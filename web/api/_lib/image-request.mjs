// One immutable identity per explicitly confirmed image attempt. This module
// never changes accepted lessons. No read/reconcile path calls the provider.
import { refinementTarget, refinementFingerprint } from './course-refinement.mjs';
import { generateCreatorImage, decodeImagePNG, imageUsage } from './openai-image.mjs';
import { imagePolicy, requireImagePolicy, ImageGenerationError } from './image-policy.mjs';
import { imageRequestStore, imageAssetStore, ImageRequestError } from './image-request-store.mjs';
import { IMAGE_SAVE_RESERVE_MS } from './image-execution.mjs';

export const IMAGE_REQUEST_LEASE_MS = 300000;
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
const now = args => (args.now || Date.now)();
const repo = args => { args.signal?.throwIfAborted(); return args.store || imageRequestStore(args.supabase); };
const assets = args => { args.signal?.throwIfAborted(); return args.assets || imageAssetStore(args.supabase); };
const fail = (code, status) => { throw new ImageRequestError(code, status); };
const active = status => ['queued','running','persisting'].includes(status);
const stopped = status => ['cancelled','discarded'].includes(status);
function identity(args) {
  if (!uuid(args.ownerId) || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(args.courseId || '') || (args.operationId !== undefined && !uuid(args.operationId))) fail('request', 400);
}
export function imageLessonHash(row, target) {
  try {
    if (!row?.id || row.payload?.config?.id !== row.id) throw new Error();
    const selected = refinementTarget(row.payload, { ...target, kind: 'lesson' });
    return refinementFingerprint({ instance: row.created_at, courseId: row.id, module: selected.mod.id, lesson: selected.lesson });
  } catch { fail('stale'); }
}
export function imageFundingQuote(env = process.env) {
  const policy = imagePolicy(env); requireImagePolicy(policy);
  const quote = { funding: policy.funding, provider: policy.provider, model: policy.model, n: policy.n,
    size: policy.size, quality: policy.quality, outputFormat: policy.output_format, moderation: policy.moderation };
  return { ...quote, hash: refinementFingerprint(quote) };
}
async function course(args, required = true) {
  identity(args);
  const value = await repo(args).course(args.ownerId, args.courseId);
  if (required && (!value || value.payload?.config?.id !== args.courseId)) fail('not_found', 404);
  return value;
}
async function read(args) {
  identity(args);
  if (!uuid(args.operationId)) fail('request', 400);
  const row = await repo(args).get(args.ownerId, args.operationId);
  if (!row || row.owner_id !== args.ownerId || row.course_id !== args.courseId) fail('not_found', 404);
  return row;
}
async function merge(args, decide) {
  for (let attempt = 0; attempt < 5; attempt++) {
    const row = await read(args), patch = decide(row);
    if (!patch) return row;
    const saved = await repo(args).update(row, patch);
    if (saved) return saved;
  }
  fail('unavailable', 503);
}
async function view(args, row, savedCourse) {
  const p = row.payload, saved = savedCourse === undefined ? await course(args, false) : savedCourse;
  let stale = !saved;
  try { stale ||= imageLessonHash(saved, p.target) !== p.baseHash; } catch { stale = true; }
  const expired = active(p.status) && now(args) >= p.expiresAt;
  const status = expired ? p.status === 'queued' ? 'failed' : 'unknown' : p.status;
  const error = expired ? p.status === 'queued' ? 'not_started' : p.status === 'persisting' ? 'save_unconfirmed' : 'outcome_unknown' : p.error || null;
  return { request: {
    id: row.id, courseId: row.course_id, current: row.is_current, status, accepted: row.accepted === true,
    target: p.target, slot: p.slot, prompt: p.prompt, alt: p.alt, baseHash: p.baseHash, stale,
    funding: p.quote, mayHaveCharged: p.mayHaveCharged, usage: p.usage || null,
    providerRequestId: p.providerRequestId || null, error, needsRecovery: expired || p.status === 'persisting' || p.status === 'unknown',
    startedAt: p.startedAt, finishedAt: p.finishedAt || null,
    // Stable identity, never a signed URL, object path, prompt or secret in lesson content.
    asset: p.status === 'ready' && p.asset ? { id: row.id, ...p.asset, alt: p.alt } : null,
  } };
}
export async function inspectImageLesson(args) {
  const row = await course(args);
  return { baseHash: imageLessonHash(row, args.target), funding: imageFundingQuote(args.env) };
}
export async function getImageRequest(args) { return view(args, await read(args)); }
export async function listImageRequests(args) {
  if (args.after !== undefined && !uuid(args.after)) fail('request',400);
  const saved = await course(args), rows = await repo(args).list(args.ownerId,args.courseId,args.after);
  const page = rows.slice(0,50);
  return { requests: await Promise.all(page.map(async row => (await view(args,row,saved)).request)), nextCursor: rows.length > 50 ? page.at(-1).id : null };
}

