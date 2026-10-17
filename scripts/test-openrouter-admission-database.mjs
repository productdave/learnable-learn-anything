import assert from 'node:assert/strict';
import {execFileSync,execFile} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {promisify} from 'node:util';
import {createOpenRouterPolicy} from '../web/api/_lib/openrouter-policy.mjs';
const db='learnable_pilot_test_'+Date.now(),container='supabase_db_learnable-setup-local';
const command=(database,sql)=>['exec','-i',container,'psql','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At','-c',sql];
const query=sql=>execFileSync('docker',command(db,sql),{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const result=sql=>JSON.parse(query(sql));let checks=0;
const check=(name,fn)=>{fn();checks++;};
const owner='11111111-1111-4111-8111-111111111111',other='22222222-2222-4222-8222-222222222222',pool='33333333-3333-4333-8333-333333333333',ownerBudget='44444444-4444-4444-8444-444444444444';
const now=Date.now(),policy=createOpenRouterPolicy({version:'openrouter-native-v2',reviewedAt:new Date(now).toISOString(),validUntil:new Date(now+3600000).toISOString(),now});
const inspect=(id=owner)=>`select public.inspect_learnable_ai_pilot('${id}')`;
const admit=(job='job-one',id=owner,hash=policy.fingerprint)=>`select public.admit_learnable_ai_job('${id}','${job}','${hash}')`;
execFileSync('docker',command('postgres',`create database ${db}`),{stdio:'pipe'});
try{
 query('create table public.generation_jobs(id text primary key,owner_id uuid,run_id text,status text,lease_expires_at timestamptz)');
 for(const name of ['27-platform-ai-spend','28-openrouter-pilot-admission','29-owner-funded-generation'])query(readFileSync(new URL('../db/'+name+'.sql',import.meta.url),'utf8'));
 check('no enrollment on install',()=>assert.equal(result(inspect()).reason,'not_enrolled'));
 for(const role of ['anon','authenticated','service_role'])check(role+' cannot mint pilot or budgets',()=>assert.equal(query(`select has_table_privilege('${role}','public.learnable_ai_pilots','insert'),has_table_privilege('${role}','public.learnable_ai_budgets','insert'),has_table_privilege('${role}','public.learnable_ai_admissions','update')`),'f|f|f'));
 for(const role of ['anon','authenticated'])check(role+' cannot impersonate admission owner',()=>assert.equal(query(`select has_function_privilege('${role}','public.admit_learnable_ai_job(uuid,text,text)','execute')`),'f'));
 query(`insert into public.learnable_ai_budgets(id,owner_id,cap_microusd,max_calls,expires_at,enabled) values ('${pool}',null,5000000,30,now()+interval '1 hour',true),('${ownerBudget}','${owner}',5000000,30,now()+interval '1 hour',true);
 insert into public.learnable_ai_pilots(owner_id,policy,pool_budget_id,owner_budget_id,job_cap_microusd,max_job_calls,expires_at,enabled,approval_note) values ('${owner}','${JSON.stringify(policy)}','${pool}','${ownerBudget}',5000000,20,now()+interval '1 hour',true,'Synthetic local test');`);
 check('reads operator-authorized policy',()=>{const r=result(inspect());assert.equal(r.ok,true);assert.equal(r.policy.fingerprint,policy.fingerprint);assert.equal(r.remainingMicrousd,5000000);});
 check('other owner not enrolled',()=>assert.equal(result(inspect(other)).ok,false));
 check('other owner cannot admit',()=>assert.equal(result(admit('job-one',other)).ok,false));
 check('forged policy cannot admit',()=>assert.equal(result(admit('job-one',owner,'bad')).reason,'policy'));
 check('bad job ID cannot admit',()=>assert.equal(result(admit('../bad')).reason,'invalid'));
 const first=result(admit());check('creates one bounded immutable binding',()=>{assert.equal(first.ok,true);assert.equal(first.budgetIds.length,3);assert.equal(first.budgetIds[0],pool);assert.equal(first.budgetIds[1],ownerBudget);});
 check('lost admission acknowledgement can be read without more budgets',()=>{assert.deepEqual(result(admit()),first);assert.equal(query('select count(*) from public.learnable_ai_budgets'),'3');});
 check('admission itself buys no AI work',()=>{assert.equal(query('select sum(committed_microusd),sum(calls) from public.learnable_ai_budgets'),'0|0');assert.equal(query('select count(*) from public.learnable_ai_requests'),'0');});
 const run=promisify(execFile);const replies=await Promise.all([1,2,3].map(()=>run('docker',command(db,admit('job-concurrent')),{encoding:'utf8'})));
 check('concurrent starts get the same binding',()=>{assert.deepEqual(JSON.parse(replies[0].stdout),JSON.parse(replies[1].stdout));assert.deepEqual(JSON.parse(replies[1].stdout),JSON.parse(replies[2].stdout));assert.equal(query('select count(*) from public.learnable_ai_budgets'),'4');});
 query(`insert into public.generation_jobs(id,owner_id,run_id,status,lease_expires_at,ai_policy,ai_budget_ids) values('job-existing','${owner}',null,'completed',null,null,null)`);
 check('never rebinds existing legacy work',()=>assert.equal(result(admit('job-existing')).reason,'conflict'));
 for(const [name,change,restore,reason] of [
  ['paused pool',`enabled=false`,`enabled=true`,'paused'],['uncertain pool',`halted=true`,`halted=false`,'paused'],['spent pool',`committed_microusd=5000000`,`committed_microusd=0`,'budget'],['calls exhausted',`calls=30`,`calls=0`,'budget'],['expired pool',`expires_at=now()-interval '1 minute'`,`expires_at=now()+interval '1 hour'`,'paused']
 ]){query(`update public.learnable_ai_budgets set ${change} where id='${pool}'`);check(name+' blocks admission and readiness',()=>{assert.equal(result(inspect()).reason,reason);assert.equal(result(admit('job-'+name.replaceAll(' ','-'))).ok,false);});query(`update public.learnable_ai_budgets set ${restore} where id='${pool}'`);}
 query("update public.learnable_ai_pilots set expires_at=now()-interval '1 minute'");check('expired enrollment cannot silently renew',()=>assert.equal(result(admit('job-expired')).reason,'expired'));
 query('update public.learnable_ai_pilots set enabled=false');check('closed enrollment stays closed',()=>assert.equal(result(inspect()).reason,'not_enrolled'));
 console.log(JSON.stringify({passed:true,checks,database:'disposable local PostgreSQL',providerCalls:0,hostedChanges:0}));
}finally{execFileSync('docker',command('postgres',`drop database ${db}`),{stdio:'pipe'});}
