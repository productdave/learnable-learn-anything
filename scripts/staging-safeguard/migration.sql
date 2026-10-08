-- Additive isolated-staging safeguard, not part of production's migration list.
-- No allowance is inserted. Only an explicit operator approval may create one.
create table public.learnable_staging_spend_budgets (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null,
  job_id text,
  profile text not null check (profile = 'sonnet45-search20250305-20260922'),
  cap_microusd bigint not null check (cap_microusd > 0 and cap_microusd <= 1000000000),
  charged_microusd bigint not null default 0 check (charged_microusd >= 0),
  max_calls integer not null check (max_calls between 1 and 100),
  calls integer not null default 0 check (calls >= 0),
  expires_at timestamptz not null,
  approved_at timestamptz not null default now(),
  approval_note text not null check (length(approval_note) between 1 and 500),
  enabled boolean not null default false,
  halted boolean not null default false,
  check (charged_microusd <= cap_microusd),
  check (expires_at > approved_at and expires_at <= approved_at + interval '24 hours'),
  check (expires_at <= timestamptz '2026-10-22 00:00:00+00')
);
create unique index learnable_staging_one_active_budget on public.learnable_staging_spend_budgets ((true)) where enabled;
create table public.learnable_staging_spend_requests (
  id uuid primary key,
  budget_id uuid not null references public.learnable_staging_spend_budgets(id),
  owner_id uuid not null,
  job_id text not null,
  run_id text not null,
  fingerprint text not null check (fingerprint ~ '^[a-f0-9]{64}$'),
  reserved_microusd bigint not null check (reserved_microusd > 0),
  actual_microusd bigint check (actual_microusd >= 0 and actual_microusd <= reserved_microusd),
  state text not null default 'pending' check (state in ('pending', 'settled')),
  provider_request_id text,
  created_at timestamptz not null default now(),
  settled_at timestamptz
);
alter table public.learnable_staging_spend_budgets enable row level security;
alter table public.learnable_staging_spend_requests enable row level security;
revoke all on public.learnable_staging_spend_budgets, public.learnable_staging_spend_requests from public, anon, authenticated, service_role;
-- Runtime may only use the narrow RPCs, never mint/edit an authorization.
create function public.reserve_learnable_staging_spend(
  p_owner_id uuid, p_job_id text, p_run_id text, p_request_id uuid,
  p_profile text, p_reserved_microusd bigint, p_fingerprint text
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare b public.learnable_staging_spend_budgets%rowtype;
begin
  if p_reserved_microusd is null or p_reserved_microusd <= 0 or p_reserved_microusd > 1000000000
    or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' or p_request_id is null then
    return jsonb_build_object('ok',false,'reason','invalid');
  end if;
  select * into b from public.learnable_staging_spend_budgets where enabled for update;
  if not found or b.owner_id is distinct from p_owner_id or b.profile is distinct from p_profile
    or b.expires_at <= clock_timestamp() or (b.job_id is not null and b.job_id is distinct from p_job_id) then
    return jsonb_build_object('ok',false,'reason','approval');
  end if;
  if b.halted then return jsonb_build_object('ok',false,'reason','halted'); end if;
  if exists (select 1 from public.learnable_staging_spend_requests where budget_id=b.id and state='pending') then
    return jsonb_build_object('ok',false,'reason','pending');
  end if;
  if exists (select 1 from public.learnable_staging_spend_requests where id=p_request_id) then
    return jsonb_build_object('ok',false,'reason','duplicate');
  end if;
  perform 1 from public.generation_jobs where id=p_job_id and owner_id=p_owner_id
    and run_id::text=p_run_id and status in ('queued','running') for share;
  if not found then return jsonb_build_object('ok',false,'reason','job'); end if;
  if b.calls >= b.max_calls or p_reserved_microusd > b.cap_microusd-b.charged_microusd then
    return jsonb_build_object('ok',false,'reason','budget');
  end if;
  insert into public.learnable_staging_spend_requests(id,budget_id,owner_id,job_id,run_id,fingerprint,reserved_microusd)
    values(p_request_id,b.id,p_owner_id,p_job_id,p_run_id,p_fingerprint,p_reserved_microusd);
  update public.learnable_staging_spend_budgets set charged_microusd=charged_microusd+p_reserved_microusd,
    calls=calls+1, job_id=p_job_id where id=b.id;
  return jsonb_build_object('ok',true);
end $$;
create function public.settle_learnable_staging_spend(
  p_owner_id uuid, p_job_id text, p_run_id text, p_request_id uuid,
  p_actual_microusd bigint, p_provider_request_id text
) returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
declare r public.learnable_staging_spend_requests%rowtype;
begin
  -- Lock order matches reserve/halt: budget then request. Settle even after
  -- cancel/expiry, but only the exact dispatch may reduce its reservation.
  perform 1 from public.learnable_staging_spend_budgets where id=(
    select budget_id from public.learnable_staging_spend_requests where id=p_request_id) for update;
  select * into r from public.learnable_staging_spend_requests where id=p_request_id for update;
  if not found or r.owner_id is distinct from p_owner_id or r.job_id is distinct from p_job_id
    or r.run_id is distinct from p_run_id or p_actual_microusd is null or p_actual_microusd < 0
    or p_actual_microusd > r.reserved_microusd then return jsonb_build_object('ok',false); end if;
  if r.state='settled' then return jsonb_build_object('ok',r.actual_microusd=p_actual_microusd); end if;
  update public.learnable_staging_spend_budgets set charged_microusd=charged_microusd-r.reserved_microusd+p_actual_microusd where id=r.budget_id;
  update public.learnable_staging_spend_requests set actual_microusd=p_actual_microusd,
    state='settled',settled_at=clock_timestamp(),provider_request_id=left(p_provider_request_id,200) where id=r.id;
  return jsonb_build_object('ok',true);
end $$;
create function public.halt_learnable_staging_spend(p_owner_id uuid,p_job_id text,p_run_id text,p_request_id uuid)
returns jsonb language plpgsql security definer set search_path = pg_catalog, public as $$
begin
  update public.learnable_staging_spend_budgets set halted=true where id in (
    select budget_id from public.learnable_staging_spend_requests where id=p_request_id
    and owner_id=p_owner_id and job_id=p_job_id and run_id=p_run_id);
  return jsonb_build_object('ok',found);
end $$;
revoke all on function public.reserve_learnable_staging_spend(uuid,text,text,uuid,text,bigint,text) from public,anon,authenticated;
revoke all on function public.settle_learnable_staging_spend(uuid,text,text,uuid,bigint,text) from public,anon,authenticated;
revoke all on function public.halt_learnable_staging_spend(uuid,text,text,uuid) from public,anon,authenticated;
grant execute on function public.reserve_learnable_staging_spend(uuid,text,text,uuid,text,bigint,text) to service_role;
grant execute on function public.settle_learnable_staging_spend(uuid,text,text,uuid,bigint,text) to service_role;
grant execute on function public.halt_learnable_staging_spend(uuid,text,text,uuid) to service_role;
