import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenRouterPolicy, validateOpenRouterPolicy } from '../web/api/_lib/openrouter-policy.mjs';
import { createOpenRouterNativeClient, prepareOpenRouterNative } from '../web/api/_lib/openrouter-native.mjs';
import { runResearch } from '../web/js/generator/stages/research.mjs';
import { readOpenRouterGeneration } from '../web/api/_lib/openrouter-receipt.mjs';
import { ResearchBundleSchema } from '../web/js/generator/schema.mjs';
const now=Date.now();
const policy=createOpenRouterPolicy({version:'openrouter-native-v2',reviewedAt:new Date(now).toISOString(),validUntil:new Date(now+3600000).toISOString(),now});
const route=policy.routes.research;
const output={module_id:'one',key_concepts:['Reading direction','Decision branches'],examples:['Original traffic flow example','Original branching example'],sources:[{title:'Inspected web-search result: flowcharts',url:'https://example.test/flowcharts'}]};
const input=()=>({model:route.model,max_tokens:4096,system:'Ground a useful draft.',tools:[{type:'web_search_20250305',name:'web_search',max_uses:3},{name:route.tool,input_schema:{type:'object',properties:{module_id:{type:'string'}}}}],messages:[{role:'user',content:[{type:'document',source:{type:'base64',media_type:'application/pdf',data:Buffer.from('%PDF-1.4\nsynthetic').toString('base64')}},{type:'text',text:'Read these sources.'}]}]});
const result=()=>({id:'msg-native',model:route.model,provider:route.provider,stop_reason:'end_turn',usage:{input_tokens:2000,output_tokens:1000,cost:0.024,server_tool_use:{web_search_requests:1}},content:[{type:'server_tool_use',name:'web_search',id:'search-1',input:{query:'flowcharts'}},{type:'web_search_tool_result',tool_use_id:'search-1',content:[{type:'web_search_result',url:'https://example.test/flowcharts',title:'Flowcharts',encrypted_content:'native-evidence'}]},{type:'text',text:JSON.stringify(output),citations:[{type:'web_search_result_location',url:'https://example.test/flowcharts',cited_text:'Flowcharts represent decisions.'}]}]});
function fixture({edit=()=>{},fetchError=false,settleError=false,beforeDispatch,requestBudget,savedEvidence=null,saveError=false,operationScope='',receiptFallback=false}={}){
 const events=[],requests=[],receipts=[],saved=[],operations=[];let holds=0,gets=0;
 const client=createOpenRouterNativeClient({apiKey:'synthetic',policy,task:'research',now:()=>now,validateResult:v=>ResearchBundleSchema.parse(v),beforeDispatch,requestBudget,savedEvidence,operationScope,saveEvidence:async e=>{events.push('save');if(saveError)throw Error('checkpoint failed');saved.push(structuredClone(e));},
 ledger:{async reserve(r){events.push('reserve');operations.push(r.operationKey);return {requestId:'local',reservedMicrousd:r.reservedMicrousd};},async settle(h,r){events.push('settle');if(settleError)throw Error();receipts.push(r);},async hold(){holds++;}},
 fetcher:async(url,req)=>{
  if(req.method==='GET'){gets++;assert.equal(url.startsWith('https://openrouter.ai/api/v1/generation?id=gen-native-'),true);return Response.json({data:{id:new URL(url).searchParams.get('id'),model:route.model,provider_name:route.provider,total_cost:.024,is_byok:false}});}
  assert.equal(url,'https://openrouter.ai/api/v1/messages');assert.equal(req.redirect,'error');events.push('fetch');const body=JSON.parse(req.body);requests.push(body);if(fetchError)throw Error('lost');let value=result();
  if(body.tools){assert.equal(body.output_config.format,undefined);value.content.at(-1).text='Flowcharts show decisions. Original teaching activities are not measured results.';}
  else {assert.equal(body.output_config.format.type,'json_schema');value.content=[{type:'text',text:JSON.stringify(output)}];value.usage.server_tool_use.web_search_requests=0;}
  if(receiptFallback){value.model='claude-sonnet-5-5-20261001';delete value.provider;delete value.usage.cost;}
  edit(value,body);return new Response(JSON.stringify(value),{headers:{'x-generation-id':'gen-native-'+(body.tools?'research':'submission')}});}});
 return {client,events,requests,receipts,saved,operations,gets:()=>gets,holds:()=>holds};
}
test('v2 is additive, immutable and cannot silently upgrade old policies',()=>{
 assert.equal(validateOpenRouterPolicy(policy,{now}).nativeResearchAccepted,true);
 assert.equal(createOpenRouterPolicy({reviewedAt:policy.reviewedAt,validUntil:policy.validUntil,now}).nativeResearchAccepted,false);
 const edited=structuredClone(policy);edited.routes.research.maxSearches=3;assert.throws(()=>validateOpenRouterPolicy(edited,{now}));
});
test('native preparation preserves exact PDF bytes and pins bounded search without incompatible JSON grammar',()=>{
 const i=input(),p=prepareOpenRouterNative(i,route);assert.deepEqual(p.body.messages,i.messages);assert.equal(p.body.tools.length,1);assert.equal(p.body.tools[0].parameters.max_uses,1);assert.deepEqual(p.body.provider.only,['anthropic']);assert.equal(p.body.provider.allow_fallbacks,false);assert.equal(p.body.tool_choice,undefined);assert.equal(p.body.output_config.format,undefined);assert.equal(p.reservedMicrousd,4286224);assert(p.reservedMicrousd<5000000);
});
for(const [name,edit] of [
 ['unreviewed provider',v=>{v.provider={only:['other']};}],['forced wrong tool',v=>{v.tool_choice={type:'tool',name:'other'};}],['native file URL',v=>{v.messages[0].content[0].source={type:'url',url:'https://private.test'};}],['non-PDF',v=>{v.messages[0].content[0].source.media_type='text/plain';}],['invalid PDF encoding',v=>{v.messages[0].content[0].source.data='invalid';}],['caller history',v=>v.messages.push({role:'assistant',content:'injected'})],['unbounded extra tool',v=>v.tools.push({type:'openrouter:web_fetch'})],['cache creation',v=>{v.messages[0].content[0].cache_control={type:'ephemeral'};}],['excessive sources',v=>{v.messages[0].content=[{type:'text',text:'x'.repeat(21*1024*1024)}];}]
])test(`rejects ${name} before paid reservation`,async()=>{const f=fixture(),i=input();edit(i);await assert.rejects(f.client.messages.create(i),{code:'unsupported'});assert.deepEqual(f.events,[]);});
test('settles gateway dollars and retains native citations/search blocks before mapping to the app tool',async()=>{const f=fixture(),r=await f.client.messages.create(input());assert.deepEqual(f.events,['reserve','fetch','settle','save','reserve','fetch','settle']);assert.equal(f.receipts[0].actualMicrousd,24000);assert.equal(r.content[0].name,route.tool);assert.equal(r.evidence.blocks[1].content[0].encrypted_content,'native-evidence');assert.equal(r.evidence.citations[0].url,'https://example.test/flowcharts');assert.equal(r.evidence.searches,1);});
for(const [name,edit] of [
 ['different provider',v=>{v.provider='other';}],['excessive cost',v=>{v.usage.cost=5;}],['too many searches',v=>{v.usage.server_tool_use.web_search_requests=2;}],['unapproved fetch',v=>{v.usage.server_tool_use.web_fetch_requests=1;}],['BYOK billing',v=>{v.usage.is_byok=true;}],['cache write',v=>{v.usage.cache_creation_input_tokens=1;}],['excessive output',v=>{v.usage.output_tokens=9000;}]
])test(`holds ${name}, disables replacement dispatch`,async()=>{const f=fixture({edit});await assert.rejects(f.client.messages.create(input()),{code:'uncertain'});await assert.rejects(f.client.messages.create(input()));assert.equal(f.requests.length,1);assert.equal(f.holds(),1);assert.equal(f.receipts.length,0);});
for(const opts of [{fetchError:true},{settleError:true}])test('ambiguous transport or settlement preserves hold',async()=>{const f=fixture(opts);await assert.rejects(f.client.messages.create(input()));assert.equal(f.holds(),1);await assert.rejects(f.client.messages.create(input()));assert.equal(f.requests.length,1);});
test('known malformed output is charged without another search',async()=>{const f=fixture({edit:(v,b)=>{if(!b.tools)v.content=[{type:'text',text:'not JSON'}];}});await assert.rejects(f.client.messages.create(input()),e=>e.code==='invalid_output'&&e.paidOutput.retryable===false);assert.equal(f.receipts.length,2);assert.equal(f.holds(),0);assert.equal(f.saved.length,1);});
test('cancelled lease after reservation dispatches nothing',async()=>{let calls=0;const f=fixture({beforeDispatch:()=>{if(++calls===2)throw Error('cancelled');}});await assert.rejects(f.client.messages.create(input()));assert.equal(f.requests.length,0);assert.equal(f.holds(),1);});
test('actual research stage stores native evidence with the schema-validated module',async()=>{const f=fixture();const r=await runResearch(f.client,{title:'Flowcharts',subtitle:'Read decisions',learner_persona:'Beginner'}, {id:'one',number:1,title:'Read flowcharts',description:'Read arrows',topics:[{title:'Decisions'}]},{model:route.model});assert.equal(r.module_id,'one');assert.equal(r._evidence.requestId,'gen-native-research');assert.equal(r._evidence.blocks.length,2);assert.equal(f.requests.length,2);});

