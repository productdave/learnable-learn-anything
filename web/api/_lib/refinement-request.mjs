// One private request receipt per owned course. No accepted lesson is changed.
// Explicit start -> queued -> running -> ready | failed | stale
//                         \-> cancelled (late output cannot replace it)
// Only a confirmed queued->running CAS may call the provider. An uncertain write
// or expired running request is NEVER an instruction to call the provider again.
import { randomUUID } from 'node:crypto';
import { refinementFingerprint, courseRefinementFingerprint } from './course-refinement.mjs';
import { buildRefinementProposalRequest, generateRefinementProposal, REFINEMENT_PROPOSAL_LIMITS } from './refinement-proposal.mjs';
import { getAiTaskConfig } from './ai-models.mjs';
import { commitCourseRow } from './course-commit.mjs';

const FIELD = '_refinementProposal';
export const REFINEMENT_REQUEST_LEASE_MS = 120000;
const active = value => ['queued', 'running'].includes(value?.status);
const validId = value => typeof value === 'string' && /^[a-zA-Z0-9_-]{16,80}$/.test(value);
const fail = (code, message, statusCode = 400) => { throw Object.assign(new Error(message), { code, statusCode }); };
const unavailable = () => fail('unavailable', 'The proposal request could not be confirmed. Check the same request before starting another.', 503);
const errors = {
  connection: 'Check your Claude connection before requesting another proposal.',
  rate_limit: 'Claude is rate-limiting requests. Wait before requesting another proposal.',
  timeout: 'The request expired. No automatic retry was made; provider charges may still apply.',
  provider: 'The AI response could not be confirmed. No automatic retry was made.',
  output: 'Claude did not return a usable proposal. Your saved course is unchanged.',
  context_size: 'This lesson and its saved research exceed the refinement context limit.',
  building: 'Finish or recover this build before requesting a proposal.',
  stale: 'The saved course changed. Compare with its latest version before replacing anything.'
};

async function read({ supabase, ownerId, courseId }) {
  if (!ownerId || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(courseId || '')) fail('identity', 'An account and saved course are required.');
  let result;
  try { result = await supabase.from('user_courses').select('id,payload,updated_at').eq('owner_id', ownerId).eq('id', courseId).maybeSingle(); } catch { unavailable(); }
  if (result.error) unavailable();
  if (!result.data) fail('not_found', 'This saved course is not available to your account.', 404);
  if (result.data.payload?.config?.id !== courseId) fail('identity', 'The saved course does not match its account record.', 409);
  return result.data;
}

async function idle(args, row) {
  if (row.payload.failedTopics?.length) fail('building', errors.building, 409);
  if (!row.payload._generationJobId) return;
  let result;
  try { result = await args.supabase.from('generation_jobs').select('status').eq('owner_id', args.ownerId).eq('id', row.payload._generationJobId).maybeSingle(); } catch { unavailable(); }
  if (result.error) unavailable();
  if (result.data && result.data.status !== 'completed') fail('building', errors.building, 409);
}

async function save(args, row, receipt) {
  const payload = { ...row.payload, [FIELD]: receipt };
  try {
    return await commitCourseRow({ ...args, row, payload });
  } catch { unavailable(); }
}

function view(row, now = Date.now) {
  const receipt = row.payload[FIELD];
  if (!receipt) return { request: null, baseHash: courseRefinementFingerprint(row.payload) };
  let status = receipt.status, error = receipt.error || null;
  if (active(receipt) && now() >= receipt.expiresAt) { status = 'failed'; error = { code: 'timeout', message: errors.timeout }; }
  const stale = courseRefinementFingerprint(row.payload) !== receipt.baseHash;
  if (status === 'ready' && stale) { status = 'stale'; error = { code: 'stale', message: errors.stale }; }
  // Never return the server dispatch token, request hash, provider key or course
  // snapshot. The explicit fields below are all owned creator-facing information.
  return { baseHash: courseRefinementFingerprint(row.payload), request: {
    id: receipt.id, status, target: receipt.target, instructions: receipt.instructions,
    workingReplacement: receipt.workingReplacement, baseHash: receipt.baseHash,
    startedAt: receipt.startedAt, finishedAt: receipt.finishedAt || null,
    model: receipt.model, providerAttempted: receipt.providerAttempted,
    usage: receipt.usage || null, error, proposal: receipt.proposal || null, stale
  } };
}

