import assert from 'node:assert/strict';
import { test } from 'node:test';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';
const policy = await import(pathToFileURL(resolve(process.env.MANUAL_POLICY_FILE || 'scripts/staging-manual-testing/policy.mjs')));
const { manualOwnerEnabled, useManualTesting, createManualAwareTextClient, beginManualAwareImageSpend } = policy;
const ownerId='62b1631e-a5aa-49b7-b05f-ebd5e4d3706f', runId='00000000-0000-4000-8000-000000000001';
const env={LEARNABLE_MANUAL_TESTING:'1',LEARNABLE_MANUAL_TESTING_OWNER_ID:ownerId,LEARNABLE_SETUP_GENERATION:'1',LEARNABLE_STAGING_IMAGE_SPEND:'1',
  SUPABASE_URL:'https://dmnwkrybgggbpqpetuub.supabase.co',LEARNABLE_GENERATION_ORIGIN:'https://learnable-staging.vercel.app'};
const client=(manual=true)=>({rpc:async(name,args)=>{assert.equal(name,'learnable_staging_manual_test_scope');assert.equal(args.p_owner_id,ownerId);return{data:{manual}};}});
const args=()=>({apiKey:'dummy',ownerId,runId,jobId:'job-setup-'+ 'a'.repeat(48),supabase:client(),env});
test('manual mode requires exact staging binding, owner and explicit enablement',()=>{
  assert.equal(manualOwnerEnabled(ownerId,env),true);
  for(const changes of [{LEARNABLE_MANUAL_TESTING:'0'},{LEARNABLE_MANUAL_TESTING_OWNER_ID:runId},{SUPABASE_URL:'https://production.invalid'},
    {LEARNABLE_GENERATION_ORIGIN:'https://elsewhere.invalid'}, {LEARNABLE_MANUAL_TESTING_OWNER_ID:undefined}])assert.equal(manualOwnerEnabled(ownerId,{...env,...changes}),false);
});
test('unknown, unowned and historically budgeted scopes remain guarded',async()=>{
  for(const kind of ['text','images'])assert.equal(await useManualTesting({client:client(false),ownerId,kind,scopeId:'existing',env}),false);
  let called=0;assert.equal(await useManualTesting({client:{rpc(){called++;}},ownerId:runId,kind:'text',scopeId:'x',env}),false);assert.equal(called,0);
});
test('classification failure and malformed reply fail closed',async()=>{
  for(const rpc of [async()=>{throw Error('offline');},async()=>({error:{}}),async()=>({data:{manual:'true'}})]){
    await assert.rejects(useManualTesting({client:{rpc},ownerId,kind:'text',scopeId:'job',env}),/confirm the manual testing scope/);
  }
});
test('manual text has no QA call limit or reservation and retains usage',async()=>{
  let calls=0,before=0,closed=0;
  const result={usage:{input_tokens:12,output_tokens:34},content:[]};
  const c=createManualAwareTextClient({...args(),beforeDispatch:()=>before++,requestBudget:{assertCanStart(){},beginRequest(){return{close(){closed++;},throwIfExpired(){}};}},
    fetcher:async(url,init)=>{assert.equal(url,'https://api.anthropic.com/v1/messages');assert.equal(init.redirect,'error');calls++;return{ok:true,json:async()=>result};}},()=>{throw Error('QA guard should not be used');});
  for(let i=0;i<12;i++)assert.equal(await c.messages.create({model:'standard-app-model',max_tokens:20000,messages:[]}),result);
  assert.equal(calls,12);assert.equal(closed,12);assert.equal(before,24);
});
test('QA-classified text always uses the original budgeted client',async()=>{
  let guarded=0,dispatched=0;const c=createManualAwareTextClient({...args(),supabase:client(false),fetcher:()=>dispatched++},()=>({messages:{create:async()=>{guarded++;throw Error('QA cap reached');}}}));
  await assert.rejects(c.messages.create({}),/QA cap reached/);assert.equal(guarded,1);assert.equal(dispatched,0);
});
test('manual mode disabled delegates unchanged; text generation still requires its switch',()=>{
  const original={};assert.equal(createManualAwareTextClient({...args(),env:{...env,LEARNABLE_MANUAL_TESTING:'0'}},()=>original),original);
  assert.throws(()=>createManualAwareTextClient({...args(),env:{...env,LEARNABLE_SETUP_GENERATION:'0'}},()=>original),/not enabled/);
});
test('stale run and classification failure never dispatch',async()=>{
  for(const changes of [{beforeDispatch:()=>{throw Error('stale');}},{supabase:{rpc:async()=>({error:{}})}}]){
    let calls=0;const c=createManualAwareTextClient({...args(),...changes,fetcher:()=>calls++},()=>({}));
    await assert.rejects(c.messages.create({}));assert.equal(calls,0);
  }
});
test('uncertain manual request stops queued automatic retries',async()=>{
  let calls=0;const c=createManualAwareTextClient({...args(),fetcher:async()=>{calls++;throw Error('lost connection');}},()=>({}));
  await assert.rejects(c.messages.create({}),/uncertain/);await assert.rejects(c.messages.create({}),/uncertain/);assert.equal(calls,1);
});
test('manual provider rejection retains safe HTTP status without retaining its body',async()=>{
  for(const status of [400,401,429,500,529]){
    let calls=0,readBody=0;
    const c=createManualAwareTextClient({...args(),fetcher:async()=>{calls++;return{ok:false,status,text(){readBody++;throw Error('private');}};}},()=>({}));
    await assert.rejects(c.messages.create({}),error=>error.status===status && !error.body && !error.message.includes('private'));
    await assert.rejects(c.messages.create({}));assert.equal(calls,1);assert.equal(readBody,0);
  }
});
test('manual timeout retains the bounded deadline code without leaking raw transport data',async()=>{
  const c=createManualAwareTextClient({...args(),fetcher:async()=>{throw Object.assign(Error('private transport details'),{code:'GENERATION_REQUEST_UNCERTAIN'});}},()=>({}));
  await assert.rejects(c.messages.create({}),error=>error.code==='GENERATION_REQUEST_UNCERTAIN' && !error.message.includes('private'));
});
test('a response-body abort preserves its request deadline reason and stops another dispatch',async()=>{
  const controller=new AbortController();let calls=0;
  const c=createManualAwareTextClient({...args(),requestBudget:{assertCanStart(){},beginRequest(){return{signal:controller.signal,close(){}};}},
    fetcher:async()=>{calls++;return{ok:true,json:async()=>{
      controller.abort(Object.assign(Error('private deadline details'),{code:'GENERATION_REQUEST_UNCERTAIN'}));
      throw new DOMException('private response body','AbortError');
    }};}},()=>({}));
  await assert.rejects(c.messages.create({}),error=>error.code==='GENERATION_REQUEST_UNCERTAIN'&&!error.message.includes('private'));
  await assert.rejects(c.messages.create({}));assert.equal(calls,1);
});
test('manual requests retain serial dispatch',async()=>{
  let active=0,peak=0;const c=createManualAwareTextClient({...args(),fetcher:async()=>{peak=Math.max(peak,++active);await Promise.resolve();active--;return{ok:true,json:async()=>({})};}},()=>({}));
  await Promise.all(Array.from({length:9},()=>c.messages.create({})));assert.equal(peak,1);
});
test('manual images have no three-call grant limit',async()=>{
  let guards=0;for(let i=0;i<5;i++){
    const spend=await beginManualAwareImageSpend({client:client(),ownerId,courseId:'manual-course',env,operationId:runId,requestHash:'a'.repeat(64),policy:{funding:'creator'}},()=>guards++);
    await spend.settle({input_tokens:1,output_tokens:1,total_tokens:2},'request');await spend.halt();
  }assert.equal(guards,0);
});
test('manual images retain the kill switch and receipt identity checks',async()=>{
  let guards=0;await beginManualAwareImageSpend({env:{...env,LEARNABLE_STAGING_IMAGE_SPEND:'0'}},()=>guards++);assert.equal(guards,1);
  await assert.rejects(beginManualAwareImageSpend({client:client(),ownerId,courseId:'manual-course',env},()=>guards++),/confirm this course image request/);assert.equal(guards,1);
});
test('QA images retain original guard; classification errors never fall through',async()=>{
  let guarded=0;const original={};
  assert.equal(await beginManualAwareImageSpend({client:client(false),ownerId,courseId:'qa-course',env},()=>{guarded++;return original;}),original);
  await assert.rejects(beginManualAwareImageSpend({client:{rpc:async()=>({error:{}})},ownerId,courseId:'qa-course',env},()=>guarded++));assert.equal(guarded,1);
});
