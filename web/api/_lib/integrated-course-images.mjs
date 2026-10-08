// Initial-draft visuals belong to the course job, not a second customer flow.
// Reuse the immutable image receipt/provider/storage path. A read or continuation
// never creates a replacement for an uncertain provider attempt.
import { createHash } from 'node:crypto';
import { imageRequestStore, imageAssetStore, ImageRequestError } from './image-request-store.mjs';
import { imageLessonHash, imageFundingQuote, startImageRequest, runImageRequest, reconcileImageRequest } from './image-request.mjs';
import { imagePolicy, ImageGenerationError } from './image-policy.mjs';
import { IMAGE_SAVE_RESERVE_MS } from './image-execution.mjs';
import { usesVisualDesigner, assertDesignComplete } from './visual-designer.mjs';
import { refinementFingerprint, refinementTarget } from './course-refinement.mjs';
import { GENERATION_PAUSE, GENERATION_UNCERTAIN } from './gen-request-budget.mjs';

export const INTEGRATED_VISUALS_POLICY = 'integrated-visuals-v2';
export const usesIntegratedVisuals = brief => brief?.materials_policy === INTEGRATED_VISUALS_POLICY;
const fail = (message, code = 'GENERATION_IMAGE_ATTENTION') => { throw Object.assign(new Error(message), { code }); };
const savedImage = lesson => lesson?.sections?.find(section => section.type === 'image' && section.image_slot === 'instruction' && section.asset_id);

function provenUndispatched(request, { ownerId, courseId, operationId, target, baseHash }) {
  const payload = request?.payload;
  // This one failure is a scheduling result, not a provider retry. Require the
  // durable completed-worker proof; missing flags, returned usage/IDs/assets,
  // stale identity, accepted/noncurrent receipts and uncertainty all fail shut.
  return request?.id === operationId && request.owner_id === ownerId && request.course_id === courseId &&
    request.is_current === true && request.accepted === false && request.status === 'failed' &&
    payload?.status === 'failed' && payload.error === 'not_started' && payload.workerDone === true &&
    payload.mayHaveCharged === false && payload.usage === null && payload.providerRequestId == null && payload.asset == null &&
    payload.baseHash === baseHash && payload.target?.moduleId === target.moduleId && payload.target?.topicId === target.topicId;
}

