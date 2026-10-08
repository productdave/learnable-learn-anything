// Staging-only owner testing. Never copied into production source or browsers.
// QA-scoped jobs/courses always keep their existing reservation/call controls.
const STAGING_URL = 'https://dmnwkrybgggbpqpetuub.supabase.co';
const STAGING_ORIGIN = 'https://learnable-staging.vercel.app';
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
class ManualTestError extends Error {
  constructor(message) { super(message); this.name = 'StagingSpendError'; this.code = 'manual-testing'; }
}
export function manualOwnerEnabled(ownerId, env = process.env) {
  return env.LEARNABLE_MANUAL_TESTING === '1' && env.SUPABASE_URL === STAGING_URL &&
    env.LEARNABLE_GENERATION_ORIGIN === STAGING_ORIGIN && UUID.test(ownerId || '') &&
    ownerId === env.LEARNABLE_MANUAL_TESTING_OWNER_ID;
}
export async function useManualTesting({ client, ownerId, kind, scopeId, env = process.env, signal }) {
  if (!manualOwnerEnabled(ownerId, env)) return false;
  if (!['text', 'images'].includes(kind) || typeof scopeId !== 'string' || !scopeId) {
    throw new ManualTestError('Could not confirm the manual testing scope. No AI request was sent.');
  }
  try {
    const operation = client.rpc('learnable_staging_manual_test_scope', {
      p_owner_id: ownerId, p_kind: kind, p_scope_id: scopeId,
    });
    const result = await (signal && typeof operation.abortSignal === 'function' ? operation.abortSignal(signal) : operation);
    if (result?.error || typeof result?.data?.manual !== 'boolean') throw new Error('Unconfirmed scope');
    return result.data.manual;
  } catch {
    throw new ManualTestError('Could not confirm the manual testing scope. No AI request was sent.');
  }
}
export function createManualAwareTextClient(args, createGuarded) {
  const { apiKey, supabase, ownerId, jobId, requestBudget = null, beforeDispatch = null,
    fetcher = fetch, env = process.env } = args;
  // Preserve the exact old path outside the explicitly enabled owner session.
  if (!manualOwnerEnabled(ownerId, env)) return createGuarded(args);
  if (env.LEARNABLE_SETUP_GENERATION !== '1' || !apiKey || !UUID.test(args.runId || '') ||
      !/^job-(?:[a-f0-9-]{36}|setup-[a-f0-9]{48})$/i.test(jobId || '')) {
    throw new ManualTestError('Course creation is not enabled for this test. No AI request was sent.');
  }
  let guarded, queue = Promise.resolve(), stopped = null;
  async function create(body) {
    if (stopped) throw stopped;
    await beforeDispatch?.();
    requestBudget?.assertCanStart();
    const isManual = await useManualTesting({ client: supabase, ownerId, kind: 'text', scopeId: jobId,
      env, signal: AbortSignal.timeout(10000) });
    if (!isManual) {
      guarded ||= createGuarded(args);
      return guarded.messages.create(body);
    }
    // Normal app execution deadlines, cancellation and stale-run checks remain.
    // No test dollar, call-count or grant-expiry limit on the owner's manual run.
    await beforeDispatch?.();
    requestBudget?.assertCanStart();
    const request = requestBudget?.beginRequest();
    try {
      const response = await fetcher('https://api.anthropic.com/v1/messages', {
        method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify(body), signal: request?.signal || AbortSignal.timeout(240000),
      });
      if (!response.ok) {
        const error = new ManualTestError('The AI provider could not complete this request. Your saved progress is retained; check your provider account before retrying.');
        // Retain only the bounded HTTP status, never a provider body or headers.
        // The designer can distinguish a known 4xx rejection from an unknown
        // transport/5xx result without silently retrying either here.
        if (Number.isInteger(response.status) && response.status >= 400 && response.status <= 599) error.status = response.status;
        throw error;
      }
      const result = await response.json();
      request?.throwIfExpired?.();
      return result; // The existing runner records token/search usage normally.
    } catch (error) {
      const cause = request?.signal?.aborted ? request.signal.reason : error;
      stopped = cause instanceof ManualTestError ? cause : new ManualTestError('The AI result is uncertain. Automatic retries are stopped; check saved progress before trying again.');
      if (cause?.code === 'GENERATION_REQUEST_UNCERTAIN') stopped.code = cause.code;
      throw stopped;
    } finally { request?.close(); }
  }
  return { messages: { create: body => {
    const next = queue.catch(() => {}).then(() => create(body)); queue = next; return next;
  } } };
}
export async function beginManualAwareImageSpend(args, beginGuarded) {
  if (args.env?.LEARNABLE_STAGING_IMAGE_SPEND !== '1') return beginGuarded(args);
  if (!await useManualTesting({ client: args.client, ownerId: args.ownerId, kind: 'images',
    scopeId: args.courseId, env: args.env, signal: AbortSignal.timeout(10000) })) return beginGuarded(args);
  if (!UUID.test(args.operationId || '') || !/^[a-f0-9]{64}$/.test(args.requestHash || '') ||
      args.policy?.funding !== 'creator') throw new ManualTestError('Could not confirm this course image request.');
  // The normal image receipt, ownership, provider policy, explicit confirmation,
  // cancellation and acceptance checks still run in the caller. Usage remains
  // in the saved image provenance; this is not a capped QA-ledger transaction.
  return { async settle() {}, async halt() {} };
}
