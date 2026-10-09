-- Additive platform-funding foundation. Installs NO allowance and enables NO job.
-- Apply only to an explicitly selected environment after local acceptance.
alter table public.generation_jobs add column if not exists ai_policy jsonb;
alter table public.generation_jobs add column if not exists ai_budget_ids uuid[];

-- A continuation/restart must retain its original funding policy and allowance.
-- New platform jobs must be inserted with their binding; legacy jobs stay legacy.
create function public.preserve_generation_ai_binding() returns trigger
language plpgsql set search_path=pg_catalog,public as $$
begin
  if new.ai_policy is distinct from old.ai_policy or new.ai_budget_ids is distinct from old.ai_budget_ids then
    raise exception 'Generation AI funding binding is immutable';
  end if;
  if old.ai_policy is not null and (new.owner_id is distinct from old.owner_id or new.id is distinct from old.id) then
    raise exception 'Platform generation identity is immutable';
  end if;
  return new;
end $$;
create trigger preserve_generation_ai_binding before update on public.generation_jobs
for each row execute function public.preserve_generation_ai_binding();
revoke all on function public.preserve_generation_ai_binding() from public,anon,authenticated,service_role;

create table public.learnable_ai_budgets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid,
  job_id text,
  cap_microusd bigint not null check (cap_microusd between 1 and 1000000000),
  committed_microusd bigint not null default 0 check (committed_microusd >= 0),
  max_calls integer not null check (max_calls between 1 and 10000),
  calls integer not null default 0 check (calls >= 0),
  expires_at timestamptz not null,
  enabled boolean not null default false,
  halted boolean not null default false,
  check (committed_microusd <= cap_microusd),
  check (job_id is null or owner_id is not null)
);
create table public.learnable_ai_requests (
  id uuid primary key,
  owner_id uuid not null,
  job_id text not null,
  run_id text not null,
  budget_ids uuid[] not null,
  policy_hash text not null check (policy_hash ~ '^[a-f0-9]{64}$'),
  operation_key text not null check (length(operation_key) between 1 and 200),
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  task text not null,
  model text not null,
  reserved_microusd bigint not null check (reserved_microusd > 0),
  actual_microusd bigint check (actual_microusd >= 0 and actual_microusd <= reserved_microusd),
  state text not null default 'pending' check (state in ('pending','settled')),
  provider_request_id text,
  usage jsonb,
  created_at timestamptz not null default clock_timestamp(),
  settled_at timestamptz,
  unique(job_id, policy_hash, operation_key)
);
create index learnable_ai_requests_job_pending on public.learnable_ai_requests(job_id) where state='pending';
create unique index learnable_ai_requests_receipt on public.learnable_ai_requests(provider_request_id) where provider_request_id is not null;
alter table public.learnable_ai_budgets enable row level security;
alter table public.learnable_ai_requests enable row level security;
revoke all on public.learnable_ai_budgets,public.learnable_ai_requests from public,anon,authenticated,service_role;

