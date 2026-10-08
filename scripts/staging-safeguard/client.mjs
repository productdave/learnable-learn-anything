// STAGING ARTIFACT ONLY. Never imported by web/ or production packaging.
// A service-only, durable reservation precedes every provider dispatch. No grant
// is created here; an operator must separately record a fresh approved test.
import { createHash, randomUUID } from 'node:crypto';

export const STAGING_URL = 'https://dmnwkrybgggbpqpetuub.supabase.co';
export const PROFILE = 'sonnet45-search20250305-20260922';
export const MODEL = 'claude-sonnet-4-5-20250929';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const UUID = /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i;
const validInt = (n, max) => Number.isSafeInteger(n) && n >= 0 && n <= max;

export class StagingSpendError extends Error {
  constructor(code, message) { super(message); this.name = 'StagingSpendError'; this.code = code; }
}
const deny = (code, message) => { throw new StagingSpendError(code, message); };

export function requestReservation(original) {
  let body, json;
  try { json = JSON.stringify(original); body = JSON.parse(json); }
  catch { deny('unsupported', 'Staging budget protection could not validate this request. No AI request was sent.'); }
  const allowed = ['model', 'max_tokens', 'system', 'tools', 'tool_choice', 'messages'];
  if (!body || Object.keys(body).some(k => !allowed.includes(k)) || body.model !== MODEL ||
      !validInt(body.max_tokens, 16384) || body.max_tokens === 0 ||
      typeof body.system !== 'string' || !Array.isArray(body.messages) || !body.messages.length ||
      !Array.isArray(body.tools) || body.tools.length < 1 || body.tools.length > 2 ||
      Buffer.byteLength(json) > 30 * 1024 * 1024) {
    deny('unsupported', 'This request is outside the reviewed staging budget profile. No AI request was sent.');
  }
  // Reject additional billable facilities, including nested cache controls.
  const visit = value => {
    if (!value || typeof value !== 'object') return;
    for (const [k, v] of Object.entries(value)) {
      if (['cache_control', 'inference_geo', 'container', 'mcp_servers', 'thinking'].includes(k))
        deny('unsupported', 'This request uses an unapproved billable feature. No AI request was sent.');
      visit(v);
    }
  };
  visit(body);
  let searches = 0, clientTools = 0;
  for (const tool of body.tools) {
    if (tool.type) {
      if (tool.type !== 'web_search_20250305' || tool.name !== 'web_search' ||
          Object.keys(tool).some(k => !['type', 'name', 'max_uses'].includes(k)) ||
          !validInt(tool.max_uses, 6) || tool.max_uses < 1 || searches)
        deny('unsupported', 'The search tool is outside the reviewed staging budget profile. No AI request was sent.');
      searches = tool.max_uses;
    } else {
      // Initial-draft Visual Designer calls use the same text reservation,
      // settlement and uncertain-outcome hold as curriculum/research/lessons.
      // They do not enable the separate user-facing refinement editor.
      if (!['submit_course_brief', 'submit_research_bundle', 'submit_topic', 'submit_course_visual_review', 'submit_lesson_visual_design'].includes(tool.name))
        deny('unsupported', 'This tool is outside the reviewed staging budget profile. No AI request was sent.');
      clientTools++;
    }
  }
  if (clientTools !== 1 || (searches && !body.tools.some(t => t.name === 'submit_research_bundle')))
    deny('unsupported', 'Only the reviewed course-creation tools are enabled for this test.');
  // Full 200k context per search pass, rather than a prompt-length estimate.
  // Current first-party Sonnet 4.5: $3/MTok input, $15/MTok output, $0.01/search.
  // Over-reserve output per pass too. Each follow-up API turn reserves anew.
  const passes = searches + 1;
  const inputTokens = 200000 * passes, outputTokens = body.max_tokens * passes;
  return { body, json, searches, inputTokens, outputTokens,
    microusd: inputTokens * 3 + outputTokens * 15 + searches * 10000,
    fingerprint: createHash('sha256').update(json).digest('hex') };
}

export function settledCost(result, reservation) {
  const u = result?.usage;
  const search = u?.server_tool_use?.web_search_requests ?? 0;
  if (result?.model !== MODEL || !u || (reservation.searches > 0 && !Object.hasOwn(u.server_tool_use || {}, 'web_search_requests')) || !validInt(u.input_tokens, reservation.inputTokens) ||
      !validInt(u.output_tokens, reservation.outputTokens) || !validInt(search, reservation.searches) ||
      (u.cache_creation_input_tokens ?? 0) !== 0 || (u.cache_read_input_tokens ?? 0) !== 0 ||
      Object.keys(u.server_tool_use || {}).some(k => k !== 'web_search_requests' && u.server_tool_use[k] !== 0) ||
      (u.service_tier && u.service_tier !== 'standard') || (u.inference_geo && !['global', 'not_available'].includes(u.inference_geo)))
    deny('uncertain', 'AI usage could not be reconciled safely. The reservation is held; automatic spending is stopped.');
  const actual = u.input_tokens * 3 + u.output_tokens * 15 + search * 10000;
  if (!validInt(actual, reservation.microusd)) deny('uncertain', 'AI usage exceeded its reservation. Spending is stopped for review.');
  return actual;
}

