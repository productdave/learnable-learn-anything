// POST /api/gen/credentials-ready
//
// Called after the user saves an Anthropic API key. It verifies the key is
// present in user_state, then clears durable "waiting for API key" messages.
// Recoverable background jobs are claimed and resumed server-side so the user
// does not need to keep the browser open after saving credentials.

import { waitUntil } from '@vercel/functions';
import { randomUUID } from 'node:crypto';
import { readApiKey, readJsonBody, requireSafeJobId, serviceClient, userFromRequest } from '../_lib/supabase-server.mjs';
import { runGeneration as defaultRunGeneration } from '../_lib/gen-runner.mjs';
import { createGenerationRequestBudget, bindGenerationClient, withGenerationSignal, isGenerationBudgetStop } from '../_lib/gen-request-budget.mjs';
import { API_KEY_WAITING_STATUSES, HUMAN_REVIEW_STATUSES, generationLeaseFields, sameRunFilter } from '../_lib/gen-state.mjs';
import { checkpointForJob, hasPendingRestartIntent, isRecoverableStatus, recoveryCheckpointForJob, recoveryModeFor, recoveryStageFor, resumeModeFor, resumeStageFor } from '../_lib/gen-recovery.mjs';
import { agentMessage } from '../../js/generator/agents.mjs';

export const config = {
  runtime: 'nodejs',
  maxDuration: 300
};

export function createCredentialsReadyHandler({ runGeneration = defaultRunGeneration, background = waitUntil, authenticate = userFromRequest, admin = serviceClient, createBudget = createGenerationRequestBudget } = {}) {
return async function handler(req, res) {
  const requestBudget = createBudget({ request: req });
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  try {
  let user, supabase, rawClient;
  try {
    const auth = await requestBudget.runOperation(signal => authenticate(req, { fetcher: withGenerationSignal(signal) }), { timeoutMs: 10_000 });
    user = auth.user;
    rawClient = admin();
    supabase = bindGenerationClient(rawClient, requestBudget, { phase: 'work' });
  } catch (e) {
    if (isGenerationBudgetStop(e)) throw e;
    return res.status(e.statusCode || 401).json({ error: e.message });
  }

  let apiKey;
  try {
    apiKey = await readApiKey(supabase, user.id);
  } catch (e) {
    if (isGenerationBudgetStop(e)) throw e;
    return res.status(e.statusCode || 400).json({ error: e.message });
  }

  try {
    const body = (await requestBudget.runOperation(() => readJsonBody(req), { timeoutMs: 10_000 })) || {};
    let jobId = '';
    if (body.jobId) {
      try { jobId = requireSafeJobId(body.jobId); }
      catch (e) { return res.status(e.statusCode || 400).json({ error: e.message }); }
    }

    const result = await recoverCredentialWaitsForUser(supabase, user.id, jobId, {
      apiKey,
      ownerEmail: user.email || null,
      startRecoverable: !!jobId,
      requestBudget,
      runnerClient: rawClient
    });
    res.status(200).json({ ok: true, cleared: result.cleared, started: result.started });
    if (result.runs.length) {
      background(Promise.all(result.runs.map(run => runGeneration(run).catch((err) => {
        console.error(`[/api/gen/credentials-ready] runner threw for ${run.jobId}:`, err);
      }))));
    }
    return;
  } catch (e) {
    if (isGenerationBudgetStop(e)) throw e;
    return res.status(500).json({ error: e.message || String(e) });
  }
  } catch (error) {
    if (isGenerationBudgetStop(error)) {
      requestBudget.stop(error);
      return res.status(503).json({ code: error.code, error: 'The request took too long to confirm. Your connection has not been removed. Check the latest course state before trying again.' });
    }
    return res.status(500).json({ error: error.message || String(error) });
  }
}
}
export default createCredentialsReadyHandler();

export async function clearCredentialWaitsForUser(supabase, ownerId, jobId = '') {
  const result = await recoverCredentialWaitsForUser(supabase, ownerId, jobId);
  return result.cleared;
}