export async function startImageRequest(args) {
  identity(args);
  if (!uuid(args.operationId) || !(args.expectedRequestId === null || uuid(args.expectedRequestId))) fail('request', 400);
  if (args.consent !== true) fail('consent', 400);
  const quote = imageFundingQuote(args.env), policy = imagePolicy(args.env);
  if (args.fundingHash !== quote.hash) fail('consent', 400);
  const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '', alt = typeof args.alt === 'string' ? args.alt.trim() : '';
  if (!prompt || [...prompt].length > policy.maxPromptCharacters || !alt || [...alt].length > policy.maxAltCharacters ||
      !/^[a-z0-9-]{1,80}$/.test(args.slot || '') || !/^[a-f0-9]{64}$/.test(args.baseHash || '')) fail('request', 400);
  const target = { moduleId: args.target?.moduleId, topicId: args.target?.topicId };
  if (![target.moduleId,target.topicId].every(value => typeof value === 'string' && /^[a-z0-9-]+$/.test(value) && value.length <= 100)) fail('request', 400);
  const slotKey = refinementFingerprint({ target, slot: args.slot });
  const requestHash = refinementFingerprint({ target, slot: args.slot, prompt, alt, baseHash: args.baseHash, quote, expectedRequestId: args.expectedRequestId });
  const existing = await repo(args).get(args.ownerId, args.operationId);
  if (existing) {
    if (existing.course_id !== args.courseId || existing.slot_key !== slotKey || existing.payload.requestHash !== requestHash) fail('conflict');
    return { ...await view(args, existing), replayed: true };
  }
  const saved = await course(args);
  if (imageLessonHash(saved, target) !== args.baseHash) fail('stale');
  const time = now(args);
  const result = await repo(args).begin({ owner_id: args.ownerId, id: args.operationId, course_id: args.courseId, slot_key: slotKey,
    payload: { status: 'queued', target, slot: args.slot, prompt, alt, baseHash: args.baseHash, requestHash, quote,
      startedAt: new Date(time).toISOString(), expiresAt: time + IMAGE_REQUEST_LEASE_MS,
      mayHaveCharged: false, workerDone: false, usage: null, asset: null, error: null } }, args.expectedRequestId, args.acknowledgePossibleCharge);
  return { ...await view(args, result.row), replayed: result.replayed };
}

