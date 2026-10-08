-- Learnable — agentic workflow storage
--
-- Run after 01-schema.sql, 02-rls.sql, and 03-user-state.sql.
--
-- This migration aligns Supabase with the current agentic course builder:
-- - `user_courses` is the renderer-facing JSON course store.
-- - `generation_jobs` is a durable agent state machine with human checkpoints.
-- - `course-uploads` stores PDFs uploaded for cloud generation.
-- - `user_state` stores the user's synced API key and learning progress.

-- =============================================================================
-- 0. user_state — synced progress + per-user API key for cloud agents
-- =============================================================================
create table if not exists public.user_state (
  user_id uuid primary key references auth.users(id) on delete cascade,
  state jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

alter table public.user_state enable row level security;

drop policy if exists "Users read own state" on public.user_state;
create policy "Users read own state"
  on public.user_state for select
  using (auth.uid() = user_id);

drop policy if exists "Users insert own state" on public.user_state;
create policy "Users insert own state"
  on public.user_state for insert
  with check (auth.uid() = user_id);

drop policy if exists "Users update own state" on public.user_state;
create policy "Users update own state"
  on public.user_state for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =============================================================================
-- 1. user_courses — one JSON payload per generated course per user
-- =============================================================================
create table if not exists public.user_courses (
  id text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id, owner_id)
);

alter table public.user_courses add column if not exists created_at timestamptz not null default now();
alter table public.user_courses add column if not exists updated_at timestamptz not null default now();

alter table public.user_courses enable row level security;

drop policy if exists "owner_select" on public.user_courses;
drop policy if exists "owner_insert" on public.user_courses;
drop policy if exists "owner_update" on public.user_courses;
drop policy if exists "owner_delete" on public.user_courses;

create policy "owner_select" on public.user_courses
  for select using (auth.uid() = owner_id);

create policy "owner_insert" on public.user_courses
  for insert with check (auth.uid() = owner_id);

create policy "owner_update" on public.user_courses
  for update using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "owner_delete" on public.user_courses
  for delete using (auth.uid() = owner_id);

-- =============================================================================
-- 2. generation_jobs — durable state for the agentic workflow
-- =============================================================================
do $$
begin
  if exists (
    select 1
    from information_schema.tables
    where table_schema = 'public'
      and table_name = 'generation_jobs'
  ) and not exists (
    select 1
    from information_schema.columns
    where table_schema = 'public'
      and table_name = 'generation_jobs'
      and column_name = 'user_brief'
  ) then
    alter table public.generation_jobs rename to generation_jobs_legacy_phase22;
  end if;
end $$;

create table if not exists public.generation_jobs (
  id text primary key,
  owner_id uuid not null references auth.users(id) on delete cascade,

  user_brief jsonb not null default '{}'::jsonb,
  extracted_urls jsonb not null default '[]'::jsonb,
  brief jsonb,
  outline jsonb,
  research jsonb not null default '{}'::jsonb,
  topics_by_key jsonb not null default '{}'::jsonb,
  failures jsonb not null default '[]'::jsonb,
  review_history jsonb not null default '[]'::jsonb,

  status text not null default 'queued' check (status in (
    'queued',
    'running',
    'review_curriculum',
    'review_research',
    'cancelling',
    'completed',
    'partial',
    'failed',
    'cancelled',
    'timed_out'
  )),
  stage text not null default 'intake' check (stage in (
    'intake',
    'research',
    'topics',
    'assemble',
    'done'
  )),
  message text,
  error text,
  run_id text,
  recovery_attempts int not null default 0,
  last_recovery_at timestamptz,
  topics_done int not null default 0,
  topics_total int not null default 0,
  saved_course_id text,

  created_at timestamptz not null default now(),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  heartbeat_at timestamptz not null default now(),
  lease_expires_at timestamptz not null default (now() + interval '6 minutes'),
  completed_at timestamptz
);

