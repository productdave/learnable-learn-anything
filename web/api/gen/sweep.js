// GET/POST /api/gen/sweep
//
// Secret-protected cloud recovery loop. Intended for Vercel Cron.
// 1. Marks expired live jobs as timed_out.
// 2. Claims a small batch of timed_out jobs.
// 3. Resumes each from its latest checkpoint using the same runner as /resume.

import { waitUntil } from '@vercel/functions';
import { randomUUID } from 'node:crypto';
import { readApiKey, serviceClient } from '../_lib/supabase-server.mjs';
import { runGeneration as defaultRunGeneration } from '../_lib/gen-runner.mjs';
import { createGenerationRequestBudget, bindGenerationClient, isGenerationBudgetStop } from '../_lib/gen-request-budget.mjs';
import { AUTO_RECOVERY_EXHAUSTED_ERROR, autoRecoveryExhaustedPatch, autoRecoveryFailurePatch, canAutoRecover, hasPendingRestartIntent, isImageOnlyRecovery, MAX_AUTO_RECOVERY_ATTEMPTS, recoveryAttemptsFor, recoveryCheckpointForJob, recoveryModeFor, recoveryStageFor, timeoutPatch } from '../_lib/gen-recovery.mjs';
import { agentMessage } from '../../js/generator/agents.mjs';
import { removePdfUploadsForJob } from './delete.js';
import { generationCancelledTerminalFields, generationLeaseFields, LIVE_GENERATION_STATUSES, sameRunFilter } from '../_lib/gen-state.mjs';
import { continuationConfig, continuationAuthorized, validContinuationRequest, isPendingContinuation, ownsContinuationRun, claimContinuation, holdContinuation } from '../_lib/gen-continuation.mjs';
import { boundedJson } from '../_lib/bounded-json.mjs';

export const config = {
  runtime: 'nodejs',
  maxDuration: 300
};

const RECOVERY_WRITABLE_STATUSES = ['running', 'failed'];
const BATCH_LIMIT = 3;
const CANCELLED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const CANCELLED_PRUNE_LIMIT = 25;

function leaseFields() {
  return {
    ...generationLeaseFields(),
    completed_at: null
  };
}

export function createSweepHandler({ runGeneration = defaultRunGeneration, background = waitUntil, admin = serviceClient, createBudget = createGenerationRequestBudget } = {}) {
return async function handler(req, res) {
  const requestBudget = createBudget({ request: req });
  if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ error: 'GET or POST only' });
  const continuationHeader = req.headers?.['x-learnable-continuation'];
  if (continuationHeader !== undefined && continuationHeader !== '1') return res.status(400).json({ error: 'Invalid continuation request.' });
  const continuationRequest = continuationHeader === '1';
  const continuation = continuationConfig();
  if (continuationRequest && req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  if (continuationRequest && !continuation) return res.status(503).json({ error: 'Automatic continuation is unavailable.' });
  if (continuationRequest && !continuationAuthorized(req, continuation)) return res.status(401).json({ error: 'Invalid continuation authorization.' });
  if (!hasSweepSecret(req)) return res.status(401).json({ error: 'Missing or invalid sweep secret' });

  let supabase, rawClient;
  try { rawClient = admin(); supabase = bindGenerationClient(rawClient, requestBudget, { phase: 'work' }); }
  catch (e) { return res.status(e.statusCode || 500).json({ error: e.message }); }

  try {
    if (continuationRequest) {
      let body;
      try { body = await requestBudget.runOperation(() => boundedJson(req, 1024), { timeoutMs: 5_000 }); }
      catch (error) { if (isGenerationBudgetStop(error)) throw error; return res.status(400).json({ error: 'Invalid continuation request.' }); }
      if (!validContinuationRequest(body)) return res.status(400).json({ error: 'Invalid continuation request.' });
      const { data: job, error } = await supabase.from('generation_jobs').select('*')
        .eq('id', body.jobId).eq('owner_id', body.ownerId).eq('run_id', body.runId).maybeSingle();
      if (error) throw error;
      if (!isPendingContinuation(job)) return res.status(200).json({ ok: true, accepted: false });
      const accepted = await startContinuation(job);
      return res.status(200).json({ ok: true, accepted });
    }
    const timedOut = await markExpiredJobs(supabase);
    const cancelled = await markExpiredCancels(supabase);
    const prunedCancelled = await pruneOldCancelledJobs(supabase);
    const exhausted = await markRecoveryExhausted(supabase);
    const candidates = await loadTimedOutJobs(supabase);
    const claimed = [];

    for (const job of candidates) {
      if (!canAutoRecover(job)) continue;
      if (ownsContinuationRun(job)) {
        if (continuation && isPendingContinuation(job) && await startContinuation(job)) claimed.push(job.id);
        continue;
      }
      requestBudget.assertCanStart();
      const preflight = await preflightRecoveryCredentials(supabase, job, requestBudget);
      if (!preflight.ok) {
        const marked = await markRecoveryWaitingForApiKey(supabase, job, preflight.error);
        if (!marked) console.warn(`[/api/gen/sweep] skipped missing-key marker for changed job ${job.id}`);
        continue;
      }
      requestBudget.assertCanStart();
      const claim = await claimTimedOutJob(supabase, job);
      if (!claim) continue;
      claimed.push(job.id);
      background(resumeJob(rawClient, job, claim.runId, preflight, { requestBudget: requestBudget.fork(), runGeneration }));
    }

    return res.status(200).json({ ok: true, timedOut, cancelled, prunedCancelled, exhausted, claimed });

    async function startContinuation(job) {
      requestBudget.assertCanStart();
      const preflight = await preflightRecoveryCredentials(supabase, job, requestBudget);
      if (!preflight.ok) {
        await holdContinuation(supabase, job, 'credential_unavailable', 'Automatic continuation is waiting for an Anthropic API key. Add one to your account, then resume. Your saved progress is retained.');
        return false;
      }
      requestBudget.assertCanStart();
      const claim = await claimContinuation(supabase, job);
      if (!claim) return false;
      background(resumeJob(rawClient, job, claim.runId, preflight, { requestBudget: requestBudget.fork(), runGeneration }));
      return true;
    }
  } catch (e) {
    if (isGenerationBudgetStop(e)) {
      requestBudget.stop(e);
      return res.status(503).json({ code: e.code, error: 'Recovery reached its request time limit. Saved checkpoints and unclaimed jobs are retained.' });
    }
    return res.status(500).json({ error: e.message || String(e) });
  }
}
}
export default createSweepHandler();

