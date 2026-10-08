-- Upgrade courses lazily, on their first revision-aware commit. No content backfill.
-- This role cannot sign in and is never granted to API roles. Only its narrowly
-- scoped SECURITY DEFINER function may cross the managed-course write boundary.
create role learnable_course_committer nologin noinherit;
grant learnable_course_committer to current_user;
grant usage,create on schema public to learnable_course_committer;
grant select,insert,update,delete on public.user_courses to learnable_course_committer;
create policy course_committer on public.user_courses to learnable_course_committer using (true) with check (true);
alter table public.user_courses add column write_revision uuid;

create function public.guard_course_revision() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if tg_op='UPDATE' and (new.id is distinct from old.id or new.owner_id is distinct from old.owner_id) then
    raise exception 'Course identity cannot change during a save' using errcode='40001';
  end if;
  if current_user <> 'learnable_course_committer' then
    if tg_op='UPDATE' and old.write_revision is not null then
      raise exception 'This course requires a revision-aware save. Reload before editing.' using errcode='40001';
    end if;
    -- A legacy writer cannot opt itself into, or forge, a managed revision.
    new.write_revision := null;
    new.payload := new.payload - '_courseRevision' - '_courseUpdatedAt';
    return new;
  end if;
  new.write_revision := gen_random_uuid();
  new.updated_at := greatest(clock_timestamp(),case when tg_op='UPDATE' then old.updated_at + interval '1 millisecond' else '-infinity'::timestamptz end);
  new.payload := (new.payload - '_syncedAt') || jsonb_build_object(
    '_courseRevision',new.write_revision,'_courseUpdatedAt',new.updated_at,
    'updatedAt',floor(extract(epoch from new.updated_at)*1000));
  return new;
end;
$$;
revoke all on function public.guard_course_revision() from public,anon,authenticated,service_role;
create trigger course_revision_guard before insert or update on public.user_courses
  for each row execute function public.guard_course_revision();

create function public.commit_user_course(p_owner uuid,p_id text,p_expected_revision uuid,
  p_updated_at timestamptz,p_payload jsonb,p_action text default 'save') returns jsonb
language plpgsql security definer set search_path=pg_catalog,public as $$
declare course public.user_courses; claims jsonb := nullif(current_setting('request.jwt.claims',true),'')::jsonb;
begin
  -- The same verified PostgREST JWT claims used by auth.uid()/auth.role(), without
  -- granting this internal role privileges on Supabase's managed auth schema.
  if p_owner is null or ((claims->>'sub')::uuid is distinct from p_owner and claims->>'role' is distinct from 'service_role') then
    raise exception 'Not authorized to save this course' using errcode='42501';
  end if;
  if p_id is null or length(p_id) not between 1 and 200 or p_action is null or p_action not in ('save','delete') then
    return jsonb_build_object('error','request');
  end if;
  if p_action='save' and (jsonb_typeof(p_payload) is distinct from 'object' or p_payload->'config'->>'id' is distinct from p_id) then
    return jsonb_build_object('error','request');
  end if;
  select * into course from public.user_courses where owner_id=p_owner and id=p_id for update;
  if found then
    if p_updated_at is null or course.updated_at is distinct from p_updated_at or course.write_revision is distinct from p_expected_revision then
      return jsonb_build_object('error','conflict');
    end if;
    if p_action='delete' then
      delete from public.user_courses where owner_id=p_owner and id=p_id;
      return jsonb_build_object('deleted',true);
    end if;
    update public.user_courses set payload=p_payload where owner_id=p_owner and id=p_id returning * into course;
  else
    if p_action='delete' or p_updated_at is not null or p_expected_revision is not null then
      return jsonb_build_object('error','conflict');
    end if;
    begin
      insert into public.user_courses(id,owner_id,payload) values(p_id,p_owner,p_payload) returning * into course;
    exception when unique_violation then return jsonb_build_object('error','conflict');
    end;
  end if;
  return jsonb_build_object('saved',true,'payload',course.payload,'updatedAt',course.updated_at);
end;
$$;
alter function public.commit_user_course(uuid,text,uuid,timestamptz,jsonb,text) owner to learnable_course_committer;
revoke create on schema public from learnable_course_committer;
revoke all on function public.commit_user_course(uuid,text,uuid,timestamptz,jsonb,text) from public,anon;
grant execute on function public.commit_user_course(uuid,text,uuid,timestamptz,jsonb,text) to authenticated,service_role;

-- Image acceptance still changes the course and image receipt in one transaction.
-- The service-only signature is preserved; its original course timestamp is CAS.
create or replace function public.accept_course_image(p_owner uuid,p_id uuid,p_course text,p_revision integer,
  p_updated_at timestamptz,p_payload jsonb,p_operation uuid,p_hash text)
returns jsonb language plpgsql security definer set search_path = public,pg_temp as $$
declare course public.user_courses; candidate public.course_image_requests; committed jsonb;
begin
  select * into course from public.user_courses where owner_id=p_owner and id=p_course for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select * into candidate from public.course_image_requests where owner_id=p_owner and id=p_id and course_id=p_course for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if candidate.accepted then
    if candidate.payload->'acceptance'->>'operationId' = p_operation::text and candidate.payload->'acceptance'->>'hash' = p_hash then
      return jsonb_build_object('saved',true,'replayed',true,'payload',course.payload,'updatedAt',course.updated_at);
    end if;
    return jsonb_build_object('error','conflict');
  end if;
  if candidate.revision <> p_revision or not candidate.is_current or candidate.status <> 'ready'
    or candidate.payload->'asset' is null or coalesce((candidate.payload->>'assetRemoved')::boolean,false)
    or course.updated_at is distinct from p_updated_at then return jsonb_build_object('error','conflict'); end if;
  if jsonb_array_length(coalesce(course.payload->'failedTopics','[]'::jsonb)) > 0 or exists (
    select 1 from public.generation_jobs where owner_id=p_owner and id=course.payload->>'_generationJobId' and status <> 'completed'
  ) then return jsonb_build_object('error','busy'); end if;
  committed := public.commit_user_course(p_owner,p_course,course.write_revision,p_updated_at,p_payload);
  if committed->>'error' is not null then return committed; end if;
  update public.course_image_requests set accepted=true,revision=revision+1,payload=payload || jsonb_build_object(
    'acceptance',jsonb_build_object('operationId',p_operation,'hash',p_hash,'at',committed->>'updatedAt')) where owner_id=p_owner and id=p_id;
  return committed || jsonb_build_object('replayed',false);
end;
$$;
revoke all on function public.accept_course_image(uuid,uuid,text,integer,timestamptz,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.accept_course_image(uuid,uuid,text,integer,timestamptz,jsonb,uuid,text) to service_role;
