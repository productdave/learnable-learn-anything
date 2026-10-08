// Real isolated-local Auth/HTTP/Postgres/RLS/Storage. Image provider is synthetic.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { createClient } from '@supabase/supabase-js';
import { createPreviewServer, loadPreviewConfig } from './dev-setup-server.mjs';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';
import { assembleCourse } from '../web/js/generator/assemble-course.js';
import { syntheticImageResponse } from './fixtures/generated-image.mjs';

const config = await loadPreviewConfig(new URL('../.env.preview.local',import.meta.url));
assert.equal(config.mode,'local'); assert.equal(config.url,'http://127.0.0.1:54321'); assert.ok(config.vaultKey);
Object.assign(process.env,{SUPABASE_URL:config.url,SUPABASE_ANON_KEY:config.publicKey,SUPABASE_SECRET_KEY:config.secretKey,LEARNABLE_PROVIDER_VAULT_KEY:config.vaultKey});
const { createCourseImageHandler } = await import('../web/api/courses/images.js');
const { sealProviderKey } = await import('../web/api/_lib/provider-vault.mjs');
const { generateCreatorImage } = await import('../web/api/_lib/openai-image.mjs');
const { imageRequestStore,imageAssetStore,imageAssetPath,IMAGE_BUCKET } = await import('../web/api/_lib/image-request-store.mjs');
const { startImageRequest,runImageRequest,getImageRequest,reconcileImageRequest,IMAGE_REQUEST_LEASE_MS } = await import('../web/api/_lib/image-request.mjs');
const admin=createClient(config.url,config.secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
const env={LEARNABLE_GPT_IMAGES:'1'}, users=[], pending=[], reports=[];
let enabled=true, calls=0,checks=0,generateHook=null,release=null;
const check=(value,label)=>{assert.ok(value,label);checks++;};
const courseId='image-request-qa',secret='sk-proj-synthetic-image-local-test-123456789';
const generate=async args=>{
  calls++;
  if(generateHook)await generateHook(args);
  return generateCreatorImage(args,{env,fetcher:async(url,options)=>{
    check(url==='https://api.openai.com/v1/images/generations' && options.headers.Authorization===`Bearer ${secret}`,'real vault supplies synthetic creator key to injected image fetch');
    return new Response(JSON.stringify(syntheticImageResponse()),{headers:{'x-request-id':'req_local_image_request'}});
  }});
};
const handler=createCourseImageHandler({env,enabled:()=>enabled,generate,background:p=>pending.push(p),report:code=>reports.push(code)});
const server=createPreviewServer({config,setupHandler:()=>{},extraHandlers:{'/api/courses/images':handler}});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
const base=`http://127.0.0.1:${server.address().port}/api/courses/images`;
async function account(){
  const email=`${randomUUID()}@example.test`,password=`${randomUUID()}Aa9!`;
  const made=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ok(!made.error);users.push(made.data.user.id);
  const sdk=createClient(config.url,config.publicKey,{auth:{persistSession:false,autoRefreshToken:false}});
  const signed=await sdk.auth.signInWithPassword({email,password});assert.ok(!signed.error);
  const owner=made.data.user.id,token=signed.data.session.access_token;
  const brief=curriculumFixture();const payload=assembleCourse(brief,brief.modules.flatMap(mod=>mod.topics.map(topic=>({moduleId:mod.id,topicId:topic.id,content:lessonFixture(['lessons'],topic)}))));payload.config.id=courseId;
  assert.ok(!(await sdk.from('user_courses').insert({owner_id:owner,id:courseId,payload})).error);
  assert.ok(!(await admin.from('provider_connections').insert({owner_id:owner,provider:'openai',encrypted_key:sealProviderKey(secret,owner,'openai')})).error);
  return {sdk,owner,token,payload,async request(body,query){
    const res=await fetch(base+(query?'?'+new URLSearchParams(query):''),{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,'Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
    check(res.headers.get('cache-control')==='private, no-store','authenticated image HTTP response not cached');
    const data=res.headers.get('content-type')?.startsWith('image/png')?Buffer.from(await res.arrayBuffer()):await res.json();
    return {status:res.status,body:data,headers:res.headers};
  }};
}
const wait=async()=>{await Promise.all(pending.splice(0));};
try{
  const a=await account(),b=await account();
  check((await fetch(base)).status===401,'real unauthenticated route denied');
  const inspect={action:'inspect',courseId,moduleId:'foundations',topicId:'lesson-1'};
  const plan=(await a.request(null,inspect)).body;
  check(plan.funding.funding==='creator'&&plan.funding.n===1&&plan.baseHash.length===64,'server supplies bounded funding quote and saved lesson revision');
  const request={action:'start',courseId,operationId:randomUUID(),expectedRequestId:null,target:{moduleId:'foundations',topicId:'lesson-1'},slot:'instruction',prompt:'Window light on a photography subject.',alt:'Window light on a subject.',consent:true,baseHash:plan.baseHash,fundingHash:plan.funding.hash};
  enabled=false;check((await a.request(request)).status===503 && calls===0,'disabled paid route makes no call');enabled=true;
  check((await a.request({...request,consent:false})).status===400 && calls===0,'server requires funding confirmation');
  const starts=await Promise.all([a.request(request),a.request(request)]);await wait();
  check(starts.every(r=>r.status===202||r.status===200)&&calls===1,'duplicate HTTP starts result in one provider dispatch');
  const current=await a.request(null,{courseId,operationId:request.operationId});
  check(current.status===200&&current.body.request.status==='ready'&&current.body.request.usage.total_tokens===42,'saved request reopens through actual authenticated API');
  const row=(await admin.from('course_image_requests').select('*').eq('owner_id',a.owner).eq('id',request.operationId).single()).data;
  const path=imageAssetPath(row);
  check(!JSON.stringify(row).includes(secret)&&row.payload.quote.funding==='creator','receipt contains payer but no key');
  const asset=await a.request(null,{action:'asset',courseId,operationId:request.operationId});
  check(asset.status===200&&asset.body.length===row.payload.asset.bytes&&asset.headers.get('x-content-type-options')==='nosniff','actual private PNG served after auth');
  check((await b.request(null,{courseId,operationId:request.operationId})).status===404,'other account cannot read receipt, even same course slug');
  check((await b.request(null,{action:'asset',courseId,operationId:request.operationId})).status===404,'other account cannot fetch bytes');
  check((await a.request(null,{action:'list',courseId})).body.requests[0].id===request.operationId,'fresh course request discovery needs no browser-saved ID');
  check((await b.request(null,{action:'list',courseId})).body.requests.length===0,'same course slug in another account has isolated image inventory');
  check(!!(await a.sdk.from('course_image_requests').select('*')).error,'browser cannot read server-only receipt table');
  check(!!(await a.sdk.from('course_image_requests').update({status:'queued'}).eq('id',request.operationId)).error,'browser cannot reset paid request state');
  check(!!(await a.sdk.rpc('begin_course_image_request',{p_owner:a.owner,p_id:randomUUID(),p_course:courseId,p_slot:row.slot_key,p_expected:null,p_payload:{},p_ack:true})).error,'browser cannot call privileged admission RPC');
  const bucket=await admin.storage.getBucket(IMAGE_BUCKET);
  check(!bucket.error&&!bucket.data.public&&Number(bucket.data.file_size_limit)===8388608&&bucket.data.allowed_mime_types.join(',')==='image/png','private PNG bucket with enforced size/type policy');
  check(!!(await a.sdk.storage.from(IMAGE_BUCKET).download(path)).error,'even owner must use authorized asset route, not direct storage');
  check(!!(await b.sdk.storage.from(IMAGE_BUCKET).download(path)).error,'other account direct storage access denied');
  check(!!(await a.sdk.storage.from(IMAGE_BUCKET).upload(`${a.owner}/forged.png`,asset.body,{contentType:'image/png'})).error,'browser cannot forge generated asset');
  check(!!(await a.sdk.storage.from(IMAGE_BUCKET).createSignedUrl(path,60)).error,'browser cannot mint independent signed asset URL');
  const publicURL=admin.storage.from(IMAGE_BUCKET).getPublicUrl(path).data.publicUrl;
  check(!(await fetch(publicURL)).ok,'no public storage bypass');
  const beforeCalls=calls;await a.request({...request,action:'resume'});await wait();
  check(calls===beforeCalls,'reopen/resume after ready is free');
  check(isDeepStrictEqual((await a.sdk.from('user_courses').select('payload').eq('id',courseId).single()).data.payload,a.payload),'generation has not overwritten accepted course');

  // Real SQL serialization of competing replacement IDs.
  const next={...request,operationId:randomUUID(),expectedRequestId:request.operationId};
  check((await a.request(next)).status===409,'new charged attempt requires separate acknowledgement');
  const competitors=await Promise.all([a.request({...next,acknowledgePossibleCharge:true}),a.request({...next,operationId:randomUUID(),acknowledgePossibleCharge:true})]);await wait();
  check(competitors.filter(r=>r.status===202||r.status===200).length===1&&competitors.filter(r=>r.status===409).length===1,'real SQL admits one current replacement');
  check(calls===2&&(await admin.storage.from(IMAGE_BUCKET).download(path)).data?.size===asset.body.length,'new attempt retains original saved image');
  const winner=competitors.find(r=>r.status!==409).body.request.id;
  await a.request({action:'discard',courseId,operationId:winner});
  check((await a.request({action:'cleanup',courseId,operationId:winner})).body.removed,'discarded settled candidate explicitly removed');
  check((await a.request(null,{action:'asset',courseId,operationId:winner})).status===404,'discarded candidate cannot be previewed');
  check((await admin.storage.from(IMAGE_BUCKET).download(path)).data?.size===asset.body.length,'cleanup leaves previous image intact');

  // Late provider result after actual HTTP cancellation.
  let entered=false;
  generateHook=async()=>{entered=true;await new Promise(resolve=>{release=resolve;});};
  const cancelled={...request,operationId:randomUUID(),slot:'cancel-test'};
  await a.request(cancelled);
  for(let i=0;i<100&&!entered;i++)await new Promise(resolve=>setTimeout(resolve,10));
  check(entered,'synthetic generation in flight');
  check((await a.request({...cancelled,action:'cancel'})).body.request.status==='cancelled','actual cancellation persisted');
  release();release=null;generateHook=null;await wait();
  const late=(await a.request(null,{courseId,operationId:cancelled.operationId})).body.request;
  check(late.status==='cancelled'&&late.usage.total_tokens===42&&!late.asset,'late result records cost usage without undoing cancellation');
  const cancelledRow=(await admin.from('course_image_requests').select('*').eq('owner_id',a.owner).eq('id',cancelled.operationId).single()).data;
  check(!cancelledRow.payload.asset&&cancelledRow.payload.workerDone,'cancelled before upload creates no orphan');

  // Real durable write, then simulated lost reply. Never infer permission to resend.
  const real=imageRequestStore(admin),baseArgs={supabase:admin,ownerId:a.owner,courseId,env,generate};
  const lost={...request,operationId:randomUUID(),slot:'lost-cas'};
  await startImageRequest({...baseArgs,...lost});
  const lostStore={...real,async update(r,p){const saved=await real.update(r,p);if(p.status==='running'&&saved)throw new Error('synthetic lost commit reply');return saved;}};
  const beforeLost=calls;await assert.rejects(runImageRequest({...baseArgs,operationId:lost.operationId,store:lostStore}));checks++;
  const expired=await reconcileImageRequest({...baseArgs,operationId:lost.operationId,now:()=>Date.now()+IMAGE_REQUEST_LEASE_MS+1000});
  check(expired.request.status==='unknown'&&calls===beforeLost,'committed but unacknowledged dispatch never calls provider');
  await runImageRequest({...baseArgs,operationId:lost.operationId});check(calls===beforeLost,'unknown never automatically replays');

  // Real private upload, lost reply, then exact immutable-object recovery.
  const upload={...request,operationId:randomUUID(),slot:'lost-upload'};await startImageRequest({...baseArgs,...upload});
  const actualAssets=imageAssetStore(admin),lostAsset={...actualAssets,async put(r,bytes){await actualAssets.put(r,bytes);throw new Error('synthetic lost upload reply');}};
  check((await runImageRequest({...baseArgs,operationId:upload.operationId,assets:lostAsset})).request.status==='ready','real stored image recovered despite lost upload response');
  const uploadRow=(await real.get(a.owner,upload.operationId));
  check((await actualAssets.read(uploadRow)).sha256===uploadRow.payload.asset.sha256,'stored binary digest verified on fresh read');
  const altered={...uploadRow,payload:{...uploadRow.payload,asset:{...uploadRow.payload.asset,bytes:uploadRow.payload.asset.bytes+1}}};
  await assert.rejects(actualAssets.read(altered),e=>e.code==='asset');checks++;
  const noAssetRow={...uploadRow,id:randomUUID()};check((await actualAssets.read(noAssetRow))===null,'missing object recognized without accepting empty bytes');
  enabled=false;
  check((await a.request(null,{action:'asset',courseId,operationId:upload.operationId})).status===200,'pausing generation does not revoke existing private images');
  check((await a.request({...request,operationId:randomUUID(),slot:'disabled'})).status===503,'paused generation blocks new costs');
  check(reports.length===0,'no unexpected background failures in HTTP flow');
  console.log(`Local durable images: ${checks} checks passed. Real Auth/HTTP/Postgres/RLS/Storage; ${calls} synthetic provider calls. No paid requests or UI enablement.`);
}finally{
  release?.();await Promise.allSettled(pending);
  await new Promise(resolve=>server.close(resolve));
  if(users.length){
    const rows=await admin.from('course_image_requests').select('*').in('owner_id',users);assert.ok(!rows.error);
    const paths=rows.data.filter(r=>r.payload.asset).map(imageAssetPath);
    if(paths.length)assert.ok(!(await admin.storage.from(IMAGE_BUCKET).remove(paths)).error);
    for(const owner of users){assert.ok(!(await admin.auth.admin.deleteUser(owner)).error);}
  }
  console.log('Removed only this run’s temporary local accounts, synthetic receipts, courses and image objects. No existing user work was changed.');
}