// Explicit recovery inspects the immutable object; a missing/expired dispatch
// becomes unknown, never queued. A stored image can recover after a lost DB reply.
export async function reconcileImageRequest(args) {
  let row = await read(args), p = row.payload;
  if (stopped(p.status) || p.status === 'ready') return view(args, row);
  if (p.asset) {
    const image = await assets(args).read(row);
    if (image) {
      row = await merge(args, current => stopped(current.payload.status) || current.payload.status === 'ready' ? null :
        { status: 'ready', error: null, finishedAt: new Date(now(args)).toISOString() });
      return view(args, row);
    }
  }
  if (now(args) >= p.expiresAt && active(p.status)) {
    row = await merge(args, current => !active(current.payload.status) || now(args) < current.payload.expiresAt ? null : {
      status: current.payload.status === 'running' ? 'unknown' : 'failed',
      error: current.payload.status === 'queued' ? 'not_started' : current.payload.status === 'persisting' ? 'asset_missing' : 'outcome_unknown',
      workerDone: current.payload.status === 'queued' || current.payload.workerDone,
      finishedAt: new Date(now(args)).toISOString(),
    });
  }
  return view(args, row);
}

export async function runImageRequest(args) {
  let row = await read(args);
  if (row.payload.status !== 'queued' || now(args) >= row.payload.expiresAt) return reconcileImageRequest(args);
  try {
    const current = await course(args);
    if (imageLessonHash(current, row.payload.target) !== row.payload.baseHash) fail('stale');
    if (imageFundingQuote(args.env).hash !== row.payload.quote.hash) fail('consent', 400);
  } catch (error) {
    const code = ['stale','not_found','consent'].includes(error.code) ? error.code : 'configuration';
    row = await merge(args, r => r.payload.status !== 'queued' ? null : { status: 'failed', error: code, workerDone: true, finishedAt: new Date(now(args)).toISOString() });
    return view(args, row);
  }
  // Do not start a paid call when preflight has consumed the time needed for
  // the provider's existing 150-second limit plus a bounded persistence window.
  if (args.remainingMs && args.remainingMs() < imagePolicy(args.env).timeoutMs + IMAGE_SAVE_RESERVE_MS) {
    row = await merge(args, r => r.payload.status !== 'queued' ? null : {
      status: 'failed', error: 'not_started', workerDone: true, finishedAt: new Date(now(args)).toISOString(),
    });
    return view(args, row);
  }
  // An ambiguous CAS reply MUST throw: do not fresh-read running and dispatch.
  row = await repo(args).update(row, { status: 'running', mayHaveCharged: true, expiresAt: now(args) + IMAGE_REQUEST_LEASE_MS });
  if (!row) return getImageRequest(args);
  let generated;
  try {
    // Recheck cancellation after claiming; never pass private originals wholesale.
    const latest = await read(args);
    if (stopped(latest.payload.status)) {
      row = await merge(args, () => ({ workerDone: true, mayHaveCharged: false }));
      return view(args, row);
    }
    args.signal?.throwIfAborted();
    // The course-generation caller rechecks its live lease/cancellation here.
    // Manual image requests omit this hook and retain their existing behavior.
    await args.beforeDispatch?.();
    if (args.remainingMs && args.remainingMs() < imagePolicy(args.env).timeoutMs + IMAGE_SAVE_RESERVE_MS) {
      row = await merge(args, r => ({ workerDone: true, mayHaveCharged: false,
        ...(!stopped(r.payload.status) ? { status: 'failed', error: 'not_started', finishedAt: new Date(now(args)).toISOString() } : {}) }));
      return view(args, row);
    }
    generated = await (args.generate || generateCreatorImage)({ client: args.supabase, ownerId: args.ownerId,
      courseId: args.courseId, operationId: row.id, requestHash: row.payload.requestHash,
      funding: row.payload.quote.funding, prompt: row.payload.prompt, alt: row.payload.alt, signal: args.signal }, { env: args.env });
    args.signal?.throwIfAborted();
  } catch (error) {
    const trusted = error instanceof ImageGenerationError;
    row = await merge(args, r => ({ workerDone: true, mayHaveCharged: trusted ? error.mayHaveCharged : true,
      usage: imageUsage(error.usage), providerRequestId: /^req_[A-Za-z0-9_-]{1,100}$/.test(error.requestId || '') ? error.requestId : null,
      ...(!stopped(r.payload.status) ? { status: trusted && ['timeout','response','unavailable'].includes(error.code) ? 'unknown' : 'failed',
        error: trusted ? error.code : 'outcome_unknown', finishedAt: new Date(now(args)).toISOString() } : {}) }));
    return view(args, row);
  }
  const usage = imageUsage(generated?.provenance?.usage);
  const providerRequestId = /^req_[A-Za-z0-9_-]{1,100}$/.test(generated?.provenance?.requestId || '') ? generated.provenance.requestId : null;
  let image;
  try {
    if (!['funding','provider','model','n','size','quality','outputFormat'].every(key => generated?.provenance?.[key] === row.payload.quote[key])) throw new Error();
    image = decodeImagePNG(generated.asset.bytes.toString('base64'));
  }
  catch {
    row = await merge(args, r => ({ workerDone: true, usage, providerRequestId,
      ...(!stopped(r.payload.status) ? { status: 'failed', error: 'response', finishedAt: new Date(now(args)).toISOString() } : {}) }));
    return view(args, row);
  }
  // Record the exact object BEFORE upload: a lost upload response can be resolved
  // by hashing those bytes, and a cancelled upload never becomes untraceable.
  row = await merge(args, r => stopped(r.payload.status) ? { workerDone: true, usage, providerRequestId } : {
    status: 'persisting', usage, providerRequestId, error: null,
    asset: { sha256: image.sha256, bytes: image.bytes.length, contentType: image.contentType, width: image.width, height: image.height },
  });
  if (stopped(row.payload.status)) return view(args, row);
  try { await assets(args).put(row, image.bytes); }
  catch { /* Read-after-upload resolves conflicts/lost replies without new AI. */ }
  await merge(args, () => ({ workerDone: true }));
  return reconcileImageRequest(args);
}

