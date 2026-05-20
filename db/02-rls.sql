-- Learnable — Row-Level Security policies, Phase 2.2
--
-- Run this AFTER 01-schema.sql in the Supabase SQL editor.
-- These policies enforce per-user isolation for every table.
-- The service-role key bypasses all of these — only used server-side.

-- =============================================================================
-- 1. learner_profiles — a user can only see and edit their own profile
-- =============================================================================
alter table public.learner_profiles enable row level security;

create policy "Users read own profile"
  on public.learner_profiles for select
  using (auth.uid() = user_id);

create policy "Users insert own profile"
  on public.learner_profiles for insert
  with check (auth.uid() = user_id);

create policy "Users update own profile"
  on public.learner_profiles for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- No DELETE policy by default — profiles are cleaned up via auth.users cascade.

-- =============================================================================
-- 2. courses — owner has full access; non-owners can read iff is_public
-- =============================================================================
alter table public.courses enable row level security;

create policy "Owners read own courses"
  on public.courses for select
  using (auth.uid() = owner_id);

create policy "Anyone reads public courses"
  on public.courses for select
  using (is_public = true);

create policy "Owners insert their courses"
  on public.courses for insert
  with check (auth.uid() = owner_id);

create policy "Owners update their courses"
  on public.courses for update
  using (auth.uid() = owner_id)
  with check (auth.uid() = owner_id);

create policy "Owners delete their courses"
  on public.courses for delete
  using (auth.uid() = owner_id);

-- =============================================================================
-- 3. modules — readable if you can read the parent course
-- =============================================================================
alter table public.modules enable row level security;

create policy "Read modules of accessible courses"
  on public.modules for select
  using (
    exists (
      select 1 from public.courses c
      where c.id = modules.course_id
        and (c.owner_id = auth.uid() or c.is_public = true)
    )
  );

create policy "Course owners manage modules"
  on public.modules for all
  using (
    exists (
      select 1 from public.courses c
      where c.id = modules.course_id and c.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.courses c
      where c.id = modules.course_id and c.owner_id = auth.uid()
    )
  );

-- =============================================================================
-- 4. topics — same as modules: readable through course ownership / public flag
-- =============================================================================
alter table public.topics enable row level security;

create policy "Read topics of accessible courses"
  on public.topics for select
  using (
    exists (
      select 1
      from public.modules m
      join public.courses c on c.id = m.course_id
      where m.id = topics.module_id
        and (c.owner_id = auth.uid() or c.is_public = true)
    )
  );

create policy "Course owners manage topics"
  on public.topics for all
  using (
    exists (
      select 1
      from public.modules m
      join public.courses c on c.id = m.course_id
      where m.id = topics.module_id and c.owner_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1
      from public.modules m
      join public.courses c on c.id = m.course_id
      where m.id = topics.module_id and c.owner_id = auth.uid()
    )
  );

-- =============================================================================
-- 5. progress — per-user, strictly isolated
-- =============================================================================
alter table public.progress enable row level security;

create policy "Users read own progress"
  on public.progress for select
  using (auth.uid() = user_id);

create policy "Users write own progress"
  on public.progress for all
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

-- =============================================================================
-- 6. learning_events — per-user, insert-only from the client
-- =============================================================================
alter table public.learning_events enable row level security;

create policy "Users read own events"
  on public.learning_events for select
  using (auth.uid() = user_id);

create policy "Users insert own events"
  on public.learning_events for insert
  with check (auth.uid() = user_id);

-- Intentionally NO update/delete policies on learning_events — append-only.

-- =============================================================================
-- 7. generation_jobs — owners can see their jobs, only server can write
-- =============================================================================
alter table public.generation_jobs enable row level security;

create policy "Owners read their jobs"
  on public.generation_jobs for select
  using (auth.uid() = owner_id);

create policy "Owners insert their jobs"
  on public.generation_jobs for insert
  with check (auth.uid() = owner_id);

-- Updates happen server-side via service role (bypasses RLS).
