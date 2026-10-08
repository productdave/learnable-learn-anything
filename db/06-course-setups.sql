-- Slice C: private setup backups. Apply through the normal database release
-- process, not by opening the preview. No existing courses/jobs are changed.
create table if not exists public.course_setups (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id text not null check (id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'),
  revision integer not null check (revision > 0),
  payload jsonb not null,
  content_hash text not null check (content_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (owner_id, id)
);
alter table public.course_setups enable row level security;
revoke all on public.course_setups from anon, authenticated;
grant select on public.course_setups to authenticated;
drop policy if exists "Read own course setups" on public.course_setups;
create policy "Read own course setups" on public.course_setups for select to authenticated using (auth.uid() = owner_id);

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('setup-sources', 'setup-sources', false, 10485760,
  array['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "Read own setup sources" on storage.objects;
create policy "Read own setup sources" on storage.objects for select to authenticated
using (bucket_id = 'setup-sources' and (storage.foldername(name))[1] = auth.uid()::text);
drop policy if exists "Insert own immutable setup sources" on storage.objects;
create policy "Insert own immutable setup sources" on storage.objects for insert to authenticated
with check (bucket_id = 'setup-sources' and (storage.foldername(name))[1] = auth.uid()::text
  and name ~ '^[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[A-Za-z0-9_-]+/[a-f0-9]{64}$');
-- No browser UPDATE/DELETE grant for this bucket: retries may not replace an
-- acknowledged original. Source retention/cleanup requires release policy.

create or replace function public.commit_course_setup(p_owner uuid, p_id text, p_expected integer, p_payload jsonb, p_hash text)
returns jsonb language plpgsql security definer set search_path = public, pg_temp as $$
declare current_row public.course_setups; source jsonb; object_name text;
begin
  if p_expected < 0 or p_expected is null or p_id !~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$'
     or p_hash !~ '^[a-f0-9]{64}$' or octet_length(p_payload::text) > 1200000 then
    raise exception 'invalid setup';
  end if;
  -- Serializes first insert as well as later updates. Collision only queues an
  -- unrelated operation; owner/id predicates still enforce the exact target.
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text || '/' || p_id, 0));
  select * into current_row from public.course_setups where owner_id = p_owner and id = p_id for update;
  if current_row.id is not null and current_row.content_hash = p_hash then
    return jsonb_build_object('id', p_id, 'revision', current_row.revision, 'contentHash', p_hash, 'updatedAt', current_row.updated_at);
  end if;
  if coalesce(current_row.revision, 0) <> p_expected then return jsonb_build_object('error', 'conflict'); end if;
  for source in select value from jsonb_array_elements(p_payload->'sources'->'files') loop
    object_name := p_owner::text || '/' || p_id || '/' || (source->>'id') || '/' || (source->>'sha256');
    if not exists (select 1 from storage.objects where bucket_id = 'setup-sources' and name = object_name
      and (metadata->>'size')::bigint = (source->>'size')::bigint) then
      return jsonb_build_object('error', 'files-pending');
    end if;
  end loop;
  insert into public.course_setups(owner_id,id,revision,payload,content_hash)
    values(p_owner,p_id,p_expected+1,p_payload,p_hash)
    on conflict(owner_id,id) do update set revision = excluded.revision, payload = excluded.payload,
      content_hash = excluded.content_hash, updated_at = now()
    returning * into current_row;
  return jsonb_build_object('id',p_id,'revision',current_row.revision,'contentHash',p_hash,'updatedAt',current_row.updated_at);
end;
$$;
revoke all on function public.commit_course_setup(uuid,text,integer,jsonb,text) from public, anon, authenticated;
grant execute on function public.commit_course_setup(uuid,text,integer,jsonb,text) to service_role;
