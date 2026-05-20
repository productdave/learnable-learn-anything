-- Learnable — Supabase schema, Phase 2.2
--
-- Run this in the Supabase SQL editor of a NEW project (or any project where
-- you're OK with these tables existing). Then run 02-rls.sql.
--
-- Conventions:
-- * All primary keys are uuid, default gen_random_uuid().
-- * All timestamps are timestamptz, default now().
-- * `auth.users(id)` is Supabase-managed — we reference it from our tables.
-- * `learning_events` is append-only — never UPDATE/DELETE.
-- * Status enums use plain text checks for forward-compat, not native enums.

-- =============================================================================
-- 1. learner_profiles — one row per signed-in user, captured at onboarding
-- =============================================================================
create table public.learner_profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,

  -- Captured during the 5-question onboarding flow:
  role text,                                 -- e.g. "PM", "designer", "founder"
  current_goals text[] default '{}',         -- 1-3 free-text goals
  prior_knowledge_tags text[] default '{}',  -- self-declared familiarity tags
  voice_preference text default 'conversational' check (voice_preference in ('conversational','academic','direct','playful')),
  time_budget_per_week text,                 -- e.g. "1-2 hours", "5+ hours"
  learning_style_prefs jsonb default '{}'::jsonb,  -- examples_vs_theory, reading_vs_exercise, etc.

  -- Implicitly maintained, refreshed nightly by the recommendations cron:
  derived_state jsonb default '{}'::jsonb,   -- strengths, gaps, pacing, interest clusters

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- =============================================================================
-- 2. courses — one row per generated course (owned by a user)
-- =============================================================================
create table public.courses (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,

  -- Renderer-facing fields (subset of course.json):
  slug text not null,                        -- kebab-case, used in URLs (e.g. "pour-over-coffee")
  title text not null,
  subtitle text,
  eyebrow text,                              -- e.g. "Free Course"

  -- Generation metadata:
  brief jsonb not null,                      -- the full Stage 1 CourseBrief (scope, persona, objectives, modules)
  palette jsonb default '{}'::jsonb,         -- moduleColorAccents + future palette overrides
  tone text default 'conversational',        -- which preset was used

  -- Lifecycle:
  scope text check (scope in ('single_module','mini_course','full_course')),
  status text not null default 'pending' check (status in ('pending','generating','ready','failed','archived')),
  is_public boolean not null default false,  -- if true, anyone can read the course (modules/topics)

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  unique (owner_id, slug)
);

create index courses_owner_idx on public.courses (owner_id, created_at desc);
create index courses_public_idx on public.courses (is_public) where is_public = true;

-- =============================================================================
-- 3. modules — module metadata per course
-- =============================================================================
create table public.modules (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,

  number int not null check (number between 1 and 6),
  slug text not null,
  title text not null,
  description text,
  icon text,
  color text,

  created_at timestamptz not null default now(),
  unique (course_id, number),
  unique (course_id, slug)
);

create index modules_course_idx on public.modules (course_id, number);

-- =============================================================================
-- 4. topics — full topic content (sections + flashcards)
-- =============================================================================
create table public.topics (
  id uuid primary key default gen_random_uuid(),
  module_id uuid not null references public.modules(id) on delete cascade,

  slug text not null,
  title text not null,
  estimated_minutes int default 15,
  schema_version int not null default 1,    -- bump when section schema evolves

  -- The full topic body — sections[] + flashcards[]. Matches the renderer schema.
  content jsonb not null,

  -- Optional grounding: sources surfaced under the topic (from Stage 2 research)
  sources jsonb default '[]'::jsonb,

  status text not null default 'pending' check (status in ('pending','generating','ready','failed')),

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (module_id, slug)
);

create index topics_module_idx on public.topics (module_id);

-- =============================================================================
-- 5. progress — one row per (user × topic). Tracks completion + state.
-- =============================================================================
create table public.progress (
  user_id uuid not null references auth.users(id) on delete cascade,
  topic_id uuid not null references public.topics(id) on delete cascade,

  completed_at timestamptz,                 -- null = not completed yet
  flashcard_state jsonb default '{}'::jsonb, -- SM-2 state per card
  exercise_responses jsonb default '{}'::jsonb,
  quiz_answers jsonb default '{}'::jsonb,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (user_id, topic_id)
);

create index progress_user_idx on public.progress (user_id, updated_at desc);

-- =============================================================================
-- 6. learning_events — append-only journal of every meaningful interaction
-- =============================================================================
create table public.learning_events (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  course_id uuid references public.courses(id) on delete cascade,
  topic_id uuid references public.topics(id) on delete cascade,

  event_type text not null check (event_type in (
    'topic_started','topic_completed','topic_abandoned',
    'quiz_answered','exercise_submitted','flashcard_reviewed',
    'chat_question_asked','marked_helpful','marked_unhelpful',
    'regenerate_requested','course_generated'
  )),

  -- Free-form payload — e.g. for quiz_answered: { quiz_id, variant, selected, correct }
  payload jsonb default '{}'::jsonb,

  created_at timestamptz not null default now()
);

create index learning_events_user_idx on public.learning_events (user_id, created_at desc);
create index learning_events_topic_idx on public.learning_events (topic_id, created_at desc) where topic_id is not null;

-- =============================================================================
-- 7. generation_jobs — track the 4-stage generator pipeline per course
-- =============================================================================
create table public.generation_jobs (
  id uuid primary key default gen_random_uuid(),
  course_id uuid not null references public.courses(id) on delete cascade,
  owner_id uuid not null references auth.users(id) on delete cascade,

  stage text not null check (stage in ('intake','research','topics','assemble','done','failed')),
  status text not null default 'running' check (status in ('queued','running','succeeded','failed')),
  error text,                                -- when status='failed'
  payload jsonb default '{}'::jsonb,         -- e.g. user brief, partial progress, etc.

  started_at timestamptz not null default now(),
  completed_at timestamptz,

  created_at timestamptz not null default now()
);

create index generation_jobs_course_idx on public.generation_jobs (course_id, started_at desc);
create index generation_jobs_owner_idx on public.generation_jobs (owner_id, started_at desc);

-- =============================================================================
-- updated_at triggers — keep updated_at fresh on every UPDATE
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

create trigger learner_profiles_set_updated_at before update on public.learner_profiles
  for each row execute function public.set_updated_at();
create trigger courses_set_updated_at before update on public.courses
  for each row execute function public.set_updated_at();
create trigger topics_set_updated_at before update on public.topics
  for each row execute function public.set_updated_at();
create trigger progress_set_updated_at before update on public.progress
  for each row execute function public.set_updated_at();
