-- Acceptance and course replacement commit together. Never expose this RPC to
-- browser roles: the server validates the lesson, bytes and proposed content.
alter table public.course_image_requests add column accepted boolean not null default false;

create function public.accept_course_image(p_owner uuid,p_id uuid,p_course text,p_revision integer,
  p_updated_at timestamptz,p_payload jsonb,p_operation uuid,p_hash text)
returns jsonb language plpgsql security definer set search_path = public,pg_temp as $$
declare course public.user_courses; candidate public.course_image_requests; saved_at timestamptz;
begin
  -- Same lock order as admission: course, then candidate.
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
    or course.updated_at is distinct from p_updated_at then
    return jsonb_build_object('error','conflict');
  end if;
  if jsonb_array_length(coalesce(course.payload->'failedTopics','[]'::jsonb)) > 0 or exists (
    select 1 from public.generation_jobs where owner_id=p_owner and id=course.payload->>'_generationJobId' and status <> 'completed'
  ) then return jsonb_build_object('error','busy'); end if;
  if p_payload->'config'->>'id' is distinct from p_course then return jsonb_build_object('error','request'); end if;
  saved_at := greatest(clock_timestamp(),coalesce(course.updated_at,now()) + interval '1 millisecond');
  p_payload := jsonb_set(p_payload,'{updatedAt}',to_jsonb(floor(extract(epoch from saved_at)*1000)));
  update public.user_courses set payload=p_payload,updated_at=saved_at where owner_id=p_owner and id=p_course;
  update public.course_image_requests set accepted=true,revision=revision+1,payload=payload || jsonb_build_object(
    'acceptance',jsonb_build_object('operationId',p_operation,'hash',p_hash,'at',saved_at)) where owner_id=p_owner and id=p_id;
  return jsonb_build_object('saved',true,'replayed',false,'payload',p_payload,'updatedAt',saved_at);
end;
$$;
revoke all on function public.accept_course_image(uuid,uuid,text,integer,timestamptz,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.accept_course_image(uuid,uuid,text,integer,timestamptz,jsonb,uuid,text) to service_role;
