-- Remove draft content while retaining a minimal deletion marker. A delayed
-- save must not recreate the same draft. Existing courses/jobs/originals remain.
alter table public.course_setups add column deleted boolean not null default false;
drop policy if exists "Read own course setups" on public.course_setups;
create policy "Read own course setups" on public.course_setups for select to authenticated
  using (auth.uid() = owner_id and not deleted);

alter function public.commit_course_setup(uuid,text,integer,jsonb,text) rename to commit_live_course_setup;
revoke all on function public.commit_live_course_setup(uuid,text,integer,jsonb,text) from public,anon,authenticated,service_role;
create function public.commit_course_setup(p_owner uuid,p_id text,p_expected integer,p_payload jsonb,p_hash text)
returns jsonb language plpgsql security definer set search_path = public,pg_temp as $$
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text || '/' || p_id,0));
  if exists(select 1 from public.course_setups where owner_id=p_owner and id=p_id and deleted) then
    return jsonb_build_object('error','deleted');
  end if;
  return public.commit_live_course_setup(p_owner,p_id,p_expected,p_payload,p_hash);
end;
$$;
revoke all on function public.commit_course_setup(uuid,text,integer,jsonb,text) from public,anon,authenticated;
grant execute on function public.commit_course_setup(uuid,text,integer,jsonb,text) to service_role;

create function public.delete_course_setup(p_owner uuid,p_id text,p_expected integer)
returns jsonb language plpgsql security definer set search_path = public,pg_temp as $$
declare current_row public.course_setups;
begin
  if p_expected is null or p_expected < 0 or p_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$' then raise exception 'invalid setup'; end if;
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text || '/' || p_id,0));
  select * into current_row from public.course_setups where owner_id=p_owner and id=p_id for update;
  if current_row.deleted then return jsonb_build_object('deleted',true,'replayed',true); end if;
  if coalesce(current_row.revision,0) <> p_expected then return jsonb_build_object('error','conflict'); end if;
  insert into public.course_setups(owner_id,id,revision,payload,content_hash,deleted)
    values(p_owner,p_id,1,'{}',repeat('0',64),true)
    on conflict(owner_id,id) do update set deleted=true,payload='{}',content_hash=repeat('0',64),
      revision=public.course_setups.revision+1,updated_at=now();
  return jsonb_build_object('deleted',true,'replayed',false);
end;
$$;
revoke all on function public.delete_course_setup(uuid,text,integer) from public,anon,authenticated;
grant execute on function public.delete_course_setup(uuid,text,integer) to service_role;
