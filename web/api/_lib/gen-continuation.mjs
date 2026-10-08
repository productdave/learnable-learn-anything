// A safe time-slice handoff, not a retry queue for failed/uncertain AI requests.
// Only the server can write generation_jobs.continuation. One exact run claims
// each handoff; no provider credential, user input or incoming URL is forwarded.
import { createHash, randomUUID, timingSafeEqual } from 'node:crypto';
import { generationLeaseFields, generationTerminalFields, RUNNER_WRITABLE_STATUSES } from './gen-state.mjs';

export const MAX_CONTINUATION_HOPS = 128; // 48 lessons + their visuals + research/sources/finalization.
export const MAX_CONTINUATION_STALLS = 2;
export const CONTINUATION_DELIVERY_MS = 5_000;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function continuationConfig(env = process.env) {
  if (env.LEARNABLE_GENERATION_CONTINUATION !== '1') return null;
  const secret = env.GEN_SWEEP_SECRET || env.CRON_SECRET || env.GEN_WATCHDOG_SECRET;
  if (!secret) return null;
  try {
    const origin = new URL(env.LEARNABLE_GENERATION_ORIGIN);
    // Deliberately restricted to the current Vercel hosting contract. A future
    // custom-domain change needs review; request Host/forwarded headers never do.
    if (origin.protocol !== 'https:' || !/^[a-z0-9-]+\.vercel\.app$/i.test(origin.hostname)
      || origin.port || origin.username || origin.password || origin.search || origin.hash || origin.pathname !== '/') return null;
    return { url: `${origin.origin}/api/gen/sweep`, secret };
  } catch { return null; }
}

