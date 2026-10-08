import { randomUUID } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { userFromRequest, serviceClient } from '../_lib/supabase-server.mjs';
import { readProtectedKey, checkAnthropicKey } from '../_lib/provider-vault.mjs';
import { setupGenerationIssues, setupJobId, setupToGenerationBrief, inspectSetupSources } from '../_lib/setup-generation.mjs';
import { boundedJson } from '../_lib/bounded-json.mjs';
import { getAiModelRegistry, assertCloudGenerationModelSupport } from '../_lib/ai-models.mjs';
import { generationLeaseFields } from '../_lib/gen-state.mjs';
import { runGeneration } from '../_lib/gen-runner.mjs';
import { createGenerationRequestBudget, bindGenerationClient, withGenerationSignal, isGenerationBudgetStop } from '../_lib/gen-request-budget.mjs';
import { setupIdentifier } from '../../js/setup-account-model.js';

export const config = { runtime: 'nodejs', maxDuration: 300 };
export function createSetupGenerationHandler({ authenticate = userFromRequest, admin = serviceClient, run = runGeneration, background = waitUntil, validate = checkAnthropicKey, createBudget = createGenerationRequestBudget, enabled = () => process.env.LEARNABLE_SETUP_GENERATION === '1' } = {}) {
  return async (req, res) => {
    const requestBudget = createBudget({ request: req });
    const timedOut = error => {
      requestBudget.stop(error);
      return res.status(503).json({ code: error.code, error: 'The request took too long to confirm. Your saved setup is retained. Retry to check for saved progress.' });
    };
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
    let user;
    try { ({ user } = await requestBudget.runOperation(signal => authenticate(req, { fetcher: withGenerationSignal(signal) }), { timeoutMs: 10_000 })); }
    catch (error) { if (isGenerationBudgetStop(error)) return timedOut(error); return res.status(401).json({ error: 'Sign in again before creating your course.' }); }
    let body;
    try { body = await requestBudget.runOperation(() => boundedJson(req), { timeoutMs: 10_000 }); setupIdentifier(body.id); if (!Number.isInteger(body.revision) || body.revision < 1 || !['check', 'start'].includes(body.action)) throw new Error('Invalid request.'); }
    catch (error) { if (isGenerationBudgetStop(error)) return timedOut(error); return res.status(400).json({ error: 'Invalid course creation request.' }); }
    try {
      const rawClient = admin(), client = bindGenerationClient(rawClient, requestBudget, { phase: 'work' });
      const models = getAiModelRegistry(); assertCloudGenerationModelSupport(models);
      const { data: row, error } = await client.from('course_setups').select('id,revision,content_hash,payload').eq('owner_id', user.id).eq('id', body.id).eq('deleted', false).maybeSingle();
      if (error) throw new Error('Couldn’t read your saved course setup. Retry in a moment.');
      if (!row) return res.status(404).json({ error: 'Save this setup to your account before continuing.' });
      if (row.revision !== body.revision) return res.status(409).json({ error: 'Your setup changed in another tab. Return to Review before creating a course.' });
      const jobId = setupJobId(user.id, row.id, row.content_hash);
      const { data: existing, error: lookupError } = await client.from('generation_jobs').select('id,status').eq('owner_id', user.id).eq('id', jobId).maybeSingle();
      if (lookupError) throw new Error('Couldn’t check existing creation progress. Retry before starting again.');
      if (existing) return res.status(200).json({ existing: true, jobId, status: existing.status });
      const sources = await requestBudget.runOperation(() => inspectSetupSources(row, user.id, client), { timeoutMs: 35_000 });
      const issues = [...setupGenerationIssues(row.payload), ...sources.issues], apiKey = await readProtectedKey(client, user.id);
      // New creation includes purposeful visuals. Check both account connections
      // before starting paid work, not after the text course has been generated.
      const imageConnected = !!await readProtectedKey(client, user.id, 'openai');
      const result = { ready: !issues.length && !!apiKey && imageConnected && enabled(), issues, sources: sources.review, connected: !!apiKey, imageConnected, enabled: enabled(), provider: 'anthropic', model: models.curriculum.model };
      if (body.action === 'check') {
        return res.status(200).json(result);
      }
      if (!result.ready) return res.status(409).json({ ...result, error: 'Resolve the creation checks before starting.' });
      if (sources.review.requiresReview && body.sourceReview !== sources.review.digest) return res.status(409).json({ ...result, code: 'source-review-required', error: 'Review the extracted source text again before creating your course plan.' });
      await requestBudget.runOperation(signal => validate(apiKey, models.curriculum.model, withGenerationSignal(signal)), { timeoutMs: 20_000 });
      const { data: latest, error: latestError } = await client.from('course_setups').select('revision,content_hash').eq('owner_id', user.id).eq('id', body.id).eq('deleted', false).maybeSingle();
      if (latestError) throw new Error('Couldn’t confirm your latest setup. Retry before creating a course plan.');
      if (!latest || latest.revision !== row.revision || latest.content_hash !== row.content_hash) return res.status(409).json({ error: 'Your setup changed during the source check. Return to Review before creating a course plan.' });
      const userBrief = await setupToGenerationBrief(row, user.id, client, sources), runId = randomUUID();
      requestBudget.assertCanStart();
      const { error: insertError } = await client.from('generation_jobs').insert({ id: jobId, owner_id: user.id, user_brief: userBrief, status: 'running', stage: 'intake', run_id: runId, recovery_attempts: 0, message: 'Preparing your course plan…', ...generationLeaseFields() });
      if (insertError) {
        if (insertError.code === '23505') {
          const { data: found } = await client.from('generation_jobs').select('id,status').eq('owner_id', user.id).eq('id', jobId).maybeSingle();
          if (found) return res.status(200).json({ existing: true, jobId, status: found.status });
        }
        throw new Error('Couldn’t start your course plan. Retry to check for saved progress.');
      }
      // One owner/content-derived job ID: retries and concurrent clicks reuse it.
      background(run({ supabase: rawClient, jobId, ownerId: user.id, ownerEmail: user.email, runId, apiKey, userBrief, pdfRefs: [], checkpoint: null, mode: 'curriculum', requestBudget }).catch(() => {}));
      return res.status(200).json({ jobId, status: 'running' });
    } catch (error) { if (isGenerationBudgetStop(error)) return timedOut(error); return res.status(503).json({ error: /^(Couldn’t|Claude|This connection|Secure AI|Notes and|.+ is not UTF-8|.+ contains binary)/.test(error.message || '') ? error.message : 'Course creation is unavailable. Your setup is saved; please retry.' }); }
  };
}
export default createSetupGenerationHandler();
