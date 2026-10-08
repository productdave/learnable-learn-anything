-- Isolated staging only. Read-only classification, not a new grant or budget.
-- Any historical QA allowance keeps that job/course on the guarded path,
-- including closed/expired allowances. The caller separately checks the owner.
create function public.learnable_staging_manual_test_scope(p_owner_id uuid, p_kind text, p_scope_id text)
returns jsonb language sql stable security definer set search_path=pg_catalog,public as $$
  select jsonb_build_object('manual', case
    when p_kind='text' then
      exists(select 1 from public.generation_jobs j where j.owner_id=p_owner_id and j.id=p_scope_id)
      and not exists(select 1 from public.learnable_staging_spend_budgets b where b.owner_id=p_owner_id and b.job_id=p_scope_id)
    when p_kind='images' then
      exists(select 1 from public.user_courses c where c.owner_id=p_owner_id and c.id=p_scope_id)
      and not exists(select 1 from public.learnable_staging_image_budgets b where b.owner_id=p_owner_id and b.course_id=p_scope_id)
      and not exists(select 1 from public.generation_jobs j join public.learnable_staging_spend_budgets b
        on b.owner_id=j.owner_id and b.job_id=j.id where j.owner_id=p_owner_id and j.saved_course_id=p_scope_id)
    else false end);
$$;
revoke all on function public.learnable_staging_manual_test_scope(uuid,text,text) from public,anon,authenticated;
grant execute on function public.learnable_staging_manual_test_scope(uuid,text,text) to service_role;
notify pgrst, 'reload schema';
