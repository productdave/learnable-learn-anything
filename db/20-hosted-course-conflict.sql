-- Forward-only: business conflicts are not retryable serialization failures.
-- Hosted PostgREST 14 retries SQLSTATE 40001 indefinitely. PT409 preserves the
-- rejected write while returning HTTP 409 promptly. Migration 19 is unchanged.
create or replace function public.guard_course_revision() returns trigger
language plpgsql security invoker set search_path=pg_catalog,public as $$
begin
  if tg_op='UPDATE' and (new.id is distinct from old.id or new.owner_id is distinct from old.owner_id) then
    raise exception 'Course identity cannot change during a save' using errcode='PT409';
  end if;
  if current_user <> 'learnable_course_committer' then
    if tg_op='UPDATE' and old.write_revision is not null then
      raise exception 'This course requires a revision-aware save. Reload before editing.' using errcode='PT409';
    end if;
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