export function createClient({ apiKey, supabase, ownerId, jobId, runId, requestBudget = null, beforeDispatch = null, fetcher = fetch, env = process.env }) {
  if (env.LEARNABLE_SETUP_GENERATION !== '1') deny('disabled', 'Course generation is disabled on staging. No AI request was sent.');
  if (env.SUPABASE_URL !== STAGING_URL || !supabase?.rpc || !UUID.test(ownerId || '') ||
      !UUID.test(runId || '') || !/^job-(?:[a-f0-9-]{36}|setup-[a-f0-9]{48})$/i.test(jobId || '') || !apiKey)
    deny('configuration', 'Staging spending protection is not configured for this course. No AI request was sent.');
  // Queue workers within a runner; the database separately prevents another
  // invocation/resume from dispatching while a reservation is unresolved.
  let queue = Promise.resolve();
  let stopped = null;
  const rpc = async (name, args, signal = null) => {
    let result;
    try {
      const operation = supabase.rpc(name, args);
      result = await (signal && typeof operation.abortSignal === 'function' ? operation.abortSignal(signal) : operation);
    }
    catch { deny('ledger', 'The spending check could not be confirmed. No automatic retry will spend tokens.'); }
    if (result.error) deny('ledger', 'The spending check could not be confirmed. No automatic retry will spend tokens.');
    return result.data;
  };
  async function create(original) {
    if (stopped) throw stopped;
    // These checks run inside the queue, not when a worker enqueues its call.
    await beforeDispatch?.();
    requestBudget?.assertCanStart();
    const r = requestReservation(original), requestId = randomUUID();
    const scope = { p_owner_id: ownerId, p_job_id: jobId, p_run_id: runId, p_request_id: requestId };
    const request = requestBudget?.beginRequest();
    const signal = request?.signal || AbortSignal.timeout(240000);
    let reservationDenied = false;
    // A reservation RPC can commit even when its reply is lost. Never infer a
    // refund from a timeout, including a timeout before confirmed dispatch.
    try {
      const reserved = await rpc('reserve_learnable_staging_spend', {
        ...scope, p_profile: PROFILE, p_reserved_microusd: r.microusd, p_fingerprint: r.fingerprint
      }, signal);
      if (!reserved?.ok) {
        reservationDenied = true;
        const reason = reserved?.reason;
        if (reason === 'budget') deny('budget', 'This test cannot safely cover the next AI request. Your work is saved; review the test budget before continuing.');
        if (reason === 'pending' || reason === 'halted') deny('pending', 'A previous AI request still needs a spending review. Your work is saved; do not retry paid generation yet.');
        deny('approval', 'This staging course does not have an active approved test budget. No AI request was sent.');
      }
      request?.throwIfExpired?.();
      requestBudget?.assertCanStart();
      const response = await fetcher(ENDPOINT, { method: 'POST', redirect: 'error',
        headers: { 'content-type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
        body: r.json, signal });
      if (!response.ok) deny('provider', 'The AI request did not complete cleanly. Its reservation is held for review; no automatic retry will spend tokens.');
      const result = await response.json(), actual = settledCost(result, r);
      request?.throwIfExpired?.();
      const settled = await rpc('settle_learnable_staging_spend', {
        ...scope, p_actual_microusd: actual, p_provider_request_id: response.headers?.get?.('request-id') || null
      }, signal);
      if (!settled?.ok) deny('ledger', 'AI usage was received but its spending record could not be confirmed. Further spending is stopped.');
      return result;
    } catch (error) {
      if (reservationDenied) throw error;
      // If settlement succeeded but its response was lost, this still closes the
      // grant. If the database is unreachable, the pending row itself stops it.
      stopped = error instanceof StagingSpendError ? error : new StagingSpendError('uncertain', 'The AI result is uncertain. Its budget reservation is held and automatic spending is stopped. Your saved work is unchanged.');
      // Use a separate, short cleanup timeout; the provider signal may already
      // be aborted. The held row prevents spending even if this halt fails.
      try { await rpc('halt_learnable_staging_spend', scope, AbortSignal.timeout(5000)); } catch { /* held reservation is already durable */ }
      throw stopped;
    } finally { request?.close(); }
  }
  return { messages: { create: original => {
    const next = queue.catch(() => {}).then(() => create(original)); queue = next; return next;
  } } };
}
