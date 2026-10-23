import assert from 'node:assert/strict';
import test,{afterEach} from 'node:test';
import {randomUUID} from 'node:crypto';
import {createOpenRouterPolicy,validateOpenRouterPolicy,OPENROUTER_OWNER_POLICY_VERSION} from '../web/api/_lib/openrouter-policy.mjs';
import {generationProvider} from '../web/api/_lib/generation-provider.mjs';
import {inspectOpenRouterAccess,admitOpenRouterJob,publicOpenRouterAccess} from '../web/api/_lib/openrouter-admission.mjs';
import {createSetupGenerationHandler} from '../web/api/setups/generate.js';
import {createConnectionHandler} from '../web/api/providers/connection.js';
import {setupDraft} from '../web/js/setup-model.js';
import {prepareAccountPayload} from '../web/js/setup-account-model.js';
const env={LEARNABLE_GENERATION_PROVIDER:'openrouter',LEARNABLE_OPENROUTER_ENABLED:'1',OPENROUTER_API_KEY:'synthetic'},previous={...process.env};
afterEach(()=>{for(const k of Object.keys(process.env))if(!(k in previous))delete process.env[k];Object.assign(process.env,previous);});
const now=Date.now(),policy=createOpenRouterPolicy({version:'openrouter-native-v2',reviewedAt:new Date(now).toISOString(),validUntil:new Date(now+3600000).toISOString(),now}),ids=[randomUUID(),randomUUID(),randomUUID()];
const response=()=>({code:0,body:null,setHeader(){},status(n){this.code=n;return this;},json(v){this.body=v;return this;}});
function rpcFixture(value={ok:true,policy,remainingMicrousd:5000000}){let calls=[];return {calls,async rpc(name,args){calls.push({name,args});return {data:name==='inspect_learnable_ai_pilot'?value:{ok:true,policy,budgetIds:ids}};}};}
test('server-owned access uses operator policy and exposes no key or funding details',async()=>{const db=rpcFixture(),access=await inspectOpenRouterAccess(db,'owner',{env,now});assert.equal(access.ready,true);assert.deepEqual(db.calls[0].args,{p_owner_id:'owner'});const visible=publicOpenRouterAccess(access);assert.equal(visible.policy,undefined);assert(!JSON.stringify(visible).includes('synthetic'));const binding=await admitOpenRouterJob(db,'owner','job-one',access,{env,now});assert.equal(binding.ai_policy.fingerprint,policy.fingerprint);assert.deepEqual(binding.ai_budget_ids,ids);});
for(const [name,config] of [['paused',{...env,LEARNABLE_OPENROUTER_ENABLED:'0'}],['missing gateway key',{...env,OPENROUTER_API_KEY:''}]])test(`${name} does not read personal keys or mint admission`,async()=>{const db=rpcFixture();assert.equal((await inspectOpenRouterAccess(db,'owner',{env:config,now})).ready,false);assert.equal(db.calls.length,0);});
for(const reason of ['not_enrolled','paused','expired','budget'])test(`${reason} never falls back to BYOK`,async()=>{const db=rpcFixture({ok:false,reason}),access=await inspectOpenRouterAccess(db,'owner',{env,now});assert.equal(access.managed,true);assert.equal(access.ready,false);await assert.rejects(admitOpenRouterJob(db,'owner','job-one',access,{env,now}));assert.equal(db.calls.length,1);});
test('remaining allowance must cover the conservative next reservation',async()=>{assert.equal((await inspectOpenRouterAccess(rpcFixture({ok:true,policy,remainingMicrousd:100}),'owner',{env,now})).reason,'budget');});
test('legacy is untouched without platform selection',async()=>{const db=rpcFixture();assert.equal(await inspectOpenRouterAccess(db,'owner',{env:{},now}),null);assert.equal(db.calls.length,0);});
test('expired or edited policy cannot admit new work',async()=>{for(const p of [{...policy,fingerprint:'bad'},createOpenRouterPolicy({reviewedAt:policy.reviewedAt,validUntil:policy.validUntil,now})])await assert.rejects(inspectOpenRouterAccess(rpcFixture({ok:true,policy:p,remainingMicrousd:5000000}),'owner',{env,now}));});
async function setup(){
 Object.assign(process.env,env);const owner=randomUUID(),draft=setupDraft('Reading flowcharts');Object.assign(draft.brief,{audience:'Beginners',context:'Short sessions',goal:'Read a branching flowchart',starting_point:'Beginner',experience:'guided_practice'});draft.sources.notes=[{id:'n1',title:'Supplied notes',text:'Follow arrows and read the decision before taking a branch.'}];
 const prepared=await prepareAccountPayload(draft),row={id:'setup-native',owner_id:owner,revision:1,deleted:false,content_hash:prepared.hash,payload:prepared.payload};const jobs=[],runs=[],db=rpcFixture();
 db.from=table=>{assert(['course_setups','generation_jobs'].includes(table),'No personal credential read');let filters=[],input=null;const q={select(){return this;},eq(k,v){filters.push(r=>r[k]===v);return this;},maybeSingle(){return this;},insert(v){input=v;return this;},then(resolve,reject){return Promise.resolve().then(()=>{if(input){jobs.push(input);return {error:null};}return {data:(table==='course_setups'?[row]:jobs).find(r=>filters.every(f=>f(r)))||null};}).then(resolve,reject);}};return q;};
 const deps={authenticate:async()=>({user:{id:owner}}),admin:()=>db,run:async a=>runs.push(a),background:p=>p,enabled:()=>true,validate:()=>{throw Error('Must not validate a Claude key');}};
 const handler=createSetupGenerationHandler(deps),call=async(action,extra={})=>{const r=response();await handler({method:'POST',headers:{},body:{id:row.id,revision:1,action,...extra}},r);return r;};return {row,jobs,runs,db,deps,call};
}
test('actual setup preflight is key-free, exposes source review and makes no admission',async()=>{const f=await setup(),r=await f.call('check');assert.equal(r.code,200);assert.equal(r.body.ready,true);assert.equal(r.body.managed,true);assert.equal(r.body.provider,'openrouter');assert(r.body.sources);assert.equal(r.body.policy,undefined);assert.equal(f.jobs.length,0);assert.equal(f.runs.length,0);assert.equal(f.db.calls.length,1);});
test('actual setup start persists immutable gateway binding, then duplicates reattach without admission',async()=>{const f=await setup(),check=await f.call('check'),r=await f.call('start',{sourceReview:check.body.sources.digest,ai_policy:{funding:'attacker'}});assert.equal(r.code,200);assert.equal(f.jobs.length,1);assert.equal(f.jobs[0].ai_policy.fingerprint,policy.fingerprint);assert.deepEqual(f.jobs[0].ai_budget_ids,ids);assert.equal(f.runs.length,1);assert.equal(f.runs[0].apiKey,null);const calls=f.db.calls.length,r2=await f.call('start');assert.equal(r2.body.existing,true);assert.equal(f.db.calls.length,calls);assert.equal(f.runs.length,1);});
test('actual account endpoint returns managed status and rejects user-key replacement before reading it',async()=>{const f=await setup(),handler=createConnectionHandler(f.deps),r=response();await handler({method:'GET',headers:{}},r);assert.equal(r.body.managed,true);assert.equal(r.body.policy,undefined);const r2=response();await handler({method:'POST',headers:{},body:{key:'synthetic-personal-key'}},r2);assert.equal(r2.code,409);assert.equal(f.jobs.length,0);});

