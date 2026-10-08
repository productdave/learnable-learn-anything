// Synthetic storage/acceptance fixture. Never calls an image provider.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {syntheticPNG} from './generated-image.mjs';
import {decodeImagePNG} from '../../web/api/_lib/openai-image.mjs';
import {inspectImageLesson,startImageRequest,runImageRequest} from '../../web/api/_lib/image-request.mjs';
import {acceptCourseImage} from '../../web/api/_lib/image-acceptance.mjs';
import {imageAssetPath,IMAGE_BUCKET} from '../../web/api/_lib/image-request-store.mjs';
import {PUBLICATION_IMAGE_BUCKET} from '../../web/api/_lib/publication-images.mjs';

export async function seedAcceptedPublicationImage(db,ownerId,courseId,{expectedRequestId=null,accept=true}={}) {
  const args={supabase:db,ownerId,courseId,target:{moduleId:'foundations',topicId:'lesson-1'},env:{LEARNABLE_GPT_IMAGES:'1'}},quote=await inspectImageLesson(args),operationId=randomUUID();
  await startImageRequest({...args,operationId,expectedRequestId,slot:'instruction',prompt:'PRIVATE-IMAGE-PROMPT-SENTINEL',alt:'Synthetic gray square for image transport testing.',baseHash:quote.baseHash,fundingHash:quote.funding.hash,consent:true,acknowledgePossibleCharge:true});
  await runImageRequest({...args,operationId,generate:async()=>({asset:decodeImagePNG(syntheticPNG({text:'PRIVATE-PNG-METADATA-SENTINEL'}).toString('base64')),provenance:{...quote.funding,requestId:'PRIVATE-PROVIDER-SENTINEL',usage:null}})});
  if(accept)await acceptCourseImage({...args,operationId,acceptanceId:randomUUID(),alt:'Synthetic gray square for image transport testing.',caption:'Synthetic QA image; not a generated teaching example.',reviewed:true});
  return (await db.from('course_image_requests').select('*').eq('owner_id',ownerId).eq('id',operationId).single()).data;
}
export async function cleanupPublicationImageFixtures(db,owner,extraPaths=[]) {
  const rows=await db.from('course_image_requests').select('*').eq('owner_id',owner);assert.ok(!rows.error);
  const privatePaths=rows.data.filter(r=>r.payload.asset).map(imageAssetPath);
  if(privatePaths.length)assert.ok(!(await db.storage.from(IMAGE_BUCKET).remove(privatePaths)).error);
  const publications=await db.from('course_publications').select('snapshot').eq('owner_id',owner);assert.ok(!publications.error);
  const paths=new Set(extraPaths);
  for(const p of publications.data)for(const m of p.snapshot.modules)for(const t of m.topics)for(const s of t.sections)if(s.public_image)paths.add(s.public_image.id+'.png');
  if(paths.size)assert.ok(!(await db.storage.from(PUBLICATION_IMAGE_BUCKET).remove([...paths])).error);
}
