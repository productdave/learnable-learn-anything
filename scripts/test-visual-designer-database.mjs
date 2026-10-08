// Static migration contract; the companion verifier exercises real PostgreSQL.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const sql = readFileSync(new URL('../db/24-visual-designer.sql', import.meta.url), 'utf8');
const code = sql.replace(/--[^\n]*/g, '');
assert.match(code, /add column if not exists design_progress jsonb/);
assert.match(code, /drop constraint if exists generation_jobs_stage_check;/);
assert.match(code, /drop constraint if exists generation_jobs_stage_check1;/);
assert.match(code, /stage in \('intake','research','topics','design','images','assemble','done'\)/);
assert.match(code, /octet_length\(design_progress::text\)<=131072/);
assert.match(code, /p_revision uuid/);
assert.match(code, /security definer set search_path = public,pg_temp/);
assert.ok(code.indexOf('from public.generation_jobs') < code.indexOf('from public.user_courses'));
for (const guard of ['job.run_id is distinct from p_run', 'job.lease_expires_at is null',
  'job.lease_expires_at <= clock_timestamp()', "job.stage <> 'design'", 'job.saved_course_id is distinct from p_course',
  "job.user_brief->>'visual_designer_policy'", "course.payload->'_brief'->>'visual_designer_policy'",
  'course.write_revision is distinct from p_revision', 'course.updated_at is distinct from p_updated_at',
  "p_payload->'_brief' is distinct from course.payload->'_brief'", 'jsonb_path_exists(course.payload',
  'jsonb_path_exists(p_payload', 'public.commit_user_course(p_owner,p_course,p_revision,p_updated_at,p_payload)',
  'update public.generation_jobs set design_progress=p_progress']) assert.ok(code.includes(guard), guard);
assert.match(code, /revoke all on function public\.commit_generation_design\(uuid,text,text,text,timestamptz,uuid,jsonb,jsonb\) from public,anon,authenticated/);
assert.match(code, /grant execute on function public\.commit_generation_design\(uuid,text,text,text,timestamptz,uuid,jsonb,jsonb\) to service_role/);
assert.doesNotMatch(code, /create policy|grant (?:insert|update|delete)|update public\.user_courses|update public\.generation_jobs set user_brief/i);
console.log('visual designer migration contract passed (no database or provider calls)');