const ownerPolicy=createOpenRouterPolicy({version:OPENROUTER_OWNER_POLICY_VERSION,reviewedAt:new Date(now).toISOString(),now});
const ownerEnv={...env,LEARNABLE_OWNER_FUNDED_ENABLED:'1'};
test('explicit owner policy stays usable after the old one-day window',()=>{
 assert.equal(ownerPolicy.validUntil,null);
 assert.equal(validateOpenRouterPolicy(ownerPolicy,{now:now+86400000*365}).fingerprint,ownerPolicy.fingerprint);
 assert.throws(()=>validateOpenRouterPolicy(policy,{now:now+86400000*2}));
 assert.throws(()=>validateOpenRouterPolicy({...ownerPolicy,routes:{}}));
});
test('owner-funded readiness needs the server switch and matching database mode, not an allowance',async()=>{
 const state={ok:true,policy:ownerPolicy,fundingMode:'owner_funded',remainingMicrousd:null};
 assert.equal((await inspectOpenRouterAccess(rpcFixture(state),'owner',{env:ownerEnv,now})).ready,true);
 assert.equal((await inspectOpenRouterAccess(rpcFixture(state),'owner',{env,now})).ready,false);
 assert.equal((await inspectOpenRouterAccess(rpcFixture({...state,fundingMode:'capped'}),'owner',{env:ownerEnv,now})).ready,false);
});
test('owner-funded continuation retains provider, owner and pause checks',()=>{
 const job={id:'owner-course',owner_id:'owner',ai_policy:ownerPolicy,ai_budget_ids:ids};
 assert.equal(generationProvider(job,'owner',{env:ownerEnv,now:now+86400000*2}).gateway,'openrouter');
 assert.throws(()=>generationProvider(job,'owner',{env,now}));
 assert.throws(()=>generationProvider(job,'other',{env:ownerEnv,now}));
});
test('managed funding failure does not claim the image server is disabled',async()=>{
 const f=await setup();f.db.rpc=async()=>({data:{ok:false,reason:'expired'}});
 const r=await f.call('check');assert.equal(r.code,200);assert.equal(r.body.ready,false);
 assert.equal(r.body.issues.length,0);assert.match(r.body.message,/allowance/);assert.equal(f.runs.length,0);
});
test('owner-funded actual start saves the new mode and a repeated click reattaches',async()=>{
 const f=await setup();Object.assign(process.env,ownerEnv);
 f.db.rpc=async name=>({data:name==='inspect_learnable_ai_pilot'?{ok:true,policy:ownerPolicy,fundingMode:'owner_funded',remainingMicrousd:null}:{ok:true,policy:ownerPolicy,budgetIds:ids}});
 const check=await f.call('check');assert.equal(check.body.ready,true);
 const start=await f.call('start');assert.equal(start.code,200);assert.equal(f.jobs[0].ai_policy.version,OPENROUTER_OWNER_POLICY_VERSION);
 assert.equal((await f.call('start')).body.existing,true);assert.equal(f.runs.length,1);
});
