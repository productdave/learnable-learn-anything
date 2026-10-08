-- Private, server-written image attempts, separate from browser-writable courses.
-- Keep receipts after course deletion so an unfinished upload remains traceable.
create table public.course_image_requests (
  owner_id uuid not null references auth.users(id) on delete cascade,
  id uuid not null,
  course_id text not null check (course_id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$'),
  slot_key text not null check (slot_key ~ '^[a-f0-9]{64}$'),
  is_current boolean not null default true,
  revision integer not null default 1 check (revision > 0),
  status text not null check (status in ('queued','running','persisting','ready','failed','unknown','cancelled','discarded')),
  payload jsonb not null check (octet_length(payload::text) <= 24000),
  created_at timestamptz not null default now(),
  primary key (owner_id,id)
);
create unique index course_image_current_slot on public.course_image_requests(owner_id,course_id,slot_key) where is_current;
alter table public.course_image_requests enable row level security;
revoke all on public.course_image_requests from public, anon, authenticated;
grant select,insert,update,delete on public.course_image_requests to service_role;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('course-images','course-images',false,8388608,array['image/png']);
-- No browser policies: bytes are served only after authenticated request/course checks.

create function public.begin_course_image_request(p_owner uuid,p_id uuid,p_course text,p_slot text,p_expected uuid,p_payload jsonb,p_ack boolean)
returns jsonb language plpgsql security definer set search_path = public,pg_temp as $$
declare prior public.course_image_requests; current_row public.course_image_requests;
begin
  perform pg_advisory_xact_lock(hashtextextended(p_owner::text || '/' || p_course || '/' || p_slot,0));
  select * into prior from public.course_image_requests where owner_id=p_owner and id=p_id;
  if prior.id is not null then
    if prior.course_id <> p_course or prior.slot_key <> p_slot or prior.payload->>'requestHash' is distinct from p_payload->>'requestHash' then
      return jsonb_build_object('error','conflict');
    end if;
    return jsonb_build_object('row',to_jsonb(prior),'replayed',true);
  end if;
  perform 1 from public.user_courses where owner_id=p_owner and id=p_course for share;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select * into current_row from public.course_image_requests where owner_id=p_owner and course_id=p_course and slot_key=p_slot and is_current for update;
  if current_row.id is distinct from p_expected then return jsonb_build_object('error','conflict'); end if;
  if current_row.status in ('queued','running','persisting') then return jsonb_build_object('error','busy'); end if;
  if coalesce((current_row.payload->>'mayHaveCharged')::boolean,false) and p_ack is distinct from true then
    return jsonb_build_object('error','charge_ack');
  end if;
  update public.course_image_requests set is_current=false where owner_id=p_owner and id=current_row.id;
  insert into public.course_image_requests(owner_id,id,course_id,slot_key,status,payload)
    values(p_owner,p_id,p_course,p_slot,'queued',p_payload) returning * into prior;
  return jsonb_build_object('row',to_jsonb(prior),'replayed',false);
end;
$$;
revoke all on function public.begin_course_image_request(uuid,uuid,text,text,uuid,jsonb,boolean) from public,anon,authenticated;
grant execute on function public.begin_course_image_request(uuid,uuid,text,text,uuid,jsonb,boolean) to service_role;
