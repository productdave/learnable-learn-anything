// Optional operational diagnostics. Never a spending receipt or recovery authority.
import { randomUUID } from 'node:crypto';

const EVENTS = new Set(['run.started', 'run.stopped', 'provider.response', 'stage.saved', 'operation.failed', 'image.preflight_failed']);
const STAGES = new Set(['intake', 'research', 'topics', 'design', 'images', 'assemble', 'done']);
const ERRORS = new Set(['GENERATION_IO_UNCERTAIN', 'GENERATION_REQUEST_UNCERTAIN', 'GENERATION_TIME_SLICE_COMPLETE', 'GENERATION_MEDIA_TIMEOUT', 'PROVIDER_CREDIT_BALANCE', 'PROVIDER_HTTP_ERROR', 'configuration', 'stale', 'not_found', 'consent', 'unavailable', 'asset']);
const DESIGN_ERRORS = new Set('ALIGNMENT ANSWERS AUDIT_SIZE CITATION CONTEXT COURSE COVERAGE EDIT FACTS IDENTITY INCOMPLETE INPUT LESSON MARKUP ORDER POLICY SAFETY SCHEMA SIZE TARGET TOOL TRUNCATED VISUAL CONFLICT FAILED UNCERTAIN CAPACITY'.split(' ').map(code => 'VISUAL_DESIGN_' + code));
const FIELDS = new Set('summary guidance lessons flags kind message moduleId topicId edits scope field value sectionIndex itemIndex sectionOrder visual decision reason prompt alt caption afterSectionIndex alignment quizAnswersPreserved checksMatchTeaching'.split(' '));
const ISSUES = new Set('invalid_type invalid_literal unrecognized_keys invalid_union invalid_union_discriminator invalid_enum_value invalid_arguments invalid_return_type invalid_date invalid_string too_small too_big invalid_intersection_types not_multiple_of not_finite custom validation'.split(' '));
const safeId = value => typeof value === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9_./:-]{0,159}$/.test(value) && !/sk-|bearer|secret|token=/i.test(value) ? value : null;
const count = value => Number.isSafeInteger(value) && value >= 0 && value < 1e12 ? value : 0;

export function safeDiagnostic(error = {}) {
  error = error && typeof error === 'object' ? error : {};
  const code = ERRORS.has(error.code) || DESIGN_ERRORS.has(error.code) ? error.code : 'UNCLASSIFIED_ERROR';
  const status = error.status ?? error.httpStatus, sqlState = error.sqlState || error.code;
  return { code, ...(Number.isInteger(status) && status >= 400 && status <= 599 ? { httpStatus: status } : {}),
    ...(/^[0-9A-Z]{5}$/.test(sqlState || '') ? { sqlState } : {}),
    ...(typeof error.responseReceived === 'boolean' ? { responseReceived: error.responseReceived } : {}),
    ...(['tool_use','max_tokens','end_turn','stop_sequence','pause_turn','refusal'].includes(error.stopReason) ? { stopReason: error.stopReason } : {}),
    ...(Array.isArray(error.issues) ? { issues: error.issues.slice(0,4).map(issue => ({
      code: ISSUES.has(issue?.code) ? issue.code : 'validation',
      path: (Array.isArray(issue?.path) ? issue.path : []).slice(0,8).map(part => Number.isInteger(part) && part>=0 && part<=1000 ? part : FIELDS.has(part) ? part : '[field]'),
    })) } : {}) };
}

export function safeUsage(call = {}) {
  call = call && typeof call === 'object' ? call : {};
  return { callId: safeId(call.callId), task: safeId(call.task) || 'unknown', provider: safeId(call.provider) || 'unknown', model: safeId(call.model) || 'unknown',
    inputTokens: count(call.inputTokens), outputTokens: count(call.outputTokens),
    cacheCreationInputTokens: count(call.cacheCreationInputTokens), cacheReadInputTokens: count(call.cacheReadInputTokens) };
}

export function safeEventDetails(details = {}) {
  details = details && typeof details === 'object' ? details : {};
  const result = {};
  for (const key of ['operationId', 'lessonId', 'task', 'provider', 'model', 'callId']) if (safeId(details[key])) result[key] = details[key];
  for (const key of ['elapsedMs', 'remainingMs', 'completed', 'total']) if (Number.isFinite(details[key]) && details[key] >= 0) result[key] = Math.min(1e12, Math.round(details[key]));
  if (STAGES.has(details.stage)) result.stage = details.stage;
  if (['yes', 'no', 'unknown'].includes(details.dispatched)) result.dispatched = details.dispatched;
  if (['confirmed', 'unconfirmed', 'unknown'].includes(details.saved)) result.saved = details.saved;
  if (details.error) result.error = safeDiagnostic(details.error);
  if (details.usage) result.usage = safeUsage(details.usage);
  return result;
}

export function createGenerationTrace({ client, jobId, ownerId, runId, enabled = process.env.LEARNABLE_GENERATION_LOGS === '1',
  now = () => new Date().toISOString(), output = row => console.info('GENERATION_EVENT', JSON.stringify(row)), timeoutMs = 1000 } = {}) {
  let pending = [], dropped = 0, inFlight = null;
  function emit(event, details = {}) {
    if (!enabled || !EVENTS.has(event)) return;
    const row = { id: randomUUID(), job_id: safeId(jobId), owner_id: ownerId, run_id: safeId(runId), event,
      created_at: now(), details: safeEventDetails(details), build: safeId(process.env.VERCEL_GIT_COMMIT_SHA) || null };
    try { output(row); } catch { /* Optional logs never interrupt generation. */ }
    if (pending.length < 100) pending.push(row); else dropped++;
  }
  async function flush() {
    if (!enabled) return;
    if (inFlight) { await inFlight; if (pending.length) return flush(); return; }
    if (!pending.length) return;
    const batch = pending, overflow = dropped; pending = []; dropped = 0;
    inFlight = (async () => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      let settle;
      const timeout = new Promise(resolve => { settle = () => resolve({ error: true }); controller.signal.addEventListener('abort', settle, { once: true }); });
      try {
        // Stable IDs make a later diagnostic replay idempotent. No automatic retry.
        let query = client.from('generation_events').upsert(batch, { onConflict: 'id', ignoreDuplicates: true });
        if (typeof query.abortSignal === 'function') query = query.abortSignal(controller.signal);
        const result = await Promise.race([Promise.resolve(query), timeout]);
        if (result?.error) throw new Error('trace unavailable');
        if (overflow) {
          try { output({ event: 'trace.unavailable', job_id: safeId(jobId), run_id: safeId(runId), dropped: overflow }); } catch {}
        }
      } catch {
        try { output({ event: 'trace.unavailable', job_id: safeId(jobId), run_id: safeId(runId), dropped: batch.length + overflow }); } catch {}
      } finally { clearTimeout(timer); controller.signal.removeEventListener('abort', settle); }
    })();
    try { await inFlight; } finally { inFlight = null; }
  }
  return { emit, flush };
}