export async function cancelImageRequest(args) {
  const row = await merge(args, r => !active(r.payload.status) && r.payload.status !== 'unknown' ? null : {
    status: 'cancelled', error: 'cancelled', workerDone: r.payload.status === 'queued' || r.payload.workerDone,
    finishedAt: new Date(now(args)).toISOString(),
  });
  return view(args, row);
}
export async function discardImageRequest(args) {
  const existing = await read(args), saved = await course(args, false);
  if (existing.accepted) fail('referenced');
  const content = JSON.stringify(saved?.payload || {});
  if (existing.payload.asset && (content.includes(existing.id) || content.includes(existing.payload.asset.sha256))) fail('referenced');
  const row = await merge(args, r => {
    if (r.accepted) fail('referenced');
    if (active(r.payload.status)) fail('busy');
    return r.payload.status === 'discarded' ? null : { status: 'discarded', error: null };
  });
  return view(args, row);
}
export async function readImageAsset(args) {
  const row = await read(args);
  await course(args); // Deleting the course revokes preview access immediately.
  if (row.payload.status !== 'ready' || !row.payload.asset || row.payload.assetRemoved) fail('asset', 404);
  const data = await assets(args).read(row);
  if (!data) fail('asset', 404);
  return { ...data, alt: row.payload.alt };
}

// Only explicitly discarded/cancelled, settled candidates. No broad bucket sweep,
// accepted asset deletion, policy for account deletion, or provider retry here.
export async function cleanupImageCandidate(args) {
  const row = await read(args), p = row.payload;
  if (row.accepted) fail('referenced');
  if (!stopped(p.status) || !p.workerDone) fail('busy');
  if (!p.asset) return { removed: false };
  const saved = await course(args, false), content = JSON.stringify(saved?.payload || {});
  if (content.includes(row.id) || content.includes(p.asset.sha256)) fail('referenced');
  // Repeating cleanup is safe, including an upload that committed late after a
  // transport error. Keep its exact descriptor; assetRemoved is not a tombstone
  // that would prevent checking/removing that same candidate again.
  await assets(args).remove(row);
  await merge(args, current => stopped(current.payload.status) ? { assetRemoved: true } : null);
  return { removed: true };
}
