// Disposable database on the already-running LOCAL Supabase container only.
import assert from 'node:assert/strict';
import {execFileSync,execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {readFileSync} from 'node:fs';
const run=promisify(execFile),container='supabase_db_learnable-setup-local';
const db='learnable_spend_test_'+Date.now();
const command=(database,sql)=>['exec','-i',container,'psql','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At','-c',sql];
const query=sql=>execFileSync('docker',command(db,sql),{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const owner='11111111-1111-4111-8111-111111111111',other='aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',runId='22222222-2222-4222-8222-222222222222',job='job-33333333-3333-4333-8333-333333333333';
const grantId='44444444-4444-4444-8444-444444444444';let checks=0;
const reserve=(request,amount=80,changes={})=>`select public.reserve_learnable_staging_spend('${changes.owner||owner}','${changes.job||job}','${changes.run||runId}','${request}','sonnet45-search20250305-20260922',${amount},'${'a'.repeat(64)}')`;
const settle=(request,amount=30)=>`select public.settle_learnable_staging_spend('${owner}','${job}','${runId}','${request}',${amount},'synthetic-local')`;
const rid=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
function check(label,fn){fn();checks++;}
function reset(){query(`truncate public.learnable_staging_spend_requests,public.learnable_staging_spend_budgets; insert into public.learnable_staging_spend_budgets(id,owner_id,profile,cap_microusd,max_calls,expires_at,approval_note,enabled) values('${grantId}','${owner}','sonnet45-search20250305-20260922',100,3,now()+interval '1 hour','Synthetic local test; no provider',true); update public.generation_jobs set status='running',run_id='${runId}';`);}
execFileSync('docker',command('postgres',`create database ${db}`),{stdio:'pipe'});
try{
  query(`create table public.generation_jobs(id text primary key,owner_id uuid,run_id text,status text); insert into public.generation_jobs values('${job}','${owner}','${runId}','running');`);
  query(readFileSync(new URL('./staging-safeguard/migration.sql',import.meta.url),'utf8'));
  check('no allowance installed',()=>assert.equal(JSON.parse(query(reserve(rid(1)))).reason,'approval'));
  reset();
  for(const role of ['anon','authenticated'])check(role+' cannot read grants or call reserve',()=>{
    assert.equal(query(`select has_table_privilege('${role}','public.learnable_staging_spend_budgets','select'),has_function_privilege('${role}','public.reserve_learnable_staging_spend(uuid,text,text,uuid,text,bigint,text)','execute')`),'f|f');
  });
  check('runtime cannot create grants',()=>assert.equal(query("select has_table_privilege('service_role','public.learnable_staging_spend_budgets','insert'),has_table_privilege('service_role','public.learnable_staging_spend_requests','update')"),'f|f'));
  for(const changes of [{owner:other},{run:other},{job:'job-'+other}])check('identity mismatch denied',()=>assert.equal(JSON.parse(query(reserve(rid(1),80,changes))).ok,false));
  check('exact ceiling enforced before dispatch',()=>assert.equal(JSON.parse(query(reserve(rid(1),101))).reason,'budget'));
  const simultaneous=await Promise.all([rid(2),rid(3)].map(id=>run('docker',command(db,`set role service_role; ${reserve(id)}`))));
  assert.equal(simultaneous.map(r=>JSON.parse(r.stdout.trim().split('\n').at(-1))).filter(r=>r.ok).length,1);checks++;
  const held=query('select id from public.learnable_staging_spend_requests');
  check('pending survives another caller',()=>assert.equal(JSON.parse(query(reserve(rid(4)))).reason,'pending'));
  check('oversized reconciliation cannot refund',()=>assert.equal(JSON.parse(query(settle(held,81))).ok,false));
  check('correct settlement releases only difference',()=>{assert.equal(JSON.parse(query(settle(held))).ok,true);assert.equal(query('select charged_microusd from public.learnable_staging_spend_budgets'),'30');});
  check('settlement idempotent',()=>{assert.equal(JSON.parse(query(settle(held))).ok,true);assert.equal(query('select charged_microusd from public.learnable_staging_spend_budgets'),'30');});
  check('second settlement cannot change cost',()=>assert.equal(JSON.parse(query(settle(held,0))).ok,false));
  check('settled request ID cannot spend twice',()=>assert.equal(JSON.parse(query(reserve(held))).reason,'duplicate'));
  check('new request obeys remaining budget',()=>assert.equal(JSON.parse(query(reserve(rid(4),71))).reason,'budget'));
  check('authorization binds to one job',()=>{query(`insert into public.generation_jobs values('job-${other}','${owner}','${runId}','running')`);assert.equal(JSON.parse(query(reserve(rid(4),1,{job:'job-'+other}))).reason,'approval');});
  reset();query(reserve(rid(5)));query(`select public.halt_learnable_staging_spend('${owner}','${job}','${runId}','${rid(5)}')`);
  check('halt survives successful later settlement',()=>{query(settle(rid(5)));assert.equal(JSON.parse(query(reserve(rid(6),1))).reason,'halted');});
  reset();query(`update public.learnable_staging_spend_budgets set approved_at=now()-interval '2 hours',expires_at=now()-interval '1 hour'`);
  check('expired allowance denied',()=>assert.equal(JSON.parse(query(reserve(rid(7),1))).reason,'approval'));
  reset();query(`update public.generation_jobs set status='cancelled'`);
  check('cancelled job denied',()=>assert.equal(JSON.parse(query(reserve(rid(8),1))).reason,'job'));
  reset();query('update public.learnable_staging_spend_budgets set max_calls=1');query(reserve(rid(9),1));query(settle(rid(9),0));
  check('call ceiling independent of refunds',()=>assert.equal(JSON.parse(query(reserve(rid(10),1))).reason,'budget'));
  console.log(JSON.stringify({status:'passed',checks,database:'disposable local database',providerCalls:0,hostedChanges:0}));
}finally{
  // Only the exact freshly-created test DB; no shared tables or user data.
  assert.match(db,/^learnable_spend_test_\d+$/);
  execFileSync('docker',command('postgres',`drop database ${db}`),{stdio:'pipe'});
}
