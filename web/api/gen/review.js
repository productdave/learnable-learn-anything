// POST /api/gen/review
// Body: { jobId, action, feedback? }
//
// Actions:
// - approve_curriculum: run research, then pause for research review.
// - revise_curriculum: rerun curriculum with feedback, then pause again.
// - approve_research: write lessons, assemble, and save the course.
// - rerun_research: rerun research with feedback, then pause again.

import { waitUntil } from '@vercel/functions';
import { randomUUID } from 'node:crypto';
import { requireSafeJobId, userFromRequest, readApiKey, serviceClient } from '../_lib/supabase-server.mjs';
import { runGeneration as defaultRunGeneration } from '../_lib/gen-runner.mjs';
import { agentMessage, agentNameForStage } from '../../js/generator/agents.mjs';
import { outlineForBrief, topicCountForBrief } from '../_lib/gen-brief.mjs';
import { appendReviewHistory } from '../_lib/gen-review-history.mjs';
import { hasCompleteResearchCheckpoint } from '../_lib/gen-research-checkpoint.mjs';
import { generationLeaseFields, sameRunFilter, requireGenerationExpectation } from '../_lib/gen-state.mjs';
import { acceptedReviewSources } from '../_lib/review-sources.mjs';
import { boundedJson } from '../_lib/bounded-json.mjs';
import { createGenerationRequestBudget, bindGenerationClient, withGenerationSignal, isGenerationBudgetStop } from '../_lib/gen-request-budget.mjs';

export const config = {
  runtime: 'nodejs',
  maxDuration: 300
};

function leaseFields() {
  return {
    ...generationLeaseFields(),
    completed_at: null
  };
}

export function createReviewHandler({ runGeneration = defaultRunGeneration, background = waitUntil, authenticate = userFromRequest, admin = serviceClient, createBudget = createGenerationRequestBudget } = {}) {
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

  let body;
  try { body = await requestBudget.runOperation(() => boundedJson(req, 1100000), { timeoutMs: 10_000 }); }
  catch (e) { if (isGenerationBudgetStop(e)) throw e; return res.status(400).json({ error: 'Invalid or oversized review request.' }); }
  let jobId;
  try { jobId = requireSafeJobId(body.jobId); }
  catch (e) { return res.status(e.statusCode || 400).json({ error: e.message }); }
  const action = body.action;
  const feedback = String(body.feedback || '').trim();
  if (!action) return res.status(400).json({ error: 'Missing { jobId, action }' });

  const { data: job, error } = await supabase
    .from('generation_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (error || !job) return res.status(404).json({ error: 'Job not found' });
  try { requireGenerationExpectation(body.expected, job); }
  catch (e) { return res.status(e.statusCode).json({ error: e.message, code: e.code }); }

  const runId = randomUUID();
  let transition;
  try {
    if (body.sourceChanges && action !== 'rerun_research') return res.status(400).json({ error: 'Changed sources must be researched again before writing lessons.' });
    const sourceUpdate = body.sourceChanges ? await requestBudget.runOperation(() => acceptedReviewSources(job, user.id, supabase, body.sourceChanges), { timeoutMs: 35_000 }) : null;
    transition = buildReviewTransition({ action, job, feedback, runId, lease: leaseFields(), sourceUpdate });
  } catch (e) {
    if (isGenerationBudgetStop(e)) throw e;
    if (e?.statusCode) return res.status(e.statusCode).json({ error: e.message });
    return res.status(500).json({ error: e.message || String(e) });
  }

  let apiKey;
  try { apiKey = await readApiKey(supabase, user.id); }
  catch (e) {
    if (isGenerationBudgetStop(e)) throw e;
    let marked;
    try {
      marked = await markReviewWaitingForApiKey(supabase, jobId, user.id, transition.expectedStatus, job.run_id, e.message || String(e), transition.patch.review_history);
    } catch (markErr) {
      if (isGenerationBudgetStop(markErr)) throw markErr;
      return res.status(500).json({ error: markErr.message || String(markErr) });
    }
    if (!marked) return res.status(409).json({ code: 'GENERATION_CHANGED', error: 'This course changed. No action was taken. Review the latest course state before trying again.' });
    return res.status(e.statusCode || 400).json({ error: e.message });
  }

  try {
    requestBudget.assertCanStart();
    const claim = await updateJobFromStatus(supabase, jobId, user.id, transition.expectedStatus, job.run_id, transition.patch);
    if (!claim.ok) return res.status(409).json({ code: 'GENERATION_CHANGED', error: claim.error });
    res.status(200).json({ jobId, action });
    return background(run(transition.runnerRow || job, apiKey, transition.runnerMode, transition.checkpoint));
  } catch (e) {
    if (isGenerationBudgetStop(e)) throw e;
    return res.status(500).json({ error: e.message || String(e) });
  }

  function run(row, key, mode, checkpoint) {
    return runGeneration({
      supabase: rawClient,
      requestBudget,
      jobId,
      ownerId: user.id,
      runId,
      ownerEmail: user.email || null,
      apiKey: key,
      userBrief: row.user_brief || {},
      pdfRefs: row.user_brief?.pdfRefs || [],
      checkpoint,
      mode
    }).catch((err) => {
      console.error(`[/api/gen/review] runner threw for ${jobId}:`, err);
    });
  }
  } catch (error) {
    if (isGenerationBudgetStop(error)) {
      requestBudget.stop(error);
      return res.status(503).json({ code: error.code, error: 'The request took too long to confirm. Your saved review is retained. Check the latest course state before trying again.' });
    }
    return res.status(500).json({ error: error.message || String(error) });
  }
}

}
export default createReviewHandler();

