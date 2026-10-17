-- Owner-funded creation is explicitly provisioned by the operator, never clients.
-- NULL caps/expiry mean tracking only. Existing capped pilots keep every limit.
-- This migration enrolls nobody, changes no existing values, and grants no access.
alter table public.learnable_ai_budgets
 add column funding_mode text not null default 'capped' check (funding_mode in ('capped','owner_funded')),
 alter column cap_microusd drop not null,
 alter column max_calls drop not null,
 alter column expires_at drop not null,
 add constraint ai_budget_funding_limits check (
  (funding_mode='capped' and cap_microusd is not null and max_calls is not null and expires_at is not null)
  or (funding_mode='owner_funded' and cap_microusd is null and max_calls is null and expires_at is null));
alter table public.learnable_ai_pilots
 add column funding_mode text not null default 'capped' check (funding_mode in ('capped','owner_funded')),
 alter column job_cap_microusd drop not null,
 alter column max_job_calls drop not null,
 alter column expires_at drop not null,
 add constraint ai_pilot_funding_limits check (
  (funding_mode='capped' and job_cap_microusd is not null and max_job_calls is not null and expires_at is not null
   and coalesce(policy->>'version','') <> 'openrouter-owner-v3')
  or (funding_mode='owner_funded' and job_cap_microusd is null and max_job_calls is null and expires_at is null
   and coalesce(policy->>'version','')='openrouter-owner-v3' and policy->>'validUntil' is null));

create or replace function public.inspect_learnable_ai_pilot(p_owner_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.learnable_ai_pilots%rowtype; pool public.learnable_ai_budgets%rowtype; owner_budget public.learnable_ai_budgets%rowtype;
begin
 select * into p from public.learnable_ai_pilots where owner_id=p_owner_id and enabled;
 if not found then return jsonb_build_object('ok',false,'reason','not_enrolled'); end if;
 if p.funding_mode='capped' and (p.expires_at<=clock_timestamp() or p.policy->>'validUntil' is null
   or (p.policy->>'validUntil')::timestamptz<=clock_timestamp()) then return jsonb_build_object('ok',false,'reason','expired'); end if;
 select * into pool from public.learnable_ai_budgets where id=p.pool_budget_id;
 select * into owner_budget from public.learnable_ai_budgets where id=p.owner_budget_id;
 if pool.id is null or owner_budget.id is null
   or pool.funding_mode is distinct from p.funding_mode or owner_budget.funding_mode is distinct from p.funding_mode or pool.owner_id is not null or pool.job_id is not null
   or owner_budget.owner_id is distinct from p_owner_id or owner_budget.job_id is not null
   or not pool.enabled or not owner_budget.enabled or pool.halted or owner_budget.halted
   or pool.expires_at<=clock_timestamp() or owner_budget.expires_at<=clock_timestamp() then
   return jsonb_build_object('ok',false,'reason','paused'); end if;
 if pool.calls>=pool.max_calls or owner_budget.calls>=owner_budget.max_calls
   or pool.committed_microusd>=pool.cap_microusd or owner_budget.committed_microusd>=owner_budget.cap_microusd then
   return jsonb_build_object('ok',false,'reason','budget'); end if;
 return jsonb_build_object('ok',true,'policy',p.policy,'pilotId',p.id,
   'fundingMode',p.funding_mode,
   'remainingMicrousd',least(pool.cap_microusd-pool.committed_microusd,owner_budget.cap_microusd-owner_budget.committed_microusd,p.job_cap_microusd));
end $$;

create or replace function public.admit_learnable_ai_job(p_owner_id uuid,p_job_id text,p_policy_hash text) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare state jsonb; p public.learnable_ai_pilots%rowtype; a public.learnable_ai_admissions%rowtype; b uuid;
begin
 if p_job_id is null or p_job_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$' or p_policy_hash is null then
   return jsonb_build_object('ok',false,'reason','invalid'); end if;
 -- Lock the operator record to serialize admission, not to add spending authority.
 select * into p from public.learnable_ai_pilots where owner_id=p_owner_id and enabled for update;
 if not found then return jsonb_build_object('ok',false,'reason','not_enrolled'); end if;
 state:=public.inspect_learnable_ai_pilot(p_owner_id);
 if not (state->>'ok')::boolean then return state; end if;
 if p.policy->>'fingerprint' is distinct from p_policy_hash then return jsonb_build_object('ok',false,'reason','policy'); end if;
 select * into a from public.learnable_ai_admissions where job_id=p_job_id;
 if found then
   if a.owner_id is distinct from p_owner_id or a.policy->>'fingerprint' is distinct from p_policy_hash then
     return jsonb_build_object('ok',false,'reason','conflict'); end if;
   return jsonb_build_object('ok',true,'policy',a.policy,'budgetIds',a.budget_ids);
 end if;
 if exists(select 1 from public.generation_jobs where id=p_job_id) then
   return jsonb_build_object('ok',false,'reason','conflict'); end if;
 insert into public.learnable_ai_budgets(owner_id,job_id,cap_microusd,max_calls,expires_at,enabled,funding_mode)
 values(p_owner_id,p_job_id,p.job_cap_microusd,p.max_job_calls,
   least(p.expires_at,(p.policy->>'validUntil')::timestamptz),true,p.funding_mode) returning id into b;
 insert into public.learnable_ai_admissions(job_id,owner_id,pilot_id,policy,budget_ids)
 values(p_job_id,p_owner_id,p.id,p.policy,array[p.pool_budget_id,p.owner_budget_id,b]) returning * into a;
 return jsonb_build_object('ok',true,'policy',a.policy,'budgetIds',a.budget_ids);
end $$;
create or replace function public.reserve_learnable_ai_spend(
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
    or (coalesce(j.ai_policy->>'version','') <> 'openrouter-owner-v3' and
      (j.ai_policy->>'validUntil' is null or (j.ai_policy->>'validUntil')::timestamptz<=clock_timestamp())) then
    return jsonb_build_object('ok',false,'reason','policy'); end if;
  ids:=j.ai_budget_ids;
  if array_length(ids,1) is distinct from 3 or (select count(distinct x) from unnest(ids) x)<>3 then
    return jsonb_build_object('ok',false,'reason','approval'); end if;
  -- Fixed lock order serializes concurrent jobs sharing a pool or owner allowance.
  for b in select * from public.learnable_ai_budgets where id=any(ids) order by id for update loop
    seen:=seen+1;
    if not b.enabled or b.halted or b.expires_at<=clock_timestamp()
      or (b.funding_mode='owner_funded') is distinct from (coalesce(j.ai_policy->>'version','')='openrouter-owner-v3')
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
