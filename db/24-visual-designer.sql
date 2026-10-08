-- Bounded learner-experience refinement for newly opted-in generation jobs.
-- No existing job or saved course is opted in or rewritten by this migration.
alter table public.generation_jobs add column if not exists design_progress jsonb;
alter table public.generation_jobs drop constraint if exists generation_jobs_stage_check;
alter table public.generation_jobs drop constraint if exists generation_jobs_stage_check1;
alter table public.generation_jobs add constraint generation_jobs_stage_check
  check (stage in ('intake','research','topics','design','images','assemble','done'));
alter table public.generation_jobs drop constraint if exists generation_jobs_design_progress_check;
alter table public.generation_jobs add constraint generation_jobs_design_progress_check
  check (design_progress is null or coalesce((jsonb_typeof(design_progress)='object'
    and design_progress->>'version'='1' and octet_length(design_progress::text)<=131072), false));

-- Only the server may commit a designer checkpoint. Lock the job before its
-- owner-scoped course, then CAS the captured course revision and timestamp.
-- Course metadata and job progress commit atomically, including the durable
-- pre-dispatch marker used to reconcile a lost provider/save acknowledgement.
create or replace function public.commit_generation_design(p_owner uuid,p_job text,p_run text,
  p_course text,p_updated_at timestamptz,p_revision uuid,p_payload jsonb,p_progress jsonb)
returns jsonb language plpgsql security definer set search_path = public,pg_temp as $$
declare job public.generation_jobs; course public.user_courses; committed jsonb; design jsonb;
begin
  select * into job from public.generation_jobs where owner_id=p_owner and id=p_job for update;
  if not found or p_run is null or job.run_id is distinct from p_run or job.status not in ('queued','running')
    or job.lease_expires_at is null or job.lease_expires_at <= clock_timestamp()
    or job.stage <> 'design' or job.saved_course_id is distinct from p_course
    or job.user_brief->>'materials_policy' is distinct from 'integrated-visuals-v2'
    or job.user_brief->>'visual_designer_policy' is distinct from 'learner-experience-v1' then
    return jsonb_build_object('error','conflict');
  end if;
  select * into course from public.user_courses where owner_id=p_owner and id=p_course for update;
  if not found or course.payload->'config'->>'id' is distinct from p_course
    or course.payload->>'_generationJobId' is distinct from p_job
    or course.payload->'_brief'->>'materials_policy' is distinct from 'integrated-visuals-v2'
    or course.payload->'_brief'->>'visual_designer_policy' is distinct from 'learner-experience-v1' then
    return jsonb_build_object('error','not_found');
  end if;
  design := p_payload->'_visualDesign';
  if p_updated_at is null or course.updated_at is distinct from p_updated_at
    or course.write_revision is distinct from p_revision
    or jsonb_typeof(p_payload) is distinct from 'object'
    or p_payload->'config'->>'id' is distinct from p_course
    or p_payload->>'_generationJobId' is distinct from p_job
    or p_payload->'_brief' is distinct from course.payload->'_brief'
    or jsonb_typeof(design) is distinct from 'object'
    or design->>'version' is distinct from '1'
    or design->>'policy' is distinct from 'learner-experience-v1'
    or coalesce(design->>'status','') not in ('reviewing','refining','complete','attention')
    or coalesce(design->>'cycle','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    or coalesce(design->>'sourceRevision','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    or coalesce(design->>'contentHash','') !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(design->'items') is distinct from 'object'
    or coalesce(jsonb_typeof(design->'review'),'null') not in ('null','object')
    or coalesce(jsonb_typeof(design->'pending'),'null') not in ('null','object')
    or octet_length(design::text)>131072
    or jsonb_typeof(p_progress) is distinct from 'object'
    or p_progress->>'version' is distinct from '1'
    or p_progress->>'status' is distinct from design->>'status'
    or p_progress->>'cycle' is distinct from design->>'cycle'
    or jsonb_typeof(p_progress->'items') is distinct from 'object'
    or jsonb_typeof(p_progress->'reviewed') is distinct from 'boolean'
    or coalesce(p_progress->>'total','') !~ '^[0-9]{1,3}$'
    or coalesce(p_progress->>'completed','') !~ '^[0-9]{1,3}$'
    or octet_length(p_progress::text)>131072 then
    return jsonb_build_object('error','conflict');
  end if;
  if (p_progress->>'completed')::integer > (p_progress->>'total')::integer
    or (design->>'status'='complete' and (coalesce(jsonb_typeof(design->'pending'),'null')<>'null'
      or (p_progress->>'completed')::integer <> (p_progress->>'total')::integer)) then
    return jsonb_build_object('error','conflict');
  end if;
  if jsonb_typeof(design->'pending')='object' and (
    coalesce(design->'pending'->>'id','') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$'
    or coalesce(design->'pending'->>'status','') not in ('started','failed','unknown')
    or length(coalesce(design->'pending'->>'key','')) not between 1 and 256) then
    return jsonb_build_object('error','conflict');
  end if;
  if jsonb_typeof(course.payload->'_visualDesign')='object' then
    if course.payload->'_visualDesign'->>'status'='complete'
      or design->>'cycle' is distinct from course.payload->'_visualDesign'->>'cycle'
      or design->>'sourceRevision' is distinct from course.payload->'_visualDesign'->>'sourceRevision' then
      return jsonb_build_object('error','conflict');
    end if;
  elsif design->>'sourceRevision' is distinct from course.write_revision::text then
    return jsonb_build_object('error','conflict');
  end if;
  -- A refinement retry must never rewrite an already illustrated draft. The
  -- designer also cannot insert an asset without the image receipt transaction.
  if jsonb_path_exists(course.payload, '$.modules.*.*.sections[*] ? (@.type == "image" && exists(@.asset_id))')
    or jsonb_path_exists(p_payload, '$.modules.*.*.sections[*] ? (@.type == "image" && exists(@.asset_id))') then
    return jsonb_build_object('error','conflict');
  end if;
  committed := public.commit_user_course(p_owner,p_course,p_revision,p_updated_at,p_payload);
  if committed->>'error' is not null then return committed; end if;
  update public.generation_jobs set design_progress=p_progress
    where owner_id=p_owner and id=p_job;
  return committed;
end;
$$;
revoke all on function public.commit_generation_design(uuid,text,text,text,timestamptz,uuid,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.commit_generation_design(uuid,text,text,text,timestamptz,uuid,jsonb,jsonb) to service_role;
