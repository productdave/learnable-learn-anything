// POST /api/gen/start
//
// Body: { brief: { topic, source_text, source_urls, depth, tone, pdfRefs }, courseSlug? }
// Header: Authorization: Bearer <supabase access token>
//
// Creates a generation_jobs row, kicks off the pipeline server-side, returns
// { jobId } immediately. The function keeps running until the pipeline
// finishes or maxDuration is hit. Real-time status updates land in the
// generation_jobs row; the client subscribes to those via Realtime.

import { waitUntil } from '@vercel/functions';
import { randomUUID } from 'node:crypto';
import { readJsonBody, requirePdfRefsBelongToJob, requireSafeJobId, userFromRequest, readApiKey, serviceClient } from '../_lib/supabase-server.mjs';
import { runGeneration as defaultRunGeneration } from '../_lib/gen-runner.mjs';
import { createGenerationRequestBudget, bindGenerationClient, withGenerationSignal, isGenerationBudgetStop } from '../_lib/gen-request-budget.mjs';
import { timeoutPatch } from '../_lib/gen-recovery.mjs';
import { generationCancelledTerminalFields, generationLeaseFields, LIVE_GENERATION_STATUSES, sameRunFilter } from '../_lib/gen-state.mjs';
import { removePdfUploadsForJob } from './delete.js';
import { creationBrief } from '../../js/generator/component-policy.mjs';
import { readProtectedKey } from '../_lib/provider-vault.mjs';
import { imagePolicy, requireImagePolicy } from '../_lib/image-policy.mjs';

export const config = {
  runtime: 'nodejs',
  maxDuration: 300   // Five-minute Hobby/Fluid Compute request window.
};