alter table public.generation_jobs add column if not exists user_brief jsonb not null default '{}'::jsonb;
alter table public.generation_jobs add column if not exists extracted_urls jsonb not null default '[]'::jsonb;
alter table public.generation_jobs add column if not exists brief jsonb;
alter table public.generation_jobs add column if not exists outline jsonb;
alter table public.generation_jobs add column if not exists research jsonb not null default '{}'::jsonb;
alter table public.generation_jobs add column if not exists topics_by_key jsonb not null default '{}'::jsonb;
alter table public.generation_jobs add column if not exists failures jsonb not null default '[]'::jsonb;
alter table public.generation_jobs add column if not exists review_history jsonb not null default '[]'::jsonb;
alter table public.generation_jobs add column if not exists message text;
alter table public.generation_jobs add column if not exists run_id text;
alter table public.generation_jobs add column if not exists recovery_attempts int not null default 0;
alter table public.generation_jobs add column if not exists last_recovery_at timestamptz;
alter table public.generation_jobs add column if not exists topics_done int not null default 0;
alter table public.generation_jobs add column if not exists topics_total int not null default 0;
alter table public.generation_jobs add column if not exists saved_course_id text;
alter table public.generation_jobs add column if not exists created_at timestamptz not null default now();
alter table public.generation_jobs add column if not exists started_at timestamptz not null default now();
alter table public.generation_jobs add column if not exists heartbeat_at timestamptz not null default now();
alter table public.generation_jobs add column if not exists lease_expires_at timestamptz not null default (now() + interval '6 minutes');
alter table public.generation_jobs add column if not exists completed_at timestamptz;

alter table public.generation_jobs
  drop constraint if exists generation_jobs_status_check;

alter table public.generation_jobs
  add constraint generation_jobs_status_check
  check (status in (
    'queued',
    'running',
    'review_curriculum',
    'review_research',
    'cancelling',
    'completed',
    'partial',
    'failed',
    'cancelled',
    'timed_out'
  ));

alter table public.generation_jobs
  drop constraint if exists generation_jobs_stage_check;

alter table public.generation_jobs
  add constraint generation_jobs_stage_check
  check (stage in (
    'intake',
    'research',
    'topics',
    'assemble',
    'done'
  ));

alter table public.generation_jobs
  drop constraint if exists generation_jobs_id_safe_check;

