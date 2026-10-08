-- Forward-only protection for the table preserved by migration 04.
-- Keep every historical row and its schema. Browser roles must not read or
-- mutate an internal archive; this does not migrate, infer or delete history.
alter table public.generation_jobs_legacy_phase22 enable row level security;
revoke all on public.generation_jobs_legacy_phase22 from public, anon, authenticated;
