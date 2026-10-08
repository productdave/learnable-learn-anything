// POST /api/gen/resume
// Body: { jobId, expected: { status, runId } }
//
// Reads the existing generation_jobs row, picks up the pipeline from the last
// checkpoint (brief, research per module, topics_by_key). Skips work that
// already finished — no re-billing.

import { waitUntil } from '@vercel/functions';
import { randomUUID } from 'node:crypto';
import { readJsonBody, requireSafeJobId, userFromRequest, readApiKey, serviceClient } from '../_lib/supabase-server.mjs';
import { runGeneration as defaultRunGeneration } from '../_lib/gen-runner.mjs';
import { createGenerationRequestBudget, bindGenerationClient, withGenerationSignal, isGenerationBudgetStop } from '../_lib/gen-request-budget.mjs';
import { checkpointForJob, isImageOnlyRecovery, isRecoverableStatus, isReviewStatus, RECOVERABLE_STATUSES, resumeModeFor, resumeStageFor } from '../_lib/gen-recovery.mjs';
import { agentMessage } from '../../js/generator/agents.mjs';
import { generationLeaseFields, sameRunFilter, requireGenerationExpectation } from '../_lib/gen-state.mjs';

export const config = {
  runtime: 'nodejs',
  maxDuration: 300
};

export function createResumeHandler({ runGeneration = defaultRunGeneration, background = waitUntil, authenticate = userFromRequest, admin = serviceClient, createBudget = createGenerationRequestBudget } = {}) {
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

  let jobId, body;
  try { body = await requestBudget.runOperation(() => readJsonBody(req), { timeoutMs: 10_000 }); jobId = requireSafeJobId(body?.jobId); }
  catch (e) { if (isGenerationBudgetStop(e)) throw e; return res.status(e.statusCode || 400).json({ error: e.message }); }

  const { data: job, error } = await supabase
    .from('generation_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (error || !job) return res.status(404).json({ error: 'Job not found' });
  try { requireGenerationExpectation(body.expected, job); }
  catch (e) { return res.status(e.statusCode).json({ error: e.message, code: e.code }); }
  if (isReviewStatus(job.status)) {
    return res.status(409).json({ error: 'This job is waiting for human review. Use the review action instead of resume.' });
  }
  if (!isRecoverableStatus(job.status)) {
    return res.status(409).json({ error: `Job is ${job.status}; only failed, timed-out, or partial jobs can be resumed.` });
  }

  let apiKey;
  try {
    if (isImageOnlyRecovery(job)) apiKey = null;
    else apiKey = await readApiKey(supabase, user.id);
  }
  catch (e) {
    if (isGenerationBudgetStop(e)) throw e;
    let marked;
    try {
      marked = await markRecoverableWaitingForApiKey(supabase, jobId, user.id, job.status, job.run_id, e.message || String(e));
    } catch (markErr) {
      if (isGenerationBudgetStop(markErr)) throw markErr;
      return res.status(500).json({ error: markErr.message || String(markErr) });
    }
    if (!marked) return res.status(409).json({ code: 'GENERATION_CHANGED', error: 'This course changed. No action was taken. Review the latest course state before trying again.' });
    return res.status(e.statusCode || 400).json({ error: e.message });
  }

  const runId = randomUUID();
  requestBudget.assertCanStart();
  let transitionQuery = supabase.from('generation_jobs').update({
    status: 'running',
    run_id: runId,
    recovery_attempts: 0,
    last_recovery_at: null,
    stage: resumeStageFor(job),
    error: null,
    message: agentMessage(resumeStageFor(job), 'Resuming from checkpoint…'),
    completed_at: null,
    ...generationLeaseFields()
  })
    .eq('id', jobId)
    .eq('owner_id', user.id)
    .eq('status', job.status);
  transitionQuery = sameRunFilter(transitionQuery, job.run_id);
  const { data: transition, error: transitionErr } = await transitionQuery
    .select('id')
    .maybeSingle();
  if (transitionErr) return res.status(500).json({ error: transitionErr.message });
  if (!transition) return res.status(409).json({ code: 'GENERATION_CHANGED', error: 'This course changed. No action was taken. Review the latest course state before trying again.' });

  res.status(200).json({ jobId, resumed: true });

  background(
    runGeneration({
      supabase: rawClient,
      requestBudget,
      jobId,
      ownerId: user.id,
      runId,
      ownerEmail: user.email || null,
      apiKey,
      userBrief: job.user_brief,
      pdfRefs: job.user_brief?.pdfRefs || [],
      checkpoint: checkpointForJob(job),
      retryFailedImages: true, // Explicit course-level Resume, never a timed continuation.
      retryFailedDesign: true,
      mode: resumeModeFor(job)
    }).catch((err) => {
      console.error(`[/api/gen/resume] runner threw for ${jobId}:`, err);
    })
  );
  } catch (error) {
    if (isGenerationBudgetStop(error)) {
      requestBudget.stop(error);
      return res.status(503).json({ code: error.code, error: 'The request took too long to confirm. Your saved checkpoints are retained. Check the latest course state before trying again.' });
    }
    return res.status(500).json({ error: error.message || String(error) });
  }
}
}
export default createResumeHandler();

export async function markRecoverableWaitingForApiKey(supabase, jobId, ownerId, expectedStatus, expectedRunId, error) {
  const now = new Date().toISOString();
  let query = supabase
    .from('generation_jobs')
    .update({
      error,
      message: 'Generation is waiting for an Anthropic API key. Add one to your account, then resume from the saved checkpoint.',
      updated_at: now
    })
    .eq('id', jobId)
    .eq('owner_id', ownerId)
    .eq('status', expectedStatus);
  query = sameRunFilter(query, expectedRunId);
  const { data, error: updateErr } = await query
    .select('id')
    .maybeSingle();
  if (updateErr) throw updateErr;
  return !!data;
}