create function public.reserve_learnable_ai_spend(
  p_owner_id uuid,p_job_id text,p_run_id text,p_request_id uuid,
  p_operation_key text,p_fingerprint text,p_policy_hash text,p_reserved_microusd bigint,
  p_model text,p_task text
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare j public.generation_jobs%rowtype; b public.learnable_ai_budgets%rowtype;
  ids uuid[]; seen integer:=0; global_scopes integer:=0; owner_scopes integer:=0; job_scopes integer:=0;
begin
  if p_request_id is null or p_owner_id is null or p_run_id is null or length(p_operation_key) not between 1 and 200
    or p_operation_key is null or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$'
    or p_policy_hash is null or p_policy_hash !~ '^[a-f0-9]{64}$'
    or p_reserved_microusd is null or p_reserved_microusd not between 1 and 1000000000 then
    return jsonb_build_object('ok',false,'reason','invalid'); end if;
  -- Never accept caller-supplied budget IDs or policy. Bind to the owned job/lease.
  select * into j from public.generation_jobs where id=p_job_id and owner_id=p_owner_id
    and run_id::text=p_run_id and status in ('queued','running')
    and lease_expires_at>clock_timestamp() for share;
  if not found then return jsonb_build_object('ok',false,'reason','job'); end if;
  if j.ai_policy->>'fingerprint' is distinct from p_policy_hash
    or j.ai_policy->>'funding' is distinct from 'platform'
    or j.ai_policy->'routes'->p_task->>'model' is distinct from p_model
    or p_model is null or p_task is null
    or j.ai_policy->>'validUntil' is null
    or (j.ai_policy->>'validUntil')::timestamptz<=clock_timestamp() then
    return jsonb_build_object('ok',false,'reason','policy'); end if;
  ids:=j.ai_budget_ids;
  if array_length(ids,1) is distinct from 3 or (select count(distinct x) from unnest(ids) x)<>3 then
    return jsonb_build_object('ok',false,'reason','approval'); end if;
  -- Fixed lock order serializes concurrent jobs sharing a pool or owner allowance.
  for b in select * from public.learnable_ai_budgets where id=any(ids) order by id for update loop
    seen:=seen+1;
    if not b.enabled or b.halted or b.expires_at<=clock_timestamp()
      or (b.owner_id is not null and b.owner_id is distinct from p_owner_id)
      or (b.job_id is not null and b.job_id is distinct from p_job_id) then
      return jsonb_build_object('ok',false,'reason','approval'); end if;
    if b.owner_id is null and b.job_id is null then global_scopes:=global_scopes+1;
    elsif b.job_id is null then owner_scopes:=owner_scopes+1;
    else job_scopes:=job_scopes+1; end if;
    if b.calls>=b.max_calls or p_reserved_microusd>b.cap_microusd-b.committed_microusd then
      return jsonb_build_object('ok',false,'reason','budget'); end if;
  end loop;
  if seen<>3 or global_scopes<>1 or owner_scopes<>1 or job_scopes<>1 then
    return jsonb_build_object('ok',false,'reason','approval'); end if;
  -- A prior runner may have dispatched before a crash/lost reply. Hold until reconciled.
  if exists(select 1 from public.learnable_ai_requests where job_id=p_job_id and state='pending' and run_id<>p_run_id) then
    return jsonb_build_object('ok',false,'reason','pending'); end if;
  if exists(select 1 from public.learnable_ai_requests where id=p_request_id
    or (job_id=p_job_id and policy_hash=p_policy_hash and operation_key=p_operation_key)) then
    return jsonb_build_object('ok',false,'reason','duplicate'); end if;
  insert into public.learnable_ai_requests(id,owner_id,job_id,run_id,budget_ids,policy_hash,
    operation_key,fingerprint,task,model,reserved_microusd)
    values(p_request_id,p_owner_id,p_job_id,p_run_id,ids,p_policy_hash,p_operation_key,p_fingerprint,p_task,p_model,p_reserved_microusd);
  update public.learnable_ai_budgets set committed_microusd=committed_microusd+p_reserved_microusd,calls=calls+1 where id=any(ids);
  return jsonb_build_object('ok',true);
end $$;

create function public.settle_learnable_ai_spend(
  p_owner_id uuid,p_job_id text,p_run_id text,p_request_id uuid,p_actual_microusd bigint,
  p_provider_request_id text,p_usage jsonb
) returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.learnable_ai_requests%rowtype; ids uuid[];
begin
  select budget_ids into ids from public.learnable_ai_requests where id=p_request_id;
  perform 1 from public.learnable_ai_budgets where id=any(ids) order by id for update;
  select * into r from public.learnable_ai_requests where id=p_request_id for update;
  if not found or r.owner_id is distinct from p_owner_id or r.job_id is distinct from p_job_id or r.run_id is distinct from p_run_id
    or p_actual_microusd is null or p_actual_microusd<0 or p_actual_microusd>r.reserved_microusd
    or p_provider_request_id is null or p_provider_request_id !~ '^gen-[A-Za-z0-9_-]{1,180}$'
    or p_usage is null or jsonb_typeof(p_usage)<>'object' or octet_length(p_usage::text)>10000 then
    return jsonb_build_object('ok',false); end if;
  if r.state='settled' then return jsonb_build_object('ok',r.actual_microusd=p_actual_microusd
    and r.provider_request_id=p_provider_request_id and r.usage=p_usage); end if;
  if exists(select 1 from public.learnable_ai_requests where provider_request_id=p_provider_request_id and id<>r.id) then
    return jsonb_build_object('ok',false); end if;
  update public.learnable_ai_budgets set committed_microusd=committed_microusd-r.reserved_microusd+p_actual_microusd where id=any(r.budget_ids);
  update public.learnable_ai_requests set actual_microusd=p_actual_microusd,state='settled',
    provider_request_id=p_provider_request_id,usage=p_usage,settled_at=clock_timestamp() where id=r.id;
  return jsonb_build_object('ok',true);
end $$;

create function public.halt_learnable_ai_spend(p_owner_id uuid,p_job_id text,p_run_id text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare ids uuid[];
begin
  select budget_ids into ids from public.learnable_ai_requests where id=p_request_id
    and owner_id=p_owner_id and job_id=p_job_id and run_id=p_run_id;
  -- Same lock order as reserve/settle. No automatic expiry refund or reopening.
  perform 1 from public.learnable_ai_budgets where id=any(ids) order by id for update;
  update public.learnable_ai_budgets set halted=true where id=any(ids);
  return jsonb_build_object('ok',found);
end $$;

revoke all on function public.reserve_learnable_ai_spend(uuid,text,text,uuid,text,text,text,bigint,text,text) from public,anon,authenticated;
revoke all on function public.settle_learnable_ai_spend(uuid,text,text,uuid,bigint,text,jsonb) from public,anon,authenticated;
revoke all on function public.halt_learnable_ai_spend(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.reserve_learnable_ai_spend(uuid,text,text,uuid,text,text,text,bigint,text,text) to service_role;
grant execute on function public.settle_learnable_ai_spend(uuid,text,text,uuid,bigint,text,jsonb) to service_role;
grant execute on function public.halt_learnable_ai_spend(uuid,text,text,uuid) to service_role;
