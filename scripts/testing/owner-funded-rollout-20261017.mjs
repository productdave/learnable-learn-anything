// Explicit Oct 17 owner authorization. Staging-only, no provider dispatch/top-up.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {randomUUID} from 'node:crypto';
import {inspect,vercel,db} from '/Users/davidwang/Learnable/scripts/testing/admin-observability-staging.mjs';
import {baseInventory,digest,tree} from '../packaging/grounding-release.mjs';
import {createOpenRouterPolicy,OPENROUTER_OWNER_POLICY_VERSION} from '../../web/api/_lib/openrouter-policy.mjs';
const root=resolve(import.meta.dirname,'../..'),dir=join(root,'output/staging/2026-10-17-owner-funded');
const read=n=>JSON.parse(readFileSync(join(dir,n+'.json'))),save=(n,v)=>writeFileSync(join(dir,n+'.json'),JSON.stringify(v,null,2)+'\n',{flag:'wx',mode:0o600});
const project='prj_nphig6i4hA9E8o9Wg3nhzxyP1krB',owner='62b1631e-a5aa-49b7-b05f-ebd5e4d3706f',priorPilot='5490a768-5b4d-480a-bf34-544c0f1902a2',site='https://learnable-staging.vercel.app';
const migration='db/29-owner-funded-generation.sql',sqlBytes=readFileSync(join(root,migration),'utf8');
const p=read('prepared'),reportBytes=readFileSync(join(p.artifact,'packaging-report.json')),report=JSON.parse(reportBytes),out=join(p.artifact,'.vercel/output'),inventory=baseInventory(report);
const quote=s=>"'"+String(s).replaceAll("'","''")+"'";
function verifyPackage(){assert.equal(digest(reportBytes),p.reportSha256);assert.equal(p.actualPackageTests,143);assert.equal(p.functions,8);assert.equal(JSON.parse(readFileSync(join(p.artifact,'.vercel/project.json'))).projectId,project);assert.deepEqual(tree(out),Object.keys(inventory).sort());for(const[path,h]of Object.entries(inventory))assert.equal(digest(readFileSync(join(out,path))),h,path);}
function spend(){const rows=db('select id,state,actual_microusd from learnable_ai_requests order by id');assert(rows.every(r=>r.state==='settled'));return {requests:rows.length,actualMicrousd:rows.reduce((n,r)=>n+Number(r.actual_microusd),0),hash:digest(JSON.stringify(rows))};}
function access(){return db(`select jsonb_build_object('tables',(select jsonb_agg(jsonb_build_object('name',c.relname,'rls',c.relrowsecurity,'acl',c.relacl::text) order by c.relname) from pg_class c where c.relnamespace='public'::regnamespace and c.relkind in ('r','p')),'policies',(select jsonb_agg(to_jsonb(p) order by p.tablename,p.policyname) from pg_policies p where p.schemaname='public'),'functions',(select jsonb_agg(jsonb_build_object('name',p.proname,'oid',p.oid,'acl',p.proacl::text,'hash',md5(pg_get_functiondef(p.oid))) order by p.oid) from pg_proc p where p.pronamespace='public'::regnamespace and p.prokind='f')) snapshot`)[0].snapshot;}
function unchangedExistingRows(plan){
 return db(`select 'learnable_ai_budgets' name,md5(coalesce(string_agg((to_jsonb(b)-'funding_mode')::text,'|' order by b.id),'')) digest from public.learnable_ai_budgets b where id not in (${quote(plan.poolId)},${quote(plan.ownerBudgetId)}) union all
 select 'learnable_ai_pilots',md5(coalesce(string_agg((to_jsonb(b)-'funding_mode'-'enabled')::text,'|' order by b.id),'')) from public.learnable_ai_pilots b where id<>${quote(plan.pilotId)}`);
}
async function main(){
 verifyPackage();const action=process.argv[2];
 if(action==='prepare'){
  const before=inspect();assert.equal(before.alias,p.sourceDeployment);assert(!before.migrations.some(m=>m.name===migration));
  const existing=db('select id,owner_id,enabled,expires_at from learnable_ai_pilots');assert.equal(existing.length,1);assert.equal(existing[0].id,priorPilot);assert.equal(existing[0].owner_id,owner);assert(Date.parse(existing[0].expires_at)<Date.now());
  assert.equal(db(`select count(*) n from course_setups where id='setup-57e57424-d47b-4841-98b3-85e12a2c19a7' and owner_id='${owner}' and not deleted`)[0].n,1);
  const catalog=read('catalog');assert(Date.now()-Date.parse(catalog.at)<86400000);assert.equal(catalog.records.length,3);
  const expected=[['Anthropic','anthropic',0.000002,0.00001],['Parasail','parasail/fp8',0.0000003,0.0000012],['Black Forest Labs','black-forest-labs',0,0]];
  for(let i=0;i<3;i++){const e=catalog.records[i].endpoints.find(e=>e.tag===expected[i][1]);assert(e);assert.equal(e.provider_name,expected[i][0]);assert.equal(Number(e.pricing.prompt),expected[i][2]);assert.equal(Number(e.pricing.completion),expected[i][3]);}
  const now=Date.now(),policy=createOpenRouterPolicy({version:OPENROUTER_OWNER_POLICY_VERSION,reviewedAt:new Date(now).toISOString(),now});
  const plan={at:new Date(now).toISOString(),owner,project,pilotId:randomUUID(),poolId:randomUUID(),ownerBudgetId:randomUUID(),policy,capMicrousd:null,maxCalls:null,expiresAt:null,mode:'owner_funded',authorization:'David explicitly requested removal of the testing-allowance requirement for his staging course creation, including permission to exceed that allowance on 17 October 2026.',migrationHash:digest(sqlBytes)};
  save('before',before);save('access-before',access());save('spend-before',spend());save('plan',plan);save('existing-funding-before',unchangedExistingRows(plan));console.log(JSON.stringify({prepared:true,ownerOnly:true,expiry:null,testCap:null,providerCalls:0}));return;
 }
 if(action==='deploy'){
  assert(!existsSync(join(dir,'deployment-intent.json')),'Reconcile previous deployment before retry');const before=inspect();for(const k of ['alias','productionAlias','environmentHash','accessHash','data'])assert.deepEqual(before[k],read('before')[k],k);
  const flags=[...JSON.parse(readFileSync(join(root,'output/staging/2026-10-13-openrouter-image-repair/prepared.json'))).flags,'LEARNABLE_OWNER_FUNDED_ENABLED=1'];
  save('deployment-intent',{at:new Date().toISOString(),project,artifact:p.artifact,reportSha256:p.reportSha256,rollback:before.alias,flags,authorization:read('plan').authorization});
  let result;try{result=JSON.parse(execFileSync('/Users/davidwang/.npm-global/bin/vercel',['deploy','--prebuilt','--prod','--yes','--no-wait','--format','json','--project',project,'--scope','david-davidwangcos-projects','--cwd',p.artifact,'--meta','learnableOwnerFunded='+p.reportSha256,...flags.flatMap(f=>['--env',f])],{encoding:'utf8',timeout:180000,maxBuffer:5e6,stdio:['ignore','pipe','pipe']}));}catch(e){save('deploy-error',{at:new Date().toISOString(),code:e.code,status:e.status,signal:e.signal});writeFileSync(join(dir,'deploy-private.log'),String(e.stdout||'')+'\n'+String(e.stderr||''),{mode:0o600,flag:'wx'});throw Error('Deploy unconfirmed; reconcile intent and inventory before retry.');}
  const d=result.deployment||result,receipt={at:new Date().toISOString(),id:d.id||d.deploymentId,url:d.url};assert.match(receipt.id,/^dpl_/);save('deployment',receipt);console.log(JSON.stringify(receipt));return;
 }
 const d=vercel('/v13/deployments/'+read('deployment').id);assert.equal(d.projectId,project);assert.equal(d.meta.learnableOwnerFunded,p.reportSha256);
 if(d.readyState!=='READY'){console.log(JSON.stringify({id:d.id,state:d.readyState}));return;}
 if(action==='activate'){
  assert(!existsSync(join(dir,'migration-intent.json')),'Reconcile previous migration before retry');const before=inspect();assert.equal(before.alias,d.id);
  for(const k of ['productionAlias','environmentHash','accessHash','data'])assert.deepEqual(before[k],read('before')[k],k);
  const plan=read('plan');assert.equal(plan.migrationHash,digest(sqlBytes));assert.equal(plan.owner,owner);
  const sql=`begin;set local lock_timeout='5s';set local statement_timeout='40s';
 lock table public.generation_jobs,public.learnable_ai_pilots,public.learnable_ai_budgets,public.learnable_ai_requests,public.learnable_ai_admissions in exclusive mode;
 do $guard$ begin
 if exists(select 1 from public.generation_jobs where status in ('running','queued','cancelling')) then raise exception 'Active job';end if;
 if (select count(*) from public.learnable_ai_pilots)<>1 or not exists(select 1 from public.learnable_ai_pilots where id='${priorPilot}' and owner_id='${owner}' and expires_at<clock_timestamp()) then raise exception 'Enrollment changed';end if;
 if exists(select 1 from public.learnable_ai_requests where state<>'settled') then raise exception 'Uncertain charge';end if;
 end $guard$;
 ${sqlBytes}
 update public.learnable_ai_pilots set enabled=false where id='${priorPilot}';
 insert into public.learnable_ai_budgets(id,owner_id,funding_mode,enabled) values(${quote(plan.poolId)},null,'owner_funded',true),(${quote(plan.ownerBudgetId)},'${owner}','owner_funded',true);
 insert into public.learnable_ai_pilots(id,owner_id,policy,pool_budget_id,owner_budget_id,funding_mode,enabled,approval_note)
 values(${quote(plan.pilotId)},'${owner}',${quote(JSON.stringify(plan.policy))}::jsonb,${quote(plan.poolId)},${quote(plan.ownerBudgetId)},'owner_funded',true,${quote(plan.authorization)});
 insert into learnable_staging.applied_migrations(name,sha256) values('${migration}','${plan.migrationHash}');
 notify pgrst,'reload schema';commit;`;
  save('migration-intent',{at:new Date().toISOString(),migration,hash:plan.migrationHash,transactionHash:digest(sql),owner,production:false});db(sql);save('migration-applied',{at:new Date().toISOString(),migration,hash:plan.migrationHash});console.log(JSON.stringify({activated:true,ownerOnly:true,providerCalls:0}));return;
 }
 assert.equal(action,'verify');const before=read('before'),after=inspect();assert.equal(after.alias,d.id);for(const k of ['productionAlias','environmentHash','protection'])assert.deepEqual(after[k],before[k],k);
 const changedTables=['learnable_ai_budgets','learnable_ai_pilots'];for(const row of after.data)if(!changedTables.includes(row.name))assert.deepEqual(row,before.data.find(r=>r.name===row.name),row.name);
 assert.deepEqual(unchangedExistingRows(read('plan')),read('existing-funding-before'));assert.deepEqual(spend(),read('spend-before'));
 const a0=read('access-before'),a1=access();assert.deepEqual(a1.tables,a0.tables);assert.deepEqual(a1.policies,a0.policies);
 const expectedFunctions=['inspect_learnable_ai_pilot','admit_learnable_ai_job','reserve_learnable_ai_spend'];let changedFunctions=[];
 assert.equal(a1.functions.length,a0.functions.length);for(const f of a1.functions){const old=a0.functions.find(x=>x.oid===f.oid);assert(old);assert.equal(f.acl,old.acl);if(f.hash!==old.hash)changedFunctions.push(f.name);}assert.deepEqual(changedFunctions.sort(),expectedFunctions.sort());
 const state=db(`select inspect_learnable_ai_pilot('${owner}') s`)[0].s;assert.equal(state.ok,true);assert.equal(state.fundingMode,'owner_funded');assert.equal(state.remainingMicrousd,null);assert.equal(state.policy.fingerprint,read('plan').policy.fingerprint);
 assert.equal(db('select count(*) n from learnable_ai_pilots where enabled')[0].n,1);assert.equal(db(`select enabled from learnable_ai_pilots where id='${priorPilot}'`)[0].enabled,false);
 const served=[];for(const path of ['index.html',p.namespace+'/setup-create.js',p.namespace+'/private-course-images.js',p.namespace+'/config.js',p.namespace+'/admin-dashboard.js']){const r=await fetch(site+'/'+path,{redirect:'error',signal:AbortSignal.timeout(20000)});assert.equal(r.status,200,path);assert.equal(digest(Buffer.from(await r.arrayBuffer())),report.staticFiles[path],path);served.push(path);}
 const routes=[];for(const[path,method,status]of [['/api/health/cloud','GET',200],['/api/providers/connection','GET',401],['/api/setups/generate','POST',401]]){const r=await fetch(site+path,{method,signal:AbortSignal.timeout(20000)});assert.equal(r.status,status);routes.push({path,method,status});}
 const result={at:new Date().toISOString(),deploymentId:d.id,ready:true,site,ownerOnly:true,allowanceRequirementRemoved:true,cap:null,expiry:null,served,routes,changedFunctions,existingCourseAndRequestDataPreserved:true,oldBudgetsAndReceiptsPreserved:true,expiredEnrollmentRetired:true,accessPreserved:true,productionUnchanged:true,productionWrites:0,providerCalls:0,spend:spend()};save('verified',result);console.log(JSON.stringify(result));
}
main().catch(e=>{console.error(e.message.split('\n')[0]);process.exitCode=1;});
