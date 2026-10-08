// Actual staged resume/sweep with COMPLETE synthetic checkpoints. No provider
// credentials or generated responses. A locally invoked copy of the exact hosted
// runner must first complete with every non-staging request blocked.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';
import { sealProviderKey } from '../web/api/_lib/provider-vault.mjs';

const deployment=process.argv[2],kit=resolve(process.argv[3]||'missing');
assert.match(deployment||'',/^dpl_[A-Za-z0-9]+$/);
assert.ok(kit.startsWith(resolve('output/linux-staging/build-')));
const release=JSON.parse(readFileSync(join(kit,'linux-release-receipt.json')));
assert.equal(release.stagingRef,'dmnwkrybgggbpqpetuub');assert.equal(release.checks,227);
const artifact=join(kit,release.artifact),packaging=JSON.parse(readFileSync(join(artifact,'packaging-report.json')));
const bundle=join(artifact,'.vercel/output/functions/_functions/generation.func');
for(const [path,hash]of Object.entries(packaging.groups.find(g=>g.id==='generation').files))
  assert.equal(createHash('sha256').update(readFileSync(join(bundle,path))).digest('hex'),hash);
const deployed=JSON.parse(execFileSync('vercel',['api',`/v13/deployments/${deployment}?teamId=team_ONTVy4HempTg7uINmG0C8P3N`],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(deployed.projectId,'prj_nphig6i4hA9E8o9Wg3nhzxyP1krB');assert.equal(deployed.readyState,'READY');assert.ok(deployed.alias.includes('learnable-staging.vercel.app'));
const directory=new URL('../output/staging/2026-09-18/',import.meta.url);
const state=JSON.parse(readFileSync(new URL('state.json',directory))),secret=JSON.parse(readFileSync(new URL('secrets.json',directory)));
assert.equal(state.ref,'dmnwkrybgggbpqpetuub');assert.equal(state.supabaseUrl,'https://dmnwkrybgggbpqpetuub.supabase.co');
const base='https://learnable-staging.vercel.app',nativeFetch=globalThis.fetch;
const checks=[],accounts=[],jobs=[],observations=[];let failure,externalAttempts=0,cleanedUp=false;
function check(ok,label){assert.ok(ok,label);checks.push(label);console.log('Passed: '+label);}
globalThis.fetch=(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url||input.href);
  if(![state.supabaseUrl,base].includes(url.origin)){externalAttempts++;throw Error('Non-staging network request blocked.');}
  return nativeFetch(input,{...init,redirect:'error',signal:AbortSignal.timeout(30000)});
};
const opts={auth:{persistSession:false,autoRefreshToken:false},global:{fetch:globalThis.fetch}};
const admin=createClient(state.supabaseUrl,secret.secretKey,opts);
Object.assign(process.env,{SUPABASE_URL:state.supabaseUrl,SUPABASE_ANON_KEY:secret.publicKey,SUPABASE_SECRET_KEY:secret.secretKey,LEARNABLE_PROVIDER_VAULT_KEY:secret.vaultKey});
const {runGeneration}=await import(pathToFileURL(join(bundle,'api/_lib/gen-runner.mjs')));
const {checkpointForJob}=await import(pathToFileURL(join(bundle,'api/_lib/gen-recovery.mjs')));
const schemaPaths=Object.keys(packaging.groups.find(g=>g.id==='generation').files).filter(p=>/^js[^/]*\/generator\/schema\.mjs$/.test(p));
assert.equal(schemaPaths.length,1);
const {compatibleTopicCheckpoint}=await import(pathToFileURL(join(bundle,schemaPaths[0])));
const components=['lessons','practice','checklists','quizzes','flashcards'];
const fakeKey='non-billable-complete-checkpoint-only';
async function load(job){const r=await admin.from('generation_jobs').select('*').eq('id',job.id).eq('owner_id',job.owner_id).single();assert.ok(!r.error,'Read own fixture job');return r.data;}
async function seed(owner,status='timed_out'){
  const id='background-qa-'+randomUUID(),runId=randomUUID(),brief={...curriculumFixture(),components,id:'background-'+randomUUID()};
  const topics=Object.fromEntries(brief.modules[0].topics.map(t=>['foundations/'+t.id,lessonFixture(components,t)]));
  assert.equal(Object.keys(compatibleTopicCheckpoint(brief,topics)).length,3,'All synthetic lessons must be reusable, or abort before hosted dispatch.');
  const job={id,owner_id:owner,status,stage:'assemble',run_id:runId,brief,topics_by_key:topics,failures:[],
    research:{foundations:{module_id:'foundations',key_concepts:['Light'],examples:[],experts:[],misconceptions:[],sources:[],images:[]}},
    user_brief:{topic:'Disposable hosted background QA',audience:'QA fixture only',components,source_urls:[],pdfRefs:[],tone:'conversational'},
    topics_done:3,topics_total:3,recovery_attempts:0,lease_expires_at:new Date(Date.now()-60000).toISOString(),
    completed_at:status==='timed_out'?new Date().toISOString():null};
  const insert=await admin.from('generation_jobs').insert(job);
  assert.ok(!insert.error,`Insert complete private checkpoint: ${insert.error?.code||''} ${insert.error?.message||''}`);jobs.push(job);return job;
}
async function request(path,token,body){
  const response=await fetch(base+path,{method:body?'POST':'GET',headers:{Authorization:'Bearer '+token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {status:response.status,data:await response.json()};
}
async function completed(job,label){
  const start=Date.now(),states=[];let row;
  while(Date.now()-start<45000){row=await load(job);states.push({afterMs:Date.now()-start,status:row.status,stage:row.stage});if(row.status==='completed'||row.status==='failed')break;await new Promise(r=>setTimeout(r,250));}
  observations.push({label,states});
  check(row.status==='completed'&&row.saved_course_id,label+': background completion persisted after HTTP response');
  check(states.some(s=>s.status==='running'),label+': running state observed after HTTP response');
  check(row.run_id!==job.run_id,label+': new lease owns the result');
  assert.deepEqual(row.topics_by_key,job.topics_by_key);check(!row.failures.length,label+': accepted lessons unchanged');
  const course=await admin.from('user_courses').select('payload').eq('owner_id',job.owner_id).eq('id',row.saved_course_id).single();assert.ok(!course.error);
  check(course.data.payload._generationJobId===job.id&&Object.keys(course.data.payload.modules[1]).length===3,label+': all three rich lessons saved to own account');
  return row;
}
try {
  const users=await admin.auth.admin.listUsers();assert.ok(!users.error&&users.data.users.length===0,'Requires empty isolated staging');
  const existing=await admin.from('generation_jobs').select('id');assert.ok(!existing.error&&existing.data.length===0,'Requires no existing jobs');
  for(let i=0;i<2;i++){
    const email='background-'+randomUUID()+'@example.test',password=randomUUID()+'Aa9!';
    const made=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ok(!made.error);const account={owner:made.data.user.id};accounts.push(account);
    account.client=createClient(state.supabaseUrl,secret.publicKey,opts);const login=await account.client.auth.signInWithPassword({email,password});assert.ok(!login.error);account.token=login.data.session.access_token;
  }
  const [a,b]=accounts;
  const key=await admin.from('provider_connections').insert({owner_id:a.owner,provider:'anthropic',encrypted_key:sealProviderKey(fakeKey,a.owner)});assert.ok(!key.error);
  const proof=await seed(a.owner,'running');
  await runGeneration({supabase:admin,jobId:proof.id,ownerId:a.owner,runId:proof.run_id,apiKey:fakeKey,userBrief:proof.user_brief,checkpoint:checkpointForJob(proof),pdfRefs:[],mode:'complete'});
  check((await load(proof)).status==='completed'&&externalAttempts===0,'exact packaged runner completes checkpoint with external network blocked and zero provider attempts');
  const resume=await seed(a.owner),expected={status:resume.status,runId:resume.run_id};
  check((await request('/api/gen/resume',b.token,{jobId:resume.id,expected})).status===404,'other account cannot resume fixture');
  const response=await request('/api/gen/resume',a.token,{jobId:resume.id,expected});check(response.status===200&&response.data.resumed,'actual hosted resume accepts complete checkpoint');
  await completed(resume,'resume');
  check((await request('/api/gen/resume',a.token,{jobId:resume.id,expected})).status===409,'stale resume is rejected without new work');
  const recovered=await seed(a.owner,'running');
  const review=await seed(a.owner,'review_research');
  const cancel=await seed(a.owner,'running');
  const stopped=await request('/api/gen/cancel',a.token,{jobId:cancel.id,expected:{status:'running',runId:cancel.run_id}});
  check(stopped.status===200&&stopped.data.status==='cancelling','active cancellation enters cancelling');
  assert.ok(!(await admin.from('generation_jobs').update({lease_expires_at:new Date(Date.now()-60000).toISOString()}).eq('id',cancel.id).eq('owner_id',a.owner)).error);
  const all=await admin.from('generation_jobs').select('id');assert.ok(!all.error&&all.data.every(r=>jobs.some(j=>j.id===r.id)),'Refuse sweeping non-fixture jobs');
  const sweep=await request('/api/gen/sweep',secret.cronSecret);
  check(sweep.status===200&&sweep.data.timedOut.includes(recovered.id)&&sweep.data.claimed.length===1&&sweep.data.claimed[0]===recovered.id,'actual sweep expires and claims only eligible complete checkpoint');
  check(sweep.data.cancelled.includes(cancel.id)&&(await load(cancel)).status==='cancelled','sweep finalizes expired cancellation without generating');
  check((await load(review)).status==='review_research','sweep leaves human review paused');
  await completed(recovered,'sweep');
  const cancelledReview=await request('/api/gen/cancel',a.token,{jobId:review.id,expected:{status:review.status,runId:review.run_id}});
  check(cancelledReview.status===200&&cancelledReview.data.status==='cancelled','paused review cancellation is terminal immediately');
  check(!(await load(cancel)).saved_course_id&&!(await load(review)).saved_course_id,'cancelled fixtures never save a course');
  const denied=await b.client.from('user_courses').select('id').eq('owner_id',a.owner);check(!denied.error&&denied.data.length===0,'saved background courses remain private to owner');
  check(externalAttempts===0,'test controller and locally invoked packaged runner made no external attempts');
}catch(error){failure=error.message;console.error('Background check failed: '+failure);}
finally {
  for(const job of jobs)assert.ok(!(await admin.from('generation_jobs').delete().eq('id',job.id).eq('owner_id',job.owner_id)).error);
  for(const account of accounts)assert.ok(!(await admin.auth.admin.deleteUser(account.owner)).error);
  cleanedUp=true;globalThis.fetch=nativeFetch;
}
const report={at:new Date().toISOString(),deployment,artifact,stagingRef:state.ref,checks,observations,passed:!failure,failure,cleanedUp,externalAttempts,
  limitations:['Synthetic complete checkpoints, not real-provider generation or output quality.','Local runner network is blocked; hosted provider non-dispatch follows identical complete checkpoints and a non-provider credential.','Manual sweep verifies handler behavior, not a scheduled cron firing.','Expired cancellation and paused review tested; not cancellation during a real provider call.']};
const file=new URL(`background-qa-${Date.now()}.json`,directory);writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({passed:!failure,checks:checks.length,cleanedUp,report:file.pathname}));if(failure)process.exitCode=1;
