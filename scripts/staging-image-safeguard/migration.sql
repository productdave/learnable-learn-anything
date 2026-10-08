-- Additive STAGING ONLY. No grants inserted; production migration list unchanged.
create table public.learnable_staging_image_budgets (
  id uuid primary key default gen_random_uuid(), owner_id uuid not null, course_id text not null,
  profile text not null check (profile='gpt-image-2.5-flare-2026-09-08-medium1024-20260930'),
  cap_microusd bigint not null check(cap_microusd between 1 and 3000000),
  charged_microusd bigint not null default 0 check(charged_microusd>=0 and charged_microusd<=cap_microusd),
  max_calls integer not null check(max_calls between 1 and 3), calls integer not null default 0 check(calls>=0),
  approved_at timestamptz not null default now(), expires_at timestamptz not null,
  approval_note text not null check(length(approval_note) between 1 and 500),
  enabled boolean not null default false, halted boolean not null default false,
  check(expires_at>approved_at and expires_at<=approved_at+interval '24 hours'),
  check(expires_at<=timestamptz '2026-10-07 00:00:00+00')
);
create unique index learnable_staging_one_image_budget on public.learnable_staging_image_budgets ((true)) where enabled;
create table public.learnable_staging_image_spend (
  operation_id uuid primary key, budget_id uuid not null references public.learnable_staging_image_budgets(id),
  owner_id uuid not null, course_id text not null, fingerprint text not null check(fingerprint ~ '^[a-f0-9]{64}$'),
  reserved_microusd bigint not null check(reserved_microusd>0),
  accounted_microusd bigint check(accounted_microusd>0 and accounted_microusd<=reserved_microusd),
  state text not null default 'pending' check(state in ('pending','settled')),
  provider_request_id text, created_at timestamptz not null default now(), settled_at timestamptz
);
alter table public.learnable_staging_image_budgets enable row level security;
alter table public.learnable_staging_image_spend enable row level security;
revoke all on public.learnable_staging_image_budgets,public.learnable_staging_image_spend from public,anon,authenticated,service_role;

create function public.reserve_learnable_staging_image_spend(p_owner_id uuid,p_course_id text,p_operation_id uuid,p_fingerprint text,p_profile text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare b public.learnable_staging_image_budgets%rowtype; remaining bigint;
begin
  select * into b from public.learnable_staging_image_budgets where enabled for update;
  if not found or b.owner_id is distinct from p_owner_id or b.course_id is distinct from p_course_id or
      b.profile is distinct from p_profile or b.expires_at<=clock_timestamp() or b.halted then
    return jsonb_build_object('ok',false,'reason','approval'); end if;
  if exists(select 1 from public.learnable_staging_image_spend where budget_id=b.id and state='pending') or
     exists(select 1 from public.learnable_staging_image_spend where operation_id=p_operation_id) then
    return jsonb_build_object('ok',false,'reason','pending_or_duplicate'); end if;
  perform 1 from public.course_image_requests where owner_id=p_owner_id and course_id=p_course_id and id=p_operation_id
    and status='running' and is_current and payload->>'status'='running' and payload->>'requestHash'=p_fingerprint
    and payload->'quote'->>'model'='gpt-image-2.5-flare-2026-09-08' and payload->'quote'->>'funding'='creator'
    and payload->'quote'->>'n'='1' and payload->'quote'->>'size'='1024x1024'
    and payload->'quote'->>'quality'='medium' and payload->'quote'->>'outputFormat'='png' for share;
  if not found or p_fingerprint is null or p_fingerprint !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('ok',false,'reason','request'); end if;
  remaining:=b.cap_microusd-b.charged_microusd;
  if b.calls>=b.max_calls or remaining<1000000 then return jsonb_build_object('ok',false,'reason','budget'); end if;
  -- Reserve the ENTIRE remainder, one serial call at a time. No invented image
  -- token maximum. Unknown/timeout means the remainder stays held permanently.
  insert into public.learnable_staging_image_spend(operation_id,budget_id,owner_id,course_id,fingerprint,reserved_microusd)
    values(p_operation_id,b.id,p_owner_id,p_course_id,p_fingerprint,remaining);
  update public.learnable_staging_image_budgets set charged_microusd=charged_microusd+remaining,calls=calls+1 where id=b.id;
  return jsonb_build_object('ok',true,'reserved_microusd',remaining);
end $$;
create function public.settle_learnable_staging_image_spend(p_owner_id uuid,p_course_id text,p_operation_id uuid,p_fingerprint text,p_accounted_microusd bigint,p_provider_request_id text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
declare r public.learnable_staging_image_spend%rowtype;
begin
  perform 1 from public.learnable_staging_image_budgets where id=(select budget_id from public.learnable_staging_image_spend where operation_id=p_operation_id) for update;
  select * into r from public.learnable_staging_image_spend where operation_id=p_operation_id for update;
  if not found or r.owner_id is distinct from p_owner_id or r.course_id is distinct from p_course_id or r.fingerprint is distinct from p_fingerprint
    or p_accounted_microusd is null or p_accounted_microusd<=0 or p_accounted_microusd>r.reserved_microusd
    or p_provider_request_id is null or p_provider_request_id !~ '^req_[A-Za-z0-9_-]{1,100}$' then return jsonb_build_object('ok',false); end if;
  if r.state='settled' then return jsonb_build_object('ok',r.accounted_microusd=p_accounted_microusd and r.provider_request_id=p_provider_request_id); end if;
  update public.learnable_staging_image_budgets set charged_microusd=charged_microusd-r.reserved_microusd+p_accounted_microusd where id=r.budget_id;
  update public.learnable_staging_image_spend set accounted_microusd=p_accounted_microusd,provider_request_id=p_provider_request_id,state='settled',settled_at=clock_timestamp() where operation_id=r.operation_id;
  return jsonb_build_object('ok',true);
end $$;
create function public.halt_learnable_staging_image_spend(p_owner_id uuid,p_course_id text,p_operation_id uuid,p_fingerprint text)
returns jsonb language plpgsql security definer set search_path=pg_catalog,public as $$
begin
  update public.learnable_staging_image_budgets set halted=true where id in (select budget_id from public.learnable_staging_image_spend
    where operation_id=p_operation_id and owner_id=p_owner_id and course_id=p_course_id and fingerprint=p_fingerprint);
  return jsonb_build_object('ok',found);
end $$;
revoke all on function public.reserve_learnable_staging_image_spend(uuid,text,uuid,text,text) from public,anon,authenticated;
revoke all on function public.settle_learnable_staging_image_spend(uuid,text,uuid,text,bigint,text) from public,anon,authenticated;
revoke all on function public.halt_learnable_staging_image_spend(uuid,text,uuid,text) from public,anon,authenticated;
grant execute on function public.reserve_learnable_staging_image_spend(uuid,text,uuid,text,text) to service_role;
grant execute on function public.settle_learnable_staging_image_spend(uuid,text,uuid,text,bigint,text) to service_role;
grant execute on function public.halt_learnable_staging_image_spend(uuid,text,uuid,text) to service_role;
