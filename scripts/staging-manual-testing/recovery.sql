-- Isolated staging only. An operator may record an explicit owner request to
-- take over one historical QA job for personal manual testing. No budget is
-- reopened, no job is started, and runtime/browser roles cannot mint approvals.
create table public.learnable_staging_manual_recoveries (
  owner_id uuid not null,
  job_id text not null check (job_id ~ '^job-([a-f0-9-]{36}|setup-[a-f0-9]{48})$'),
  approved_at timestamptz not null default now(),
  approval_note text not null check (length(approval_note) between 1 and 500),
  revoked_at timestamptz,
  primary key (owner_id, job_id),
  check (revoked_at is null or revoked_at >= approved_at)
);
alter table public.learnable_staging_manual_recoveries enable row level security;
revoke all on public.learnable_staging_manual_recoveries from public,anon,authenticated,service_role;

-- Recheck ownership and any open QA allowance on every classification. Historical
-- costs/uncertain reservations remain in their original ledgers, untouched.
create function public.learnable_staging_manual_recovery_allowed(p_owner_id uuid,p_job_id text)
returns boolean language sql stable security definer set search_path=pg_catalog,public as $$
  select exists(select 1 from public.learnable_staging_manual_recoveries r
    join public.generation_jobs j on j.id=r.job_id and j.owner_id=r.owner_id
    where r.owner_id=p_owner_id and r.job_id=p_job_id and r.revoked_at is null)
    and not exists(select 1 from public.learnable_staging_spend_budgets b
      where b.owner_id=p_owner_id and (b.job_id=p_job_id or b.job_id is null) and b.enabled);
$$;
revoke all on function public.learnable_staging_manual_recovery_allowed(uuid,text) from public,anon,authenticated,service_role;

-- Classifier replacement. Absent an explicit recovery record, the existing
-- historical-QA boundary is unchanged. The deployed client still separately
-- enforces the exact staging host, owner, enablement, run and cancellation checks.
create or replace function public.learnable_staging_manual_test_scope(p_owner_id uuid,p_kind text,p_scope_id text)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object('manual',case
    when p_kind='text' then
      exists(select 1 from public.generation_jobs j where j.owner_id=p_owner_id and j.id=p_scope_id)
      and (not exists(select 1 from public.learnable_staging_spend_budgets b where b.owner_id=p_owner_id and b.job_id=p_scope_id)
        or public.learnable_staging_manual_recovery_allowed(p_owner_id,p_scope_id))
    when p_kind='images' then
      exists(select 1 from public.user_courses c where c.owner_id=p_owner_id and c.id=p_scope_id)
      and not exists(select 1 from public.learnable_staging_image_budgets b where b.owner_id=p_owner_id and b.course_id=p_scope_id)
      and not exists(select 1 from public.generation_jobs j join public.learnable_staging_spend_budgets b
        on b.owner_id=j.owner_id and b.job_id=j.id where j.owner_id=p_owner_id and j.saved_course_id=p_scope_id
        and not public.learnable_staging_manual_recovery_allowed(p_owner_id,j.id))
    else false end);
$$;
revoke all on function public.learnable_staging_manual_test_scope(uuid,text,text) from public,anon,authenticated;
grant execute on function public.learnable_staging_manual_test_scope(uuid,text,text) to service_role;
notify pgrst,'reload schema';
