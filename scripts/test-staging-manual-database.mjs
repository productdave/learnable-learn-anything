// Exact migration exercised on a newly-created local disposable database.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const container='supabase_db_learnable-setup-local', db='learnable_manual_test_'+Date.now();
const query=(database,sql)=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At'],{input:sql,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const owner='62b1631e-a5aa-49b7-b05f-ebd5e4d3706f',other='11111111-1111-4111-8111-111111111111';
let checks=0;
query('postgres',`create database ${db};`);
try {
  query(db,`create table public.generation_jobs(id text,owner_id uuid,saved_course_id text);
    create table public.user_courses(id text,owner_id uuid);
    create table public.learnable_staging_spend_budgets(owner_id uuid,job_id text,enabled boolean);
    create table public.learnable_staging_image_budgets(owner_id uuid,course_id text,enabled boolean);
    insert into public.generation_jobs values('manual-job','${owner}','manual-course'),('qa-job','${owner}','qa-course'),('other-job','${other}','other-course');
    insert into public.user_courses values('manual-course','${owner}'),('qa-course','${owner}'),('old-image-course','${owner}'),('other-course','${other}');
    insert into public.learnable_staging_spend_budgets values('${owner}','qa-job',false);
    insert into public.learnable_staging_image_budgets values('${owner}','old-image-course',false);`);
  query(db,readFileSync(new URL('./staging-manual-testing/migration.sql',import.meta.url),'utf8'));
  for(const [kind,id,expected] of [['text','manual-job',true],['images','manual-course',true],['text','qa-job',false],
    ['images','qa-course',false],['images','old-image-course',false],['text','missing',false],['images','missing',false],
    ['text','other-job',false],['images','other-course',false],['other','manual-job',false]]){
    const result=JSON.parse(query(db,`set role service_role; select public.learnable_staging_manual_test_scope('${owner}','${kind}','${id}');`).split('\n').at(-1));
    assert.equal(result.manual,expected,kind+':'+id);checks++;
  }
  for(const role of ['anon','authenticated']){
    assert.equal(query(db,`select has_function_privilege('${role}','public.learnable_staging_manual_test_scope(uuid,text,text)','execute');`),'f');checks++;
    assert.throws(()=>query(db,`set role ${role}; select public.learnable_staging_manual_test_scope('${owner}','text','manual-job');`));checks++;
  }
  assert.equal(query(db,"select provolatile,prosecdef from pg_proc where oid='public.learnable_staging_manual_test_scope(uuid,text,text)'::regprocedure;"),'s|t');checks++;
  assert.equal(query(db,'select count(*) from public.learnable_staging_spend_budgets;'),'1');checks++;
  assert.equal(query(db,'select count(*) from public.learnable_staging_image_budgets;'),'1');checks++;
  console.log(JSON.stringify({checks,passed:true,scope:'disposable local PostgreSQL, exact migration, no network/provider calls'}));
} finally {
  assert.match(db,/^learnable_manual_test_\d+$/);query('postgres',`drop database ${db};`);
}