export function continuationAuthorized(req, config) {
  const value = req.headers?.authorization || req.headers?.Authorization;
  if (!config || typeof value !== 'string') return false;
  const actual = Buffer.from(value), expected = Buffer.from(`Bearer ${config.secret}`);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

export function validContinuationRequest(body) {
  return body && Object.keys(body).length === 3 && typeof body.jobId === 'string'
    && /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(body.jobId)
    && typeof body.ownerId === 'string' && UUID.test(body.ownerId)
    && typeof body.runId === 'string' && UUID.test(body.runId);
}

export function ownsContinuationRun(job) {
  const state = job?.continuation;
  return !!state && state.version === 1 && state.runId === job.run_id
    && Number.isInteger(state.sequence) && state.sequence >= 1 && state.sequence <= MAX_CONTINUATION_HOPS
    && Number.isInteger(state.stalls) && state.stalls >= 0 && state.stalls <= MAX_CONTINUATION_STALLS
    && typeof state.progress === 'string' && /^[a-f0-9]{64}$/.test(state.progress);
}

export function isPendingContinuation(job) {
  return ownsContinuationRun(job) && job.continuation.phase === 'pending'
    && job.continuation.stalls < MAX_CONTINUATION_STALLS
    && ['queued', 'timed_out'].includes(job.status);
}

export function continuationProgress(job) {
  // Stable completed identities, not timestamps/messages/token counters. Rewriting
  // the same checkpoint is not new progress and cannot reset the stall limit.
  const keys = object => Object.keys(object || {}).filter(key => object[key]).sort();
  const completed = { brief: !!job.brief, research: keys(job.research), topics: keys(job.topics_by_key),
    sources: [...new Set((job.extracted_urls || []).map(source => source?.requestedUrl || source?.url).filter(Boolean))].sort(),
    course: job.saved_course_id || null,
    design: { reviewed: !!job.design_progress?.reviewed,
      items: Object.entries(job.design_progress?.items || {}).filter(([, item]) => item?.status === 'saved')
        .map(([key, item]) => `${key}/${item.outputHash}`).sort(), complete: job.design_progress?.status === 'complete' },
    images: Object.entries(job.image_progress?.items || {}).filter(([, item]) => item?.status === 'saved')
      .map(([key, item]) => `${key}/${item.operationId}`).sort() };
  return createHash('sha256').update(JSON.stringify(completed)).digest('hex');
}

export function nextContinuation(job) {
  const progress = continuationProgress(job);
  const previous = ownsContinuationRun(job) && job.continuation.phase === 'running' ? job.continuation : null;
  const sequence = previous ? previous.sequence + 1 : 1;
  const stalls = previous?.progress === progress ? previous.stalls + 1 : 0;
  const reason = sequence > MAX_CONTINUATION_HOPS ? 'hop_limit' : stalls >= MAX_CONTINUATION_STALLS ? 'no_progress' : null;
  return { version: 1, phase: reason ? 'held' : 'pending', runId: job.run_id,
    sequence: Math.min(sequence, MAX_CONTINUATION_HOPS), stalls: Math.min(stalls, MAX_CONTINUATION_STALLS), progress,
    ...(reason ? { reason } : {}) };
}

function scopedUpdate(supabase, job, fields) {
  return supabase.from('generation_jobs').update(fields).eq('id', job.id).eq('owner_id', job.owner_id)
    .eq('run_id', job.run_id).eq('status', job.status);
}

export async function claimContinuation(supabase, job, runId = randomUUID()) {
  if (!isPendingContinuation(job)) return null;
  const { data, error } = await scopedUpdate(supabase, job, {
    status: 'running', run_id: runId, completed_at: null, error: null,
    message: 'Continuing automatically from your saved progress…',
    continuation: { ...job.continuation, phase: 'running', runId },
    ...generationLeaseFields()
  }).eq('continuation->>phase', 'pending').eq('continuation->>runId', job.run_id).select('id').maybeSingle();
  if (error) throw error;
  return data ? { runId } : null;
}

export async function holdContinuation(supabase, job, reason, message) {
  const { data, error } = await scopedUpdate(supabase, job, {
    status: 'failed', error: message, message,
    continuation: { ...job.continuation, phase: 'held', reason }, ...generationTerminalFields()
  }).eq('continuation->>phase', 'pending').select('id').maybeSingle();
  if (error) throw error;
  return !!data;
}

export async function pauseForContinuation({ supabase, jobId, ownerId, runId, requestBudget,
  config = continuationConfig(), fetchImpl = (...args) => globalThis.fetch(...args) }) {
  if (!config) return false; // Disabled/unconfigured keeps the existing manual pause.
  const { data: job, error: readError } = await supabase.from('generation_jobs').select('*')
    .eq('id', jobId).eq('owner_id', ownerId).eq('run_id', runId).maybeSingle();
  if (readError) throw readError;
  if (!job || !RUNNER_WRITABLE_STATUSES.includes(job.status)) return true;
  const state = nextContinuation(job);
  const held = state.phase === 'held';
  const message = held
    ? 'Automatic continuation paused at its retry limit. Your completed work is saved. Review the course before resuming.'
    : 'Your progress is saved. Continuing automatically…';
  const { data, error } = await scopedUpdate(supabase, job, {
    status: held ? 'failed' : 'queued', error: held ? message : null, message,
    continuation: state, completed_at: held ? new Date().toISOString() : null, ...generationLeaseFields()
  }).select('id').maybeSingle();
  if (error) throw error;
  if (!data || held) return true;
  try {
    await requestBudget.runOperation(async signal => {
      const result = await fetchImpl(config.url, {
        method: 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${config.secret}`, 'x-learnable-continuation': '1' },
        body: JSON.stringify({ jobId, ownerId, runId })
      });
      if (!result.ok) throw new Error('Continuation acknowledgement unavailable');
      const ack = await result.json();
      if (ack?.ok !== true || typeof ack.accepted !== 'boolean') throw new Error('Invalid continuation acknowledgement');
    }, { phase: 'finish', timeoutMs: CONTINUATION_DELIVERY_MS });
  } catch {
    // A lost ACK is not proof of a lost claim. Never replay here, clear the
    // checkpoint, or overwrite a newer run. The durable pending lease is picked
    // up by the existing watchdog/sweep if the child never claimed it.
    console.warn(`[gen ${jobId}] continuation delivery unconfirmed; saved state retained`);
  }
  return true;
}
