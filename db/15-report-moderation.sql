-- Forward-only moderation boundary. No accounts receive permission by default.
create table public.course_moderators (
  user_id uuid primary key references auth.users(id) on delete cascade,
  active boolean not null default true,
  created_at timestamptz not null default now()
);
alter table public.course_moderators enable row level security;
revoke all on public.course_moderators from public,anon,authenticated;
grant select,insert,update,delete on public.course_moderators to service_role;

alter table public.course_publications add column moderation_removed boolean not null default false;
alter table public.course_publications add constraint restricted_publication_not_live check (not moderation_removed or status='unpublished');

-- Preserve all historical reports; version 0 explicitly means unknown legacy evidence.
alter table public.course_publication_reports add column id uuid not null default gen_random_uuid();
alter table public.course_publication_reports add column reported_version integer not null default 0 check (reported_version>=0);
alter table public.course_publication_reports add column evidence jsonb;
alter table public.course_publication_reports add column status text not null default 'open' check (status in ('open','closed'));
alter table public.course_publication_reports add column revision integer not null default 1;
alter table public.course_publication_reports add column updated_at timestamptz not null default now();
alter table public.course_publication_reports drop constraint course_publication_reports_pkey;
alter table public.course_publication_reports add primary key (id);
alter table public.course_publication_reports add unique (publication_id,reporter_id,reported_version);
create index course_reports_queue on public.course_publication_reports (status,created_at,id);

-- Deliberately no cascading foreign keys: decision evidence survives course/account removal.
create table public.course_moderation_audit (
  operation_id uuid primary key,
  moderator_id uuid not null,
  report_id uuid not null,
  publication_id uuid not null,
  action text not null check (action in ('dismiss','remove','restore')),
  note text not null check (char_length(note) between 10 and 2000),
  request_hash text not null,
  created_at timestamptz not null default now()
);
alter table public.course_moderation_audit enable row level security;
revoke all on public.course_moderation_audit from public,anon,authenticated;
grant select on public.course_moderation_audit to service_role;
create index course_moderation_audit_case on public.course_moderation_audit (report_id,created_at);

create function public.submit_course_report(p_reporter uuid,p_publication uuid,p_version integer,p_reason text,p_detail text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare publication public.course_publications; report_id uuid;
begin
  if p_version is null or p_version<1 or p_reason is null or p_detail is null or p_reason not in ('unsafe','privacy','rights','misleading','other') or char_length(btrim(p_detail)) not between 10 and 2000 then
    return jsonb_build_object('error','request');
  end if;
  -- Consistent public version + evidence, serialized against update/removal.
  select * into publication from public.course_publications where id=p_publication and status='published' for share;
  if not found then return jsonb_build_object('error','not_found'); end if;
  if publication.version<>p_version then return jsonb_build_object('error','conflict'); end if;
  insert into public.course_publication_reports(publication_id,reporter_id,reason,detail,reported_version,evidence)
    values(p_publication,p_reporter,p_reason,btrim(p_detail),publication.version,publication.snapshot)
    on conflict(publication_id,reporter_id,reported_version) do nothing returning id into report_id;
  return jsonb_build_object('received',true,'duplicate',report_id is null);
end;
$$;
revoke all on function public.submit_course_report(uuid,uuid,integer,text,text) from public,anon,authenticated;
grant execute on function public.submit_course_report(uuid,uuid,integer,text,text) to service_role;

create function public.decide_course_report(p_moderator uuid,p_report uuid,p_action text,p_note text,
  p_revision integer,p_version integer,p_operation uuid,p_hash text)
returns jsonb language plpgsql security definer set search_path=public,pg_temp as $$
declare case_row public.course_publication_reports; publication public.course_publications;
  prior public.course_moderation_audit; pub_id uuid;
begin
  perform 1 from public.course_moderators where user_id=p_moderator and active for share;
  if not found then return jsonb_build_object('error','forbidden'); end if;
  if p_action is null or p_note is null or p_operation is null or p_revision is null or p_revision<1 or p_version is null or p_version<1 or p_action not in ('dismiss','remove','restore') or char_length(btrim(p_note)) not between 10 and 2000 or p_hash is null or p_hash !~ '^[a-f0-9]{64}$' then
    return jsonb_build_object('error','request');
  end if;
  select * into prior from public.course_moderation_audit where operation_id=p_operation;
  if found then
    if prior.moderator_id<>p_moderator or prior.request_hash<>p_hash then return jsonb_build_object('error','conflict'); end if;
    return jsonb_build_object('applied',true,'action',prior.action,'replayed',true);
  end if;
  select publication_id into pub_id from public.course_publication_reports where id=p_report;
  if not found then return jsonb_build_object('error','not_found'); end if;
  -- All public-write paths take the publication lock before the report lock.
  select * into publication from public.course_publications where id=pub_id for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  select * into case_row from public.course_publication_reports where id=p_report for update;
  if not found then return jsonb_build_object('error','not_found'); end if;
  -- A concurrent retry can arrive before the first operation commits.
  select * into prior from public.course_moderation_audit where operation_id=p_operation;
  if found then
    if prior.moderator_id<>p_moderator or prior.request_hash<>p_hash then return jsonb_build_object('error','conflict'); end if;
    return jsonb_build_object('applied',true,'action',prior.action,'replayed',true);
  end if;
  if case_row.revision<>p_revision or publication.version<>p_version then return jsonb_build_object('error','conflict'); end if;
  if p_action in ('dismiss','remove') and case_row.status<>'open' then return jsonb_build_object('error','conflict'); end if;
  if p_action='remove' and publication.moderation_removed then return jsonb_build_object('error','conflict'); end if;
  if p_action='restore' and not publication.moderation_removed then return jsonb_build_object('error','conflict'); end if;
  if p_action in ('remove','restore') then
    update public.course_publications set status='unpublished',moderation_removed=(p_action='remove'),
      version=version+1,updated_at=clock_timestamp(),last_operation=p_operation,last_hash='moderation:'||p_hash where id=pub_id;
  end if;
  update public.course_publication_reports set status='closed',revision=revision+1,updated_at=clock_timestamp() where id=p_report;
  insert into public.course_moderation_audit(operation_id,moderator_id,report_id,publication_id,action,note,request_hash)
    values(p_operation,p_moderator,p_report,pub_id,p_action,btrim(p_note),p_hash);
  return jsonb_build_object('applied',true,'action',p_action,'replayed',false);
end;
$$;
revoke all on function public.decide_course_report(uuid,uuid,text,text,integer,integer,uuid,text) from public,anon,authenticated;
grant execute on function public.decide_course_report(uuid,uuid,text,text,integer,integer,uuid,text) to service_role;
