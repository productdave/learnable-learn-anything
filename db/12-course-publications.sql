-- Public snapshots are written only by the authenticated server boundary.
-- The table contains private ownership metadata: no direct browser/public reads.
create table public.course_publications (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users(id) on delete cascade,
  source_course_id text not null,
  status text not null check (status in ('published','unpublished')),
  version integer not null default 1,
  snapshot jsonb not null,
  source_revision timestamptz not null,
  last_operation uuid not null,
  last_hash text not null,
  updated_at timestamptz not null default now(),
  unique(owner_id,source_course_id),
  foreign key(source_course_id,owner_id) references public.user_courses(id,owner_id) on delete cascade
);
alter table public.course_publications enable row level security;
revoke all on public.course_publications from anon,authenticated;
grant all on public.course_publications to service_role;

create table public.course_publication_reports (
  publication_id uuid not null references public.course_publications(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason text not null check (reason in ('unsafe','privacy','rights','misleading','other')),
  detail text not null check (char_length(detail) between 10 and 2000),
  created_at timestamptz not null default now(),
  primary key(publication_id,reporter_id)
);
alter table public.course_publication_reports enable row level security;
revoke all on public.course_publication_reports from anon,authenticated;
grant all on public.course_publication_reports to service_role;

create function public.commit_course_publication(p_owner uuid,p_course text,
  p_action text,p_version integer,p_source jsonb,p_updated_at timestamptz,
  p_snapshot jsonb,p_operation uuid,p_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare source public.user_courses; publication public.course_publications;
begin
  select * into source from public.user_courses where owner_id=p_owner and id=p_course for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select * into publication from public.course_publications where owner_id=p_owner and source_course_id=p_course for update;
  if publication.last_operation=p_operation then
    if publication.last_hash is distinct from p_hash then return jsonb_build_object('error','conflict'); end if;
    return jsonb_build_object('row',to_jsonb(publication),'replayed',true);
  end if;
  if coalesce(publication.version,0) <> p_version then return jsonb_build_object('error','conflict'); end if;
  if p_action='publish' then
    if source.updated_at is distinct from p_updated_at or source.payload is distinct from p_source then
      return jsonb_build_object('error','conflict');
    end if;
    if jsonb_array_length(coalesce(source.payload->'failedTopics','[]'::jsonb))>0 or exists (
      select 1 from public.generation_jobs where owner_id=p_owner and id=source.payload->>'_generationJobId' and status<>'completed'
    ) then return jsonb_build_object('error','busy'); end if;
    if p_snapshot is null or p_snapshot->>'version'<>'1' then return jsonb_build_object('error','request'); end if;
    insert into public.course_publications(owner_id,source_course_id,status,snapshot,source_revision,last_operation,last_hash)
      values(p_owner,p_course,'published',p_snapshot,p_updated_at,p_operation,p_hash)
      on conflict(owner_id,source_course_id) do update set status='published',snapshot=p_snapshot,
        source_revision=p_updated_at,version=course_publications.version+1,last_operation=p_operation,last_hash=p_hash,updated_at=clock_timestamp()
      returning * into publication;
  elsif p_action='unpublish' and publication.id is not null then
    update public.course_publications set status='unpublished',version=version+1,
      last_operation=p_operation,last_hash=p_hash,updated_at=clock_timestamp()
      where id=publication.id returning * into publication;
  else return jsonb_build_object('error','request'); end if;
  return jsonb_build_object('row',to_jsonb(publication),'replayed',false);
end;
$$;
revoke all on function public.commit_course_publication(uuid,text,text,integer,jsonb,timestamptz,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.commit_course_publication(uuid,text,text,integer,jsonb,timestamptz,jsonb,uuid,text) to service_role;
