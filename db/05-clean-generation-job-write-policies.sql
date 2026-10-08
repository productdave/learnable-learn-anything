-- Repair-only migration.
--
-- Use this when db/04-agentic-workflow.sql has already run far enough for the
-- cloud schema to exist, but production health still reports:
--
--   generation_jobs_no_write_policies: false
--
-- The cloud runner owns generation_jobs writes through service-role API routes.
-- Browser clients should only be able to read their own jobs.

do $$
declare
  stale_policy record;
begin
  for stale_policy in
    select policyname
    from pg_policies
    where schemaname = 'public'
      and tablename = 'generation_jobs'
      and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
  loop
    execute format('drop policy if exists %I on public.generation_jobs', stale_policy.policyname);
  end loop;
end $$;