export function buildReviewTransition({ action, job, feedback = '', runId = '', lease = {}, sourceUpdate = null } = {}) {
  if (sourceUpdate && action !== 'rerun_research') throw reviewError(400, 'Changed sources must be researched again.');
  const reviewFeedback = String(feedback || '').trim() || latestReviewFeedback(job?.review_history, action, job?.status);

  if (action === 'approve_curriculum') {
    if (job?.status !== 'review_curriculum') throw reviewError(409, 'Curriculum is not waiting for approval.');
    if (!job.brief) throw reviewError(400, 'No curriculum checkpoint to approve.');
    const brief = appendFeedbackToBrief(job.brief, reviewFeedback);
    return {
      expectedStatus: 'review_curriculum',
      runnerMode: 'research',
      runnerRow: job,
      checkpoint: { brief, research: {}, topics_by_key: {}, failures: [], extracted_urls: job.extracted_urls || [] },
      patch: {
        status: 'running',
        run_id: runId,
        recovery_attempts: 0,
        last_recovery_at: null,
        stage: 'research',
        error: null,
        brief,
        outline: outlineForBrief(brief),
        review_history: appendReviewHistory(job.review_history, { action, feedback: reviewFeedback, fromStatus: job.status, runId }),
        research: {},
        topics_by_key: {},
        failures: [],
        topics_done: 0,
        topics_total: topicCountForBrief(brief),
        message: `${agentNameForStage('research')} is researching ${brief.modules?.length || 0} modules…`,
        ...lease
      }
    };
  }

  if (action === 'revise_curriculum') {
    if (job?.status !== 'review_curriculum') throw reviewError(409, 'Curriculum is not waiting for revision.');
    // A missing-key attempt saves its feedback before claiming a new run. Only
    // that unconsumed last attempt can supply feedback on a blank recovery call;
    // feedback from an already completed revision is not a new revision request.
    const lastReview = Array.isArray(job.review_history) ? job.review_history.at(-1) : null;
    const pendingFeedback = lastReview?.action === action
      && lastReview.from_status === job.status
      && lastReview.run_id && lastReview.run_id !== job.run_id
      && (!job.run_id || job.error)
      && String(lastReview.feedback || '').trim();
    if (!String(feedback || '').trim() && !pendingFeedback) {
      throw reviewError(400, 'Tell us what to change before revising the curriculum. Your current plan is unchanged.');
    }
    const userBrief = appendFeedbackToUserBrief(job.user_brief || {}, reviewFeedback, 'Human feedback on the previous curriculum');
    return {
      expectedStatus: 'review_curriculum',
      runnerMode: 'curriculum',
      runnerRow: { ...job, user_brief: userBrief },
      checkpoint: { extracted_urls: job.extracted_urls || [] },
      patch: {
        status: 'running',
        run_id: runId,
        recovery_attempts: 0,
        last_recovery_at: null,
        stage: 'intake',
        error: null,
        user_brief: userBrief,
        brief: null,
        outline: null,
        review_history: appendReviewHistory(job.review_history, { action, feedback: reviewFeedback, fromStatus: job.status, runId }),
        research: {},
        topics_by_key: {},
        failures: [],
        topics_done: 0,
        topics_total: 0,
        message: `${agentNameForStage('intake')} is revising the curriculum…`,
        ...lease
      }
    };
  }

  if (action === 'approve_research') {
    if (job?.status !== 'review_research') throw reviewError(409, 'Research is not waiting for approval.');
    if (!job.brief) throw reviewError(400, 'No research checkpoint to approve.');
    if (!hasCompleteResearch(job)) throw reviewError(400, 'Research is incomplete. Rerun research before lesson writing.');
    const brief = appendFeedbackToBrief(job.brief, reviewFeedback);
    return {
      expectedStatus: 'review_research',
      runnerMode: 'complete',
      runnerRow: job,
      checkpoint: {
        brief,
        research: job.research || {},
        topics_by_key: job.topics_by_key || {},
        failures: job.failures || [],
        extracted_urls: job.extracted_urls || []
      },
      patch: {
        status: 'running',
        run_id: runId,
        recovery_attempts: 0,
        last_recovery_at: null,
        stage: 'topics',
        error: null,
        brief,
        outline: outlineForBrief(brief),
        review_history: appendReviewHistory(job.review_history, { action, feedback: reviewFeedback, fromStatus: job.status, runId }),
        topics_done: Object.keys(job.topics_by_key || {}).length,
        topics_total: topicCountForBrief(brief),
        message: agentMessage('topics'),
        ...lease
      }
    };
  }

  if (action === 'rerun_research') {
    if (job?.status !== 'review_research') throw reviewError(409, 'Research is not waiting for revision.');
    if (!job.brief) throw reviewError(400, 'No curriculum checkpoint to research from.');
    const userBrief = sourceUpdate ? { ...job.user_brief, ...sourceUpdate } : job.user_brief;
    const brief = appendFeedbackToBrief(sourceUpdate ? { ...job.brief, source_text: sourceUpdate.source_text, source_urls: sourceUpdate.source_urls } : job.brief, reviewFeedback);
    const extractedUrls = sourceUpdate ? [] : (job.extracted_urls || []);
    return {
      expectedStatus: 'review_research',
      runnerMode: 'research',
      runnerRow: sourceUpdate ? { ...job, user_brief: userBrief } : job,
      checkpoint: { brief, research: {}, topics_by_key: {}, failures: [], extracted_urls: extractedUrls },
      patch: {
        status: 'running',
        run_id: runId,
        recovery_attempts: 0,
        last_recovery_at: null,
        stage: 'research',
        error: null,
        brief,
        ...(sourceUpdate ? { user_brief: userBrief, extracted_urls: [] } : {}),
        review_history: appendReviewHistory(job.review_history, { action, feedback: reviewFeedback, fromStatus: job.status, runId }),
        research: {},
        topics_by_key: {},
        failures: [],
        topics_done: 0,
        topics_total: topicCountForBrief(brief),
        message: `${agentNameForStage('research')} is rerunning research…`,
        ...lease
      }
    };
  }

  throw reviewError(400, `Unknown action: ${action}`);
}

