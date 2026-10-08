// Disposable database on the existing local container; never shared/hosted data.
import assert from 'node:assert/strict';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync,writeFileSync} from 'node:fs';
const run=promisify(execFile),container='supabase_db_learnable-setup-local',database='learnable_image_spend_test_'+Date.now();
const cmd=(db,sql)=>['exec','-i',container,'psql','-U','postgres','-d',db,'-v','ON_ERROR_STOP=1','-At','-c',sql];
const q=sql=>execFileSync('docker',cmd(database,sql),{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const owner='11111111-1111-4111-8111-111111111111',other='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',hash='a'.repeat(64),profile='gpt-image-2.5-flare-2026-09-08-medium1024-20260930';
const rid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const reserve=(n,o=owner,c='rsi',f=hash,p=profile)=>`select public.reserve_learnable_staging_image_spend('${o}','${c}','${rid(n)}','${f}','${p}')`;
const settle=(n,amount=50000,o=owner)=>`select public.settle_learnable_staging_image_spend('${o}','rsi','${rid(n)}','${hash}',${amount},'req_synthetic')`;
let checks=0;const check=fn=>{fn();checks++;};
function reset(){q(`truncate public.learnable_staging_image_spend,public.learnable_staging_image_budgets;
insert into public.learnable_staging_image_budgets(owner_id,course_id,profile,cap_microusd,max_calls,expires_at,approval_note,enabled) values('${owner}','rsi','${profile}',3000000,3,now()+interval '1 hour','Synthetic local test',true);`);}
execFileSync('docker',cmd('postgres',`create database ${database}`),{stdio:'pipe'});
try{
  q('create table public.course_image_requests(id uuid,owner_id uuid,course_id text,status text,is_current boolean,payload jsonb);');
  for(let n=1;n<=10;n++)q(`insert into public.course_image_requests values('${rid(n)}','${owner}','rsi','running',true,'${JSON.stringify({status:'running',requestHash:hash,quote:{model:'gpt-image-2.5-flare-2026-09-08',funding:'creator',n:1,size:'1024x1024',quality:'medium',outputFormat:'png'}})}');`);
  q(readFileSync('scripts/staging-image-safeguard/migration.sql','utf8'));
  check(()=>assert.equal(JSON.parse(q(reserve(1))).ok,false));reset();
  for(const role of ['anon','authenticated','service_role'])check(()=>assert.equal(q(`select has_table_privilege('${role}','public.learnable_staging_image_budgets','select,insert,update,delete'),has_table_privilege('${role}','public.learnable_staging_image_spend','select,insert,update,delete')`),'f|f'));
  for(const role of ['anon','authenticated'])check(()=>assert.equal(q(`select has_function_privilege('${role}','public.reserve_learnable_staging_image_spend(uuid,text,uuid,text,text)','execute')`),'f'));
  for(const sql of [reserve(1,other),reserve(1,owner,'other'),reserve(1,owner,'rsi','b'.repeat(64)),reserve(1,owner,'rsi',hash,'wrong')])check(()=>assert.equal(JSON.parse(q(sql)).ok,false));
  const concurrent=await Promise.all([1,2].map(n=>run('docker',cmd(database,'set role service_role; '+reserve(n)))));
  check(()=>assert.equal(concurrent.map(r=>JSON.parse(r.stdout.trim().split('\n').at(-1))).filter(r=>r.ok).length,1));
  const held=q('select operation_id from public.learnable_staging_image_spend'),n=Number(held.slice(-12));
  check(()=>assert.equal(q('select charged_microusd from public.learnable_staging_image_budgets'),'3000000'));
  check(()=>assert.equal(JSON.parse(q(reserve(3))).ok,false));
  check(()=>assert.equal(JSON.parse(q(settle(n,3000001))).ok,false));
  check(()=>assert.equal(JSON.parse(q(settle(n,50000,other))).ok,false));
  check(()=>{assert.equal(JSON.parse(q(settle(n))).ok,true);assert.equal(q('select charged_microusd from public.learnable_staging_image_budgets'),'50000');});
  check(()=>assert.equal(JSON.parse(q(settle(n))).ok,true));
  check(()=>assert.equal(JSON.parse(q(settle(n,1))).ok,false));
  check(()=>assert.equal(JSON.parse(q(reserve(n))).ok,false));
  check(()=>assert.equal(JSON.parse(q(reserve(3))).reserved_microusd,2950000));q(settle(3));q(reserve(4));q(settle(4));
  check(()=>assert.equal(JSON.parse(q(reserve(5))).ok,false));
  reset();q(reserve(5));q(`select public.halt_learnable_staging_image_spend('${owner}','rsi','${rid(5)}','${hash}')`);q(settle(5));
  check(()=>assert.equal(JSON.parse(q(reserve(6))).ok,false));
  reset();q("update public.learnable_staging_image_budgets set approved_at=now()-interval '2 hours',expires_at=now()-interval '1 hour'");
  check(()=>assert.equal(JSON.parse(q(reserve(7))).ok,false));
  reset();q('update public.learnable_staging_image_budgets set charged_microusd=2500000');
  check(()=>assert.equal(JSON.parse(q(reserve(7))).ok,false));
  reset();q(`update public.course_image_requests set status='cancelled' where id='${rid(7)}'`);
  check(()=>assert.equal(JSON.parse(q(reserve(7))).ok,false));
  const result={at:new Date().toISOString(),status:'passed',checks,concurrency:'one winner; entire remainder held',providerCalls:0,hostedChanges:0,disposableDatabaseRemoved:true};
  writeFileSync('output/staging/2026-09-30-rsi-images/database-tests.json',JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result));
}finally{assert.match(database,/^learnable_image_spend_test_\d+$/);execFileSync('docker',cmd('postgres',`drop database ${database}`),{stdio:'pipe'});}
