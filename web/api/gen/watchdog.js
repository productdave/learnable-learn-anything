// POST /api/gen/watchdog
//
// Marks stale cloud generation jobs as timed_out when their lease expired.
// The browser calls this for the signed-in user's jobs; a Vercel Cron can also
// call it with GEN_WATCHDOG_SECRET to sweep all users.

import { timeoutPatch } from '../_lib/gen-recovery.mjs';
import { serviceClient, userFromRequest } from '../_lib/supabase-server.mjs';
import { removePdfUploadsForJob } from './delete.js';
import { generationCancelledTerminalFields, LIVE_GENERATION_STATUSES, sameRunFilter } from '../_lib/gen-state.mjs';
import { continuationConfig, isPendingContinuation } from '../_lib/gen-continuation.mjs';

export const config = {
  runtime: 'nodejs',
  maxDuration: 30
};

export function createWatchdogHandler({ admin = serviceClient, authenticate = userFromRequest,
  fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
return async function handler(req, res) {
  if (!['GET', 'POST'].includes(req.method)) {
    return res.status(405).json({ error: 'GET or POST only' });
  }

  let supabase;
  let ownerId = null;
  try {
    if (hasCronSecret(req)) {
      supabase = admin();
    } else {
      const auth = await authenticate(req);
      supabase = admin();
      ownerId = auth.user.id;
    }
  } catch (e) {
    return res.status(e.statusCode || 401).json({ error: e.message });
  }

  try {
    const now = new Date().toISOString();
    // A browser/cron request is independent of the worker's self-call chain.
    // Redeliver only a persisted, unclaimed handoff. The sweep's owner/run CAS
    // decides who starts; an uncertain running request is NEVER replayed here.
    await retryPendingHandoffs(supabase, { ownerId, now, fetchImpl });
    const timedOut = await markExpiredLiveJobsTimedOut(supabase, { ownerId, now });
    const cancelled = await markExpiredCancellingJobsCancelled(supabase, { ownerId, now });
    await Promise.all((cancelled || []).map(row => removePdfUploadsForJob(supabase, row.owner_id, row.id)));

    return res.status(200).json(watchdogResponse(timedOut, cancelled));
  } catch (e) {
    return res.status(500).json({ error: e.message || String(e) });
  }
}
}
export default createWatchdogHandler();

export async function retryPendingHandoffs(supabase, { ownerId = null, now = new Date().toISOString(),
  config = continuationConfig(), fetchImpl = (...args) => globalThis.fetch(...args) } = {}) {
  if (!config) return [];
  // Leave a newly queued handoff time to reach its child normally. Do not revive
  // old timed_out/failed jobs: those still need the user's explicit Resume.
  const cutoff = new Date(new Date(now).getTime() - 30_000).toISOString();
  let query = supabase.from('generation_jobs').select('id,owner_id,run_id,status,continuation')
    .eq('status', 'queued').eq('continuation->>phase', 'pending')
    .lt('updated_at', cutoff).order('updated_at').limit(3);
  if (ownerId) query = query.eq('owner_id', ownerId);
  const { data, error } = await query.abortSignal(AbortSignal.timeout(5_000));
  if (error) throw error;
  const accepted = [];
  for (const job of data || []) {
    if (!isPendingContinuation(job)) continue;
    try {
      const response = await fetchImpl(config.url, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(3_000),
        headers: { 'Content-Type': 'application/json', authorization: `Bearer ${config.secret}`, 'x-learnable-continuation': '1' },
        body: JSON.stringify({ jobId: job.id, ownerId: job.owner_id, runId: job.run_id }) });
      if (!response.ok) {
        console.warn(`[gen ${job.id}] watchdog handoff HTTP ${response.status}; checkpoint retained`);
        continue;
      }
      const ack = await response.json();
      if (ack?.ok === true && ack.accepted === true) accepted.push(job.id);
    } catch {
      // Lost acknowledgement is not a lost claim. Expiry below rechecks run and
      // lease, so a child that already claimed the job cannot be overwritten.
      console.warn(`[gen ${job.id}] watchdog handoff unconfirmed; checkpoint retained`);
    }
  }
  return accepted;
}

export function watchdogResponse(expired = [], cancelled = []) {
  return {
    ok: true,
    // Do not tell the browser to replace an uncertain failure with its ordinary
    // timeout/retry message. Rehydration and realtime carry the saved failure.
    timedOut: expired.filter(row => row.status === 'timed_out').map(row => row.id),
    failed: expired.filter(row => row.status === 'failed').map(row => row.id),
    cancelled: cancelled.map(row => row.id)
  };
}

export async function markExpiredLiveJobsTimedOut(supabase, { ownerId = null, now = new Date().toISOString() } = {}) {
  let staleQuery = supabase
    .from('generation_jobs')
    .select('id,owner_id,run_id,error,message,continuation')
    .in('status', LIVE_GENERATION_STATUSES)
    .lt('lease_expires_at', now);
  if (ownerId) staleQuery = staleQuery.eq('owner_id', ownerId);

  const { data: staleRows, error: staleErr } = await staleQuery;
  if (staleErr) throw staleErr;
  const out = [];
  for (const row of staleRows || []) {
    const patch = timeoutPatch(row, now);
    let updateQuery = supabase
      .from('generation_jobs')
      .update(patch)
      .eq('id', row.id)
      .eq('owner_id', row.owner_id)
      .in('status', LIVE_GENERATION_STATUSES)
      .lt('lease_expires_at', now);
    updateQuery = sameRunFilter(updateQuery, row.run_id);
    const { data, error } = await updateQuery
      .select('id,owner_id')
      .maybeSingle();
    if (error) throw error;
    if (data) out.push({ ...data, status: patch.status });
  }
  return out;
}

export async function markExpiredCancellingJobsCancelled(supabase, { ownerId = null, now = new Date().toISOString() } = {}) {
  let staleQuery = supabase
    .from('generation_jobs')
    .select('id,owner_id,run_id')
    .eq('status', 'cancelling')
    .lt('lease_expires_at', now);
  if (ownerId) staleQuery = staleQuery.eq('owner_id', ownerId);

  const { data: staleRows, error: staleErr } = await staleQuery;
  if (staleErr) throw staleErr;
  const out = [];
  for (const row of staleRows || []) {
    let updateQuery = supabase
      .from('generation_jobs')
      .update(generationCancelledTerminalFields(new Date(now)))
      .eq('id', row.id)
      .eq('owner_id', row.owner_id)
      .eq('status', 'cancelling')
      .lt('lease_expires_at', now);
    updateQuery = sameRunFilter(updateQuery, row.run_id);
    const { data, error } = await updateQuery
      .select('id,owner_id')
      .maybeSingle();
    if (error) throw error;
    if (data) out.push(data);
  }
  return out;
}

function hasCronSecret(req) {
  const configured = process.env.GEN_WATCHDOG_SECRET || process.env.GEN_SWEEP_SECRET || process.env.CRON_SECRET;
  if (!configured) return false;
  const auth = req.headers.authorization || req.headers.Authorization || '';
  if (auth === `Bearer ${configured}`) return true;
  const header = req.headers['x-watchdog-secret'] || req.headers['X-Watchdog-Secret'];
  const querySecret = req.query?.secret;
  return header === configured || querySecret === configured;
}
