import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {syntheticImageResponse} from './fixtures/generated-image.mjs';
const dir='output/staging/2026-09-30-rsi-images';
const release=JSON.parse(readFileSync(join(dir,'release.json')));
const owner='11111111-1111-4111-8111-111111111111',op='22222222-2222-4222-8222-222222222222';
const env={LEARNABLE_GPT_IMAGES:'1',LEARNABLE_STAGING_IMAGE_SPEND:'1',SUPABASE_URL:'https://dmnwkrybgggbpqpetuub.supabase.co'};
let checks=0;
for(const group of ['courses','images','providers']){
  const path=join(release.artifact,'.vercel/output/functions/_functions',group+'.func/api/_lib');
  const {generateCreatorImage}=await import(join(path,'openai-image.mjs'));
  const {imageAccountedMicrousd}=await import(join(path,'staging-image-spend.mjs'));
  let calls,events,mode,body;
  const client={async rpc(name,args){events.push(name);if(name.startsWith('reserve')){
    assert.equal(args.p_owner_id,owner);assert.equal(args.p_operation_id,op);assert.equal(args.p_course_id,'synthetic-rsi');assert.equal(args.p_fingerprint,'a'.repeat(64));
    if(mode==='reserve-lost')throw Error('synthetic');
    return {data:mode==='denied'?{ok:false}:{ok:true,reserved_microusd:3000000}};
  }if(name.startsWith('settle')){if(mode==='settle-lost')throw Error('synthetic');assert.equal(args.p_accounted_microusd,996);}return{data:{ok:true}};}};
  const args={client,ownerId:owner,courseId:'synthetic-rsi',operationId:op,requestHash:'a'.repeat(64),funding:'creator',prompt:'A synthetic test diagram.',alt:'Synthetic test.'};
  const deps={env,readKey:async()=> 'sk-proj-synthetic-not-a-real-key-123456789',fetcher:async(url,options)=>{
    calls++;events.push('dispatch');body=JSON.parse(options.body);assert.equal(url,'https://api.openai.com/v1/images/generations');
    if(mode==='transport')throw Error('lost response');
    const data=syntheticImageResponse();
    if(mode==='missing-usage')delete data.usage;
    if(mode==='unknown-usage')data.usage.extra_billable_tokens=10;
    if(mode==='overspend')data.usage={input_tokens:1,output_tokens:200000,total_tokens:200001};
    if(mode==='bad-asset')data.data=[];
    return new Response(JSON.stringify(data),{headers:{'x-request-id':'req_synthetic_123'}});
  }};
  const reset=m=>{calls=0;events=[];mode=m;};
  for(const override of [{LEARNABLE_STAGING_IMAGE_SPEND:'0'},{SUPABASE_URL:'https://production.invalid'}]){
    reset('ok');await assert.rejects(generateCreatorImage(args,{...deps,env:{...env,...override}}));assert.equal(calls,0);assert.equal(events.length,0);checks++;
  }
  for(const changes of [{courseId:undefined},{operationId:undefined},{requestHash:'bad'}]){
    reset('ok');await assert.rejects(generateCreatorImage({...args,...changes},deps));assert.equal(calls,0);checks++;
  }
  for(const m of ['denied','reserve-lost']){reset(m);await assert.rejects(generateCreatorImage(args,deps),e=>!e.mayHaveCharged);assert.equal(calls,0);checks++;}
  reset('ok');const result=await generateCreatorImage(args,deps);assert.equal(result.asset.width,1024);assert.equal(calls,1);assert.deepEqual(events,['reserve_learnable_staging_image_spend','dispatch','settle_learnable_staging_image_spend']);checks++;
  assert.deepEqual(Object.keys(body).sort(),['background','model','moderation','n','output_format','prompt','quality','size']);assert.equal(body.n,1);assert.equal(body.quality,'medium');checks++;
  for(const m of ['transport','missing-usage','unknown-usage','overspend','settle-lost','bad-asset']){
    reset(m);await assert.rejects(generateCreatorImage(args,deps),e=>e.mayHaveCharged&&e.automaticRetry===false);assert.equal(calls,1);assert.equal(events.at(-1),'halt_learnable_staging_image_spend');checks++;
  }
  assert.equal(imageAccountedMicrousd(syntheticImageResponse().usage),996);checks++;
  for(const u of [null,{input_tokens:1,output_tokens:0,total_tokens:1},{input_tokens:-1,output_tokens:2,total_tokens:1},{input_tokens:1,output_tokens:2,total_tokens:9},{...syntheticImageResponse().usage,input_tokens_details:{text_tokens:12,image_tokens:0,cached_tokens:1}}]){
    assert.throws(()=>imageAccountedMicrousd(u));checks++;
  }
  const future=Date.now;try{Date.now=()=>Date.parse('2026-10-08T00:00:00Z');reset('ok');await assert.rejects(generateCreatorImage(args,deps));assert.equal(calls,0);checks++;}finally{Date.now=future;}
}
const runner=readFileSync(join(release.artifact,'.vercel/output/functions/_functions/images.func/api/_lib/image-request.mjs'),'utf8');
assert.match(runner,/courseId: args.courseId, operationId: args.operationId, requestHash: row.payload.requestHash/);checks++;
const receipt={at:new Date().toISOString(),checks,status:'passed',scope:'three actual packaged primitives, synthetic provider and ledger',paidCalls:0};
writeFileSync(join(dir,'runtime-tests.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
