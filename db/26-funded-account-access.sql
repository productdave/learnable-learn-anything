-- F-01: enrollment and complimentary grants only. No purchases or spending.
-- Apply independently of the provider USD ledger in migration 25.
begin;
create table public.learnable_funding_accounts (
  owner_id uuid primary key references auth.users(id) on delete cascade,
  mode text not null check (mode in ('legacy','platform')),
  state text not null default 'active' check (state in ('active','paused','revoked')),
  expires_at timestamptz,
  created_at timestamptz not null default now()
);
create table public.learnable_credit_grants (
  grant_key uuid primary key,
  owner_id uuid not null references public.learnable_funding_accounts(owner_id) on delete cascade,
  credits integer not null check (credits between 1 and 1000000),
  reason text not null check (length(trim(reason)) between 1 and 240),
  created_at timestamptz not null default now()
);
create index learnable_credit_grants_owner on public.learnable_credit_grants(owner_id);
alter table public.learnable_funding_accounts enable row level security;
alter table public.learnable_credit_grants enable row level security;
revoke all on public.learnable_funding_accounts, public.learnable_credit_grants from public, anon, authenticated, service_role;
grant select on public.learnable_funding_accounts, public.learnable_credit_grants to authenticated, service_role;
create policy funding_account_owner on public.learnable_funding_accounts for select to authenticated using (owner_id = (select auth.uid()));
create policy credit_grant_owner on public.learnable_credit_grants for select to authenticated using (owner_id = (select auth.uid()));

-- Operator-only: neither a browser JWT nor the application service role can
-- enroll accounts or mint credits. Reusing a grant key is exact, atomic replay.
create function public.grant_learnable_credits(p_owner_id uuid, p_grant_key uuid, p_credits integer, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare prior public.learnable_credit_grants; account_mode text;
begin
  select mode into account_mode from public.learnable_funding_accounts where owner_id=p_owner_id for update;
  if account_mode is distinct from 'platform' then raise exception 'Platform enrollment required'; end if;
  if p_grant_key is null or p_credits is null or p_credits not between 1 and 1000000 or p_reason is null or length(trim(p_reason)) not between 1 and 240 then
    raise exception 'Invalid credit grant';
  end if;
  insert into public.learnable_credit_grants(grant_key,owner_id,credits,reason)
    values(p_grant_key,p_owner_id,p_credits,trim(p_reason)) on conflict do nothing;
  select * into prior from public.learnable_credit_grants where grant_key=p_grant_key;
  if prior.owner_id is distinct from p_owner_id or prior.credits is distinct from p_credits or prior.reason is distinct from trim(p_reason) then
    raise exception 'Grant key already used';
  end if;
end $$;
revoke all on function public.grant_learnable_credits(uuid,uuid,integer,text) from public, anon, authenticated, service_role;

-- Aggregate inside PostgreSQL, so PostgREST's row cap cannot undercount grants.
create function public.learnable_account_access(p_owner_id uuid)
returns jsonb language sql stable security invoker set search_path = '' as $$
  select jsonb_build_object('ownerId',a.owner_id,'mode',a.mode,'state',a.state,'expiresAt',a.expires_at,
    'granted',coalesce((select sum(g.credits) from public.learnable_credit_grants g where g.owner_id=a.owner_id),0))
  from public.learnable_funding_accounts a where a.owner_id=p_owner_id;
$$;
revoke all on function public.learnable_account_access(uuid) from public, anon;
grant execute on function public.learnable_account_access(uuid) to authenticated, service_role;
commit;
