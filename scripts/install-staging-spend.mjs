// Explicit staging safeguard approval only. Installs no allowance and never
// enables generation. Deliberately separate from production/base migrations.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {digest,readJSON} from './packaging/grounding-release.mjs';
import {verifySpendArtifact} from './packaging/staging-spend-release.mjs';
const root=resolve(new URL('..',import.meta.url).pathname),kit=resolve(process.argv[2]||'missing');
assert.ok(kit.startsWith(root+'/output/linux-staging/build-spend-'));
const release=readJSON(join(kit,'linux-release-receipt.json'));
assert.equal(release.status,'linux-verified-not-deployed');assert.equal(release.stagingSpendChecks.disabledPaidPaths,4);
verifySpendArtifact(kit,join(kit,release.artifact));
const ref='dmnwkrybgggbpqpetuub',cli='/Users/davidwang/.npm/_npx/6f1b058a4d9555af/node_modules/supabase/dist/supabase.js';
function command(args){try{return JSON.parse(execFileSync(process.execPath,[cli,...args,'--output-format','json'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000,maxBuffer:8*1024*1024}));}catch{throw Error('Isolated staging database operation did not confirm. Reconcile before retrying.');}}
const project=command(['projects','list']).projects.find(p=>p.id===ref);
assert.equal(project?.name,'Learnable Staging');assert.equal(project.organization_id,'zdghcycryytrnxopmfpv');
const query=sql=>command(['db','query','--linked','--project-ref',ref,sql]);
const sql=readFileSync(join(kit,'scripts/staging-safeguard/migration.sql'),'utf8'),sha=digest(sql);
assert.equal(release.stagingSpendOverlay.sourceHashes['scripts/staging-safeguard/migration.sql'],sha);
const before=query("select to_regclass('learnable_staging.applied_safeguards') as ledger, to_regclass('public.learnable_staging_spend_budgets') as budgets, to_regclass('public.learnable_staging_spend_requests') as requests").rows[0];
if(before.ledger){
  const rows=query('select name,sha256 from learnable_staging.applied_safeguards').rows;
  assert.deepEqual(rows,[{name:'staging-spend-20260922',sha256:sha}],'Unknown guard migration; inspect rather than overwriting');
}else{
  assert.equal(before.budgets,null);assert.equal(before.requests,null);
  query(`begin;\n${sql}\ncreate table learnable_staging.applied_safeguards(name text primary key,sha256 text not null,applied_at timestamptz not null default now());\nrevoke all on learnable_staging.applied_safeguards from public,anon,authenticated,service_role;\ninsert into learnable_staging.applied_safeguards(name,sha256) values('staging-spend-20260922','${sha}');\ncommit;`);
}
query("notify pgrst, 'reload schema';");
const counts=query("select (select count(*) from learnable_staging.applied_migrations) as base_migrations, (select count(*) from public.learnable_staging_spend_budgets) as budgets, (select count(*) from public.learnable_staging_spend_requests) as requests, (select count(*) from auth.users) as users, (select count(*) from public.generation_jobs) as jobs, (select count(*) from public.provider_connections) as connections").rows[0];
assert.equal(Number(counts.base_migrations),21);for(const [k,v]of Object.entries(counts))if(k!=='base_migrations')assert.equal(Number(v),0,k);
const privileges=query("select c.relname,c.relrowsecurity,has_table_privilege('anon',c.oid,'select,insert,update,delete') as anon_access,has_table_privilege('authenticated',c.oid,'select,insert,update,delete') as user_access,has_table_privilege('service_role',c.oid,'select,insert,update,delete') as runtime_access from pg_class c where c.oid in ('public.learnable_staging_spend_budgets'::regclass,'public.learnable_staging_spend_requests'::regclass) order by c.relname").rows;
assert.equal(privileges.length,2);for(const p of privileges)assert.ok(p.relrowsecurity&&!p.anon_access&&!p.user_access&&!p.runtime_access);
const rpcPrivileges=query("select proname,prosecdef,proconfig,has_function_privilege('anon',oid,'execute') as anon_execute,has_function_privilege('authenticated',oid,'execute') as user_execute,has_function_privilege('service_role',oid,'execute') as runtime_execute from pg_proc where pronamespace='public'::regnamespace and proname in ('reserve_learnable_staging_spend','settle_learnable_staging_spend','halt_learnable_staging_spend') order by proname").rows;
assert.equal(rpcPrivileges.length,3);for(const p of rpcPrivileges)assert.ok(p.prosecdef&&!p.anon_execute&&!p.user_execute&&p.runtime_execute&&p.proconfig.includes('search_path=pg_catalog, public'));
const secrets=readJSON(join(root,'output/staging/2026-09-18/secrets.json'));
const args={p_owner_id:'11111111-1111-4111-8111-111111111111',p_job_id:'job-33333333-3333-4333-8333-333333333333',p_run_id:'22222222-2222-4222-8222-222222222222',p_request_id:'44444444-4444-4444-8444-444444444444',p_profile:'sonnet45-search20250305-20260922',p_reserved_microusd:1,p_fingerprint:'a'.repeat(64)};
const response=await fetch(`https://${ref}.supabase.co/rest/v1/rpc/reserve_learnable_staging_spend`,{method:'POST',headers:{apikey:secrets.secretKey,'Content-Type':'application/json'},body:JSON.stringify(args),signal:AbortSignal.timeout(20000)});
assert.equal(response.status,200);assert.deepEqual(await response.json(),{ok:false,reason:'approval'});
const after=query('select (select count(*) from public.learnable_staging_spend_budgets) as budgets,(select count(*) from public.learnable_staging_spend_requests) as requests').rows[0];assert.ok(Object.values(after).every(v=>Number(v)===0));
const receipt={at:new Date().toISOString(),status:'installed-no-allowance',stagingRef:ref,migrationSha256:sha,counts,privileges,rpcPrivileges,hostedServiceRpc:'denied-no-approval',paidCalls:0,production:'unchanged'};
const dir=join(root,'output/diagnostics/m3-staging-safeguard-20260922');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'database-install.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:receipt.status,stagingRef:ref,counts,hostedServiceRpc:receipt.hostedServiceRpc,paidCalls:0}));