export async function markExpiredJobs(supabase, now = new Date().toISOString()) {
  const { data: staleRows, error: staleErr } = await supabase
    .from('generation_jobs')
    .select('id,owner_id,run_id,error,message,continuation')
    .in('status', LIVE_GENERATION_STATUSES)
    .lt('lease_expires_at', now);
  if (staleErr) throw staleErr;

  const out = [];
  for (const row of staleRows || []) {
    let update = supabase
      .from('generation_jobs')
      .update({
        ...timeoutPatch(row, now)
      })
      .eq('id', row.id)
      .eq('owner_id', row.owner_id)
      .in('status', LIVE_GENERATION_STATUSES)
      .lt('lease_expires_at', now);
    update = sameRunFilter(update, row.run_id);
    const { data, error } = await update
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (data) out.push(data.id);
  }
  return out;
}

export async function markExpiredCancels(supabase, now = new Date().toISOString()) {
  const { data: staleRows, error: staleErr } = await supabase
    .from('generation_jobs')
    .select('id,owner_id,run_id')
    .eq('status', 'cancelling')
    .lt('lease_expires_at', now);
  if (staleErr) throw staleErr;

  const out = [];
  for (const row of staleRows || []) {
    let update = supabase
      .from('generation_jobs')
      .update(generationCancelledTerminalFields(new Date(now)))
      .eq('id', row.id)
      .eq('owner_id', row.owner_id)
      .eq('status', 'cancelling')
      .lt('lease_expires_at', now);
    update = sameRunFilter(update, row.run_id);
    const { data, error } = await update
      .select('id,owner_id')
      .maybeSingle();
    if (error) throw error;
    if (!data) continue;
    await removePdfUploadsForJob(supabase, row.owner_id, row.id);
    out.push(data.id);
  }
  return out;
}

export async function pruneOldCancelledJobs(supabase, nowMs = Date.now()) {
  const cutoff = new Date(nowMs - CANCELLED_RETENTION_MS).toISOString();
  const { data, error } = await supabase
    .from('generation_jobs')
    .select('id,owner_id')
    .eq('status', 'cancelled')
    .lt('updated_at', cutoff)
    .limit(CANCELLED_PRUNE_LIMIT);
  if (error) throw error;

  const pruned = [];
  for (const row of data || []) {
    await removePdfUploadsForJob(supabase, row.owner_id, row.id);
    const { error: deleteErr } = await supabase.rpc('delete_generation_job_for_owner', {
      p_job_id: row.id,
      p_owner_id: row.owner_id
    });
    if (deleteErr) {
      console.warn(`[/api/gen/sweep] could not prune cancelled job ${row.id}:`, deleteErr.message || deleteErr);
      continue;
    }
    pruned.push(row.id);
  }
  return pruned;
}

async function loadTimedOutJobs(supabase) {
  const { data, error } = await supabase
    .from('generation_jobs')
    .select('*')
    .eq('status', 'timed_out')
    .lt('recovery_attempts', MAX_AUTO_RECOVERY_ATTEMPTS)
    .order('updated_at', { ascending: true })
    .limit(BATCH_LIMIT);
  if (error) throw error;
  return data || [];
}