export async function getRefinementRequest(args) { return view(await read(args), args.now); }

export async function startRefinementRequest(args) {
  const { operationId, expectedRequestId, baseHash, target, workingReplacement } = args;
  if (args.consent !== true) fail('consent', 'Confirm Generate proposal and its provider usage before continuing.');
  if (!validId(operationId) || !(expectedRequestId === null || validId(expectedRequestId)) || !/^[a-f0-9]{64}$/.test(baseHash || '')) fail('request', 'The saved revision and request identifiers are required.');
  const instructions = typeof args.instructions === 'string' ? args.instructions.trim() : '';
  const requestHash = refinementFingerprint({ target, instructions, baseHash, workingReplacement });
  let row = await read(args), previous = row.payload[FIELD];
  if (previous?.id === operationId) {
    if (previous.requestHash !== requestHash) fail('conflict', 'This request identifier belongs to a different proposal.', 409);
    return { ...view(row, args.now), replayed: true };
  }
  if ((previous?.id || null) !== expectedRequestId) fail('conflict', 'Another proposal request exists. Load it before starting a new one.', 409);
  if (active(previous) && (args.now || Date.now)() < previous.expiresAt) fail('busy', 'A proposal is already being prepared. Check or cancel that request first.', 409);
  if (courseRefinementFingerprint(row.payload) !== baseHash) fail('conflict', errors.stale, 409);
  await idle(args, row);
  const model = args.model || getAiTaskConfig('lesson');
  // Validate context, target and manual draft before claiming any request.
  const prepared = buildRefinementProposalRequest({ course: row.payload, target, instructions, workingReplacement, model });
  const now = (args.now || Date.now)();
  const receipt = {
    id: operationId, dispatchToken: randomUUID(), requestHash, baseHash,
    target: prepared.target, instructions, ...(workingReplacement === undefined ? {} : { workingReplacement: structuredClone(workingReplacement) }),
    model: { ...prepared.model, adapter: model.adapter }, status: 'queued',
    startedAt: new Date(now).toISOString(), expiresAt: now + REFINEMENT_REQUEST_LEASE_MS,
    providerAttempted: false, usage: null, error: null, proposal: null
  };
  const claimed = await save(args, row, receipt);
  if (claimed) return { ...view(claimed, args.now), replayed: false };
  row = await read(args); previous = row.payload[FIELD];
  if (previous?.id === operationId && previous.requestHash === requestHash) return { ...view(row, args.now), replayed: true };
  fail('conflict', 'Another request or course change was saved first. Check the latest course.', 409);
}

// Merge only this request's terminal result into the latest course. Never restore
// an old course snapshot, recreate a deleted row, or replace a newer request.
async function finish(args, token, patch, expectedStatus = 'running') {
  for (let attempt = 0; attempt < 4; attempt++) {
    let row;
    try { row = await read(args); } catch (error) { if (error.code === 'not_found') return { stopped: true }; throw error; }
    const current = row.payload[FIELD];
    if (current?.id !== args.operationId || current.dispatchToken !== token) return { stopped: true };
    if (current.status !== expectedStatus && current.status !== 'cancelled') return view(row, args.now);
    const expired = (args.now || Date.now)() >= current.expiresAt;
    const cancelled = current.status === 'cancelled';
    const stale = courseRefinementFingerprint(row.payload) !== current.baseHash;
    const terminal = cancelled ? { usage: patch.usage || current.usage, providerAttempted: !!patch.providerAttempted || current.providerAttempted }
      : { ...patch, ...(expired ? { status: 'failed', proposal: null, error: { code: 'timeout', message: errors.timeout } }
        : stale && patch.status === 'ready' ? { status: 'stale', error: { code: 'stale', message: errors.stale } } : {}), finishedAt: new Date((args.now || Date.now)()).toISOString() };
    const saved = await save(args, row, { ...current, ...terminal });
    if (saved) return view(saved, args.now);
  }
  unavailable();
}

