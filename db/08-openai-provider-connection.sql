-- Forward-only change: keep all existing encrypted Claude credentials and grants.
-- Funding is enforced by server policy, never inferred from a provider row.
alter table public.provider_connections
  drop constraint provider_connections_provider_check;
alter table public.provider_connections
  add constraint provider_connections_provider_check
  check (provider in ('anthropic', 'openai'));
-- Deliberately no browser policies/grants, storage bucket or paid job endpoint.
