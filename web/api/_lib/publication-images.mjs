import { createHash } from 'node:crypto';
import { imageRequestStore, imageAssetStore } from './image-request-store.mjs';
import { decodeImagePNG } from './openai-image.mjs';

export const PUBLICATION_IMAGE_BUCKET = 'publication-images';
export const publicImagesEnabled = () => process.env.LEARNABLE_PUBLIC_IMAGES === '1';
export const imageKey = (mi,ti,si) => `${mi}:${ti}:${si}`;
const digest = value => createHash('sha256').update(value).digest('hex');
const hex = value => /^[a-f0-9]{64}$/.test(value || '');
const fail = (message, statusCode=409) => { throw Object.assign(new Error(message), {code:'publication_image',statusCode}); };

// Preserve the encoded pixels/transparency and bounded color hints, but never
// publish textual/EXIF/provider metadata hidden inside otherwise valid PNGs.
export function publicPNG(asset) {
  const chunks=[asset.bytes.subarray(0,8)],allowed=new Set(['IHDR','PLTE','IDAT','IEND']);
  const color=asset.bytes[25];let paletteEntries=0;
  for(let offset=8;offset<asset.bytes.length;) {
    const size=asset.bytes.readUInt32BE(offset),end=offset+size+12,type=asset.bytes.toString('ascii',offset+4,offset+8);
    if(type==='PLTE')paletteEntries=size/3;
    const colorHint=(type==='gAMA'&&size===4)||(type==='cHRM'&&size===32)||(type==='sRGB'&&size===1&&asset.bytes[offset+8]<=3);
    const transparency=type==='tRNS'&&((color===0&&size===2)||(color===2&&size===6)||(color===3&&size>0&&size<=paletteEntries));
    if(allowed.has(type)||colorHint||transparency)chunks.push(asset.bytes.subarray(offset,end));offset=end;
  }
  return decodeImagePNG(Buffer.concat(chunks).toString('base64'));
}

// Metadata is server-owned. No browser-provided image URL or asset metadata is trusted.
export async function collectPublicationImages({ db, ownerId, courseId, course, scope, store=imageRequestStore(db) }) {
  const images=new Map(), entries=[]; let total=0, count=0;
  for (const [mi,mod] of (course.curriculum?.modules || []).entries()) {
    for (const [ti,topic] of (mod.topics || []).entries()) {
      const sections=course.modules?.[mod.number]?.[topic.id]?.sections || [];
      for (const [si,section] of sections.entries()) {
        if (section?.type!=='image') continue;
        if (++count>24) fail('Public sharing supports up to 24 images per course in this preview. Your previous public version is unchanged.');
        if (!/^[a-f0-9-]{36}$/.test(section.asset_id || '') || section.generated_by!=='openai') continue;
        const row=await store.get(ownerId,section.asset_id), a=row?.payload?.asset, target=row?.payload?.target;
        if (!row || row.owner_id!==ownerId || row.course_id!==courseId || !row.accepted || row.status!=='ready' || row.payload?.assetRemoved || target?.moduleId!==mod.id || target?.topicId!==topic.id || !hex(a?.sha256) || !Number.isInteger(a.bytes) || a.bytes<1 || a.bytes>8388608 || !Number.isInteger(a.width) || !Number.isInteger(a.height) || a.width<1 || a.height<1) continue;
        total+=a.bytes;
        if (total>48*1024*1024) fail('The images exceed the 48 MiB public sharing limit for this preview. Your previous public version is unchanged.');
        const metadata={id:digest(`${scope}/${row.id}/${a.sha256}`),sha256:a.sha256,bytes:a.bytes,width:a.width,height:a.height};
        images.set(imageKey(mi,ti,si),metadata); entries.push({row,metadata});
      }
    }
  }
  return {images,entries,count:entries.length,bytes:total};
}

export function snapshotImage(snapshot,id) {
  if (!hex(id)) return null;
  for(const mod of snapshot?.modules || [])for(const topic of mod.topics || [])for(const section of topic.sections || [])if(section.type==='image'&&section.public_image?.id===id)return section.public_image;
  return null;
}
export async function readPublicationImage(db,metadata) {
  if (!hex(metadata?.id) || !hex(metadata?.sha256) || !Number.isInteger(metadata.bytes) || metadata.bytes>8388608) fail('This shared image is unavailable.',503);
  const {data,error}=await db.storage.from(PUBLICATION_IMAGE_BUCKET).download(`${metadata.id}.png`);
  if (error || !data || data.size!==metadata.bytes) fail('This shared image could not be loaded. Retry loading; no new image will be generated.',503);
  let asset;
  try { asset=decodeImagePNG(Buffer.from(await data.arrayBuffer()).toString('base64')); } catch { fail('This shared image could not be verified.',503); }
  if(asset.sha256!==metadata.sha256 || asset.width!==metadata.width || asset.height!==metadata.height) fail('This shared image could not be verified.',503);
  return asset;
}
export async function stagePublicationImages(db,entries,{assets=imageAssetStore(db)}={}) {
  for(const {row,metadata} of entries) {
    const original=await assets.read(row);
    if (!original || original.sha256!==row.payload.asset.sha256 || original.width!==metadata.width || original.height!==metadata.height) fail('A reviewed image is missing or changed. Restore it before publishing. Your previous public version is unchanged.');
    const asset=publicPNG(original);
    // The sanitized snapshot shares this descriptor, not the private receipt.
    Object.assign(metadata,{sha256:asset.sha256,bytes:asset.bytes.length});
    // Immutable + deterministic per operation. A conflict/lost reply is resolved by
    // verifying the exact copy, never by overwriting or regenerating an image.
    await db.storage.from(PUBLICATION_IMAGE_BUCKET).upload(`${metadata.id}.png`,asset.bytes,{contentType:'image/png',upsert:false,cacheControl:'no-store'});
    await readPublicationImage(db,metadata);
  }
}
