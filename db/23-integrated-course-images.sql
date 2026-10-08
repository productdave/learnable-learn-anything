-- Integrated first-draft visuals. No existing job/course opts into this policy.
-- Apply before enabling integrated-visuals-v2 in a hosted package.
alter table public.generation_jobs add column if not exists image_progress jsonb;
alter table public.generation_jobs drop constraint if exists generation_jobs_stage_check;
-- Older local/hosted schema history may retain the inline definition under
-- PostgreSQL's suffixed name as well as migration 04's named constraint.
alter table public.generation_jobs drop constraint if exists generation_jobs_stage_check1;
alter table public.generation_jobs add constraint generation_jobs_stage_check
  check (stage in ('intake','research','topics','images','assemble','done'));
alter table public.generation_jobs drop constraint if exists generation_jobs_image_progress_check;
alter table public.generation_jobs add constraint generation_jobs_image_progress_check
  check (image_progress is null or coalesce((jsonb_typeof(image_progress)='object'
    and image_progress->>'version'='1' and octet_length(image_progress::text)<=96000), false));

-- Deliberately separate from human image acceptance: an active exact generation
-- lease attaches AI output to a private draft, without claiming human review.
create or replace function public.attach_generation_course_image(p_owner uuid,p_job text,p_run text,
  p_course text,p_id uuid,p_revision integer,p_updated_at timestamptz,p_payload jsonb,p_operation uuid,p_hash text)
returns jsonb language plpgsql security definer set search_path = public,pg_temp as $$
declare job public.generation_jobs; course public.user_courses; candidate public.course_image_requests; committed jsonb;
begin
  select * into job from public.generation_jobs where owner_id=p_owner and id=p_job for update;
  if not found or job.run_id is distinct from p_run or job.status not in ('queued','running')
    or job.lease_expires_at is null or job.lease_expires_at <= clock_timestamp()
    or job.stage <> 'images' or job.saved_course_id is distinct from p_course
    or job.user_brief->>'materials_policy' is distinct from 'integrated-visuals-v2' then
    return jsonb_build_object('error','conflict');
  end if;
  select * into course from public.user_courses where owner_id=p_owner and id=p_course for update;
  if not found or course.payload->>'_generationJobId' is distinct from p_job
    or course.payload->'_brief'->>'materials_policy' is distinct from 'integrated-visuals-v2' then
    return jsonb_build_object('error','not_found');
  end if;
  select * into candidate from public.course_image_requests where owner_id=p_owner and id=p_id and course_id=p_course for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if candidate.accepted then
    if candidate.payload->'acceptance'->>'operationId'=p_operation::text
      and candidate.payload->'acceptance'->>'hash'=p_hash
      and candidate.payload->'acceptance'->>'kind'='generation-draft'
      and candidate.payload->'acceptance'->>'jobId'=p_job then
      return jsonb_build_object('saved',true,'replayed',true,'payload',course.payload,'updatedAt',course.updated_at);
    end if;
    return jsonb_build_object('error','conflict');
  end if;
  if candidate.revision is distinct from p_revision or not candidate.is_current or candidate.status<>'ready'
    or candidate.payload->'asset' is null or coalesce((candidate.payload->>'assetRemoved')::boolean,false)
    or course.updated_at is distinct from p_updated_at
    or p_payload->'config'->>'id' is distinct from p_course
    or p_payload->>'_generationJobId' is distinct from p_job
    or jsonb_typeof(p_payload) is distinct from 'object'
    or p_operation is null or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('error','conflict');
  end if;
  committed := public.commit_user_course(p_owner,p_course,course.write_revision,p_updated_at,p_payload);
  if committed->>'error' is not null then return committed; end if;
  update public.course_image_requests set accepted=true,revision=revision+1,payload=payload || jsonb_build_object(
    'acceptance',jsonb_build_object('operationId',p_operation,'hash',p_hash,'kind','generation-draft',
      'jobId',p_job,'at',committed->>'updatedAt')) where owner_id=p_owner and id=p_id;
  return committed || jsonb_build_object('replayed',false);
end;
$$;
revoke all on function public.attach_generation_course_image(uuid,text,text,text,uuid,integer,timestamptz,jsonb,uuid,text) from public,anon,authenticated;
grant execute on function public.attach_generation_course_image(uuid,text,text,text,uuid,integer,timestamptz,jsonb,uuid,text) to service_role;