export function generationImageIdentity({ jobId, courseId, key, baseHash, cycle = null, attempt = 0 }) {
  const hex = createHash('sha256').update(JSON.stringify({ purpose: INTEGRATED_VISUALS_POLICY, jobId, courseId, key, baseHash, cycle, attempt })).digest('hex');
  // Deterministic RFC 4122-shaped identity, never based on the transient run lease.
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export function integratedImageInventory(course) {
  if (!usesIntegratedVisuals(course?._brief)) fail('This saved draft does not use integrated course visuals.');
  if (!Array.isArray(course.curriculum?.modules) || !course.curriculum.modules.length ||
      course.curriculum.modules.some(mod => !Array.isArray(mod.topics) || !mod.topics.length)) {
    fail('The saved draft is missing its lesson plan. Existing content is retained; recover the course before continuing.');
  }
  return course.curriculum.modules.flatMap(mod => mod.topics.map(topic => {
    const lesson = course.modules?.[mod.number]?.[topic.id], visual = lesson?.visual;
    if (!lesson || lesson.id !== topic.id || lesson.moduleId !== mod.id || !Array.isArray(lesson.sections) || !lesson.sections.length) {
      fail('A saved lesson is missing or incomplete. Existing content is retained; recover the course before illustrations can finish.');
    }
    if (!['generate', 'omit'].includes(visual?.decision) || !visual.reason?.trim()) fail('A lesson is missing its visual teaching decision. Its saved text is retained.');
    if (visual.decision === 'generate' && (!visual.prompt?.trim() || !visual.alt?.trim())) fail('A planned illustration is missing its description or alternative text. Its saved text is retained.');
    return { key: `${mod.id}/${topic.id}`, target: { moduleId: mod.id, topicId: topic.id }, title: topic.title,
      lesson, visual, image: savedImage(lesson) };
  }));
}

export function integratedImageProgress(rows, items = {}, status = 'running', cycle = null) {
  return { version: 1, planned: rows.filter(row => row.visual?.decision === 'generate').length,
    completed: rows.filter(row => row.visual?.decision === 'generate' && (row.image || items[row.key]?.status === 'saved')).length,
    omitted: rows.filter(row => row.visual?.decision === 'omit').length, status, items, ...(cycle ? { cycle } : {}) };
}

async function loadOwnedDraft({ supabase, ownerId, jobId, courseId, store, requireDesign = false }) {
  const row = await store.course(ownerId, courseId);
  if (!row || row.payload?._generationJobId !== jobId || row.payload?.config?.id !== courseId || !usesIntegratedVisuals(row.payload?._brief)) {
    fail('The saved draft no longer matches this generation job. No image was started.');
  }
  if (requireDesign || usesVisualDesigner(row.payload._brief) || row.payload._visualDesign != null || row.payload.config?.visual_designer_policy === 'learner-experience-v1') assertDesignComplete(row.payload);
  return row;
}

// This is an automatic *draft* attachment, not a claim that a human reviewed it.
// The new service-only transaction independently verifies the exact live run and
// commits the image receipt together with the owner-scoped course revision.
export async function attachGenerationImage(args) {
  const store = args.store || imageRequestStore(args.supabase), assets = args.assets || imageAssetStore(args.supabase);
  const row = await store.get(args.ownerId, args.operationId);
  const course = await loadOwnedDraft({ ...args, store });
  if (!row || row.course_id !== args.courseId || row.owner_id !== args.ownerId) throw new ImageRequestError('not_found', 404);
  const hash = refinementFingerprint({ purpose: 'generation-draft', jobId: args.jobId, operationId: row.id,
    baseHash: row.payload.baseHash, alt: row.payload.alt, caption: args.visual.caption || '' });
  if (row.accepted) {
    if (row.payload.acceptance?.kind !== 'generation-draft' || row.payload.acceptance?.jobId !== args.jobId || row.payload.acceptance?.hash !== hash) {
      throw new ImageRequestError('conflict');
    }
    const selected = refinementTarget(course.payload, { ...row.payload.target, kind: 'lesson' });
    if (savedImage(selected.lesson)?.asset_id !== row.id) throw new ImageRequestError('stale');
    return { saved: true, replayed: true, payload: course.payload };
  }
  if (!row.is_current || row.payload.status !== 'ready' || !row.payload.asset || row.payload.assetRemoved) throw new ImageRequestError('conflict');
  if (imageLessonHash(course, row.payload.target) !== row.payload.baseHash) throw new ImageRequestError('stale');
  if (!await assets.read(row)) throw new ImageRequestError('asset', 404);
  const selected = refinementTarget(course.payload, { ...row.payload.target, kind: 'lesson' });
  if (selected.lesson.visual?.decision !== 'generate' || savedImage(selected.lesson)) throw new ImageRequestError('conflict');
  const payload = structuredClone(course.payload), lesson = payload.modules[selected.mod.number][selected.meta.id];
  const takeaway = lesson.sections.findIndex(section => section.type === 'takeaway');
  const index = Number.isInteger(args.visual.afterSectionIndex) && args.visual.afterSectionIndex >= 0 && args.visual.afterSectionIndex < lesson.sections.length
    ? args.visual.afterSectionIndex + 1 : takeaway < 0 ? lesson.sections.length : takeaway;
  lesson.sections.splice(index, 0, { type: 'image', asset_id: row.id, image_slot: 'instruction', generated_by: 'openai',
    alt: row.payload.alt, ...(args.visual.caption ? { caption: args.visual.caption } : {}) });
  const { data, error } = await args.supabase.rpc('attach_generation_course_image', {
    p_owner: args.ownerId, p_job: args.jobId, p_run: args.runId, p_course: args.courseId,
    p_id: row.id, p_revision: row.revision, p_updated_at: course.updated_at, p_payload: payload,
    p_operation: args.acceptanceId, p_hash: hash
  });
  if (error || !data?.saved) throw new ImageRequestError(data?.error || 'unavailable', 409);
  return data;
}

export async function runIntegratedCourseImages({ supabase, ownerId, jobId, runId, courseId, requestBudget,
  assertRunnerWritable, checkpoint = {}, patch, withHeartbeat = (_label, work) => work(), retryFailedImages = false,
  env = process.env, store = imageRequestStore(supabase), assets = imageAssetStore(supabase), generate,
  attach = attachGenerationImage } = {}) {
  const args = { supabase, ownerId, jobId, runId, courseId, store, assets, env };
  let course = await loadOwnedDraft(args);
  args.requireDesign = usesVisualDesigner(course.payload._brief) || course.payload._visualDesign != null;
  let rows = integratedImageInventory(course.payload);
  const items = structuredClone(checkpoint.items || {});
  // Persist the generation cycle once before any paid attempt. Resumes use the
  // same cycle; an explicit Restart clears the progress and begins a new cycle,
  // keeping all old accepted assets/receipts without colliding with their slots.
  const cycle = checkpoint.cycle || runId;
  if (!/^[0-9a-f-]{36}$/i.test(cycle || '')) fail('The course illustration checkpoint is invalid. No image was started.');
  const publish = async status => {
    const progress = integratedImageProgress(rows, items, status, cycle);
    await patch({ stage: 'images', image_progress: progress,
      message: status === 'attention' ? 'Your lesson draft is saved. Course illustrations need attention before the draft is complete.'
        : `Creating course illustrations — ${progress.completed}/${progress.planned} saved` });
    return progress;
  };
  await publish('running');
  for (const row of rows) {
    if (row.visual.decision === 'omit' || row.image) continue;
    await assertRunnerWritable();
    course = await loadOwnedDraft(args);
    const visual = row.visual;
    const baseHash = imageLessonHash(course, row.target);
    let item = items[row.key];
    if (item && item.baseHash !== baseHash) fail('A lesson changed while its illustration was being prepared. Your saved draft is retained.');
    if (!item) {
      item = { attempt: 0, baseHash, status: 'planned' };
      item.operationId = generationImageIdentity({ jobId, courseId, key: row.key, baseHash, cycle });
      item.acceptanceId = generationImageIdentity({ jobId, courseId, key: `${row.key}/attach`, baseHash, cycle });
      items[row.key] = item;
      await publish('running'); // Durable attempt identity before receipt or paid dispatch.
    }
    let request = await store.get(ownerId, item.operationId);
    if (request) {
      const resolved = await reconcileImageRequest({ ...args, operationId: item.operationId });
      request = await store.get(ownerId, item.operationId);
      // Provider failures still need explicit Resume. A completed worker that
      // proved it never dispatched may continue in a fresh hosting slice. Keep
      // its old terminal receipt and create the normal CAS-bound replacement;
      // never reset it to queued or repeat a possibly charged request.
      const undispatched = provenUndispatched(request, { ...args, operationId: item.operationId, target: row.target, baseHash });
      if (resolved.request.status === 'failed' && (retryFailedImages || undispatched) && request.payload.workerDone &&
          !['outcome_unknown', 'asset_missing', 'save_unconfirmed', 'response'].includes(resolved.request.error)) {
        item = { ...item, attempt: item.attempt + 1, expectedRequestId: item.operationId, status: 'planned' };
        item.operationId = generationImageIdentity({ jobId, courseId, key: row.key, baseHash, cycle, attempt: item.attempt });
        item.acceptanceId = generationImageIdentity({ jobId, courseId, key: `${row.key}/attach`, baseHash, cycle, attempt: item.attempt });
        items[row.key] = item;
        await publish('running');
        request = null;
      }
    }
    const dispatchWindow = imagePolicy(env).timeoutMs + IMAGE_SAVE_RESERVE_MS;
    if (!request || request.payload.status === 'queued') {
      if (requestBudget.remainingMs() < dispatchWindow) {
        throw Object.assign(new Error('Continuing course illustrations in the next hosting time slice.'), { code: GENERATION_PAUSE });
      }
      const funding = imageFundingQuote(env);
      if (!request) await startImageRequest({ ...args, operationId: item.operationId, expectedRequestId: item.expectedRequestId || null,
        target: row.target, slot: `instruction-${cycle}`, baseHash, prompt: visual.prompt, alt: visual.alt,
        consent: true, fundingHash: funding.hash, acknowledgePossibleCharge: !!item.expectedRequestId });
      await assertRunnerWritable();
      await withHeartbeat(`illustration for ${row.key}`, () => requestBudget.runOperation(signal => runImageRequest({ ...args,
        operationId: item.operationId, generate, signal, remainingMs: requestBudget.remainingMs,
        beforeDispatch: async () => { try { await assertRunnerWritable(); await loadOwnedDraft(args); } catch { throw new ImageGenerationError('cancelled'); } }
      }), { timeoutMs: dispatchWindow, code: GENERATION_UNCERTAIN }));
    }
    await assertRunnerWritable();
    const result = await reconcileImageRequest({ ...args, operationId: item.operationId });
    item.status = result.request.status;
    item.error = result.request.error || null;
    if (result.request.status !== 'ready') {
      if (result.request.status === 'failed' && result.request.error === 'not_started') {
        const latest = await store.get(ownerId, item.operationId);
        if (provenUndispatched(latest, { ...args, operationId: item.operationId, target: row.target, baseHash })) {
          await publish('running');
          throw Object.assign(new Error('Continuing course illustrations in the next hosting time slice.'), { code: GENERATION_PAUSE });
        }
      }
      await publish('attention');
      const uncertain = ['unknown', 'persisting', 'running'].includes(result.request.status) ||
        ['outcome_unknown', 'asset_missing', 'save_unconfirmed', 'response'].includes(result.request.error);
      fail(uncertain
        ? 'An illustration outcome could not be confirmed. Your lessons are saved. Check this same course again; no replacement image will be generated automatically.'
        : `OpenAI course image generation could not finish (${result.request.error || result.request.status}). Your lessons are saved. Resolve the connection or provider issue, then Resume this course.`);
    }
    await attach({ ...args, operationId: item.operationId, acceptanceId: item.acceptanceId, visual });
    item.status = 'saved'; item.error = null;
    course = await loadOwnedDraft(args);
    rows = integratedImageInventory(course.payload);
    await publish('running');
  }
  // Also revalidate the no-image/all-attached path before declaring completion.
  course = await loadOwnedDraft(args);
  rows = integratedImageInventory(course.payload);
  const progress = await publish('complete');
  return { progress, course: course.payload };
}
