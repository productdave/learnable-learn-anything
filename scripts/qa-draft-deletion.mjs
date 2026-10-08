// Disposable local Auth/Postgres/IndexedDB only. Never deletes user drafts.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig,createPreviewServer } from './dev-setup-server.mjs';
import { readBrowserGraph } from './browser-contract.mjs';
import { setupDraft } from '../web/js/setup-model.js';
import { prepareAccountPayload } from '../web/js/setup-account-model.js';
const cli=process.env.PLAYWRIGHT_CLI,session=process.argv[2]||'draft-deletion';assert.ok(cli);
const config=await loadPreviewConfig(new URL('../.env.preview.local',import.meta.url));assert.equal(config.mode,'local');assert.equal(config.url,'http://127.0.0.1:54321');
Object.assign(process.env,{SUPABASE_URL:config.url,SUPABASE_ANON_KEY:config.publicKey,SUPABASE_SECRET_KEY:config.secretKey});
const graph=readBrowserGraph(),modulePath=name=>`/js/${name}.js?${graph.imports.get(resolve(graph.web,`js/${name}.js`))[0].query}`;
const admin=createClient(config.url,config.secretKey,{auth:{persistSession:false,autoRefreshToken:false}}),accounts=[];let server,checks=0;
const check=(value,label)=>{assert.ok(value,label);checks++;};
const command=args=>new Promise((resolve,reject)=>{const child=spawn(cli,['--session',session,...args]);let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);child.on('error',reject);child.on('close',code=>{const result=output.split('### Ran Playwright code')[0];code||output.includes('### Error')?reject(new Error(result)):resolve(result);});});
try{
  for(let i=0;i<2;i++){
    const account={email:`draft-delete-${randomUUID()}@example.test`,password:`${randomUUID()}Aa9!`};
    const made=await admin.auth.admin.createUser({...account,email_confirm:true});assert.ok(!made.error);account.owner=made.data.user.id;accounts.push(account);
    for(const [id,title] of [['setup-delete','Remove this account draft'],['setup-keep','Keep this account draft'],['setup-rpc','RPC deletion check']]){
      const draft=setupDraft(title);draft.brief.audience='QA only';const {payload,hash}=await prepareAccountPayload(draft);
      const result=await admin.rpc('commit_course_setup',{p_owner:account.owner,p_id:id,p_expected:0,p_payload:payload,p_hash:hash});assert.ok(!result.error&&result.data.revision===1);
    }
    assert.ok(!(await admin.from('user_courses').insert({id:'deletion-sentinel',owner_id:account.owner,payload:{config:{id:'deletion-sentinel',title:'Keep saved course'},modules:{}}})).error);
  }
  const {default:setupHandler}=await import('../web/api/setups/store.js');
  server=createPreviewServer({config,setupHandler});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  const userClient=createClient(config.url,config.publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const login=await userClient.auth.signInWithPassword(accounts[0]);assert.ok(!login.error);
  const headers={Authorization:`Bearer ${login.data.session.access_token}`,'Content-Type':'application/json'};
  const request=async(method,body,path='')=>{const r=await fetch(origin+'/api/setups/store'+path,{method,headers,...(body?{body:JSON.stringify(body)}:{})});return{status:r.status,body:await r.json()};};
  check((await request('DELETE',{id:'setup-rpc',expectedRevision:0})).status===409,'stale delete is rejected');
  check((await request('DELETE',{id:'setup-rpc',expectedRevision:1,owner_id:accounts[1].owner})).status===200,'API deletes authenticated owner only');
  check((await request('GET',null,'?id=setup-rpc')).status===404,'deleted draft hidden from account read');
  check(!(await request('GET')).body.drafts.some(d=>d.id==='setup-rpc'),'deleted draft hidden from account list');
  const marker=await admin.from('course_setups').select('*').eq('owner_id',accounts[0].owner).eq('id','setup-rpc').single();
  check(marker.data.deleted&&Object.keys(marker.data.payload).length===0,'server marker retains no draft content');
  check((await request('DELETE',{id:'setup-rpc',expectedRevision:1})).body.replayed,'duplicate deletion safely acknowledged');
  const draft=setupDraft('Late autosave');draft.brief.audience='QA';const {payload}=await prepareAccountPayload(draft);
  for(const expectedRevision of [0,1,2])check((await request('POST',{id:'setup-rpc',expectedRevision,payload})).body.code==='deleted',`late save revision ${expectedRevision} cannot resurrect draft`);
  check(!!(await userClient.rpc('delete_course_setup',{p_owner:accounts[1].owner,p_id:'setup-keep',p_expected:1})).error,'browser cannot invoke privileged deletion RPC');
  check(!!(await userClient.rpc('commit_live_course_setup',{p_owner:accounts[0].owner,p_id:'setup-rpc',p_expected:2,p_payload:payload,p_hash:'0'.repeat(64)})).error,'browser cannot bypass deleted marker through old save function');
  check(!(await admin.from('course_setups').select('deleted').eq('owner_id',accounts[1].owner).eq('id','setup-rpc').single()).data.deleted,'same ID in other account preserved');
  await command(['open',origin+'/?experience=workspace&filter=mine']);await command(['snapshot']);
  const script=readFileSync(new URL('./qa-draft-deletion.browser.js',import.meta.url),'utf8').replace('__DRAFT_DELETE_QA__',JSON.stringify({origin,accounts,authModule:modulePath('auth'),storeModule:modulePath('draft-store'),modelModule:modulePath('setup-model')}));
  console.log(await command(['run-code',script]));
  check((await command(['eval','window.__draftDeleteReport'])).includes('"total"'),'browser report complete');
  for(const account of accounts)check(!!(await admin.from('user_courses').select('id').eq('owner_id',account.owner).eq('id','deletion-sentinel').single()).data,'saved course preserved');
  check(!(await admin.from('course_setups').select('deleted').eq('owner_id',accounts[1].owner).eq('id','setup-delete').single()).data.deleted,'other account draft preserved after UI deletion');
  console.log(`Draft deletion: ${checks} actual backend checks passed. No production or paid calls.`);
}catch(error){console.log(await command(['snapshot']).catch(()=>'Snapshot unavailable'));throw error;}
finally{
  await command(['close']).catch(()=>{});if(server)await new Promise(resolve=>server.close(resolve));
  for(const account of accounts)assert.ok(!(await admin.auth.admin.deleteUser(account.owner)).error);
  console.log('Removed only disposable draft-deletion QA accounts and their fixtures.');
}
