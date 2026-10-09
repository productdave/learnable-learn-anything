// Service-only RPC facade. All three budget scopes are bound to the saved job.
// No grants, balance top-ups, retries or inferred refunds are created here.
import { randomUUID } from 'node:crypto';
import { refuse } from './openrouter-policy.mjs';

export function createAiSpendLedger({ supabase, ownerId, jobId, runId, policyHash }) {
  if (!supabase?.rpc || !ownerId || !jobId || !runId || !/^[a-f0-9]{64}$/.test(policyHash || ''))
    refuse('configuration', 'AI spending scope is incomplete.');
  const base = { p_owner_id: ownerId, p_job_id: jobId, p_run_id: runId };
  async function rpc(name, args) {
    let result;
    try { result = await supabase.rpc(name, { ...base, ...args }); }
    catch { refuse('ledger', 'The AI spending record could not be confirmed.'); }
    if (result?.error || !result?.data) refuse('ledger', 'The AI spending record could not be confirmed.');
    return result.data;
  }
  return {
    async reserve({ operationKey, fingerprint, reservedMicrousd, model, task }) {
      const requestId = randomUUID();
      const result = await rpc('reserve_learnable_ai_spend', { p_request_id: requestId,
        p_operation_key: operationKey, p_fingerprint: fingerprint, p_policy_hash: policyHash,
        p_reserved_microusd: reservedMicrousd, p_model: model, p_task: task });
      if (!result.ok) refuse(result.reason === 'budget' ? 'budget' : 'pending',
        `AI dispatch was not authorized (${['budget', 'duplicate', 'pending', 'job', 'approval', 'policy', 'invalid'].includes(result.reason) ? result.reason : 'spending check'}). No request was sent.`);
      return { requestId, reservedMicrousd };
    },
    async settle(hold, { actualMicrousd, providerRequestId, usage }) {
      const result = await rpc('settle_learnable_ai_spend', { p_request_id: hold.requestId,
        p_actual_microusd: actualMicrousd, p_provider_request_id: providerRequestId, p_usage: usage });
      if (!result.ok) refuse('ledger', 'AI usage was received but settlement needs review.');
    },
    async hold(hold) {
      // Callers retain the original error. A failed halt still leaves the durable
      // pending request, which blocks a new runner lease from spending.
      try { await rpc('halt_learnable_ai_spend', { p_request_id: hold.requestId }); } catch { /* no refund */ }
    }
  };
}
