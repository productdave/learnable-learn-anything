-- Private operator-funded pilot. No customer wallet, purchase or automatic reload.
-- Migration creates no enrollment or allowance. Only postgres provisions pilots.
-- Native cited evidence is saved before the separate structured submission.
alter table public.generation_jobs add column research_evidence jsonb;
create table public.learnable_ai_pilots (
 id uuid primary key default gen_random_uuid(), owner_id uuid not null,
 policy jsonb not null check (jsonb_typeof(policy)='object'),
 pool_budget_id uuid not null references public.learnable_ai_budgets(id),
 owner_budget_id uuid not null references public.learnable_ai_budgets(id),
 job_cap_microusd bigint not null check(job_cap_microusd between 1 and 1000000000),
 max_job_calls integer not null check(max_job_calls between 1 and 1000),
 expires_at timestamptz not null, enabled boolean not null default false,
 created_at timestamptz not null default clock_timestamp(), approval_note text not null
);
create unique index learnable_ai_pilots_active_owner on public.learnable_ai_pilots(owner_id) where enabled;
create table public.learnable_ai_admissions (
 job_id text primary key, owner_id uuid not null,
 pilot_id uuid not null references public.learnable_ai_pilots(id),
 policy jsonb not null, budget_ids uuid[] not null,
 created_at timestamptz not null default clock_timestamp()
);
alter table public.learnable_ai_pilots enable row level security;
alter table public.learnable_ai_admissions enable row level security;
revoke all on public.learnable_ai_pilots,public.learnable_ai_admissions from public,anon,authenticated,service_role;

create function public.inspect_learnable_ai_pilot(p_owner_id uuid) returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare p public.learnable_ai_pilots%rowtype; pool public.learnable_ai_budgets%rowtype; owner_budget public.learnable_ai_budgets%rowtype;
begin
 select * into p from public.learnable_ai_pilots where owner_id=p_owner_id and enabled;
 if not found then return jsonb_build_object('ok',false,'reason','not_enrolled'); end if;
 if p.expires_at<=clock_timestamp() or p.policy->>'validUntil' is null
   or (p.policy->>'validUntil')::timestamptz<=clock_timestamp() then return jsonb_build_object('ok',false,'reason','expired'); end if;
 select * into pool from public.learnable_ai_budgets where id=p.pool_budget_id;
 select * into owner_budget from public.learnable_ai_budgets where id=p.owner_budget_id;
 if pool.id is null or owner_budget.id is null or pool.owner_id is not null or pool.job_id is not null
   or owner_budget.owner_id is distinct from p_owner_id or owner_budget.job_id is not null
   or not pool.enabled or not owner_budget.enabled or pool.halted or owner_budget.halted
   or pool.expires_at<=clock_timestamp() or owner_budget.expires_at<=clock_timestamp() then
   return jsonb_build_object('ok',false,'reason','paused'); end if;
 if pool.calls>=pool.max_calls or owner_budget.calls>=owner_budget.max_calls
   or pool.committed_microusd>=pool.cap_microusd or owner_budget.committed_microusd>=owner_budget.cap_microusd then
   return jsonb_build_object('ok',false,'reason','budget'); end if;
 return jsonb_build_object('ok',true,'policy',p.policy,'pilotId',p.id,
   'remainingMicrousd',least(pool.cap_microusd-pool.committed_microusd,owner_budget.cap_microusd-owner_budget.committed_microusd,p.job_cap_microusd));
end $$;

create function public.admit_learnable_ai_job(p_owner_id uuid,p_job_id text,p_policy_hash text) returns jsonb
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
 insert into public.learnable_ai_budgets(owner_id,job_id,cap_microusd,max_calls,expires_at,enabled)
 values(p_owner_id,p_job_id,p.job_cap_microusd,p.max_job_calls,
   least(p.expires_at,(p.policy->>'validUntil')::timestamptz),true) returning id into b;
 insert into public.learnable_ai_admissions(job_id,owner_id,pilot_id,policy,budget_ids)
 values(p_job_id,p_owner_id,p.id,p.policy,array[p.pool_budget_id,p.owner_budget_id,b]) returning * into a;
 return jsonb_build_object('ok',true,'policy',a.policy,'budgetIds',a.budget_ids);
end $$;
revoke all on function public.inspect_learnable_ai_pilot(uuid) from public,anon,authenticated;
revoke all on function public.admit_learnable_ai_job(uuid,text,text) from public,anon,authenticated;
grant execute on function public.inspect_learnable_ai_pilot(uuid) to service_role;
grant execute on function public.admit_learnable_ai_job(uuid,text,text) to service_role;