alter table public.generation_jobs
  add constraint generation_jobs_id_safe_check
  check (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$');

update public.generation_jobs
set
  recovery_attempts = greatest(0, recovery_attempts),
  topics_done = greatest(0, topics_done),
  topics_total = greatest(greatest(0, topics_total), greatest(0, topics_done));

alter table public.generation_jobs
  drop constraint if exists generation_jobs_counters_check;

alter table public.generation_jobs
  add constraint generation_jobs_counters_check
  check (
    recovery_attempts >= 0
    and topics_done >= 0
    and topics_total >= 0
    and topics_done <= topics_total
  );

update public.generation_jobs
set completed_at = null
where status in ('queued', 'running', 'review_curriculum', 'review_research', 'cancelling');

update public.generation_jobs
set completed_at = coalesce(completed_at, updated_at, heartbeat_at, now())
where status in ('completed', 'partial', 'failed', 'cancelled', 'timed_out');

alter table public.generation_jobs
  drop constraint if exists generation_jobs_completion_check;

alter table public.generation_jobs
  add constraint generation_jobs_completion_check
  check (
    (
      status in ('queued', 'running', 'review_curriculum', 'review_research', 'cancelling')
      and completed_at is null
    )
    or (
      status in ('completed', 'partial', 'failed', 'cancelled', 'timed_out')
      and completed_at is not null
    )
  );

create index if not exists generation_jobs_v2_owner_idx on public.generation_jobs (owner_id, updated_at desc);
create index if not exists generation_jobs_v2_status_idx on public.generation_jobs (status, updated_at desc);

alter table public.generation_jobs enable row level security;

drop policy if exists "Owners read their jobs" on public.generation_jobs;
drop policy if exists "Owners insert their jobs" on public.generation_jobs;
drop policy if exists "Owners update their jobs" on public.generation_jobs;
drop policy if exists "Owners delete their jobs" on public.generation_jobs;

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

create policy "Owners read their jobs"
  on public.generation_jobs for select
  using (auth.uid() = owner_id);

-- No client insert/update/delete policies: generation_jobs is a server-owned
-- state machine. API routes authenticate the user, then mutate rows with the
-- service-role client while still filtering by owner_id.

-- =============================================================================
-- 3. course-uploads — PDFs for cloud generation
-- =============================================================================
insert into storage.buckets (id, name, public)
values ('course-uploads', 'course-uploads', false)
on conflict (id) do nothing;

drop policy if exists "Users manage own course uploads" on storage.objects;

create policy "Users manage own course uploads"
  on storage.objects for all
  using (
    bucket_id = 'course-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  )
  with check (
    bucket_id = 'course-uploads'
    and auth.uid()::text = (storage.foldername(name))[1]
  );

-- =============================================================================
-- updated_at trigger for generation_jobs
-- =============================================================================
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists generation_jobs_set_updated_at on public.generation_jobs;
create trigger generation_jobs_set_updated_at before update on public.generation_jobs
  for each row execute function public.set_updated_at();

-- =============================================================================
-- Atomic generation cleanup
-- =============================================================================
create or replace function public.delete_generation_job_for_owner(
  p_job_id text,
  p_owner_id uuid
)
returns table(deleted_course_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_saved_course_id text;
begin
  select status, saved_course_id
    into v_status, v_saved_course_id
  from public.generation_jobs
  where id = p_job_id
    and owner_id = p_owner_id
  for update;

  if not found then
    return;
  end if;

  if v_status not in ('review_curriculum', 'review_research', 'partial', 'failed', 'timed_out', 'cancelled', 'completed') then
    raise exception 'JOB_NOT_DELETABLE:%', v_status;
  end if;

  select uc.id
    into deleted_course_id
  from public.user_courses uc
  where uc.owner_id = p_owner_id
    and uc.payload->>'_generationJobId' = p_job_id
  order by (uc.id = v_saved_course_id) desc, uc.updated_at desc
  limit 1;

  delete from public.generation_jobs
  where id = p_job_id
    and owner_id = p_owner_id;

  delete from public.user_courses
  where owner_id = p_owner_id
    and payload->>'_generationJobId' = p_job_id;

  return next;
end;
$$;

revoke all on function public.delete_generation_job_for_owner(text, uuid) from public;
revoke all on function public.delete_generation_job_for_owner(text, uuid) from anon;
revoke all on function public.delete_generation_job_for_owner(text, uuid) from authenticated;
grant execute on function public.delete_generation_job_for_owner(text, uuid) to service_role;

-- =============================================================================
-- Workflow health metadata
-- =============================================================================
create or replace function public.generation_workflow_health()
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select jsonb_build_object(
    'status_constraint', exists (
      select 1
      from pg_constraint
      where conrelid = 'public.generation_jobs'::regclass
        and conname = 'generation_jobs_status_check'
        and pg_get_constraintdef(oid) like '%review_curriculum%'
        and pg_get_constraintdef(oid) like '%review_research%'
        and pg_get_constraintdef(oid) like '%timed_out%'
    ),
    'stage_constraint', exists (
      select 1
      from pg_constraint
      where conrelid = 'public.generation_jobs'::regclass
        and conname = 'generation_jobs_stage_check'
        and pg_get_constraintdef(oid) like '%intake%'
        and pg_get_constraintdef(oid) like '%research%'
        and pg_get_constraintdef(oid) like '%topics%'
        and pg_get_constraintdef(oid) like '%assemble%'
        and pg_get_constraintdef(oid) like '%done%'
    ),
    'job_id_constraint', exists (
      select 1
      from pg_constraint
      where conrelid = 'public.generation_jobs'::regclass
        and conname = 'generation_jobs_id_safe_check'
        and pg_get_constraintdef(oid) like '%A-Za-z0-9%'
        and pg_get_constraintdef(oid) like '%0,127%'
    ),
    'counter_constraint', exists (
      select 1
      from pg_constraint
      where conrelid = 'public.generation_jobs'::regclass
        and conname = 'generation_jobs_counters_check'
        and pg_get_constraintdef(oid) like '%recovery_attempts >= 0%'
        and pg_get_constraintdef(oid) like '%topics_done >= 0%'
        and pg_get_constraintdef(oid) like '%topics_total >= 0%'
        and pg_get_constraintdef(oid) like '%topics_done <= topics_total%'
    ),
    'completion_constraint', exists (
      select 1
      from pg_constraint
      where conrelid = 'public.generation_jobs'::regclass
        and conname = 'generation_jobs_completion_check'
        and lower(pg_get_constraintdef(oid)) like '%completed_at is null%'
        and lower(pg_get_constraintdef(oid)) like '%completed_at is not null%'
        and pg_get_constraintdef(oid) like '%review_curriculum%'
        and pg_get_constraintdef(oid) like '%timed_out%'
    ),
    'generation_jobs_rls_enabled', exists (
      select 1
      from pg_tables
      where schemaname = 'public'
        and tablename = 'generation_jobs'
        and rowsecurity = true
    ),
    'generation_jobs_no_write_policies', not exists (
      select 1
      from pg_policies
      where schemaname = 'public'
        and tablename = 'generation_jobs'
        and cmd in ('INSERT', 'UPDATE', 'DELETE', 'ALL')
    ),
    'generation_jobs_updated_at_trigger', exists (
      select 1
      from pg_trigger t
      join pg_proc p on p.oid = t.tgfoid
      join pg_namespace n on n.oid = p.pronamespace
      where t.tgrelid = 'public.generation_jobs'::regclass
        and t.tgname = 'generation_jobs_set_updated_at'
        and not t.tgisinternal
        and n.nspname = 'public'
        and p.proname = 'set_updated_at'
    ),
    'user_state_rls_enabled', exists (
      select 1
      from pg_tables
      where schemaname = 'public'
        and tablename = 'user_state'
        and rowsecurity = true
    ),
    'user_state_owner_policies', (
      exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'user_state'
          and policyname = 'Users read own state'
          and cmd = 'SELECT'
      )
      and exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'user_state'
          and policyname = 'Users insert own state'
          and cmd = 'INSERT'
      )
      and exists (
        select 1
        from pg_policies
        where schemaname = 'public'
          and tablename = 'user_state'
          and policyname = 'Users update own state'
          and cmd = 'UPDATE'
      )
    ),
    'course_uploads_owner_policy', exists (
      select 1
      from pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
        and policyname = 'Users manage own course uploads'
        and cmd = 'ALL'
        and qual like '%course-uploads%'
        and qual like '%storage.foldername(name)%'
        and with_check like '%course-uploads%'
        and with_check like '%storage.foldername(name)%'
    ),
    'user_courses_owner_key', exists (
      select 1
      from pg_constraint c
      where c.conrelid = 'public.user_courses'::regclass
        and c.contype in ('p', 'u')
        and (
          select array_agg(a.attname::text order by k.ord)
          from unnest(c.conkey) with ordinality as k(attnum, ord)
          join pg_attribute a
            on a.attrelid = c.conrelid
           and a.attnum = k.attnum
        ) = array['id', 'owner_id']
    ),
    'delete_generation_job_rpc_service_only', exists (
      select 1
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public'
        and p.proname = 'delete_generation_job_for_owner'
        and p.prosecdef = true
        and p.proacl is not null
        and has_function_privilege('service_role', 'public.delete_generation_job_for_owner(text, uuid)', 'EXECUTE')
        and not has_function_privilege('anon', 'public.delete_generation_job_for_owner(text, uuid)', 'EXECUTE')
        and not has_function_privilege('authenticated', 'public.delete_generation_job_for_owner(text, uuid)', 'EXECUTE')
    )
  );
$$;

revoke all on function public.generation_workflow_health() from public;
revoke all on function public.generation_workflow_health() from anon;
revoke all on function public.generation_workflow_health() from authenticated;
grant execute on function public.generation_workflow_health() to service_role;