export function latestReviewFeedback(reviewHistory = [], action = '', fromStatus = '') {
  const entries = Array.isArray(reviewHistory) ? reviewHistory : [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.action !== action) continue;
    if (entry?.from_status !== fromStatus) continue;
    const feedback = String(entry.feedback || '').trim();
    if (feedback) return feedback;
  }
  return '';
}

function reviewError(statusCode, message) {
  const err = new Error(message);
  err.statusCode = statusCode;
  return err;
}

export function appendFeedbackToUserBrief(userBrief, feedback, label) {
  const clean = String(feedback || '').trim();
  if (!clean) return userBrief;
  const block = `${label}:\n${clean}`;
  const sourceText = String(userBrief.source_text || '').trim();
  if (sourceText.includes(block)) return userBrief;
  return {
    ...userBrief,
    source_text: [sourceText, block]
      .filter(Boolean)
      .join('\n\n')
  };
}

export function appendFeedbackToBrief(brief, feedback) {
  const clean = String(feedback || '').trim();
  if (!clean) return brief;
  const prior = String(brief.human_feedback || '').trim();
  const priorItems = prior.split(/\n{2,}/).map(item => item.trim()).filter(Boolean);
  if (priorItems.includes(clean)) return brief;
  return {
    ...brief,
    human_feedback: [prior, clean].filter(Boolean).join('\n\n')
  };
}

export function hasCompleteResearch(job) {
  return hasCompleteResearchCheckpoint(job?.brief, job?.research || {});
}

export async function updateJobFromStatus(supabase, jobId, ownerId, expectedStatus, expectedRunId, patch) {
  let query = supabase
    .from('generation_jobs')
    .update(patch)
    .eq('id', jobId)
    .eq('owner_id', ownerId)
    .eq('status', expectedStatus);
  query = sameRunFilter(query, expectedRunId);
  const { data, error } = await query
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) return { ok: false, error: 'Job state changed. Refresh and try again.' };
  return { ok: true };
}

export async function markReviewWaitingForApiKey(supabase, jobId, ownerId, expectedStatus, expectedRunId, error, reviewHistory = null) {
  const now = new Date().toISOString();
  const patch = {
    error,
    message: 'Review is waiting for an Anthropic API key. Add one to your account, then continue from this checkpoint.',
    updated_at: now,
    ...(Array.isArray(reviewHistory) ? { review_history: reviewHistory } : {})
  };
  let query = supabase
    .from('generation_jobs')
    .update(patch)
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
