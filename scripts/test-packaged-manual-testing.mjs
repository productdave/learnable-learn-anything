// Actual packaged wrappers/provider primitives, entirely synthetic network/DB.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { syntheticImageResponse } from './fixtures/generated-image.mjs';
const receipt=JSON.parse(readFileSync('output/staging/2026-10-01-manual-testing/release.json'));
const base=join(receipt.artifact,'.vercel/output/functions/_functions');
const owner='62b1631e-a5aa-49b7-b05f-ebd5e4d3706f',run='00000000-0000-4000-8000-000000000001';
const env={LEARNABLE_MANUAL_TESTING:'1',LEARNABLE_MANUAL_TESTING_OWNER_ID:owner,SUPABASE_URL:'https://dmnwkrybgggbpqpetuub.supabase.co',
  LEARNABLE_GENERATION_ORIGIN:'https://learnable-staging.vercel.app',LEARNABLE_SETUP_GENERATION:'1',LEARNABLE_GPT_IMAGES:'1',LEARNABLE_STAGING_IMAGE_SPEND:'1'};
let checks=0;
for(const group of ['generation','sources']){
  const {createClient,MODEL}=await import(pathToFileURL(join(base,group+'.func/js-workspace-20260918-candidate3/generator/anthropic-fetch.js')));
  let paid=0,manual=true,events=[];
  const supabase={rpc:async(name)=>{events.push(name);return{data:name==='learnable_staging_manual_test_scope'?{manual}:{ok:false,reason:'approval'}};}};
  const result={model:MODEL,usage:{input_tokens:100,output_tokens:20},content:[]};
  const args={apiKey:'synthetic-only',supabase,ownerId:owner,jobId:'job-setup-'+'a'.repeat(48),runId:run,env,
    fetcher:async(url,opts)=>{assert.equal(url,'https://api.anthropic.com/v1/messages');assert.equal(opts.redirect,'error');paid++;return{ok:true,json:async()=>result};}};
  const body={model:MODEL,max_tokens:4096,system:'Synthetic',messages:[{role:'user',content:'Synthetic'}],tools:[{name:'submit_course_brief',input_schema:{type:'object'}}]};
  const c=createClient(args);for(let i=0;i<10;i++)assert.equal(await c.messages.create(body),result);assert.equal(paid,10);assert.ok(events.every(e=>e==='learnable_staging_manual_test_scope'));checks++;
  manual=false;await assert.rejects(createClient(args).messages.create(body),/active approved test budget/);assert.equal(paid,10);assert.equal(events.at(-1),'reserve_learnable_staging_spend');checks++;
  manual=true;await assert.rejects(createClient({...args,ownerId:run}).messages.create(body),/active approved test budget/);assert.equal(paid,10);checks++;
}
for(const group of ['courses','images','providers']){
  const {generateCreatorImage}=await import(pathToFileURL(join(base,group+'.func/api/_lib/openai-image.mjs')));
  let paid=0,manual=true,events=[];
  const client={rpc:async(name)=>{events.push(name);return{data:name==='learnable_staging_manual_test_scope'?{manual}:{ok:false,reason:'approval'}};}};
  const args={client,ownerId:owner,courseId:'manual-course',operationId:run,requestHash:'a'.repeat(64),funding:'creator',prompt:'Synthetic.',alt:'Synthetic.'};
  const deps={env,readKey:async()=>'sk-proj-synthetic-not-a-real-key-123456789',fetcher:async(url,opts)=>{
    assert.equal(url,'https://api.openai.com/v1/images/generations');assert.equal(opts.redirect,'error');paid++;
    return new Response(JSON.stringify(syntheticImageResponse()),{headers:{'x-request-id':'req_synthetic_manual'}});
  }};
  for(let i=0;i<5;i++){const result=await generateCreatorImage(args,deps);assert.equal(result.asset.width,1024);assert.equal(result.provenance.usage.total_tokens,syntheticImageResponse().usage.total_tokens);}
  assert.equal(paid,5);assert.ok(events.every(e=>e==='learnable_staging_manual_test_scope'));checks++;
  manual=false;await assert.rejects(generateCreatorImage(args,deps),e=>e.mayHaveCharged===false);assert.equal(paid,5);assert.equal(events.at(-1),'reserve_learnable_staging_image_spend');checks++;
  manual=true;await assert.rejects(generateCreatorImage({...args,ownerId:run},deps),e=>e.mayHaveCharged===false);assert.equal(paid,5);checks++;
  const date=Date.now;try{Date.now=()=>Date.parse('2026-10-08T00:00:00Z');await generateCreatorImage(args,deps);assert.equal(paid,6);checks++;}finally{Date.now=date;}
}
console.log(JSON.stringify({checks,passed:true,actualServerGroups:5,scope:'synthetic provider and classification RPC',paidCalls:0}));
