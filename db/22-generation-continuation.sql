-- Server-owned safe time-slice handoff. Apply before deploying continuation code.
-- No new status, policy, grant, provider credential, source content or public data.
-- Existing generation_jobs RLS permits owners to read; service role owns writes.
begin;
alter table public.generation_jobs add column if not exists continuation jsonb;
alter table public.generation_jobs drop constraint if exists generation_jobs_continuation_check;
alter table public.generation_jobs add constraint generation_jobs_continuation_check
  check (continuation is null or coalesce((
    jsonb_typeof(continuation) = 'object'
    and continuation->>'version' = '1'
    and continuation->>'phase' in ('pending', 'running', 'held')
  ), false));
comment on column public.generation_jobs.continuation is
  'Private server-owned time-slice handoff identity, progress digest and bounded counters; never an approval to spend.';
commit;
