// Real local account/database and full runner. ALL external requests are blocked;
// only synthetic Anthropic messages are returned. No paid calls or publication.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig } from './dev-setup-server.mjs';
import { createSetupAccountClient } from '../web/js/setup-account-client.js';
import { setupDraft } from '../web/js/setup-model.js';
import { componentCombinations, curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';

const config=await loadPreviewConfig(new URL('../.env.preview.local',import.meta.url));
assert.equal(config.url,'http://127.0.0.1:54321');assert.equal(config.mode,'local');
Object.assign(process.env,{SUPABASE_URL:config.url,SUPABASE_ANON_KEY:config.publicKey,SUPABASE_SECRET_KEY:config.secretKey,LEARNABLE_PROVIDER_VAULT_KEY:config.vaultKey});
const {createSetupGenerationHandler}=await import('../web/api/setups/generate.js');
const {runGeneration}=await import('../web/api/_lib/gen-runner.mjs');
const {buildReviewTransition}=await import('../web/api/gen/review.js');
const {generationLeaseFields}=await import('../web/api/_lib/gen-state.mjs');
const {sealProviderKey}=await import('../web/api/_lib/provider-vault.mjs');
const admin=createClient(config.url,config.secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
const base='http://127.0.0.1:4173', originalFetch=globalThis.fetch, users=[], jobs=[], pending=[];
let activeComponents=[], messageCalls=0, checks=0;
const check=(value,label)=>{assert.ok(value,label);checks++;};
globalThis.fetch=async(input,options)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(url.origin==='https://api.anthropic.com'&&url.pathname==='/v1/messages') {
    messageCalls++;
    const request=JSON.parse(options.body), name=request.tool_choice?.name || request.tools?.find(tool=>tool.name==='submit_research_bundle')?.name;
    let value;
    if(name==='submit_course_brief') value=curriculumFixture();
    else if(name==='submit_research_bundle') value={module_id:'foundations',key_concepts:['Natural light','Clear composition'],examples:['Window portrait','Single subject'],experts:[],misconceptions:[],sources:[],images:[]};
    else if(name==='submit_topic') {
      const id=request.messages[0].content.match(/Topic id: ([a-z0-9-]+)/)?.[1];
      assert.ok(id);value=lessonFixture(activeComponents,{id,title:`Photography ${id}`});
    } else throw new Error('Unexpected model tool in synthetic run.');
    return new Response(JSON.stringify({content:[{type:'tool_use',name,input:value}],usage:{input_tokens:10,output_tokens:10}}),{headers:{'Content-Type':'application/json'}});
  }
  if(![base,config.url].includes(url.origin)) throw new Error('External network blocked in component integration QA.');
  return originalFetch(input,options);
};
try {
  const email=`component-qa-${randomUUID()}@example.test`, password=`${randomUUID()}Aa9!`;
  const created=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ok(!created.error);const owner=created.data.user.id;users.push(owner);
  const sdk=createClient(config.url,config.publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const signed=await sdk.auth.signInWithPassword({email,password});assert.ok(!signed.error);const token=signed.data.session.access_token;
  const client=createSetupAccountClient({getClient:async()=>sdk,getIdentity:()=>({id:owner}),fetcher:(url,options)=>fetch(base+url,options)});
  const key='sk-ant-synthetic-local-component-QA-only';
  assert.ok(!(await admin.from('provider_connections').insert({owner_id:owner,provider:'anthropic',encrypted_key:sealProviderKey(key,owner)})).error);
  const handler=createSetupGenerationHandler({enabled:()=>true,validate:async()=>{},background:promise=>pending.push(promise)});
  for (const components of componentCombinations) {
    activeComponents=components;
    const draft=setupDraft('Component integration QA');draft.brief.audience='New photographers';draft.components=components;
    const id=`qa-components-${randomUUID()}`, saved=await client.save(owner,id,draft);
    const body={id,revision:saved.revision,action:'check'};
    const checked=await (await fetch(base+'/api/setups/generate',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)})).json();
    check(checked.ready&&!checked.issues.length,`${components}: real API preflight accepts selected combination`);
    const res={code:0,body:null,setHeader(){},status(code){this.code=code;return this;},json(body){this.body=body;return this;}};
    await handler({method:'POST',headers:{authorization:`Bearer ${token}`},body:{...body,action:'start'}},res);assert.equal(res.code,200);jobs.push(res.body.jobId);
    await Promise.all(pending.splice(0));
    const load=async()=>{const r=await admin.from('generation_jobs').select('*').eq('id',res.body.jobId).eq('owner_id',owner).single();assert.ok(!r.error);return r.data;};
    let job=await load();
    check(job.status==='review_curriculum'&&JSON.stringify(job.brief.components)===JSON.stringify(components),'actual runner pauses with canonical component choices in curriculum checkpoint');
    for (const [action,status] of [['approve_curriculum','review_research'],['approve_research','completed']]) {
      const runId=randomUUID(), transition=buildReviewTransition({action,job,runId,lease:generationLeaseFields()});
      const update=await admin.from('generation_jobs').update(transition.patch).eq('id',job.id).eq('owner_id',owner).eq('status',transition.expectedStatus).select('id').single();assert.ok(!update.error);
      await runGeneration({supabase:admin,jobId:job.id,ownerId:owner,runId,apiKey:key,userBrief:job.user_brief,checkpoint:transition.checkpoint,pdfRefs:[],mode:transition.runnerMode});
      job=await load();check(job.status===status,`real review transition reaches ${status}`);
    }
    const course=await sdk.from('user_courses').select('payload').eq('id',job.saved_course_id).single();assert.ok(!course.error);
    const payload=course.data.payload;
    check(JSON.stringify(payload.config.components)===JSON.stringify(components),'durable course config preserves selected tools');
    check(Object.values(payload.modules[1]).every(t=>t.sections.some(s=>s.type==='quiz')===components.includes('quizzes')&&!!t.flashcards.length===components.includes('flashcards')),'persisted topic contents contain exactly the selected tools');
    const before=messageCalls;
    const reopened=await (await fetch(base+'/api/setups/generate',{method:'POST',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:JSON.stringify(body)})).json();
    check(reopened.existing&&reopened.jobId===job.id&&before===messageCalls,'reopening completed request reattaches without model work');
  }
  check(messageCalls===20,'four complete courses use one curriculum, one research and three synthetic lesson calls each');
  console.log(`Local component pipeline: ${checks} checks passed. Real Auth/API/runner/checkpoints/Storage-backed course rows; external network blocked and all 20 model responses synthetic.`);
} finally {
  await Promise.allSettled(pending);
  for(const owner of users) {
    for(const table of ['generation_jobs','user_courses']) {const removed=await admin.from(table).delete().eq('owner_id',owner);assert.ok(!removed.error);}
    const removed=await admin.auth.admin.deleteUser(owner);assert.ok(!removed.error);
  }
  globalThis.fetch=originalFetch;
  console.log('Removed only this run’s disposable local account, setups, jobs and generated test courses. User work unchanged.');
}