export async function claimTimedOutJob(supabase, job) {
  const runId = randomUUID();
  const now = new Date().toISOString();
  const pendingRestart = hasPendingRestartIntent(job);
  const stage = recoveryStageFor(job);
  let query = supabase
    .from('generation_jobs')
    .update({
      status: 'running',
      run_id: runId,
      recovery_attempts: recoveryAttemptsFor(job) + 1,
      last_recovery_at: now,
      stage,
      error: null,
      message: pendingRestart
        ? 'Cloud recovery is restarting from the saved request...'
        : agentMessage(stage, 'Cloud recovery is resuming from checkpoint...'),
      ...(pendingRestart ? {
        user_brief: job.user_brief || {},
        extracted_urls: job.extracted_urls || [],
        brief: null,
        outline: null,
        research: {},
        topics_by_key: {},
        image_progress: null,
        design_progress: null,
        continuation: null,
        failures: [],
        topics_done: 0,
        topics_total: 0
      } : {}),
      ...leaseFields()
    })
    .eq('id', job.id)
    .eq('owner_id', job.owner_id)
    .eq('status', 'timed_out');
  query = sameRunFilter(query, job.run_id);
  const { data, error } = await query
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return data ? { runId } : null;
}

export async function markRecoveryExhausted(supabase) {
  const now = new Date().toISOString();
  const { data: exhaustedRows, error: loadErr } = await supabase
    .from('generation_jobs')
    .select('id,owner_id,run_id,error,message')
    .eq('status', 'timed_out')
    .gte('recovery_attempts', MAX_AUTO_RECOVERY_ATTEMPTS)
    .neq('error', AUTO_RECOVERY_EXHAUSTED_ERROR);
  if (loadErr) throw loadErr;

  const out = [];
  for (const row of exhaustedRows || []) {
    let query = supabase
      .from('generation_jobs')
      .update(autoRecoveryExhaustedPatch(row, now))
      .eq('id', row.id)
      .eq('owner_id', row.owner_id)
      .eq('status', 'timed_out')
      .gte('recovery_attempts', MAX_AUTO_RECOVERY_ATTEMPTS)
      .neq('error', AUTO_RECOVERY_EXHAUSTED_ERROR);
    query = sameRunFilter(query, row.run_id);
    const { data, error } = await query
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (data) out.push(data.id);
  }
  return out;
}

async function preflightRecoveryCredentials(supabase, job, requestBudget) {
  try {
    // The image primitive resolves the owner's protected OpenAI connection.
    // Completed text does not need an unrelated Anthropic credential again.
    if (isImageOnlyRecovery(job)) return { ok: true, apiKey: null, ownerEmail: null };
    const apiKey = await readApiKey(supabase, job.owner_id);
    const ownerEmail = await requestBudget.runOperation(() => getOwnerEmail(supabase, job.owner_id), { timeoutMs: 10_000 });
    return { ok: true, apiKey, ownerEmail };
  } catch (err) {
    if (isGenerationBudgetStop(err)) throw err;
    return { ok: false, error: err?.message || String(err || 'Could not read API key.') };
  }
}

export async function markRecoveryWaitingForApiKey(supabase, job, error) {
  const now = new Date().toISOString();
  const message = hasPendingRestartIntent(job)
    ? 'Automatic recovery is waiting for an Anthropic API key. Add one, then restart from the saved request.'
    : 'Automatic recovery is waiting for an Anthropic API key. Add one, then resume from the saved checkpoint.';
  let query = supabase
    .from('generation_jobs')
    .update({
      error,
      message,
      updated_at: now
    })
    .eq('id', job.id)
    .eq('owner_id', job.owner_id)
    .eq('status', 'timed_out');
  query = sameRunFilter(query, job.run_id);
  const { data, error: updateErr } = await query
    .select('id')
    .maybeSingle();
  if (updateErr) throw updateErr;
  return !!data;
}

async function resumeJob(supabase, job, runId, credentials, { requestBudget, runGeneration }) {
  const finishClient = bindGenerationClient(supabase, requestBudget);
  try {
    const { apiKey, ownerEmail } = credentials;
    await runGeneration({
      supabase,
      requestBudget,
      jobId: job.id,
      ownerId: job.owner_id,
      runId,
      ownerEmail,
      apiKey,
      userBrief: job.user_brief || {},
      pdfRefs: job.user_brief?.pdfRefs || [],
      checkpoint: recoveryCheckpointForJob(job),
      mode: recoveryModeFor(job)
    });
  } catch (err) {
    console.error(`[/api/gen/sweep] recovery failed for ${job.id}:`, err);
    await finishClient
      .from('generation_jobs')
      .update(autoRecoveryFailurePatch(job, err))
      .eq('id', job.id)
      .eq('owner_id', job.owner_id)
      .eq('run_id', runId)
      .in('status', RECOVERY_WRITABLE_STATUSES);
  }
}

async function getOwnerEmail(supabase, userId) {
  try {
    const { data } = await supabase.auth.admin.getUserById(userId);
    return data?.user?.email || null;
  } catch {
    return null;
  }
}

function hasSweepSecret(req) {
  const configured = process.env.GEN_SWEEP_SECRET || process.env.CRON_SECRET || process.env.GEN_WATCHDOG_SECRET;
  if (!configured) return false;
  const auth = req.headers.authorization || req.headers.Authorization || '';
  if (auth === `Bearer ${configured}`) return true;
  const header = req.headers['x-sweep-secret'] || req.headers['X-Sweep-Secret'] || req.headers['x-watchdog-secret'] || req.headers['X-Watchdog-Secret'];
  const querySecret = req.query?.secret;
  return header === configured || querySecret === configured;
}
