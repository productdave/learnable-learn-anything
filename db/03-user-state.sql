-- Learnable — per-user learning-state blob (Phase 2a, progress sync)
--
-- Run AFTER 01-schema.sql and 02-rls.sql. Safe to re-run.
--
-- Cross-device progress sync uses a single JSON blob per user (the same shape
-- as the app's localStorage state: progress, quizAnswers, exerciseDrafts,
-- flashcardState). This is far simpler and more robust than normalising into
-- the per-topic `progress` table for bundled (static) courses whose ids aren't
-- in the database. The normalized `progress` + `learning_events` tables remain
-- for analytics/recommendations.

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
