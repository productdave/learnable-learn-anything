import test from 'node:test';
import assert from 'node:assert/strict';
import { readFundedAccess } from '../web/api/_lib/funded-access.mjs';
import { createAccountAccessHandler } from '../web/api/account/access.js';
import { createStartHandler } from '../web/api/gen/start.js';
import { createSetupGenerationHandler } from '../web/api/setups/generate.js';
import { createSetupGenerationClient } from '../web/js/setup-generation-client.js';
import { fundedAccessHTML } from '../web/js/funded-access-view.js';
const owner = '11111111-1111-4111-8111-111111111111';
const row = { ownerId: owner, mode: 'platform', state: 'active', expiresAt: null, granted: 500 };
const read = (data = row, error = null) => readFundedAccess({ rpc: async (name, args) => {
  assert.equal(name, 'learnable_account_access'); assert.deepEqual(args, { p_owner_id: owner }); return { data, error };
} }, owner, { rollout: 'pilot', now: Date.parse('2026-10-11') });
const response = () => ({ code: null, body: null, headers: {}, setHeader(k,v){this.headers[k]=v;}, status(v){this.code=v;return this;},json(v){this.body=v;return this;} });
for (const [patch,status] of [[{},'included'],[{granted:0},'empty'],[{state:'paused'},'paused'],[{state:'revoked'},'revoked'],[{expiresAt:'2026-10-10'},'expired']]) test('access state '+status,async()=>{
 const r=await read({...row,...patch}); assert.equal(r.status,status);assert.equal(r.canCreate,false);assert.equal(r.balance.available,patch.granted??500);
});
test('missing invitation is unknown balance, not a zero grant',async()=>assert.deepEqual(await read(null),{mode:'platform',status:'not_invited',balance:null,canCreate:false}));
test('rollout off preserves un-enrolled legacy accounts but never downgrades enrolled funding',async()=>{const lookup=data=>({rpc:async()=>({data,error:null})});assert.equal((await readFundedAccess(lookup(null),owner,{rollout:'legacy'})).mode,'legacy');const enrolled=await readFundedAccess(lookup(row),owner,{rollout:'legacy'});assert.equal(enrolled.mode,'platform');assert.equal(enrolled.status,'paused');});
test('pilot preserves explicitly enrolled legacy account',async()=>assert.equal((await read({...row,mode:'legacy'})).mode,'legacy'));
for(const patch of [{ownerId:'other'},{granted:-1},{granted:0.5},{granted:Number.MAX_SAFE_INTEGER+1},{mode:'other'},{state:'unknown'},{expiresAt:'bad'}])test('reject malformed projection '+JSON.stringify(patch),async()=>assert.rejects(read({...row,...patch})));
test('database and invalid rollout errors fail closed',async()=>{await assert.rejects(read(null,{message:'secret'}));await assert.rejects(readFundedAccess({},owner,{rollout:'typo'}));});
test('API ignores requested owner and uses verified auth owner with no-store',async()=>{
 let called=0;const handler=createAccountAccessHandler({authenticate:async()=>({user:{id:owner},client:{owned:true}}),read:async(c,id)=>{assert.equal(id,owner);assert.equal(c.owned,true);called++;return read();}});
 const res=response();await handler({method:'GET',query:{owner:'other'},body:{ownerId:'other'}},res);assert.equal(res.code,200);assert.equal(called,1);assert.equal(res.headers['Cache-Control'],'no-store');assert.equal(res.headers.Vary,'Authorization');
});
test('API rejects unauthenticated access and mutations; redacts database errors',async()=>{
 for(const method of ['POST','PUT','DELETE']){const res=response();await createAccountAccessHandler({authenticate:()=>{throw Error('should not run');}})({method},res);assert.equal(res.code,405);}
 let res=response();await createAccountAccessHandler({authenticate:async()=>{throw Error('secret');}})({method:'GET'},res);assert.equal(res.code,401);assert.ok(!JSON.stringify(res.body).includes('secret'));
 res=response();await createAccountAccessHandler({authenticate:async()=>({user:{id:owner}}),read:()=>{throw Error('secret');}})({method:'GET'},res);assert.equal(res.code,503);assert.ok(!JSON.stringify(res.body).includes('secret'));
});
const auth=async()=>({user:{id:owner}});
function dbFixture({existing=false}={}){return{from(table){assert.ok(['course_setups','generation_jobs'].includes(table),'must not read keys or provider data');const filters={};return{select(){return this;},eq(k,v){filters[k]=v;return this;},async maybeSingle(){assert.equal(filters.owner_id,owner);return{data:table==='course_setups'?{id:'setup-qa',revision:1,content_hash:'a'.repeat(64),payload:{}}:existing?{id:'job-existing',status:'completed',user_brief:{}}:null,error:null};}};}};}
for(const route of ['direct','setup'])test(route+' start denies funded accounts before key/provider/job writes',async()=>{
 for(const state of ['active','paused','revoked']){const options={authenticate:auth,admin:()=>dbFixture(),access:async(c,id)=>{assert.equal(id,owner);return read({...row,state});},run:()=>assert.fail('runner'),runGeneration:()=>assert.fail('runner'),background:()=>assert.fail('background')};
 const handler=route==='direct'?createStartHandler(options):createSetupGenerationHandler(options);const res=response();await handler({method:'POST',body:route==='direct'?{brief:{topic:'A course'}}:{id:'setup-qa',revision:1,action:'start'}},res);assert.equal(res.code,409);assert.equal(res.body.funding,'platform');assert.equal(res.body.ready,false);}
});
for(const route of ['direct','setup'])test(route+' existing course reattaches without access/key/provider checks',async()=>{
 const options={authenticate:auth,admin:()=>dbFixture({existing:true}),access:()=>assert.fail('existing job does not need new funding')};const res=response();await(route==='direct'?createStartHandler(options):createSetupGenerationHandler(options))({method:'POST',body:route==='direct'?{jobId:'job-existing',brief:{topic:'A course'}}:{id:'setup-qa',revision:1,action:'start'}},res);assert.equal(res.code,200);assert.equal(res.body.existing,true);
});
test('setup readiness is key-free and does not inspect source URLs for funded account',async()=>{const res=response();await createSetupGenerationHandler({authenticate:auth,admin:()=>dbFixture(),access:()=>read()})({method:'POST',body:{id:'setup-qa',revision:1,action:'check'}},res);assert.equal(res.code,200);assert.equal(res.body.ready,false);assert.equal(res.body.access.balance.available,500);});
test('client balance read uses current bearer identity and rejects late account switch',async()=>{
 let identity=owner, calls=0;const client=createSetupGenerationClient({getIdentity:()=>({id:identity}),getClient:async()=>({auth:{getSession:async()=>({data:{session:{user:{id:owner},access_token:'synthetic'}}})}}),fetcher:async(path,init)=>{calls++;assert.equal(path,'/api/account/access');assert.equal(init.method,'GET');assert.equal(init.cache,'no-store');assert.equal(init.headers.Authorization,'Bearer synthetic');return{ok:true,json:async()=>{identity='other';return read();}};}});
 await assert.rejects(client.access(owner),/account changed/);await assert.rejects(client.access(owner),/account changed/);assert.equal(calls,1);
});
test('balance presenter distinguishes unknown/zero and unavailable credits',()=>{assert.match(fundedAccessHTML(null),/Balance unavailable/);assert.ok(!fundedAccessHTML(null).includes('<dd>0'));assert.match(fundedAccessHTML({status:'empty',balance:{available:0,reserved:0,used:0}}),/<dd>0/);assert.match(fundedAccessHTML({status:'expired',balance:{available:500,reserved:0,used:0}}),/<dt>Unspent/);});