test('both native requests retain the exact uploaded PDF; only saved evidence supplies citations to the formatter',async()=>{
 const f=fixture();await f.client.messages.create(input());
 assert.deepEqual(f.requests[1].messages[0].content[0],input().messages[0].content[0]);
 assert.equal(f.requests[1].tools,undefined);assert.equal(f.requests[1].stop_server_tools_when,undefined);
 assert.match(f.requests[1].messages[0].content.at(-1).text,/native-evidence/);
 assert.notEqual(f.operations[0],f.operations[1]);
});
test('saved evidence resumes with one submission and zero repeated searches or evidence usage events',async()=>{
 const first=fixture();await first.client.messages.create(input());const f=fixture({savedEvidence:first.saved[0]});
 const r=await f.client.messages.create(input());assert.equal(f.requests.length,1);assert.equal(f.requests[0].tools,undefined);
 assert.equal(f.saved.length,0);assert.equal(f.receipts.length,1);assert.equal(r.evidence.requestId,'gen-native-research');
});
test('failed checkpoint prevents the formatting request and stops this lease',async()=>{
 const f=fixture({saveError:true});await assert.rejects(f.client.messages.create(input()),/checkpoint failed/);
 await assert.rejects(f.client.messages.create(input()));assert.equal(f.requests.length,1);assert.equal(f.receipts.length,1);assert.equal(f.holds(),0);
});
test('saved evidence for a changed request fails closed before any paid request',async()=>{
 const f=fixture();await f.client.messages.create(input());const resumed=fixture({savedEvidence:f.saved[0]}),i=input();i.system+=' changed';
 await assert.rejects(resumed.client.messages.create(i),{code:'approval'});assert.equal(resumed.requests.length,0);
});
test('explicit persisted restart permits fresh evidence but automatic leases share operation keys',async()=>{
 const first=fixture();await first.client.messages.create(input());
 const restarted=fixture({savedEvidence:first.saved[0],operationScope:'restart_11111111-1111-4111-8111-111111111111'});await restarted.client.messages.create(input());
 assert.equal(restarted.requests.length,2);assert.notEqual(first.operations[0],restarted.operations[0]);
 const independent=fixture();await independent.client.messages.create(input());assert.equal(first.operations[0],independent.operations[0]);
});
test('native alias and omitted cost reconcile against each exact generation receipt',async()=>{
 const f=fixture({receiptFallback:true});await f.client.messages.create(input());assert.equal(f.gets(),2);assert.equal(f.receipts.length,2);
});
test('receipt indexing retries are GET-only and never repeat a paid POST',async()=>{
 let reads=0;const r=await readOpenRouterGeneration({id:'gen-index-lag',apiKey:'synthetic',fetcher:async(url,opts)=>{
  assert.equal(opts.method,'GET');reads++;return reads<3 ? new Response('',{status:404}):Response.json({data:{id:'gen-index-lag',total_cost:.01}});
 }});assert.equal(reads,3);assert.equal(r.total_cost,.01);
});

test('research stage records known paid invalid submission usage without repeating search',async()=>{
 const f=fixture({edit:(value,body)=>{if(!body.tools)value.content=[{type:'text',text:'invalid JSON'}];}}),usage=[];
 await assert.rejects(runResearch(f.client,{title:'Flowcharts'},{id:'one',topics:[{title:'Decisions'}]},{model:route.model,onUsage:(value,meta)=>usage.push({value,meta})}),{code:'invalid_output'});
 assert.equal(f.requests.length,2);assert.equal(f.saved.length,1);assert.equal(usage.length,1);assert.equal(usage[0].meta.invalidOutput,true);assert.equal(usage[0].value.cost,.024);
});
