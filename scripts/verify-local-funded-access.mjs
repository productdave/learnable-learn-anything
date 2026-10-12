// Real local Auth + JWT-scoped PostgREST + RLS. The migration is applied to
// uniquely named test tables/functions, then removed; shared app tables remain.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig } from './dev-setup-server.mjs';
const config=await loadPreviewConfig(process.argv[2] || new URL('../.env.preview.local',import.meta.url));
assert.equal(config.mode,'local');assert.equal(config.url,'http://127.0.0.1:54321');
Object.assign(process.env,{SUPABASE_URL:config.url,SUPABASE_ANON_KEY:config.publicKey,LEARNABLE_FUNDED_ACCESS:'pilot'});
const {createAccountAccessHandler}=await import('../web/api/account/access.js');
const {readFundedAccess}=await import('../web/api/_lib/funded-access.mjs');
const admin=createClient(config.url,config.secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
const prefix='qa_f01_'+randomUUID().replaceAll('-','').slice(0,12);
const names={learnable_funding_accounts:prefix+'_accounts',learnable_credit_grants:prefix+'_grants',grant_learnable_credits:prefix+'_grant',learnable_account_access:prefix+'_access',learnable_credit_grants_owner:prefix+'_index'};
const sql=q=>execFileSync('docker',['exec','-i','supabase_db_learnable-setup-local','psql','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1','-At','-c',q],{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const users=[];let checks=0,created=false;
const check=(value,label)=>{assert.ok(value,label);checks++;};
const sdk=()=>createClient(config.url,config.publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
const response=()=>({code:null,body:null,setHeader(){},status(n){this.code=n;return this;},json(data){this.body=data;return this;}});
try{
 let migration=readFileSync(new URL('../db/26-funded-account-access.sql',import.meta.url),'utf8');
 for(const [original,replacement]of Object.entries(names).sort((a,b)=>b[0].length-a[0].length))migration=migration.replaceAll(original,replacement);
 sql(migration);created=true;sql("notify pgrst, 'reload schema'");
 for(let i=0;i<2;i++){
  const email=`${prefix}-${i}@example.test`,password=randomUUID()+'Aa9!';const made=await admin.auth.admin.createUser({email,password,email_confirm:true});check(!made.error&&made.data.user,'create disposable local identity');users.push({id:made.data.user.id,email,password,client:sdk()});
  const u=users.at(-1),login=await u.client.auth.signInWithPassword({email,password});check(!login.error&&login.data.session,'real password session');u.token=login.data.session.access_token;
  sql(`insert into public.${names.learnable_funding_accounts}(owner_id,mode) values('${u.id}','platform'); select public.${names.grant_learnable_credits}('${u.id}','${randomUUID()}',${i?70:500},'Disposable local QA');`);
 }
 const handler=createAccountAccessHandler({read:(client,owner)=>readFundedAccess({rpc:(_name,args)=>client.rpc(names.learnable_account_access,args)},owner)});
 const call=async(token,query={})=>{const res=response();await handler({method:'GET',headers:{authorization:'Bearer '+token},query},res);return res;};
 // Schema cache reload is asynchronous. Retry only the read, never grants.
 let ready;for(let i=0;i<20;i++){ready=await call(users[0].token);if(ready.code===200)break;await new Promise(r=>setTimeout(r,100));}
 check(ready.code===200&&ready.body.balance.available===500,'verified JWT reads first real balance');
 check((await call(users[1].token,{owner:users[0].id})).body.balance.available===70,'second JWT ignores spoofed first owner');
 const direct=await users[0].client.rpc(names.learnable_account_access,{p_owner_id:users[1].id});check(!direct.error&&direct.data===null,'cross-owner RPC denied by actual PostgREST RLS');
 const grants=await users[0].client.from(names.learnable_credit_grants).select('*');check(!grants.error&&grants.data.length===1&&grants.data[0].owner_id===users[0].id,'direct grant read RLS');
 check(!!(await users[0].client.from(names.learnable_funding_accounts).update({mode:'legacy'}).eq('owner_id',users[0].id)).error,'browser cannot downgrade account');
 check(!!(await users[0].client.rpc(names.grant_learnable_credits,{p_owner_id:users[0].id,p_grant_key:randomUUID(),p_credits:500,p_reason:'spoof'})).error,'browser cannot mint');
 check(!!(await admin.rpc(names.grant_learnable_credits,{p_owner_id:users[0].id,p_grant_key:randomUUID(),p_credits:500,p_reason:'spoof'})).error,'runtime service role cannot mint');
 for(const state of ['paused','revoked']){sql(`update public.${names.learnable_funding_accounts} set state='${state}' where owner_id='${users[0].id}'`);const result=await call(users[0].token);check(result.body.status===state&&result.body.canCreate===false,'real '+state+' access');}
 sql(`update public.${names.learnable_funding_accounts} set state='active',expires_at=now()-interval '1 minute' where owner_id='${users[0].id}'`);check((await call(users[0].token)).body.status==='expired','expired access');
 const device=sdk();const login=await device.auth.signInWithPassword({email:users[1].email,password:users[1].password});check(!login.error&&(await call(login.data.session.access_token)).body.balance.available===70,'second device sees same server balance');
 sql(`delete from public.${names.learnable_credit_grants} where owner_id='${users[1].id}'`);check((await call(users[1].token)).body.status==='empty','real zero grant balance');
 sql(`delete from public.${names.learnable_funding_accounts} where owner_id='${users[1].id}'`);const missing=await call(users[1].token);check(missing.body.status==='not_invited'&&missing.body.balance===null,'real missing invitation is unknown');
 sql(`insert into public.${names.learnable_funding_accounts}(owner_id,mode) values('${users[1].id}','legacy')`);check((await call(users[1].token)).body.mode==='legacy','real legacy account preserved');
 sql(`update public.${names.learnable_funding_accounts} set state='active',expires_at=null where owner_id='${users[0].id}'`);process.env.LEARNABLE_FUNDED_ACCESS='legacy';const off=await call(users[0].token);check(off.body.mode==='platform'&&off.body.status==='paused','real enrolled mode survives rollout off');
 check((await call('invalid')).code===401,'invalid JWT denied');
 console.log(JSON.stringify({status:'passed',checks,auth:'two disposable real local users and a second session',database:'namespaced migration through real PostgREST RLS',providerCalls:0,hostedChanges:0}));
}finally{
 if(created){sql(`drop function public.${names.learnable_account_access}(uuid); drop function public.${names.grant_learnable_credits}(uuid,uuid,integer,text); drop table public.${names.learnable_credit_grants}; drop table public.${names.learnable_funding_accounts}; notify pgrst, 'reload schema';`);}
 for(const u of users){const deleted=await admin.auth.admin.deleteUser(u.id);assert.ok(!deleted.error,'remove only disposable QA user');}
}
