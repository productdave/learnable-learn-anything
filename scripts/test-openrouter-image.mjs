import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenRouterPolicy } from '../web/api/_lib/openrouter-policy.mjs';
import { createOpenRouterImageGenerator, openRouterImagePolicy } from '../web/api/_lib/openrouter-image.mjs';
import { imageFundingQuote } from '../web/api/_lib/image-request.mjs';
import { syntheticPNG } from './fixtures/generated-image.mjs';
const now=Date.now(),policy=createOpenRouterPolicy({version:'openrouter-native-v2',reviewedAt:new Date(now).toISOString(),validUntil:new Date(now+3600000).toISOString(),now});
const request={prompt:'Teach a simple fork in a flowchart.',alt:'An arrow splits at a decision.',operationId:'11111111-1111-4111-8111-111111111111',funding:'platform'};
function fixture({edit=()=>{},editReceipt=()=>{},missingId=false,fetchError=false,settleError=false,beforeDispatch}={}){
 const calls=[],events=[],receipts=[];let holds=0;
 const generate=createOpenRouterImageGenerator({apiKey:'synthetic',policy,now:()=>now,beforeDispatch,
 ledger:{async reserve(r){events.push('reserve');assert.equal(r.reservedMicrousd,56000);return {requestId:'local',reservedMicrousd:r.reservedMicrousd};},async settle(h,r){events.push('settle');if(settleError)throw Error();receipts.push(r);},async hold(){holds++;}},
 fetcher:async(url,req)=>{assert.equal(new URL(url).origin,'https://openrouter.ai');assert.equal(req.redirect,'error');calls.push({url,...req});if(fetchError)throw Error();if(req.method==='GET'){const receipt={id:'gen-image1',model:policy.routes.image.model,provider_name:'Black Forest Labs',total_cost:.014,is_byok:false};editReceipt(receipt);return Response.json({data:receipt});}
 assert.equal(url,'https://openrouter.ai/api/v1/images');const body=JSON.parse(req.body);assert.deepEqual(body.provider,{only:['black-forest-labs'],allow_fallbacks:false});assert.equal(body.size,'1024x1024');assert.equal(body.n,1);assert.equal(body.output_format,'png');assert.equal(body.input_references,undefined);
 const result={created:1,data:[{b64_json:syntheticPNG().toString('base64'),media_type:'image/png'}],usage:{cost:.014,prompt_tokens:0,completion_tokens:0,total_tokens:0}};edit(result);return Response.json(result,{headers:missingId?{}:{'x-generation-id':'gen-image1'}});
 }});return {generate,calls,events,receipts,holds:()=>holds};
}
test('platform quote comes from the reviewed job, never legacy image environment',()=>{const p=openRouterImagePolicy(policy,{now});assert.equal(p.provider,'openrouter');assert.equal(p.funding,'platform');assert.equal(imageFundingQuote({},policy).model,policy.routes.image.model);assert.throws(()=>imageFundingQuote({LEARNABLE_GPT_IMAGES:'1',LEARNABLE_IMAGE_FUNDING:'platform'}),{code:'funding'});});
test('one image request uses the same key and settles before returning a validated asset',async()=>{const f=fixture(),r=await f.generate(request);assert.deepEqual(f.events,['reserve','settle']);assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(f.calls.filter(c=>c.method==='GET').length,1);assert.equal(f.receipts[0].actualMicrousd,14000);assert.equal(r.provenance.provider,'openrouter');assert.equal(r.provenance.requestId,'gen-image1');assert.equal(r.asset.width,1024);assert.deepEqual(r.asset.bytes,syntheticPNG());});
for(const [name,opts] of [
 ['missing receipt ID',{missingId:true}],['wrong provider',{editReceipt:r=>{r.provider_name='other';}}],['wrong model',{editReceipt:r=>{r.model='other';}}],['receipt cost mismatch',{editReceipt:r=>{r.total_cost=.03;}}],['unapproved BYOK',{editReceipt:r=>{r.is_byok=true;}}],['over reservation',{edit:r=>{r.usage.cost=.07;},editReceipt:r=>{r.total_cost=.07;}}],['lost transport',{fetchError:true}],['lost settlement',{settleError:true}]
])test(`${name} keeps spending held and never repeats generation`,async()=>{const f=fixture(opts);await assert.rejects(f.generate(request),e=>e.mayHaveCharged===true);await assert.rejects(f.generate(request));assert.equal(f.calls.filter(c=>c.method==='POST').length,1);assert.equal(f.holds(),1);assert.equal(f.receipts.length,0);});
for(const [name,edit] of [['invalid PNG',r=>{r.data[0].b64_json='invalid';}],['wrong dimensions',r=>{r.data[0].b64_json=syntheticPNG({width:1}).toString('base64');}],['extra image',r=>r.data.push(r.data[0])],['unexpected media',r=>{r.data[0].media_type='image/svg+xml';}]])test(`${name} records known cost but rejects the asset`,async()=>{const f=fixture({edit});await assert.rejects(f.generate(request),e=>e.code==='response'&&e.mayHaveCharged);assert.equal(f.receipts.length,1);assert.equal(f.holds(),0);});
test('lease cancellation after image hold sends no paid request',async()=>{let n=0;const f=fixture({beforeDispatch:()=>{if(++n===2)throw Error('cancelled');}});await assert.rejects(f.generate(request),e=>!e.mayHaveCharged);assert.equal(f.calls.length,0);assert.equal(f.holds(),1);});
test('invalid input is rejected before reserving',async()=>{const f=fixture();await assert.rejects(f.generate({...request,prompt:''}),{code:'input'});await assert.rejects(f.generate({...request,funding:'creator'}),{code:'input'});assert.equal(f.events.length,0);});

test('absent image envelope cost is read from its exact gateway receipt',async()=>{const f=fixture({edit:r=>{delete r.usage.cost;}});await f.generate(request);assert.equal(f.receipts[0].actualMicrousd,14000);});