export async function cancelRefinementRequest(args) {
  if (!validId(args.operationId)) fail('request', 'Choose the proposal request to cancel.');
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await read(args), receipt = row.payload[FIELD];
    if (receipt?.id !== args.operationId) fail('conflict', 'This proposal request has changed. Load the current request.', 409);
    if (!active(receipt)) return view(row, args.now);
    const saved = await save(args, row, { ...receipt, status: 'cancelled', proposal: null, finishedAt: new Date((args.now || Date.now)()).toISOString(), error: { code: 'cancelled', message: receipt.providerAttempted ? 'Proposal cancelled. The provider may still finish and charge; its output will not be applied.' : 'Proposal cancelled before generation started.' } });
    if (saved) return view(saved, args.now);
  }
  unavailable();
}

export async function discardRefinementRequest(args) {
  if (!validId(args.operationId)) fail('request', 'Choose the suggestion to discard.');
  for (let attempt = 0; attempt < 4; attempt++) {
    const row = await read(args), receipt = row.payload[FIELD];
    if (receipt?.id !== args.operationId) fail('conflict', 'This suggestion has changed. Load the current request.', 409);
    if (active(receipt) && (args.now || Date.now)() < receipt.expiresAt) fail('busy', 'Cancel the active request before discarding its suggestion.', 409);
    if (['discarded', 'applied'].includes(receipt.status)) return view(row, args.now);
    const saved = await save(args, row, { ...receipt, status: 'discarded', proposal: null, error: null });
    if (saved) return view(saved, args.now);
  }
  unavailable();
}

export async function runRefinementRequest(args) {
  if (!validId(args.operationId)) fail('request', 'Choose an existing proposal request.');
  let row = await read(args), receipt = row.payload[FIELD];
  if (receipt?.id !== args.operationId) fail('conflict', 'This proposal request has changed.', 409);
  if (receipt.status !== 'queued' || (args.now || Date.now)() >= receipt.expiresAt) return view(row, args.now);
  const token = receipt.dispatchToken;
  let apiKey;
  try {
    if (courseRefinementFingerprint(row.payload) !== receipt.baseHash) fail('stale', errors.stale, 409);
    await idle(args, row);
    buildRefinementProposalRequest({ course: row.payload, ...receipt });
    apiKey = await args.getKey(args.supabase, args.ownerId);
    if (!apiKey) fail('connection', errors.connection);
  } catch (error) {
    const code = error.code === 'stale' ? 'stale' : error.code === 'building' ? 'building' : error.code === 'context_size' ? 'context_size' : 'connection';
    return finish(args, token, { status: code === 'stale' ? 'stale' : 'failed', error: { code, message: errors[code] }, providerAttempted: false }, 'queued');
  }
  if ((args.now || Date.now)() >= receipt.expiresAt) return getRefinementRequest(args);
  // The atomic transition is the sole provider-call admission. A lost DB reply
  // stops here, even if Postgres may have committed the running receipt.
  const claimed = await save(args, row, { ...receipt, status: 'running', providerAttempted: true });
  if (!claimed) return getRefinementRequest(args);
  row = claimed; receipt = row.payload[FIELD];
  let patch;
  try {
    const proposal = await (args.generate || generateRefinementProposal)({ course: row.payload, target: receipt.target, instructions: receipt.instructions, workingReplacement: receipt.workingReplacement, model: receipt.model, apiKey, timeoutMs: Math.max(1, Math.min(REFINEMENT_PROPOSAL_LIMITS.timeoutMs, receipt.expiresAt - (args.now || Date.now)())) });
    patch = { status: 'ready', proposal, usage: proposal.usage || null, providerAttempted: true, error: null };
  } catch (error) {
    const code = ['connection', 'rate_limit', 'timeout'].includes(error.code) ? error.code : ['output', 'output_size', 'validation', 'markup', 'identity', 'media'].includes(error.code) ? 'output' : 'provider';
    patch = { status: 'failed', proposal: null, usage: error.usage || null, providerAttempted: error.providerAttempted !== false, error: { code, message: errors[code] } };
  }
  return finish(args, token, patch);
}
