import test from 'node:test';
import assert from 'node:assert/strict';
import { pathToFileURL } from 'node:url';
const mod = await import(process.env.GUARD_MODULE ? pathToFileURL(process.env.GUARD_MODULE) : './staging-safeguard/client.mjs');
const {createClient,requestReservation,settledCost,MODEL,STAGING_URL,PROFILE}=mod;
const ownerId='11111111-1111-4111-8111-111111111111',runId='22222222-2222-4222-8222-222222222222';
const jobId='job-33333333-3333-4333-8333-333333333333';
const req=(search=false)=>({model:MODEL,max_tokens:4096,system:'Test only',messages:[{role:'user',content:'Test'}],tools:[{name:search?'submit_research_bundle':'submit_course_brief',input_schema:{type:'object'}},...(search?[{type:'web_search_20250305',name:'web_search',max_uses:6}]:[])]});
const result=()=>({model:MODEL,content:[],usage:{input_tokens:100,output_tokens:10}});
function fixture({cap=10000000,approved=true,fetcher,settleError=false}={}) {
  const state={cap,approved,charged:0,pending:null,halted:false,dispatches:0,events:[]};
  const supabase={async rpc(name,args){
    state.events.push(name);
    if(name==='reserve_learnable_staging_spend'){
      let reason=!state.approved?'approval':state.halted?'halted':state.pending?'pending':args.p_reserved_microusd>state.cap-state.charged?'budget':null;
      if(reason)return {data:{ok:false,reason}};
      state.pending=args;state.charged+=args.p_reserved_microusd;return {data:{ok:true}};
    }
    if(name==='halt_learnable_staging_spend'){state.halted=true;return {data:{ok:true}};}
    if(settleError)return {error:{message:'private database detail'}};
    state.charged-=state.pending.p_reserved_microusd-args.p_actual_microusd;state.pending=null;return {data:{ok:true}};
  }};
  const options={apiKey:'synthetic-no-network',supabase,ownerId,runId,jobId,env:{SUPABASE_URL:STAGING_URL,LEARNABLE_SETUP_GENERATION:'1'},fetcher:async(...args)=>{
    state.dispatches++;state.events.push('dispatch');assert.ok(state.pending,'durable reservation before network');
    return fetcher?fetcher(...args):{ok:true,headers:new Headers(),json:async()=>result()};
  }};
  return {state,options,client:createClient(options)};
}
test('profile supports the existing live-search request without rewriting it',()=>{
  const original=req(true),r=requestReservation(original);
  assert.deepEqual(r.body,original);assert.equal(r.microusd,4690080);assert.equal(r.searches,6);
  assert.equal(PROFILE,'sonnet45-search20250305-20260922');assert.equal(settledCost({...result(),usage:{...result().usage,server_tool_use:{web_search_requests:0}}},r),450);
  assert.throws(()=>settledCost(result(),r),'Missing search accounting must hold the reservation');
});
test('production/missing server context fails closed',()=>{
  const f=fixture();for(const patch of [{env:{}},{env:{SUPABASE_URL:'https://production.invalid',LEARNABLE_SETUP_GENERATION:'1'}},{env:{...f.options.env,LEARNABLE_SETUP_GENERATION:'0'}},{supabase:null},{ownerId:null},{runId:null},{jobId:'bad'},{apiKey:null}])
    assert.throws(()=>createClient({...f.options,...patch}),/not configured|disabled/);
  assert.equal(f.state.dispatches,0);
});
test('account setup IDs use the same durable reservation; malformed variants fail closed', async()=>{
  const f=fixture(), setupJobId='job-setup-'+'a'.repeat(48);
  const client=createClient({...f.options,jobId:setupJobId});
  await client.messages.create(req());
  assert.equal(f.state.dispatches,1);
  assert.deepEqual(f.state.events,['reserve_learnable_staging_spend','dispatch','settle_learnable_staging_spend']);
  for(const invalid of ['job-setup-'+'a'.repeat(47),'job-setup-'+'g'.repeat(48),setupJobId+'/other',setupJobId+'\n'])
    assert.throws(()=>createClient({...f.options,jobId:invalid}),/not configured/);
});
test('unknown billable facilities and tool/model variants fail before reservation',async()=>{
  const bodies=[{...req(),model:'another-model'},{...req(),max_tokens:16385},{...req(),stream:true},{...req(),thinking:{}},{...req(),messages:[{role:'user',content:[{type:'text',text:'x',cache_control:{type:'ephemeral'}}]}]},
    {...req(true),tools:[req(true).tools[0],{type:'web_search_20260209',name:'web_search',max_uses:6}]},
    {...req(true),tools:[req(true).tools[0],{type:'web_search_20250305',name:'web_search'}]},
    {...req(),tools:[{name:'unknown_tool'}]}];
  for(const body of bodies){const f=fixture();await assert.rejects(f.client.messages.create(body));assert.equal(f.state.dispatches,0);assert.equal(f.state.events.length,0);}
});
test('missing approval and insufficient allowance never dispatch',async()=>{
  for(const options of [{approved:false},{cap:1}]){const f=fixture(options);await assert.rejects(f.client.messages.create(req()));assert.equal(f.state.dispatches,0);assert.equal(f.state.charged,0);}
});
test('reserve, dispatch, reconcile; only confirmed unused reservation is released',async()=>{
  const f=fixture();assert.deepEqual(await f.client.messages.create(req()),result());
  assert.deepEqual(f.state.events,['reserve_learnable_staging_spend','dispatch','settle_learnable_staging_spend']);assert.equal(f.state.charged,450);assert.equal(f.state.pending,null);
});
test('parallel local workers are queued, all costs counted',async()=>{
  const f=fixture();await Promise.all(Array.from({length:4},()=>f.client.messages.create(req())));
  assert.equal(f.state.dispatches,4);assert.equal(f.state.charged,1800);
});
test('second invocation cannot spend against an unresolved first request',async()=>{
  let complete;const f=fixture({fetcher:()=>new Promise(resolve=>{complete=resolve;})});
  const first=f.client.messages.create(req());await new Promise(resolve=>setImmediate(resolve));
  const second=createClient(f.options);await assert.rejects(second.messages.create(req()),/previous AI request/);assert.equal(f.state.dispatches,1);
  complete({ok:true,headers:new Headers(),json:async()=>result()});await first;
});
test('timeouts, HTTP errors, malformed output and usage mismatch retain money and halt retries',async()=>{
  const failures=[async()=>{throw Error('private request data');},async()=>({ok:false,status:429}),async()=>({ok:true,json:async()=>{throw Error('bad JSON');}}),
    async()=>({ok:true,json:async()=>({...result(),usage:null})}),async()=>({ok:true,json:async()=>({...result(),model:'changed'})}),
    async()=>({ok:true,json:async()=>({...result(),usage:{input_tokens:200001,output_tokens:10}})})];
  for(const fetcher of failures){const f=fixture({fetcher});await assert.rejects(f.client.messages.create(req()),e=>!e.message.includes('private request data'));
    assert.equal(f.state.charged,requestReservation(req()).microusd);assert.ok(f.state.halted);await assert.rejects(f.client.messages.create(req()));assert.equal(f.state.dispatches,1);}
});
test('settlement failure never releases the reservation or permits a retry',async()=>{
  const f=fixture({settleError:true});await assert.rejects(f.client.messages.create(req()),e=>!e.message.includes('private database detail'));
  assert.ok(f.state.pending);await assert.rejects(f.client.messages.create(req()));assert.equal(f.state.dispatches,1);
});
test('unexpected caching, searches, geography, or negative usage fails reconciliation',()=>{
  const r=requestReservation(req());for(const usage of [{input_tokens:10,output_tokens:-1},{input_tokens:10,output_tokens:10,cache_read_input_tokens:1},{input_tokens:10,output_tokens:10,server_tool_use:{web_search_requests:1}},{input_tokens:10,output_tokens:10,inference_geo:'us'}])
    assert.throws(()=>settledCost({...result(),usage},r));
});
test('Sonnet 4.5 historical provider usage accepts its documented not_available geography',()=>{
  const response={model:MODEL,usage:{input_tokens:3573,cache_creation_input_tokens:0,cache_read_input_tokens:0,cache_creation:{ephemeral_5m_input_tokens:0,ephemeral_1h_input_tokens:0},output_tokens:536,service_tier:'standard',inference_geo:'not_available'}};
  assert.equal(settledCost(response,requestReservation(req())),18759);
  assert.throws(()=>settledCost({...response,model:'claude-sonnet-4-6'},requestReservation(req())));
});
test('provider request pins endpoint, headers, no redirects, and timeout',async()=>{
  let options;const f=fixture({fetcher:async(url,opts)=>{assert.equal(url,'https://api.anthropic.com/v1/messages');options=opts;return {ok:true,json:async()=>result()};}});
  await f.client.messages.create(req());assert.equal(options.redirect,'error');assert.equal(options.headers['anthropic-version'],'2023-06-01');assert.equal(Object.keys(options.headers).length,3);assert.ok(options.signal);assert.deepEqual(JSON.parse(options.body),req());
});
