// Existing Docker-local PostgreSQL only. Both migrations and all fixtures are
// rolled back in one transaction. No hosted changes, retained local edits or AI.
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
const prerequisite = readFileSync(new URL('../db/23-integrated-course-images.sql', import.meta.url), 'utf8');
const migration = readFileSync(new URL('../db/24-visual-designer.sql', import.meta.url), 'utf8');
for (const sql of [prerequisite, migration]) assert.doesNotMatch(sql, /^\s*(?:begin|commit)\s*;/mi, 'The verifier owns rollback.');
const snapshot = `
select 'schema', md5(string_agg(value, '|' order by value)) from (
  select conname||pg_get_constraintdef(oid) as value from pg_constraint where conrelid in
    ('public.generation_jobs'::regclass,'public.user_courses'::regclass,'public.course_image_requests'::regclass)
  union all select table_name||column_name||data_type from information_schema.columns where table_schema='public'
    and table_name in ('generation_jobs','user_courses','course_image_requests')
  union all select policyname||coalesce(qual,'')||coalesce(with_check,'') from pg_policies where schemaname='public'
    and tablename in ('generation_jobs','user_courses','course_image_requests')
  union all select pg_get_functiondef(oid)||coalesce(proacl::text,'') from pg_proc
    where proname in ('commit_generation_design','attach_generation_course_image')
) records;
select 'jobs',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by id),'')) from public.generation_jobs t;
select 'courses',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by owner_id,id),'')) from public.user_courses t;
select 'requests',count(*),md5(coalesce(string_agg(to_jsonb(t)::text,'|' order by owner_id,id),'')) from public.course_image_requests t;
select 'owners',count(*),md5(coalesce(string_agg(id::text,'|' order by id),'')) from auth.users;
`;
const before = psql(snapshot);
let output;
try { output = psql(`begin;
set local lock_timeout='3s';
set local statement_timeout='25s';
create temporary table visual_design_assertions(label text);
create temporary table visual_design_baseline as select
  md5(coalesce(string_agg(row_to_json(p)::text,'|' order by tablename,policyname),'')) policies
  from pg_policies p where schemaname='public' and tablename in ('generation_jobs','user_courses','course_image_requests');
${prerequisite}
${migration}
${migration}
create function pg_temp.expect(ok boolean,label text) returns void language plpgsql as $$
begin
  if ok is distinct from true then raise exception 'Visual-design assertion failed: %',label; end if;
  insert into visual_design_assertions values(label);
end;
$$;
select pg_temp.expect((select policies from visual_design_baseline) = (
  select md5(coalesce(string_agg(row_to_json(p)::text,'|' order by tablename,policyname),'')) from pg_policies p
  where schemaname='public' and tablename in ('generation_jobs','user_courses','course_image_requests')), 'existing RLS policies unchanged');
select pg_temp.expect((select bool_and(relrowsecurity) from pg_class where oid in
  ('public.generation_jobs'::regclass,'public.user_courses'::regclass,'public.course_image_requests'::regclass)), 'RLS remains enabled');
select pg_temp.expect(not has_function_privilege('anon','public.commit_generation_design(uuid,text,text,text,timestamptz,uuid,jsonb,jsonb)','execute'), 'anonymous cannot refine');
select pg_temp.expect(not has_function_privilege('authenticated','public.commit_generation_design(uuid,text,text,text,timestamptz,uuid,jsonb,jsonb)','execute'), 'browser role cannot refine');
select pg_temp.expect(has_function_privilege('service_role','public.commit_generation_design(uuid,text,text,text,timestamptz,uuid,jsonb,jsonb)','execute'), 'service role can refine');
select pg_temp.expect((select prosecdef from pg_proc where oid='public.commit_generation_design(uuid,text,text,text,timestamptz,uuid,jsonb,jsonb)'::regprocedure), 'narrow transaction is security definer');
insert into auth.users(id,email) values
  ('fd620def-732d-4a67-a616-000000000001','visual-designer-rollback@example.test'),
  ('fd620def-732d-4a67-a616-000000000002','visual-designer-other-rollback@example.test');
insert into public.generation_jobs(id,owner_id,run_id,status,stage,saved_course_id,user_brief,lease_expires_at) values
  ('job-visual-design-rollback','fd620def-732d-4a67-a616-000000000001','design-run','running','design','visual-design-rollback',
   '{"materials_policy":"integrated-visuals-v2","visual_designer_policy":"learner-experience-v1"}',now()+interval '6 minutes');
select set_config('request.jwt.claims','{"role":"service_role"}',true);
select public.commit_user_course('fd620def-732d-4a67-a616-000000000001','visual-design-rollback',null,null,
  '{"config":{"id":"visual-design-rollback"},"_generationJobId":"job-visual-design-rollback",
    "_brief":{"materials_policy":"integrated-visuals-v2","visual_designer_policy":"learner-experience-v1","components":["lessons","images"]},
    "modules":{"1":{"lesson-1":{"id":"lesson-1","sections":[{"type":"concept","content":"Preserved teaching"}]}}}}');
create temporary table visual_design_original as select payload,write_revision,updated_at from public.user_courses
  where id='visual-design-rollback' and owner_id='fd620def-732d-4a67-a616-000000000001';
create function pg_temp.attempt(changes jsonb default '{}') returns jsonb language plpgsql as $$
declare course public.user_courses; design jsonb; progress jsonb; proposed jsonb;
begin
  select * into course from public.user_courses where id='visual-design-rollback' and owner_id='fd620def-732d-4a67-a616-000000000001';
  design := coalesce(course.payload->'_visualDesign',jsonb_build_object('version',1,'policy','learner-experience-v1',
    'cycle','fd620def-732d-4a67-a616-000000000003','sourceRevision',course.write_revision,'status','reviewing',
    'review',null,'items','{}'::jsonb,'pending',null,'contentHash',repeat('a',64)));
  if changes ? 'design' then design := case when jsonb_typeof(changes->'design')='object' then design||(changes->'design') else changes->'design' end; end if;
  progress := jsonb_build_object('version',1,'status',design->>'status','cycle',design->>'cycle',
    'total',1,'completed',0,'reviewed',false,'items','{}'::jsonb);
  if changes ? 'progress' then progress := case when jsonb_typeof(changes->'progress')='object' then progress||(changes->'progress') else changes->'progress' end; end if;
  proposed := course.payload||jsonb_build_object('_visualDesign',design);
  if changes ? 'payloadPatch' then proposed := proposed||(changes->'payloadPatch'); end if;
  if changes ? 'lessonText' then proposed := jsonb_set(proposed,'{modules,1,lesson-1,sections,0,content}',changes->'lessonText'); end if;
  if changes ? 'payload' then proposed := changes->'payload'; end if;
  return public.commit_generation_design(
    case when changes ? 'owner' then (changes->>'owner')::uuid else course.owner_id end,
    coalesce(changes->>'job','job-visual-design-rollback'),
    case when changes ? 'run' then changes->>'run' else 'design-run' end,
    case when changes ? 'course' then changes->>'course' else course.id end,
    case when changes ? 'timestamp' then (changes->>'timestamp')::timestamptz else course.updated_at end,
    case when changes ? 'revision' then (changes->>'revision')::uuid else course.write_revision end,
    proposed,progress);
end;
$$;
create function pg_temp.edit_course(changes jsonb) returns void language plpgsql as $$
declare course public.user_courses; result jsonb;
begin
  select * into course from public.user_courses where id='visual-design-rollback' and owner_id='fd620def-732d-4a67-a616-000000000001';
  result := public.commit_user_course(course.owner_id,course.id,course.write_revision,course.updated_at,course.payload||changes);
  if result->>'saved' is distinct from 'true' then raise exception 'Synthetic edit failed'; end if;
end;
$$;
select pg_temp.expect((select design_progress is null from public.generation_jobs where id='job-visual-design-rollback'),'new progress defaults to null');
do $$ declare bad jsonb; begin
  for bad in select value from jsonb_array_elements('[null,[],1,"text",{},{"version":2},{"unrelated":1}]') loop
    begin
      update public.generation_jobs set design_progress=bad where id='job-visual-design-rollback';
      raise exception 'Invalid progress was accepted';
    exception when check_violation then perform pg_temp.expect(true,'reject invalid progress '||bad::text); end;
  end loop;
  begin
    update public.generation_jobs set design_progress=jsonb_build_object('version',1,'padding',repeat('x',131072)) where id='job-visual-design-rollback';
    raise exception 'Oversize progress was accepted';
  exception when check_violation then perform pg_temp.expect(true,'reject oversized progress'); end;
end $$;
select pg_temp.expect(pg_temp.attempt('{"owner":"fd620def-732d-4a67-a616-000000000002"}')->>'error'='conflict','wrong owner rejected');
select pg_temp.expect(pg_temp.attempt('{"job":"another-job"}')->>'error'='conflict','wrong job rejected');
select pg_temp.expect(pg_temp.attempt('{"run":"old-run"}')->>'error'='conflict','stale run rejected');
select pg_temp.expect(pg_temp.attempt('{"run":null}')->>'error'='conflict','missing run rejected');
select pg_temp.expect(pg_temp.attempt('{"course":"another-course"}')->>'error'='conflict','cross-course write rejected');
select pg_temp.expect(pg_temp.attempt('{"revision":"fd620def-732d-4a67-a616-000000000099"}')->>'error'='conflict','stale course revision rejected');
select pg_temp.expect(pg_temp.attempt('{"revision":null}')->>'error'='conflict','missing course revision rejected');
select pg_temp.expect(pg_temp.attempt('{"timestamp":"2000-01-01T00:00:00Z"}')->>'error'='conflict','stale course timestamp rejected');
select pg_temp.expect(pg_temp.attempt('{"timestamp":null}')->>'error'='conflict','missing course timestamp rejected');
select pg_temp.expect(pg_temp.attempt('{"payload":[]}')->>'error'='conflict','nonobject payload rejected');
select pg_temp.expect(pg_temp.attempt('{"design":null}')->>'error'='conflict','missing design metadata rejected');
select pg_temp.expect(pg_temp.attempt('{"design":{"policy":"other-policy"}}')->>'error'='conflict','wrong design policy rejected');
select pg_temp.expect(pg_temp.attempt('{"design":{"cycle":"not-a-uuid"}}')->>'error'='conflict','invalid design cycle rejected');
select pg_temp.expect(pg_temp.attempt('{"design":{"contentHash":"not-a-hash"}}')->>'error'='conflict','invalid content fingerprint rejected');
select pg_temp.expect(pg_temp.attempt('{"design":{"sourceRevision":"fd620def-732d-4a67-a616-000000000099"}}')->>'error'='conflict','design is bound to original captured revision');
select pg_temp.expect(pg_temp.attempt('{"design":{"pending":{"id":"bad","key":"course","status":"started"}}}')->>'error'='conflict','invalid pending identity rejected');
select pg_temp.expect(pg_temp.attempt('{"progress":null}')->>'error'='conflict','missing mirrored progress rejected');
select pg_temp.expect(pg_temp.attempt('{"progress":{"status":"complete"}}')->>'error'='conflict','mismatched course and job status rejected');
select pg_temp.expect(pg_temp.attempt('{"progress":{"cycle":"fd620def-732d-4a67-a616-000000000099"}}')->>'error'='conflict','mismatched course and job cycle rejected');
select pg_temp.expect(pg_temp.attempt('{"progress":{"completed":2}}')->>'error'='conflict','invalid progress counters rejected');
select pg_temp.expect(pg_temp.attempt('{"design":{"status":"complete"}}')->>'error'='conflict','incomplete refinement cannot claim complete');
select pg_temp.expect(pg_temp.attempt(jsonb_build_object('design',jsonb_build_object('padding',repeat('x',131072))))->>'error'='conflict','oversize course design checkpoint rejected');
select pg_temp.expect((select design_progress is null from public.generation_jobs where id='job-visual-design-rollback'),'rejected attempts do not advance job');
select pg_temp.expect((select payload=(select payload from visual_design_original) and write_revision=(select write_revision from visual_design_original) from public.user_courses where id='visual-design-rollback' and owner_id='fd620def-732d-4a67-a616-000000000001'),'rejected attempts preserve original course revision');
update public.generation_jobs set status='cancelled',completed_at=now() where id='job-visual-design-rollback';
select pg_temp.expect(pg_temp.attempt()->>'error'='conflict','cancelled job cannot refine');
update public.generation_jobs set status='running',completed_at=null,lease_expires_at=now()-interval '1 second' where id='job-visual-design-rollback';
select pg_temp.expect(pg_temp.attempt()->>'error'='conflict','expired lease cannot refine');
-- The installed schema normally rejects null already; exercise the RPC's
-- defensive check without retaining any schema change outside this rollback.
alter table public.generation_jobs alter column lease_expires_at drop not null;
update public.generation_jobs set lease_expires_at=null where id='job-visual-design-rollback';
select pg_temp.expect(pg_temp.attempt()->>'error'='conflict','missing lease cannot refine');
update public.generation_jobs set lease_expires_at=now()+interval '6 minutes',stage='images' where id='job-visual-design-rollback';
alter table public.generation_jobs alter column lease_expires_at set not null;
select pg_temp.expect(pg_temp.attempt()->>'error'='conflict','image stage cannot rewrite lessons');
update public.generation_jobs set stage='design',user_brief='{"materials_policy":"integrated-visuals-v2"}' where id='job-visual-design-rollback';
select pg_temp.expect(pg_temp.attempt()->>'error'='conflict','old integrated job cannot opt in');
update public.generation_jobs set user_brief='{"visual_designer_policy":"learner-experience-v1"}' where id='job-visual-design-rollback';
select pg_temp.expect(pg_temp.attempt()->>'error'='conflict','new marker alone cannot bypass material policy');
update public.generation_jobs set user_brief='{"materials_policy":"integrated-visuals-v2","visual_designer_policy":"learner-experience-v1"}' where id='job-visual-design-rollback';
select pg_temp.edit_course('{"_brief":{"materials_policy":"integrated-visuals-v2"}}');
select pg_temp.expect(pg_temp.attempt()->>'error'='not_found','old integrated course cannot opt in');
select pg_temp.edit_course(jsonb_build_object('_brief',(select payload->'_brief' from visual_design_original)));
select pg_temp.expect(pg_temp.attempt('{"payloadPatch":{"_generationJobId":"other-job"}}')->>'error'='conflict','payload job identity cannot change');
select pg_temp.expect(pg_temp.attempt('{"payloadPatch":{"config":{"id":"another-course"}}}')->>'error'='conflict','payload course identity cannot change');
select pg_temp.expect(pg_temp.attempt('{"payloadPatch":{"_brief":{}}}')->>'error'='conflict','selected materials and original brief cannot change');
select pg_temp.expect(pg_temp.attempt('{"payloadPatch":{"modules":{"1":{"lesson-1":{"sections":[{"type":"image","asset_id":"unreceipted-asset"}]}}}}}')->>'error'='conflict','designer cannot inject asset outside receipt transaction');
select pg_temp.edit_course('{"modules":{"1":{"lesson-1":{"id":"lesson-1","sections":[{"type":"image","asset_id":"retained-asset","image_slot":"instruction"}]}}}}');
select pg_temp.expect(pg_temp.attempt()->>'error'='conflict','already inserted generation images cannot be rewritten');
select pg_temp.edit_course(jsonb_build_object('modules',(select payload->'modules' from visual_design_original)));
create temporary table visual_design_pending as select pg_temp.attempt('{"design":{"pending":{"id":"fd620def-732d-4a67-a616-000000000004","key":"course","status":"started"},"lastFailure":{"version":1,"code":"VISUAL_DESIGN_SCHEMA","operation":"course_review","operationId":"fd620def-732d-4a67-a616-000000000004","at":"2026-10-05T21:15:51Z","responseReceived":true,"stopReason":"tool_use","issues":[{"path":["lessons",2,"guidance"],"code":"invalid_type"}]}}}') as result;
select pg_temp.expect((select result->>'saved'='true' and result->'payload'->>'_courseRevision' is not null from visual_design_pending),'active exact lease commits pending checkpoint');
select pg_temp.expect((select payload#>>'{_visualDesign,lastFailure,code}'='VISUAL_DESIGN_SCHEMA' and payload#>>'{_visualDesign,lastFailure,issues,0,path,0}'='lessons' from public.user_courses where id='visual-design-rollback'),'bounded failure diagnostics fit existing atomic checkpoint contract');
select pg_temp.expect((select payload->'_visualDesign'->'pending'->>'status'='started' and payload=(select result->'payload' from visual_design_pending) from public.user_courses where id='visual-design-rollback'),'lost acknowledgement is recoverable from saved pending course');
select pg_temp.expect((select design_progress->>'status'='reviewing' and design_progress->>'cycle'='fd620def-732d-4a67-a616-000000000003' from public.generation_jobs where id='job-visual-design-rollback'),'pending course and job progress committed atomically');
select pg_temp.expect(pg_temp.attempt('{"design":{"cycle":"fd620def-732d-4a67-a616-000000000005"}}')->>'error'='conflict','resume cannot replace design cycle');
select pg_temp.expect(pg_temp.attempt('{"design":{"sourceRevision":"fd620def-732d-4a67-a616-000000000005"}}')->>'error'='conflict','resume cannot replace captured source revision');
select pg_temp.expect(pg_temp.attempt('{"design":{"status":"complete"},"progress":{"completed":1}}')->>'error'='conflict','pending paid attempt cannot be marked complete');
create temporary table visual_design_captured as select updated_at,write_revision from public.user_courses where id='visual-design-rollback';
select pg_temp.edit_course('{"creatorEdit":"Keep this concurrent human edit"}');
select pg_temp.expect(pg_temp.attempt(jsonb_build_object('timestamp',(select updated_at from visual_design_captured),'revision',(select write_revision from visual_design_captured)))->>'error'='conflict','concurrent creator edit rejects stale designer output');
select pg_temp.expect((select payload->>'creatorEdit'='Keep this concurrent human edit' from public.user_courses where id='visual-design-rollback'),'creator edit survives stale design save');
create temporary table visual_design_complete as select pg_temp.attempt(jsonb_build_object('design',jsonb_build_object('status','complete','pending',null,'review','{}'::jsonb,
  'items',jsonb_build_object('module/lesson',jsonb_build_object('status','saved','inputHash',repeat('a',64),'outputHash',repeat('b',64),'summary','Clearer copy','flags','[]'::jsonb))),
  'progress',jsonb_build_object('completed',1,'reviewed',true,'items',jsonb_build_object('module/lesson',jsonb_build_object('status','saved','outputHash',repeat('b',64)))),
  'lessonText','Learner-friendly teaching')) as result;
select pg_temp.expect((select result->>'saved'='true' from visual_design_complete),'bounded designer pass completes');
select pg_temp.expect((select design_progress->>'status'='complete' and design_progress->>'completed'='1' from public.generation_jobs where id='job-visual-design-rollback'),'complete progress is atomically visible on job');
select pg_temp.expect((select payload->'_visualDesign'->>'status'='complete' and payload->>'creatorEdit'='Keep this concurrent human edit' and payload#>>'{modules,1,lesson-1,sections,0,content}'='Learner-friendly teaching' from public.user_courses where id='visual-design-rollback'),'completed checkpoint saves revised content and retains creator edit');
select pg_temp.expect(pg_temp.attempt('{"design":{"status":"refining","pending":null},"lessonText":"Repeated pass"}')->>'error'='conflict','completed pass cannot be reopened or rewritten');
select pg_temp.expect((select payload#>>'{modules,1,lesson-1,sections,0,content}'='Learner-friendly teaching' from public.user_courses where id='visual-design-rollback'),'rejected repeated pass preserves saved refined content');
select 'VISUAL_DESIGN_CHECKS='||count(*) from visual_design_assertions;
rollback;
`); } finally {
  assert.equal(psql(snapshot), before, 'Rollback must preserve installed schema and all courses/jobs/receipts/owner identities.');
}
const count = Number(output.match(/VISUAL_DESIGN_CHECKS=(\d+)/)?.[1]);
assert.ok(count >= 60, 'Expected every SQL assertion to run.');
console.log(JSON.stringify({ passed: true, checks: count, migrationAppliedTwice: true, localOnly: true,
  transactionRolledBack: true, schemaAndDataUnchanged: true, paidCalls: 0 }));