export async function recoverCredentialWaitsForUser(supabase, ownerId, jobId = '', { apiKey = '', ownerEmail = null, startRecoverable = !!jobId, requestBudget = null, runnerClient = supabase } = {}) {
  let query = supabase
    .from('generation_jobs')
    .select('*')
    .eq('owner_id', ownerId)
    .in('status', API_KEY_WAITING_STATUSES);
  if (jobId) query = query.eq('id', jobId);

  const { data, error } = await query;
  if (error) throw error;

  const waiting = (data || []).filter(row => isMissingApiKeyText(`${row.error || ''}\n${row.message || ''}`));
  const results = await Promise.all(waiting.map(row => recoverWaitingRow(supabase, ownerId, row, { apiKey, ownerEmail, startRecoverable, requestBudget, runnerClient })));
  const confirmed = results.filter(Boolean);
  return {
    cleared: confirmed.map(result => result.id),
    started: confirmed.filter(result => result.started).map(result => result.id),
    runs: confirmed.map(result => result.run).filter(Boolean)
  };
}

async function recoverWaitingRow(supabase, ownerId, row, { apiKey = '', ownerEmail = null, startRecoverable = false, requestBudget = null, runnerClient = supabase } = {}) {
  if (startRecoverable && apiKey && isRecoverableStatus(row.status)) {
    requestBudget?.assertCanStart();
    const claimed = await claimRecoverableWaitingRow(supabase, ownerId, row);
    if (!claimed) return null;
    return {
      id: row.id,
      started: true,
      run: {
        supabase: runnerClient,
        ...(requestBudget ? { requestBudget: requestBudget.fork() } : {}),
        jobId: row.id,
        ownerId,
        runId: claimed.runId,
        ownerEmail,
        apiKey,
        userBrief: claimed.userBrief,
        pdfRefs: claimed.userBrief?.pdfRefs || [],
        checkpoint: claimed.checkpoint,
        mode: claimed.mode
      }
    };
  }
  const cleared = await clearWaitingRow(supabase, ownerId, row);
  return cleared ? { id: cleared, started: false, run: null } : null;
}

async function clearWaitingRow(supabase, ownerId, row) {
  const now = new Date().toISOString();
  const message = HUMAN_REVIEW_STATUSES.includes(row.status)
    ? 'API key saved. Continue from this checkpoint.'
    : row.status === 'partial'
      ? (isPendingRestartWait(row) ? 'API key saved. Restart from the saved request.' : 'API key saved. Retry missing topics from the saved checkpoint.')
      : isPendingRestartWait(row)
        ? 'API key saved. Restart from the saved request.'
        : 'API key saved. Resume from the saved checkpoint.';
  let update = supabase
    .from('generation_jobs')
    .update({
      error: null,
      message,
      updated_at: now
    })
    .eq('id', row.id)
    .eq('owner_id', ownerId)
    .eq('status', row.status);
  update = sameRunFilter(update, row.run_id);
  update = sameValueFilter(update, 'error', row.error);
  update = sameValueFilter(update, 'message', row.message);

  const { data, error } = await update
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return data?.id || null;
}

async function claimRecoverableWaitingRow(supabase, ownerId, row) {
  const runId = randomUUID();
  const pendingRestart = isPendingRestartWait(row);
  const stage = pendingRestart ? recoveryStageFor(row) : resumeStageFor(row);
  const mode = pendingRestart ? recoveryModeFor(row) : resumeModeFor(row);
  const checkpoint = pendingRestart ? recoveryCheckpointForJob(row) : checkpointForJob(row);
  const userBrief = row.user_brief || {};
  const message = pendingRestart
    ? 'API key saved. Restarting from the saved request...'
    : agentMessage(stage, 'API key saved. Resuming from saved checkpoint...');
  let update = supabase
    .from('generation_jobs')
    .update({
      status: 'running',
      run_id: runId,
      stage,
      error: null,
      message,
      recovery_attempts: 0,
      last_recovery_at: null,
      completed_at: null,
      ...(pendingRestart ? {
        user_brief: userBrief,
        extracted_urls: row.extracted_urls || [],
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
      ...generationLeaseFields()
    })
    .eq('id', row.id)
    .eq('owner_id', ownerId)
    .eq('status', row.status);
  update = sameRunFilter(update, row.run_id);
  update = sameValueFilter(update, 'error', row.error);
  update = sameValueFilter(update, 'message', row.message);

  const { data, error } = await update
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return data ? { runId, stage, mode, checkpoint, userBrief } : null;
}

function sameValueFilter(query, field, value) {
  return value == null ? query.is(field, null) : query.eq(field, value);
}

export function isMissingApiKeyText(message) {
  return /No Anthropic API key|Missing API key|Anthropic API key (?:is )?required|waiting for an Anthropic API key|Add one(?: to your account)?, then (?:resume|continue|restart)/i.test(String(message || ''));
}

export function isPendingRestartWait(row) {
  return hasPendingRestartIntent(row);
}
