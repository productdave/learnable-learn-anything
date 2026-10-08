-- Search only approved public snapshot metadata. Existing ownership/RLS stays intact.
create extension if not exists pg_trgm with schema extensions;
alter table public.course_publications add column listing_search text generated always as (
  coalesce(snapshot->>'title','') || ' ' || coalesce(snapshot->>'subtitle','') || ' ' || coalesce(snapshot->'publicAuthor'->>'displayName','')
) stored;
create index course_publications_live_order on public.course_publications (updated_at desc, id desc) where status='published';
create index course_publications_live_search on public.course_publications using gin (listing_search extensions.gin_trgm_ops) where status='published';
