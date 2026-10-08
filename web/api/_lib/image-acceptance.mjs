import { imageRequestStore, imageAssetStore, ImageRequestError } from './image-request-store.mjs';
import { imageLessonHash } from './image-request.mjs';
import { refinementFingerprint, refinementTarget, proposeCourseRefinement } from './course-refinement.mjs';

const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const fail = (code, status) => { throw new ImageRequestError(code, status); };
export async function acceptCourseImage(args) {
  const { ownerId, courseId, operationId, acceptanceId } = args;
  if (![ownerId, operationId, acceptanceId].every(uuid) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(courseId || '')) fail('request',400);
  const alt = typeof args.alt === 'string' ? args.alt.trim() : '', caption = typeof args.caption === 'string' ? args.caption.trim() : '';
  if (args.reviewed !== true || !alt || [...alt].length > 300 || [...caption].length > 500) fail('review',400);
  const store = args.store || imageRequestStore(args.supabase), assets = args.assets || imageAssetStore(args.supabase);
  const row = await store.get(ownerId,operationId), course = await store.course(ownerId,courseId);
  if (!row || row.owner_id !== ownerId || row.course_id !== courseId || !course || course.payload?.config?.id !== courseId) fail('not_found',404);
  const hash = refinementFingerprint({ operationId, alt, caption, baseHash: row.payload.baseHash });
  // The transaction checks the receipt before the old lesson hash on replay.
  if (row.accepted) return store.accept(row,course,course.payload,acceptanceId,hash);
  if (!row.is_current || row.payload.status !== 'ready' || !row.payload.asset || row.payload.assetRemoved) fail('conflict');
  if (imageLessonHash(course,row.payload.target) !== row.payload.baseHash) fail('stale');
  if (!await assets.read(row)) fail('asset',404);
  let proposal;
  try {
    const target = { ...row.payload.target, kind:'lesson' }, selected = refinementTarget(course.payload,target);
    const lesson = structuredClone(selected.lesson);
    const section = { type:'image', asset_id:row.id, image_slot:'instruction', generated_by:'openai', alt, ...(caption ? { caption } : {}) };
    const index = lesson.sections.findIndex(item => item.type === 'image' && item.image_slot === 'instruction');
    if (index >= 0) lesson.sections[index] = section;
    else {
      const takeaway = lesson.sections.findIndex(item => item.type === 'takeaway');
      lesson.sections.splice(takeaway < 0 ? lesson.sections.length : takeaway,0,section);
    }
    proposal = proposeCourseRefinement(course.payload,target,lesson,{ allowedImageAssetId:row.id });
  } catch { fail('lesson',409); }
  return { ...await store.accept(row,course,proposal.course,acceptanceId,hash), impact:proposal.impact };
}
