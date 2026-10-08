-- Forward-only local migration. Keeps the row lock across version check and
-- existing job/course deletion. No data rewrite, retention change or browser grant.
create or replace function public.delete_generation_job_at_checkpoint(
  p_job_id text, p_owner_id uuid, p_expected_status text, p_expected_run_id uuid
)
returns table(deleted_course_id text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_status text;
  v_run_id uuid;
begin
  select status, run_id into v_status, v_run_id
  from public.generation_jobs
  where id = p_job_id and owner_id = p_owner_id
  for update;
  if not found then return; end if;
  if p_expected_status is null or v_status is distinct from p_expected_status
      or v_run_id is distinct from p_expected_run_id then
    raise exception 'GENERATION_CHANGED';
  end if;
  return query select * from public.delete_generation_job_for_owner(p_job_id, p_owner_id);
end;
$$;
revoke all on function public.delete_generation_job_at_checkpoint(text, uuid, text, uuid) from public, anon, authenticated;
grant execute on function public.delete_generation_job_at_checkpoint(text, uuid, text, uuid) to service_role;
