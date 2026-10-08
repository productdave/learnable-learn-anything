// Disposable PostgreSQL plus the actual deployed wrapper with simulated AI.
// No hosted write, provider key or real provider request.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
const container='supabase_db_learnable-setup-local',database='learnable_manual_recovery_'+Date.now();
const owner='62b1631e-a5aa-49b7-b05f-ebd5e4d3706f',other='11111111-1111-4111-8111-111111111111';
const job='job-setup-'+ 'a'.repeat(48),qa='job-setup-'+ 'b'.repeat(48),fresh='job-setup-'+ 'c'.repeat(48);
const foreign='job-setup-'+ 'd'.repeat(48),missing='job-setup-'+ 'e'.repeat(48);
const query=(db,sql)=>execFileSync('docker',['exec','-i',container,'psql','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-At'],{input:sql,encoding:'utf8',stdio:['pipe','pipe','pipe']}).trim();
const sql=q=>query(database,q),scope=(kind,id,uid=owner)=>JSON.parse(sql(`set role service_role; select public.learnable_staging_manual_test_scope('${uid}','${kind}','${id}');`).split('\n').at(-1)).manual;
let checks=0;const check=(a,b,label)=>{assert.deepEqual(a,b,label);checks++;};
const snapshot=()=>sql(`select md5(string_agg(to_jsonb(b)::text,'|' order by to_jsonb(b)::text)) from public.learnable_staging_spend_budgets b;`);
query('postgres',`create database ${database};`);
try{
  sql(`create table public.generation_jobs(id text primary key,owner_id uuid,saved_course_id text);
    create table public.user_courses(id text,owner_id uuid);
    create table public.learnable_staging_spend_budgets(owner_id uuid,job_id text,enabled boolean,halted boolean,charged_microusd bigint);
    create table public.learnable_staging_image_budgets(owner_id uuid,course_id text,enabled boolean);
    insert into public.generation_jobs values('${job}','${owner}','recovered'),('${qa}','${owner}','qa-course'),('${fresh}','${owner}','fresh'),('${foreign}','${other}','foreign');
    insert into public.user_courses values('recovered','${owner}'),('qa-course','${owner}'),('fresh','${owner}'),('foreign','${other}');
    insert into public.learnable_staging_spend_budgets values('${owner}','${job}',false,true,661440),('${owner}','${job}',false,false,1289730),('${owner}','${qa}',false,false,1234);`);
  sql(readFileSync(new URL('./staging-manual-testing/migration.sql',import.meta.url),'utf8'));
  check(scope('text',job),false,'reproduce original closed-budget classification');
  let migration=readFileSync(new URL('./staging-manual-testing/recovery.sql',import.meta.url),'utf8');
  if(process.env.MANUAL_RECOVERY_BASELINE==='1')migration=migration.split('-- Classifier replacement.')[0];
  sql(migration);
  const before=snapshot();
  for(const[k,id,expected]of [['text',job,false],['images','recovered',false],['text',qa,false],['images','qa-course',false],['text',fresh,true],['images','fresh',true],['text',foreign,false],['images','foreign',false],['text',missing,false],['unknown',job,false]])check(scope(k,id),expected,`${k}:${id}`);
  sql(`insert into public.learnable_staging_manual_recoveries(owner_id,job_id,approval_note) values('${owner}','${job}','Explicit owner request to resume this saved course personally.');`);
  check(scope('text',job),true,'explicit manual recovery must unblock this exact job');
  check(scope('images','recovered'),true,'recovered course can reach its normal image stage');
  check(scope('text',qa),false,'unrelated historical QA stays guarded');
  check(scope('text',job,other),false,'approval never crosses owners');
  check(scope('images','recovered',other),false,'image ownership retained');
  check(snapshot(),before,'old budget rows unchanged');
  sql(`update public.learnable_staging_manual_recoveries set revoked_at=now();`);
  check(scope('text',job),false,'revocation blocks further text calls');
  check(scope('images','recovered'),false,'revocation also applies to resulting course');
  sql(`update public.learnable_staging_manual_recoveries set revoked_at=null;
    update public.learnable_staging_spend_budgets set enabled=true where job_id='${job}';`);
  check(scope('text',job),false,'enabled QA budget takes precedence');
  check(scope('images','recovered'),false,'enabled QA budget also retains image boundary');
  sql(`update public.learnable_staging_spend_budgets set enabled=false;
    insert into public.learnable_staging_spend_budgets values('${owner}',null,true,false,0);`);
  check(scope('text',job),false,'unbound enabled QA budget takes precedence');
  sql(`delete from public.learnable_staging_spend_budgets where job_id is null;
    insert into public.learnable_staging_image_budgets values('${owner}','recovered',false);`);
  check(scope('images','recovered'),false,'text recovery cannot adopt a separate historical image QA grant');
  sql(`delete from public.learnable_staging_image_budgets;
    update public.generation_jobs set saved_course_id='recovered' where id='${qa}';`);
  check(scope('images','recovered'),false,'another unrecovered QA job on the same course still blocks images');
  sql(`update public.generation_jobs set saved_course_id='qa-course' where id='${qa}';
    insert into public.learnable_staging_manual_recoveries(owner_id,job_id,approval_note) values('${other}','${job}','Wrong owner'),('${owner}','${missing}','Missing job');`);
  check(scope('text',job,other),false,'unowned approval is inert');
  check(scope('text',missing),false,'orphan approval is inert');
  for(const role of ['anon','authenticated','service_role']){
    check(sql(`select has_table_privilege('${role}','public.learnable_staging_manual_recoveries','select,insert,update,delete,truncate');`),'f',role+' cannot read/mint/edit/delete approvals');
    check(sql(`select has_function_privilege('${role}','public.learnable_staging_manual_recovery_allowed(uuid,text)','execute');`),'f',role+' cannot invoke private helper');
    assert.throws(()=>sql(`set role ${role}; insert into public.learnable_staging_manual_recoveries(owner_id,job_id,approval_note) values('${owner}','${qa}','Unauthorized');`));checks++;
    check(sql(`select has_function_privilege('${role}','public.learnable_staging_manual_test_scope(uuid,text,text)','execute');`),role==='service_role'?'t':'f','classifier privilege');
  }
  check(sql("select relrowsecurity from pg_class where oid='public.learnable_staging_manual_recoveries'::regclass;"),'t','RLS enabled');
  check(sql("select provolatile,prosecdef from pg_proc where oid='public.learnable_staging_manual_test_scope(uuid,text,text)'::regprocedure;"),'s|t','read-only definer classifier');
  const {createManualAwareTextClient,beginManualAwareImageSpend}=await import(pathToFileURL(resolve(process.env.MANUAL_POLICY_FILE||'scripts/staging-manual-testing/policy.mjs')));
  const env={LEARNABLE_MANUAL_TESTING:'1',LEARNABLE_MANUAL_TESTING_OWNER_ID:owner,LEARNABLE_SETUP_GENERATION:'1',LEARNABLE_STAGING_IMAGE_SPEND:'1',SUPABASE_URL:'https://dmnwkrybgggbpqpetuub.supabase.co',LEARNABLE_GENERATION_ORIGIN:'https://learnable-staging.vercel.app'};
  const supabase={rpc:async(name,args)=>{check(name,'learnable_staging_manual_test_scope','same runtime RPC');return{data:{manual:scope(args.p_kind,args.p_scope_id,args.p_owner_id)}};}};
  let providerCalls=0,guardedCalls=0;
  const create=jobId=>createManualAwareTextClient({ownerId:owner,jobId,runId:other,apiKey:'synthetic-only',env,supabase,
    fetcher:async()=>{providerCalls++;return{ok:true,json:async()=>({content:[],usage:{input_tokens:10,output_tokens:20}})};}},()=>({messages:{create:async()=>{guardedCalls++;throw Error('Original QA guard');}}}));
  const response=await create(job).messages.create({max_tokens:100});
  check(response.usage.output_tokens,20,'simulated provider result through deployed client');
  check(providerCalls,1,'one simulated dispatch');check(guardedCalls,0,'recovered job does not hit closed allowance');
  await assert.rejects(create(qa).messages.create({}),/Original QA guard/);checks++;
  check(providerCalls,1,'unapproved job does not reach provider');check(guardedCalls,1,'unapproved job retains old guard');
  const spend=await beginManualAwareImageSpend({ownerId:owner,courseId:'recovered',env,client:supabase,operationId:other,requestHash:'a'.repeat(64),policy:{funding:'creator'}},()=>{throw Error('Unexpected image QA guard');});
  await spend.settle();checks++;
  sql(`update public.learnable_staging_manual_recoveries set revoked_at=now() where owner_id='${owner}' and job_id='${job}';`);
  await assert.rejects(create(job).messages.create({}),/Original QA guard/);checks++;
  check(providerCalls,1,'revocation is checked before every provider dispatch');
  check(snapshot(),before,'all historical budgets still byte-equivalent');
  console.log(JSON.stringify({checks,passed:true,syntheticProviderCalls:providerCalls,paidCalls:0,scope:'disposable PostgreSQL and wrapper regression'}));
}finally{
  assert.match(database,/^learnable_manual_recovery_\d+$/);query('postgres',`drop database ${database};`);
}
