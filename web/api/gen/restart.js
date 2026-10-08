// POST /api/gen/restart
// Body: { jobId, feedback? }
//
// Starts a recoverable job over from the original request when checkpointed
// resume is not enough. Keeps user_brief, PDF refs, source URLs, and extracted
// URL text so the restart does not throw away all context or re-fetch sources.

import { waitUntil } from '@vercel/functions';
import { randomUUID } from 'node:crypto';
import { readJsonBody, requirePdfRefsBelongToJob, requireSafeJobId, userFromRequest, readApiKey, serviceClient } from '../_lib/supabase-server.mjs';
import { runGeneration as defaultRunGeneration } from '../_lib/gen-runner.mjs';
import { createGenerationRequestBudget, bindGenerationClient, withGenerationSignal, isGenerationBudgetStop } from '../_lib/gen-request-budget.mjs';
import { RECOVERABLE_STATUSES } from '../_lib/gen-recovery.mjs';
import { appendReviewHistory } from '../_lib/gen-review-history.mjs';
import { agentNameForStage } from '../../js/generator/agents.mjs';
import { generationLeaseFields, sameRunFilter, requireGenerationExpectation } from '../_lib/gen-state.mjs';

export const config = {
  runtime: 'nodejs',
  maxDuration: 300
};

export function createRestartHandler({ runGeneration = defaultRunGeneration, background = waitUntil, authenticate = userFromRequest, admin = serviceClient, createBudget = createGenerationRequestBudget } = {}) {
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

  const body = (await requestBudget.runOperation(() => readJsonBody(req), { timeoutMs: 10_000 })) || {};
  let jobId;
  try { jobId = requireSafeJobId(body.jobId); }
  catch (e) { return res.status(e.statusCode || 400).json({ error: e.message }); }
  const feedback = String(body.feedback || '').trim();
  const replacementBrief = body.brief && typeof body.brief === 'object' ? body.brief : null;

  const { data: job, error } = await supabase
    .from('generation_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (error || !job) return res.status(404).json({ error: 'Job not found' });
  try { requireGenerationExpectation(body.expected, job); }
  catch (e) { return res.status(e.statusCode).json({ error: e.message, code: e.code }); }
  if (!RECOVERABLE_STATUSES.includes(job.status)) {
    return res.status(409).json({ error: `Job is ${job.status}; only failed, timed-out, or partial jobs can be restarted.` });
  }

  const runId = randomUUID();
  const originalBrief = job.user_brief || {};
  const mergedBrief = replacementBrief
    ? mergeRestartBrief(originalBrief, replacementBrief)
    : originalBrief;
  const priorHumanFeedback = collectRestartHumanFeedback({
    reviewHistory: job.review_history,
    checkpointBrief: job.brief
  });
  const restartFeedback = feedback || latestRestartFeedback(job.review_history);
  const userBrief = appendRestartFeedback(mergedBrief, restartFeedback, priorHumanFeedback);
  try { requirePdfRefsBelongToJob(userBrief.pdfRefs || [], { ownerId: user.id, jobId }); }
  catch (e) { return res.status(e.statusCode || 400).json({ error: e.message }); }
  const checkpoint = restartCheckpointForBriefs(originalBrief, userBrief, job.extracted_urls || []);
  const reviewHistory = appendReviewHistory(job.review_history, {
    action: 'restart_generation',
    feedback: restartFeedback,
    fromStatus: job.status,
    runId
  });

  let apiKey;
  try { apiKey = await readApiKey(supabase, user.id); }
  catch (e) {
    if (isGenerationBudgetStop(e)) throw e;
    let marked;
    try {
      marked = await markRestartWaitingForApiKey(supabase, jobId, user.id, job.status, job.run_id, e.message || String(e), {
        userBrief,
        extractedUrls: checkpoint.extracted_urls,
        reviewHistory
      });
    } catch (markErr) {
      if (isGenerationBudgetStop(markErr)) throw markErr;
      return res.status(500).json({ error: markErr.message || String(markErr) });
    }
    if (!marked) return res.status(409).json({ code: 'GENERATION_CHANGED', error: 'This course changed. No action was taken. Review the latest course state before trying again.' });
    return res.status(e.statusCode || 400).json({ error: e.message });
  }

  requestBudget.assertCanStart();
  let transitionQuery = supabase
    .from('generation_jobs')
    .update({
      status: 'running',
      stage: 'intake',
      run_id: runId,
      user_brief: userBrief,
      extracted_urls: checkpoint.extracted_urls,
      brief: null,
      outline: null,
      research: {},
      topics_by_key: {},
      image_progress: null,
      design_progress: null,
      continuation: null,
      failures: [],
      error: null,
      recovery_attempts: 0,
      last_recovery_at: null,
      topics_done: 0,
      topics_total: 0,
      review_history: reviewHistory,
      completed_at: null,
      message: `${agentNameForStage('intake')} is restarting from your saved request...`,
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

  res.status(200).json({ jobId, restarted: true });

  background(
    runGeneration({
      supabase: rawClient,
      requestBudget,
      jobId,
      ownerId: user.id,
      runId,
      ownerEmail: user.email || null,
      apiKey,
      userBrief,
      pdfRefs: userBrief?.pdfRefs || [],
      checkpoint,
      mode: 'curriculum'
    }).catch((err) => {
      console.error(`[/api/gen/restart] runner threw for ${jobId}:`, err);
    })
  );
  } catch (error) {
    if (isGenerationBudgetStop(error)) {
      requestBudget.stop(error);
      return res.status(503).json({ code: error.code, error: 'The request took too long to confirm. Your saved request is retained. Check the latest course state before trying again.' });
    }
    return res.status(500).json({ error: error.message || String(error) });
  }
}
}
export default createRestartHandler();

export function appendRestartFeedback(userBrief, feedback, priorHumanFeedback = '') {
  const sections = [];
  const sourceText = String(userBrief.source_text || '').trim();
  const newPriorHumanFeedback = dedupeFeedbackAlreadyInSource(sourceText, priorHumanFeedback);
  if (newPriorHumanFeedback) sections.push(['Prior human review feedback', newPriorHumanFeedback]);
  if (feedback) sections.push(['Restart feedback', feedback]);
  if (!sections.length) return userBrief;
  const additions = sections
    .map(([label, text]) => restartFeedbackBlock(label, text))
    .filter(block => block && !sourceText.includes(block))
    .filter(Boolean)
    .join('\n\n');
  if (!additions) return userBrief;
  return {
    ...userBrief,
    source_text: [sourceText, additions].filter(Boolean).join('\n\n')
  };
}

export async function markRestartWaitingForApiKey(supabase, jobId, ownerId, expectedStatus, expectedRunId, error, { userBrief = null, extractedUrls = null, reviewHistory = null } = {}) {
  const now = new Date().toISOString();
  const patch = {
    error,
    message: 'Generation is waiting for an Anthropic API key. Add one to your account, then restart from the saved request.',
    updated_at: now,
    ...(userBrief && typeof userBrief === 'object' ? { user_brief: userBrief } : {}),
    ...(Array.isArray(extractedUrls) ? { extracted_urls: extractedUrls } : {}),
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

export function dedupeFeedbackAlreadyInSource(sourceText = '', priorHumanFeedback = '') {
  const source = String(sourceText || '');
  return String(priorHumanFeedback || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => {
      if (source.includes(line)) return false;
      const bare = stripKnownFeedbackLabel(line);
      return !bare || !source.includes(bare);
    })
    .join('\n');
}

function stripKnownFeedbackLabel(line) {
  const labels = Object.values(REVIEW_ACTION_LABELS);
  for (const label of labels) {
    const prefix = `${label}:`;
    if (line.startsWith(prefix)) return line.slice(prefix.length).trim();
  }
  return '';
}

function restartFeedbackBlock(label, text) {
  const clean = String(text || '').trim();
  if (!clean) return '';
  return label ? `${label}:\n${clean}` : clean;
}

export function collectRestartHumanFeedback({ reviewHistory = [], checkpointBrief = null } = {}) {
  const seen = new Set();
  const lines = [];
  const add = (label, feedback) => {
    const text = String(feedback || '').trim();
    if (!text || seen.has(text)) return;
    seen.add(text);
    lines.push(label ? `${label}: ${text}` : text);
  };

  for (const entry of Array.isArray(reviewHistory) ? reviewHistory : []) {
    add(reviewActionLabel(entry?.action), entry?.feedback);
  }

  for (const text of splitHumanFeedback(checkpointBrief?.human_feedback)) {
    add('', text);
  }

  return lines.join('\n');
}

export function latestRestartFeedback(reviewHistory = []) {
  const entries = Array.isArray(reviewHistory) ? reviewHistory : [];
  for (let i = entries.length - 1; i >= 0; i--) {
    const entry = entries[i];
    if (entry?.action !== 'restart_generation') continue;
    const feedback = String(entry.feedback || '').trim();
    if (feedback) return feedback;
  }
  return '';
}

function splitHumanFeedback(text) {
  return String(text || '')
    .split(/\n{2,}/)
    .map(part => part.trim())
    .filter(Boolean);
}

function reviewActionLabel(action) {
  return REVIEW_ACTION_LABELS[action] || 'Human review feedback';
}

const REVIEW_ACTION_LABELS = {
  approve_curriculum: 'Approved curriculum with feedback',
  revise_curriculum: 'Requested curriculum revision',
  approve_research: 'Approved research with feedback',
  rerun_research: 'Requested research revision',
  restart_generation: 'Restart feedback'
};

export function mergeRestartBrief(existingBrief = {}, replacementBrief = {}) {
  const replacementSourceText = String(replacementBrief.source_text || '').trim();
  const replacementUrls = Array.isArray(replacementBrief.source_urls)
    ? replacementBrief.source_urls.filter(Boolean)
    : [];
  return {
    ...existingBrief,
    ...replacementBrief,
    source_text: replacementSourceText || existingBrief.source_text,
    source_urls: replacementUrls.length
      ? replacementUrls
      : (existingBrief.source_urls || []),
    pdfRefs: Array.isArray(replacementBrief.pdfRefs)
      ? replacementBrief.pdfRefs
      : (existingBrief.pdfRefs || [])
  };
}

export function shouldReuseExtractedUrls(oldBrief = {}, nextBrief = {}) {
  return normalizedUrls(oldBrief.source_urls).join('\n') === normalizedUrls(nextBrief.source_urls).join('\n');
}

export function restartCheckpointForBriefs(oldBrief = {}, nextBrief = {}, extractedUrls = []) {
  return {
    extracted_urls: shouldReuseExtractedUrls(oldBrief, nextBrief) ? (extractedUrls || []) : []
  };
}

function normalizedUrls(urls) {
  return (Array.isArray(urls) ? urls : [])
    .map(url => String(url || '').trim())
    .filter(Boolean)
    .sort();
}
