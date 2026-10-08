// Disposable accounts in Docker-local Supabase only. No paid image call.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig } from './dev-setup-server.mjs';
import { curriculumFixture,lessonFixture } from './fixtures/component-course.mjs';
import { retainComponentChoices } from '../web/js/generator/component-policy.mjs';
import { assembleCourse } from '../web/js/generator/assemble-course.js';
import { syntheticPNG } from './fixtures/generated-image.mjs';
import { decodeImagePNG } from '../web/api/_lib/openai-image.mjs';
import { imageRequestStore,imageAssetPath,IMAGE_BUCKET } from '../web/api/_lib/image-request-store.mjs';
import { inspectImageLesson,startImageRequest,runImageRequest,discardImageRequest,cleanupImageCandidate,readImageAsset } from '../web/api/_lib/image-request.mjs';
import { acceptCourseImage } from '../web/api/_lib/image-acceptance.mjs';
import { proposeCourseRefinement } from '../web/api/_lib/course-refinement.mjs';
import { commitCourseRow } from '../web/api/_lib/course-commit.mjs';

const config=await loadPreviewConfig(new URL('../.env.preview.local',import.meta.url));
assert.equal(config.mode,'local');assert.equal(config.url,'http://127.0.0.1:54321');
const admin=createClient(config.url,config.secretKey,{auth:{persistSession:false,autoRefreshToken:false}}),accounts=[];
let checks=0,calls=0; const check=(test,label)=>{assert.ok(test,label);checks++;};
const rejects=async(promise,code)=>{await assert.rejects(promise,e=>e.code===code);checks++;};
const courseId='image-acceptance-qa',target={moduleId:'foundations',topicId:'lesson-1'},env={LEARNABLE_GPT_IMAGES:'1'};
const generate=async()=>{calls++; const funding=(await inspectImageLesson(args)).funding;return{asset:decodeImagePNG(syntheticPNG().toString('base64')),provenance:{...funding,requestId:'req_acceptance_test',usage:null}};};
let args;
try {
  for(let i=0;i<2;i++){
    const email=`image-accept-${randomUUID()}@example.test`,password=`${randomUUID()}Aa9!`;
    const made=await admin.auth.admin.createUser({email,password,email_confirm:true});assert.ok(!made.error);accounts.push({owner:made.data.user.id,email,password});
    const brief=retainComponentChoices(curriculumFixture(),{components:['lessons','practice','checklists','quizzes','flashcards']});
    const course=assembleCourse(brief,brief.modules.flatMap(mod=>mod.topics.map(topic=>({moduleId:mod.id,topicId:topic.id,content:lessonFixture(brief.components,topic)}))));course.config.id=courseId;
    assert.ok(!(await admin.from('user_courses').insert({owner_id:made.data.user.id,id:courseId,payload:course})).error);
  }
  const store=imageRequestStore(admin);args={supabase:admin,ownerId:accounts[0].owner,courseId,env,target,generate};
  const candidate=async(expectedRequestId=null)=>{
    const quote=await inspectImageLesson(args),operationId=randomUUID();
    await startImageRequest({...args,operationId,expectedRequestId,slot:'instruction',prompt:'Compare directional window light.',alt:'Window light on an object.',baseHash:quote.baseHash,fundingHash:quote.funding.hash,consent:true,acknowledgePossibleCharge:true});
    const result=await runImageRequest({...args,operationId});check(result.request.status==='ready','candidate stored');return operationId;
  };
  let operationId=await candidate();const before=await store.course(args.ownerId,courseId);
  const accept={...args,operationId,acceptanceId:randomUUID(),alt:'Soft light enters from the left and casts a shadow to the right.',caption:'Compare the light and shadow.',reviewed:true};
  await rejects(acceptCourseImage({...accept,reviewed:false}),'review');
  await rejects(acceptCourseImage({...accept,alt:'🙂'.repeat(301)}),'review');
  await rejects(acceptCourseImage({...accept,caption:'x'.repeat(501)}),'review');
  await rejects(acceptCourseImage({...accept,ownerId:accounts[1].owner}),'not_found');
  await rejects(acceptCourseImage({...accept,assets:{read:async()=>null}}),'asset');
  const forged={...before.payload.modules[1]['lesson-1'],sections:[...before.payload.modules[1]['lesson-1'].sections,{type:'image',asset_id:operationId,image_slot:'instruction',generated_by:'openai',alt:'x'}]};
  assert.throws(()=>proposeCourseRefinement(before.payload,{...target,kind:'lesson'},forged),e=>e.code==='media');checks++;
  const sdk=createClient(config.url,config.publicKey,{auth:{persistSession:false,autoRefreshToken:false}});await sdk.auth.signInWithPassword(accounts[0]);
  check(!!(await sdk.rpc('accept_course_image',{p_owner:args.ownerId,p_id:operationId,p_course:courseId,p_revision:1,p_updated_at:before.updated_at,p_payload:{},p_operation:randomUUID(),p_hash:'x'})).error,'browser role cannot call privileged acceptance');
  const [a,b]=await Promise.all([acceptCourseImage(accept),acceptCourseImage(accept)]);
  check(a.saved&&b.saved&&[a,b].filter(r=>r.replayed).length===1,'concurrent same acceptance commits once and replays');
  const saved=await store.course(args.ownerId,courseId),image=saved.payload.modules[1]['lesson-1'].sections.find(s=>s.asset_id);
  check(image.asset_id===operationId&&image.alt===accept.alt&&!image.src,'saved stable private identity and reviewed alt text');
  assert.deepEqual(saved.payload.modules[1]['lesson-2'],before.payload.modules[1]['lesson-2']);checks++;
  assert.deepEqual(saved.payload.modules[1]['lesson-1'].sections.filter(s=>s.type!=='image'),before.payload.modules[1]['lesson-1'].sections);checks++;
  check(saved.payload.modules[1]['lesson-1']._contentRevision!==before.payload.modules[1]['lesson-1']._contentRevision,'changed lesson revision updated');
  check((await store.get(args.ownerId,operationId)).accepted,'receipt and lesson atomically accepted');
  await rejects(discardImageRequest({...args,operationId}),'referenced');await rejects(cleanupImageCandidate({...args,operationId}),'referenced');
  await rejects(acceptCourseImage({...accept,acceptanceId:randomUUID()}),'conflict');
  const next=await candidate(operationId);check((await store.course(args.ownerId,courseId)).payload.modules[1]['lesson-1'].sections.find(s=>s.asset_id).asset_id===operationId,'new candidate leaves old accepted image in place');
  const nextAccept={...accept,operationId:next,acceptanceId:randomUUID(),alt:'Second version of directional light.'};
  await acceptCourseImage(nextAccept);
  const replaced=await store.course(args.ownerId,courseId);
  check(replaced.payload.modules[1]['lesson-1'].sections.filter(s=>s.asset_id).length===1&&replaced.payload.modules[1]['lesson-1'].sections.find(s=>s.asset_id).asset_id===next,'explicit replacement does not accumulate generated image slots');
  check((await readImageAsset({...args,operationId})).bytes.length>0,'old accepted bytes retained for history');
  check((await acceptCourseImage(accept)).payload.modules[1]['lesson-1'].sections.find(s=>s.asset_id).asset_id===next,'late replay never reinstates older accepted image');
  await rejects(discardImageRequest({...args,operationId}),'referenced');
  operationId=await candidate(next);
  const stale=await store.course(args.ownerId,courseId);stale.payload.modules[1]['lesson-1'].title='Newer lesson';
  check(!!(await commitCourseRow({supabase:admin,ownerId:args.ownerId,courseId,row:stale,payload:stale.payload})),'newer lesson committed with its original revision');
  await rejects(acceptCourseImage({...accept,operationId,acceptanceId:randomUUID()}),'stale');
  await discardImageRequest({...args,operationId});await rejects(acceptCourseImage({...accept,operationId,acceptanceId:randomUUID()}),'conflict');
  const last=await candidate(operationId);
  // Interleave an unrelated course write between validation and atomic acceptance.
  const raceStore={...store,accept:async(row,course,payload,id,hash)=>{
    const newer=structuredClone(course.payload);newer.config.subtitle='Concurrent account edit';
    check(!!(await commitCourseRow({supabase:admin,ownerId:args.ownerId,courseId,row:course,payload:newer})),'concurrent edit committed with its original revision');
    return store.accept(row,course,payload,id,hash);
  }};
  await rejects(acceptCourseImage({...accept,operationId:last,acceptanceId:randomUUID(),store:raceStore}),'conflict');
  check(!(await store.get(args.ownerId,last)).accepted,'losing acceptance does not mark receipt accepted');
  check((await store.course(args.ownerId,courseId)).payload.config.subtitle==='Concurrent account edit','concurrent course edit preserved');
  await acceptCourseImage({...accept,operationId:last,acceptanceId:randomUUID()});
  check(calls===4,'accept, replay and reads make no provider calls');
  console.log(`Local image acceptance: ${checks} checks passed; ${calls} synthetic images, no paid calls.`);
} finally {
  for(const account of accounts){
    const rows=await admin.from('course_image_requests').select('*').eq('owner_id',account.owner);assert.ok(!rows.error);
    const paths=rows.data.filter(r=>r.payload.asset).map(imageAssetPath);if(paths.length)assert.ok(!(await admin.storage.from(IMAGE_BUCKET).remove(paths)).error);
    assert.ok(!(await admin.auth.admin.deleteUser(account.owner)).error);
  }
  console.log('Removed only disposable acceptance-QA accounts, courses, receipts and synthetic objects.');
}
