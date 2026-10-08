// Scoped hosted acceptance. Disposable fixtures only, no provider credentials,
// paid AI requests, public publishing, production origin, or real emails.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { functionGroups } from './packaging/grouped-manifest.mjs';
import { pdfFixture, docxFixture } from './fixtures/source-documents.mjs';
import { curriculumFixture } from './fixtures/component-course.mjs';
import { sealProviderKey } from '../web/api/_lib/provider-vault.mjs';

const base='https://learnable-staging.vercel.app', directory=new URL('../output/staging/2026-09-18/',import.meta.url);
const deployment=process.argv[2];assert.match(deployment||'',/^dpl_[A-Za-z0-9]+$/,'Supply the current staging deployment ID.');
const deployed=JSON.parse(execFileSync('vercel',['api',`/v13/deployments/${deployment}?teamId=team_ONTVy4HempTg7uINmG0C8P3N`],{encoding:'utf8',stdio:['ignore','pipe','pipe']}));
assert.equal(deployed.projectId,'prj_nphig6i4hA9E8o9Wg3nhzxyP1krB');assert.equal(deployed.readyState,'READY');assert.ok(deployed.alias.includes('learnable-staging.vercel.app'));
const state=JSON.parse(readFileSync(new URL('state.json',directory))),secrets=JSON.parse(readFileSync(new URL('secrets.json',directory)));
assert.equal(state.ref,'dmnwkrybgggbpqpetuub');assert.equal(state.supabaseUrl,'https://dmnwkrybgggbpqpetuub.supabase.co');
const checks=[],accounts=[],objects=[];let failure;
const check=(condition,label)=>{assert.ok(condition,label);checks.push(label);console.log('Passed: '+label);};
const confinedFetch=(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url||input.href);
  assert.ok([base,state.supabaseUrl].includes(url.origin),'Only isolated staging traffic allowed');
  return fetch(input,{...init,redirect:'error',signal:AbortSignal.timeout(45000)});
};
const options={auth:{persistSession:false,autoRefreshToken:false},global:{fetch:confinedFetch}};
const admin=createClient(state.supabaseUrl,secrets.secretKey,options);
async function request(path,{method='GET',token,body}={}){
  const res=await confinedFetch(base+path,{method,headers:{...(token?{Authorization:'Bearer '+token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  const text=await res.text();let data;try{data=JSON.parse(text);}catch{}
  return {status:res.status,data,text,headers:res.headers};
}
const jobId='staging-docs-'+randomUUID(),setupId='staging-setup-'+randomUUID();
try {
  const health=await request('/api/health/cloud');check(health.status===200&&health.data.ok,'hosted cloud health and schema ready');
  const favicon=await request('/favicon.svg');
  check(favicon.status===200&&favicon.headers.get('content-type')?.includes('image/svg+xml'),'hosted favicon is served as SVG');
  check(createHash('sha256').update(favicon.text).digest('hex')===createHash('sha256').update(readFileSync(new URL('web/favicon.svg',directory))).digest('hex'),'hosted favicon matches frozen source bytes');
  for(const suffix of ['.js','/']){
    const value=await request('/api/health/cloud'+suffix+'?probe=one&probe=two');
    check(value.status===200&&value.data.ok,'health alias and query dispatch '+suffix);
  }
  for(const group of functionGroups)for(const route of group.routes){
    const value=await request('/api/'+route,{method:'OPTIONS'});
    const source=readFileSync(new URL(`../output/staging/2026-09-18/web/api/${route}.js`,import.meta.url),'utf8');
    const expected=['courses/refine','courses/proposal','courses/community','courses/publication-status','courses/publish','courses/public-image','courses/moderation'].includes(route)?503:/req.method === 'OPTIONS'/.test(source)?204:405;
    check(value.status===expected&&(expected===204||!!value.data),`hosted method routing: ${route} (${value.status}, expected ${expected})`);
  }
  for(const path of ['/_functions/health','/_functions/images','/api/_lib/supabase-server.mjs','/api/_grouped/health.js','/.vercel/output/config.json','/node_modules/@supabase/supabase-js/package.json','/api/not-a-route']){
    check((await request(path)).status===404,'private or unknown path denied: '+path);
  }
  for(const [path,method]of [['/api/setups/store','GET'],['/api/gen/start','POST'],['/api/providers/connection','GET'],['/api/gen/sources','POST'],['/api/gen/sweep','GET']]){
    check((await request(path,{method,body:method==='POST'?{}:undefined})).status===401,'anonymous access denied: '+path);
  }
  const users=await admin.auth.admin.listUsers();assert.ok(!users.error&&users.data.users.length===0,'This verifier requires empty isolated staging');
  const jobs=await admin.from('generation_jobs').select('id');assert.ok(!jobs.error&&!jobs.data.length,'No pre-existing staging jobs');
  const sweep=await request('/api/gen/sweep',{token:secrets.cronSecret});
  check(sweep.status===200&&sweep.data.ok&&sweep.data.claimed.length===0,'authorized empty cron sweep; no model work');
  for(let i=0;i<2;i++){
    const email='hosted-runtime-'+randomUUID()+'@example.test',password=randomUUID()+'Aa9!';
    const made=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ok(!made.error);
    const account={owner:made.data.user.id};accounts.push(account);
    account.sdk=createClient(state.supabaseUrl,secrets.publicKey,options);
    const login=await account.sdk.auth.signInWithPassword({email,password});assert.ok(!login.error);
    account.token=login.data.session.access_token;
  }
  const [a,b]=accounts;
  const payload={schemaVersion:1,brief:{topic:'Disposable hosted document QA',audience:'QA only',goal:'Read sources safely',starting_point:'Beginner',context:'Synthetic text',depth:'single_module',experience:'understand'},components:['lessons'],sources:{notes:[{id:'note',title:'Transcript',text:'Synthetic plain text.'}],links:[],files:[]}};
  const saved=await request('/api/setups/store',{method:'POST',token:a.token,body:{id:setupId,expectedRevision:0,payload}});
  check(saved.status===200&&saved.data.revision===1,'authenticated setup save through actual hosted Node helpers');
  const read=await request('/api/setups/store.js?id='+setupId,{token:a.token});
  check(read.status===200&&read.data.id===setupId&&read.data.payload.brief.topic===payload.brief.topic,'query and .js alias preserve exact saved setup');
  check((await request('/api/setups/store?id='+setupId,{token:b.token})).status===404,'second account cannot read saved setup through API');
  const conflict=await request('/api/setups/store',{method:'POST',token:a.token,body:{id:setupId,expectedRevision:0,payload:{...payload,brief:{...payload.brief,topic:'Stale competing edit'}}}});
  check(conflict.status===409,'stale hosted setup write rejected');
  const connected=await request('/api/providers/connection',{token:a.token});
  check(connected.status===200&&connected.data.connected===false,'hosted vault read returns no connection without exposing secrets');
  const gated=await request('/api/setups/generate',{method:'POST',token:a.token,body:{id:setupId,revision:1,hash:read.data.content_hash,action:'check'}});
  check(gated.status===200&&!gated.data.enabled&&!gated.data.connected&&!gated.data.ready,'creation preflight honestly reports disabled and missing provider');
  // A synthetic, non-provider credential proves the deployed vault can decrypt.
  // Only GET/DELETE are used: neither route validates or calls the provider.
  process.env.LEARNABLE_PROVIDER_VAULT_KEY=secrets.vaultKey;
  const sealed=sealProviderKey('non-billable-hosted-vault-fixture',a.owner);
  const insertedKey=await admin.from('provider_connections').insert({owner_id:a.owner,provider:'anthropic',encrypted_key:sealed});assert.ok(!insertedKey.error);
  const vault=await request('/api/providers/connection',{token:a.token});
  check(vault.status===200&&vault.data.connected===true&&!vault.text.includes(sealed),'deployed vault decrypts synthetic connection without exposing it');
  const removedKey=await request('/api/providers/connection',{method:'DELETE',token:a.token});
  check(removedKey.status===200&&removedKey.data.connected===false,'synthetic connection is removed through owner API');
  const runId=randomUUID(),sources={notes:[],links:[],files:[]};
  for(const [id,name,bytes,type]of [
    ['pdf','pages.pdf',pdfFixture(['Hosted first page','Hosted second page']),'application/pdf'],
    ['docx','transcript.docx',docxFixture(['Hosted Word café 日本語']),'application/vnd.openxmlformats-officedocument.wordprocessingml.document'],
    ['txt','notes.txt',Buffer.from('Hosted plain transcript café 日本語'),'text/plain']]){
    const sha256=createHash('sha256').update(bytes).digest('hex'),path=`${a.owner}/${jobId}/${id}/${sha256}`;
    const uploaded=await a.sdk.storage.from('setup-sources').upload(path,bytes,{contentType:type,upsert:false});assert.ok(!uploaded.error);objects.push(path);
    sources.files.push({id,name,size:bytes.length,sha256});
  }
  const inserted=await admin.from('generation_jobs').insert({id:jobId,owner_id:a.owner,status:'review_research',stage:'research',run_id:runId,brief:curriculumFixture(),research:{},user_brief:{...payload.brief,components:['lessons'],source_manifest:sources,source_storage_id:jobId}});assert.ok(!inserted.error);
  const checked=await request('/api/gen/sources',{method:'POST',token:a.token,body:{jobId,action:'check',expectedRunId:runId,sources}});
  check(checked.status===200&&checked.data.sources.complete&&!checked.data.issues.length,'hosted source readers extract private files without AI');
  for(const [id,text]of [['pdf','Hosted second page'],['docx','Hosted Word café 日本語'],['txt','Hosted plain transcript café 日本語']]){
    check(checked.data.sources.files.some(file=>file.id===id&&file.text.includes(text)),'actual hosted document extraction '+id);
  }
  check((await request('/api/gen/sources',{method:'POST',token:b.token,body:{jobId,action:'read'}})).status===404,'second account cannot read hosted source job');
  const unchanged=await admin.from('generation_jobs').select('run_id,status,research').eq('id',jobId).single();
  check(!unchanged.error&&unchanged.data.run_id===runId&&unchanged.data.status==='review_research','source checking does not start generation or replace accepted research');
  const deleted=await request('/api/setups/store',{method:'DELETE',token:a.token,body:{id:setupId,expectedRevision:1}});
  check(deleted.status===200&&deleted.data.deleted,'own disposable setup can be deleted through hosted API');
  const replay=await request('/api/setups/store',{method:'POST',token:a.token,body:{id:setupId,expectedRevision:0,payload}});
  check(replay.status===409&&replay.data.code==='deleted','deleted setup tombstone prevents stale resurrection');
}catch(error){failure=error.message;console.error('Hosted check failed: '+failure);}
finally{
  if(objects.length)assert.ok(!(await admin.storage.from('setup-sources').remove(objects)).error);
  for(const account of accounts){
    assert.ok(!(await admin.from('generation_jobs').delete().eq('id',jobId).eq('owner_id',account.owner)).error);
    assert.ok(!(await admin.auth.admin.deleteUser(account.owner)).error);
  }
}
const report={at:new Date().toISOString(),base,stagingRef:state.ref,deployment,checks,count:checks.length,passed:!failure,failure,cleanedUp:true,limitations:['No paid provider, email delivery, background waitUntil lifetime, scheduled cron firing or physical-phone acceptance.']};
const file=new URL(`hosted-runtime-qa-${Date.now()}.json`,directory);writeFileSync(file,JSON.stringify(report,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({passed:!failure,checks:checks.length,report:file.pathname,cleanedUp:true}));if(failure)process.exitCode=1;