export function createStartHandler({ runGeneration = defaultRunGeneration, background = waitUntil, authenticate = userFromRequest, admin = serviceClient, createBudget = createGenerationRequestBudget, imageConnection = async (client, ownerId) => {
  requireImagePolicy(imagePolicy());
  return readProtectedKey(client, ownerId, 'openai');
} } = {}) {
return async function handler(req, res) {
  const requestBudget = createBudget({ request: req });
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

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

  const body = await requestBudget.runOperation(() => readJsonBody(req), { timeoutMs: 10_000 });
  if (!body?.brief) return res.status(400).json({ error: 'Missing { brief }' });
  const { pdfRefs = [], ...inputBrief } = body.brief;
  let userBrief;
  try { userBrief = creationBrief(inputBrief); }
  catch (error) { return res.status(400).json({ error: error.message }); }
  let requestedJobId = null;
  if (body.jobId) {
    try { requestedJobId = requireSafeJobId(body.jobId); }
    catch (e) { return res.status(e.statusCode || 400).json({ error: e.message }); }
  }

  // Generate a job + course id. Use a slug derived from the topic; we collision-
  // rename later in the runner if it clashes with a bundled course slug.
  const jobId = requestedJobId || `job-${randomUUID()}`;
  const runId = randomUUID();

  try { requirePdfRefsBelongToJob(pdfRefs, { ownerId: user.id, jobId }); }
  catch (e) { return res.status(e.statusCode || 400).json({ error: e.message }); }

  // Reattachment is not a new paid start. It must still work if a provider was
  // disconnected after the original request reached the server.
  if (requestedJobId) {
    const { data: prior, error } = await supabase.from('generation_jobs')
      .select('id,status,run_id,lease_expires_at,user_brief,error,message')
      .eq('id', jobId).eq('owner_id', user.id).maybeSingle();
    if (error) return res.status(503).json({ error: 'Could not check existing course creation. Check again before starting another course.' });
    if (prior) return res.status(200).json({ jobId, existing: true,
      status: await expireExistingJobIfStale(supabase, prior, user.id), pdfRefs: prior.user_brief?.pdfRefs || [] });
  }

  // Get the user's Anthropic key (stored under user_state by sync.js).
  let apiKey;
  try { apiKey = await readApiKey(supabase, user.id); }
  catch (e) { if (isGenerationBudgetStop(e)) throw e; return res.status(e.statusCode || 400).json({ error: e.message }); }

  if (!await imageConnection(supabase, user.id)) return res.status(409).json({ code: 'image_connection', error: 'Connect OpenAI on the Create course screen so Learnable can include useful illustrations. No generation has started.' });

  // Insert the row first so the client can subscribe before work begins.
  // If the browser retries the same request after a network hiccup, attach to
  // the existing owned job instead of failing and stranding the local card.
  requestBudget.assertCanStart();
  const { error: insertErr } = await supabase.from('generation_jobs').insert({
    id: jobId,
    owner_id: user.id,
    user_brief: { ...userBrief, pdfRefs },
    status: 'running',
    stage: 'intake',
    run_id: runId,
    recovery_attempts: 0,
    last_recovery_at: null,
    message: 'Starting…',
    ...generationLeaseFields()
  });
  if (insertErr) {
    if (insertErr.code === '23505') {
      const { data: existing, error: existingErr } = await supabase
        .from('generation_jobs')
        .select('id,status,run_id,lease_expires_at,user_brief,error,message')
        .eq('id', jobId)
        .eq('owner_id', user.id)
        .maybeSingle();
      if (!existingErr && existing) {
        const status = await expireExistingJobIfStale(supabase, existing, user.id);
        return res.status(200).json({
          jobId,
          existing: true,
          status,
          pdfRefs: existing.user_brief?.pdfRefs || []
        });
      }
      if (!existingErr && !existing) {
        return res.status(409).json({
          error: 'Could not create this generation job because its id is already in use. Start again to create a fresh job.'
        });
      }
    }
    return res.status(500).json({ error: 'Could not create job: ' + insertErr.message });
  }

  // Respond immediately so the client UI can switch to progress mode, then
  // keep the pipeline running via waitUntil — the officially supported way
  // to continue work after the response on Vercel. Without it the runtime
  // may freeze the function the moment the response is sent.
  res.status(200).json({ jobId });

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
      pdfRefs,
      checkpoint: null,
      mode: 'curriculum'
    }).catch((err) => {
      // Errors are already persisted on the row by the runner; just log so
      // Vercel captures it.
      console.error(`[/api/gen/start] runner threw for ${jobId}:`, err);
    })
  );
  } catch (error) {
    if (isGenerationBudgetStop(error)) {
      requestBudget.stop(error);
      return res.status(503).json({ code: error.code, error: 'The request took too long to confirm. Check for saved creation progress before trying again.' });
    }
    return res.status(500).json({ error: error.message || String(error) });
  }
}
}
export default createStartHandler();

export async function expireExistingJobIfStale(supabase, job, ownerId) {
  const nowMs = Date.now();
  const expiresMs = Date.parse(job.lease_expires_at || '');
  if (!Number.isFinite(expiresMs) || expiresMs > nowMs) return job.status;

  const now = new Date(nowMs).toISOString();
  if (LIVE_GENERATION_STATUSES.includes(job.status)) {
    let query = supabase
      .from('generation_jobs')
      .update({
        ...timeoutPatch(job, now)
      })
      .eq('id', job.id)
      .eq('owner_id', ownerId)
      .in('status', LIVE_GENERATION_STATUSES)
      .lt('lease_expires_at', now);
    query = sameRunFilter(query, job.run_id);
    const { data } = await query
      .select('status')
      .maybeSingle();
    if (data?.status === 'cancelled') {
      await removePdfUploadsForJob(supabase, ownerId, job.id);
    }
    return data?.status || job.status;
  }

  if (job.status === 'cancelling') {
    let query = supabase
      .from('generation_jobs')
      .update(generationCancelledTerminalFields(new Date(nowMs)))
      .eq('id', job.id)
      .eq('owner_id', ownerId)
      .eq('status', 'cancelling')
      .lt('lease_expires_at', now);
    query = sameRunFilter(query, job.run_id);
    const { data } = await query
      .select('status')
      .maybeSingle();
    return data?.status || job.status;
  }

  return job.status;
}
