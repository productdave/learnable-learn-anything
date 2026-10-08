-- Server-only encrypted BYO credentials for the new creator. No legacy keys move.
create table if not exists public.provider_connections (
  owner_id uuid not null references auth.users(id) on delete cascade,
  provider text not null check (provider = 'anthropic'),
  encrypted_key text not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, provider)
);
alter table public.provider_connections enable row level security;
revoke all on public.provider_connections from public, anon, authenticated;
grant select, insert, update, delete on public.provider_connections to service_role;
