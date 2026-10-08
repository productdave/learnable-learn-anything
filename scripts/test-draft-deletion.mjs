import assert from 'node:assert/strict';
import { createSetupSessions } from '../web/js/setup-session.js';
import { createSetupAccountClient } from '../web/js/setup-account-client.js';
import { createSetupHandler } from '../web/api/setups/store.js';

let checks=0,owner=null,rows=new Map(),writes=0,removes=0;
const check=(value,label)=>{assert.ok(value,label);checks++;};
const key=(owner,id)=>JSON.stringify([owner,id]);
const store={
  async save(input,{ownerId,expectedRevision}){writes++;const k=key(ownerId,input.id),prior=rows.get(k);if(prior?.deleted)throw{code:'deleted'};if((prior?.revision||0)!==expectedRevision)throw{code:'conflict'};const row={...input,revision:expectedRevision+1};rows.set(k,row);return row;},
  async load(id,ownerId){const row=rows.get(key(ownerId,id));return row?.deleted?{status:'deleted'}:row?{status:'found',draft:row}:{status:'missing'};},
  async list(ownerId){return {drafts:[...rows].filter(([k,v])=>JSON.parse(k)[0]===ownerId&&!v.deleted).map(([,v])=>v)};},
  async remove(id,{ownerId,expectedRevision,tombstone}){const k=key(ownerId,id),row=rows.get(k);if(row?.deleted)return true;if((row?.revision||0)!==expectedRevision)throw{code:'conflict'};check(tombstone,'delete uses anti-resurrection marker');rows.set(k,{id,deleted:true});removes++;return true;}
};
const sessions=createSetupSessions({store,getOwner:()=>owner});
const first=await sessions.start({topic:'Delete this draft'}),other=await sessions.start({topic:'Keep this draft'});await sessions.flush(first);await sessions.flush(other);
first.draft.brief.topic='Current unsent title';sessions.edit(first);
const snapshot=await sessions.deletionSnapshot(first.id);check(snapshot.title==='Current unsent title','confirmation identifies current draft');
await sessions.remove(snapshot);const writeCount=writes;await sessions.flush(first);
check(writes===writeCount&&!sessions.hasUnsaved(),'deleted buffer cannot autosave or cause leave warning');
check((await sessions.list()).drafts.length===1&&(await sessions.open(other.id)).status==='found','only selected draft removed');
check((await sessions.open(first.id)).status==='deleted','deleted route does not restore local copy');
await sessions.remove(snapshot);check(removes===1,'repeat local deletion harmless');
const second=await sessions.start({topic:'Account-sensitive'});await sessions.flush(second);
const version=await sessions.deletionSnapshot(second.id);rows.get(key(null,second.id)).revision++;
await assert.rejects(sessions.remove(version),/changed/);checks++;
check((await sessions.open(second.id)).status==='found','conflict preserves changed draft');
const fresh=await sessions.deletionSnapshot(second.id);
await assert.rejects(sessions.remove(fresh,async()=>{throw new Error('Account unavailable');}),/unavailable/);checks++;
check((await store.load(second.id,null)).status==='found','failed account removal keeps local copy');
owner='other-account';await assert.rejects(sessions.remove(fresh),/account changed/);checks++;
owner=null;
await assert.rejects(sessions.remove(fresh,async()=>{owner='other-account';}),/account changed/);checks++;
check((await store.load(second.id,null)).status==='found','account switch during remote operation cannot delete another local scope');

let identity={id:'owner'},networkFail=false,request;
const client=createSetupAccountClient({getIdentity:()=>identity,getClient:async()=>({auth:{getSession:async()=>({data:{session:{user:identity,access_token:'test'}}})}}),fetcher:async(url,options)=>{request={url,...options};if(networkFail)throw new Error('private transport detail');return{ok:true,json:async()=>({deleted:true})};}});
await client.remove('owner','setup-one',3);check(request.method==='DELETE'&&JSON.parse(request.body).expectedRevision===3,'authenticated deletion includes expected revision');
networkFail=true;await assert.rejects(client.remove('owner','setup-one',3),e=>e.code==='network'&&e.message.includes('deletion'));checks++;
identity={id:'other'};await assert.rejects(client.remove('owner','setup-one',3),e=>e.code==='auth');checks++;
let rpc,answer={deleted:true};const handler=createSetupHandler({authenticate:async()=>({user:{id:'verified-owner'}}),admin:()=>({rpc:async(name,args)=>{rpc={name,args};return{data:answer};}})});
const call=async body=>{const res={setHeader(){},status(code){this.code=code;return this;},json(value){this.body=value;return this;}};await handler({method:'DELETE',body},res);return res;};
check((await call({id:'setup-one',expectedRevision:2,owner_id:'attacker'})).code===200&&rpc.args.p_owner==='verified-owner'&&rpc.name==='delete_course_setup','API ignores client owner and uses protected RPC');
answer={error:'conflict'};check((await call({id:'setup-one',expectedRevision:2})).code===409,'API exposes revision conflict');
check((await call({id:'../bad',expectedRevision:0})).code===400,'invalid deletion target refused');
check((await call({id:'setup-one',expectedRevision:-1})).code===400,'invalid deletion revision refused');
console.log(`Draft deletion: ${checks} session/client/API checks passed. No user data changed.`);
