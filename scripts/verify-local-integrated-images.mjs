// Existing Docker-local PostgreSQL only. The migration and fixtures are rolled
// back together. No hosted write, saved local data change or AI provider call.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const container = 'supabase_db_learnable-setup-local';
const inspect = spawnSync('docker', ['inspect', '--format', '{{.State.Running}}', container], { encoding: 'utf8' });
assert.equal(inspect.status, 0, 'The existing local PostgreSQL container must be available.');
assert.equal(inspect.stdout.trim(), 'true');
const psql = sql => {
  const result = spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-At'], {
    input: sql, encoding: 'utf8', timeout: 30_000, maxBuffer: 2 * 1024 * 1024
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};
const migration = readFileSync(new URL('../db/23-integrated-course-images.sql', import.meta.url), 'utf8');
assert.doesNotMatch(migration, /^\s*(?:begin|commit)\s*;/mi, 'This verifier owns the rollback transaction.');
const snapshot = `
select 'schema', md5(string_agg(value, '|' order by value)) from (
  select conname||pg_get_constraintdef(oid) as value from pg_constraint where conrelid in
    ('public.generation_jobs'::regclass,'public.user_courses'::regclass,'public.course_image_requests'::regclass)
  union all select table_name||column_name||data_type from information_schema.columns where table_schema='public'
    and table_name in ('generation_jobs','user_courses','course_image_requests')
  union all select policyname||coalesce(qual,'')||coalesce(with_check,'') from pg_policies where schemaname='public'
    and tablename in ('generation_jobs','user_courses','course_image_requests')
  union all select pg_get_functiondef(oid) from pg_proc where proname='attach_generation_course_image'
) records;
select 'jobs',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by id),'')) from public.generation_jobs t;
select 'courses',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by owner_id,id),'')) from public.user_courses t;
select 'requests',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by owner_id,id),'')) from public.course_image_requests t;
select 'owners',count(*),md5(coalesce(string_agg(id::text,'|' order by id),'')) from auth.users;
`;
const before = psql(snapshot);
const output = psql(`begin;
set local lock_timeout='3s';
set local statement_timeout='25s';
create temporary table integrated_image_assertions(label text);
create temporary table integrated_image_baseline as select
  md5(coalesce(string_agg(row_to_json(p)::text,'|' order by tablename,policyname),'')) policies
  from pg_policies p where schemaname='public' and tablename in ('generation_jobs','user_courses','course_image_requests');
${migration}
${migration}
create function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'Integrated-image assertion failed: %',label; end if;
  insert into integrated_image_assertions values(label);
end;
$$;
select pg_temp.expect((select policies from integrated_image_baseline) = (
  select md5(coalesce(string_agg(row_to_json(p)::text,'|' order by tablename,policyname),'')) from pg_policies p
  where schemaname='public' and tablename in ('generation_jobs','user_courses','course_image_requests')), 'existing RLS policies unchanged');
select pg_temp.expect((select bool_and(relrowsecurity) from pg_class where oid in
  ('public.generation_jobs'::regclass,'public.user_courses'::regclass,'public.course_image_requests'::regclass)), 'RLS remains enabled');
select pg_temp.expect(not has_function_privilege('anon','public.attach_generation_course_image(uuid,text,text,text,uuid,integer,timestamptz,jsonb,uuid,text)','execute'), 'anonymous cannot attach');
select pg_temp.expect(not has_function_privilege('authenticated','public.attach_generation_course_image(uuid,text,text,text,uuid,integer,timestamptz,jsonb,uuid,text)','execute'), 'browser role cannot attach');
select pg_temp.expect(has_function_privilege('service_role','public.attach_generation_course_image(uuid,text,text,text,uuid,integer,timestamptz,jsonb,uuid,text)','execute'), 'service role can attach');
insert into auth.users(id,email) values
  ('fd610def-732d-4a67-a616-000000000001','integrated-images-rollback@example.test'),
  ('fd610def-732d-4a67-a616-000000000002','integrated-images-other-rollback@example.test');
insert into public.generation_jobs(id,owner_id,run_id,status,stage,saved_course_id,user_brief) values
  ('job-integrated-image-rollback','fd610def-732d-4a67-a616-000000000001','integrated-run','running','images','integrated-image-rollback',
   '{"materials_policy":"integrated-visuals-v2"}');
insert into public.user_courses(id,owner_id,payload) values
  ('integrated-image-rollback','fd610def-732d-4a67-a616-000000000001',
   '{"config":{"id":"integrated-image-rollback"},"_generationJobId":"job-integrated-image-rollback","_brief":{"materials_policy":"integrated-visuals-v2"},"lesson":"Preserved text"}');
insert into public.course_image_requests(owner_id,id,course_id,slot_key,status,payload) values
  ('fd610def-732d-4a67-a616-000000000001','fd610def-732d-4a67-a616-000000000003','integrated-image-rollback',repeat('a',64),'ready',
   '{"status":"ready","asset":{"sha256":"synthetic-only"}}');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
create function pg_temp.attempt(changes jsonb default '{}') returns jsonb language plpgsql as $$
declare course public.user_courses; receipt public.course_image_requests;
begin
  select * into course from public.user_courses where id='integrated-image-rollback' and owner_id='fd610def-732d-4a67-a616-000000000001';
  select * into receipt from public.course_image_requests where id='fd610def-732d-4a67-a616-000000000003' and owner_id=course.owner_id;
  return public.attach_generation_course_image(
    coalesce((changes->>'owner')::uuid,course.owner_id), 'job-integrated-image-rollback',
    coalesce(changes->>'run','integrated-run'), coalesce(changes->>'course',course.id), receipt.id,
    case when changes ? 'revision' then (changes->>'revision')::integer else receipt.revision end,
    case when changes ? 'timestamp' then (changes->>'timestamp')::timestamptz else course.updated_at end,
    case when changes ? 'payload' then changes->'payload' else course.payload||'{"image":"attached to private draft"}'::jsonb end,
    case when changes ? 'operation' then (changes->>'operation')::uuid else 'fd610def-732d-4a67-a616-000000000004'::uuid end,
    case when changes ? 'hash' then changes->>'hash' else repeat('b',64) end);
end;
$$;
select pg_temp.expect((select image_progress is null from public.generation_jobs where id='job-integrated-image-rollback'),'new progress defaults to null');
do $$ declare bad jsonb; begin
  for bad in select value from jsonb_array_elements('[null,[],1,"text",{},{"version":2},{"unrelated":1}]') loop
    begin
      update public.generation_jobs set image_progress=bad where id='job-integrated-image-rollback';
      raise exception 'Invalid progress was accepted';
    exception when check_violation then perform pg_temp.expect(true,'reject invalid progress '||bad::text); end;
  end loop;
  begin
    update public.generation_jobs set image_progress=jsonb_build_object('version',1,'padding',repeat('x',96000)) where id='job-integrated-image-rollback';
    raise exception 'Oversize progress was accepted';
  exception when check_violation then perform pg_temp.expect(true,'reject oversized progress'); end;
end $$;
update public.generation_jobs set image_progress='{"version":1,"items":{}}' where id='job-integrated-image-rollback';
select pg_temp.expect((select image_progress->>'version'='1' from public.generation_jobs where id='job-integrated-image-rollback'),'valid progress accepted');
select pg_temp.expect(pg_temp.attempt('{"owner":"fd610def-732d-4a67-a616-000000000002"}')->>'error'='conflict','wrong owner rejected');
select pg_temp.expect(pg_temp.attempt('{"run":"old-run"}')->>'error'='conflict','stale run rejected');
select pg_temp.expect(pg_temp.attempt('{"course":"another-course"}')->>'error'='conflict','wrong saved course rejected');
select pg_temp.expect(pg_temp.attempt('{"revision":999}')->>'error'='conflict','stale receipt revision rejected');
select pg_temp.expect(pg_temp.attempt('{"revision":null}')->>'error'='conflict','missing receipt revision rejected');
select pg_temp.expect(pg_temp.attempt('{"timestamp":"2000-01-01T00:00:00Z"}')->>'error'='conflict','stale course timestamp rejected');
select pg_temp.expect(pg_temp.attempt('{"hash":null}')->>'error'='conflict','missing acceptance identity rejected');
select pg_temp.expect(pg_temp.attempt('{"operation":null}')->>'error'='conflict','missing acceptance operation rejected');
select pg_temp.expect(pg_temp.attempt('{"payload":[]}')->>'error'='conflict','nonobject course payload rejected');
update public.generation_jobs set status='cancelled',completed_at=now() where id='job-integrated-image-rollback';
select pg_temp.expect(pg_temp.attempt()->>'error'='conflict','cancelled job cannot attach');
update public.generation_jobs set status='running',completed_at=null,lease_expires_at=now()-interval '1 second' where id='job-integrated-image-rollback';
select pg_temp.expect(pg_temp.attempt()->>'error'='conflict','expired lease cannot attach');
update public.generation_jobs set lease_expires_at=now()+interval '6 minutes',stage='topics' where id='job-integrated-image-rollback';
select pg_temp.expect(pg_temp.attempt()->>'error'='conflict','text stage cannot attach');
update public.generation_jobs set stage='images',user_brief='{}' where id='job-integrated-image-rollback';
select pg_temp.expect(pg_temp.attempt()->>'error'='conflict','legacy job cannot opt in accidentally');
update public.generation_jobs set user_brief='{"materials_policy":"integrated-visuals-v2"}' where id='job-integrated-image-rollback';
update public.user_courses set payload=payload||'{"_brief":{}}' where id='integrated-image-rollback' and owner_id='fd610def-732d-4a67-a616-000000000001';
select pg_temp.expect(pg_temp.attempt()->>'error'='not_found','legacy course cannot opt in accidentally');
update public.user_courses set payload=payload||'{"_brief":{"materials_policy":"integrated-visuals-v2"}}' where id='integrated-image-rollback' and owner_id='fd610def-732d-4a67-a616-000000000001';
update public.course_image_requests set status='running' where id='fd610def-732d-4a67-a616-000000000003';
select pg_temp.expect(pg_temp.attempt()->>'error'='conflict','unfinished candidate cannot attach');
update public.course_image_requests set status='ready',is_current=false where id='fd610def-732d-4a67-a616-000000000003';
select pg_temp.expect(pg_temp.attempt()->>'error'='conflict','superseded candidate cannot attach');
update public.course_image_requests set is_current=true where id='fd610def-732d-4a67-a616-000000000003';
select pg_temp.expect((select not accepted and revision=1 from public.course_image_requests where id='fd610def-732d-4a67-a616-000000000003'),'rejected attempts leave receipt untouched');
select pg_temp.expect((select payload->>'image' is null and payload->>'lesson'='Preserved text' and write_revision is null from public.user_courses where id='integrated-image-rollback' and owner_id='fd610def-732d-4a67-a616-000000000001'),'rejected attempts preserve original draft');
create temporary table integrated_image_commit as select pg_temp.attempt() as result;
select pg_temp.expect((select (result->>'saved')::boolean and not (result->>'replayed')::boolean from integrated_image_commit),'active exact run attaches once');
select pg_temp.expect((select accepted and revision=2 and payload->'acceptance'->>'kind'='generation-draft' and payload->'acceptance'->>'jobId'='job-integrated-image-rollback' from public.course_image_requests where id='fd610def-732d-4a67-a616-000000000003'),'receipt marks generation draft, not human review');
select pg_temp.expect((select write_revision is not null and payload->>'lesson'='Preserved text' and payload->>'image'='attached to private draft' from public.user_courses where id='integrated-image-rollback' and owner_id='fd610def-732d-4a67-a616-000000000001'),'attachment commits managed course revision');
select pg_temp.expect((pg_temp.attempt()->>'replayed')::boolean,'lost acknowledgement replays same receipt');
select pg_temp.expect((select payload=(select result->'payload' from integrated_image_commit) from public.user_courses where id='integrated-image-rollback' and owner_id='fd610def-732d-4a67-a616-000000000001'),'replay does not rewrite course');
select pg_temp.expect(pg_temp.attempt('{"operation":"fd610def-732d-4a67-a616-000000000005"}')->>'error'='conflict','new identity cannot replay accepted receipt');
select pg_temp.expect(pg_temp.attempt('{"run":"stale-after-save"}')->>'error'='conflict','stale run cannot replay accepted receipt');
select 'INTEGRATED_IMAGE_CHECKS='||count(*) from integrated_image_assertions;
rollback;
`);
assert.equal(psql(snapshot), before, 'Rollback must preserve installed schema and all courses/jobs/receipts/owner identities.');
const count = Number(output.match(/INTEGRATED_IMAGE_CHECKS=(\d+)/)?.[1]);
assert.ok(count >= 35, 'Expected all SQL assertions to run.');
console.log(JSON.stringify({ passed: true, checks: count, migrationAppliedTwice: true, localOnly: true,
  transactionRolledBack: true, schemaAndDataUnchanged: true, paidCalls: 0 }));
