export const GENERATION_LEASE_MS = 6 * 60 * 1000;
export const CANCEL_GRACE_MS = 90 * 1000;
export const LIVE_GENERATION_STATUSES = ['queued', 'running'];
export const RUNNER_WRITABLE_STATUSES = LIVE_GENERATION_STATUSES;
export const CANCELLATION_STATUSES = ['cancelling', 'cancelled'];
export const ACTIVE_GENERATION_STATUSES = [...LIVE_GENERATION_STATUSES, 'cancelling'];
export const RUNNER_CANCELLATION_WRITABLE_STATUSES = [...ACTIVE_GENERATION_STATUSES, 'cancelled'];
export const HUMAN_REVIEW_STATUSES = ['review_curriculum', 'review_research'];
export const CANCELLABLE_GENERATION_STATUSES = [...ACTIVE_GENERATION_STATUSES, ...HUMAN_REVIEW_STATUSES];
export const API_KEY_WAITING_STATUSES = ['failed', 'timed_out', 'partial', ...HUMAN_REVIEW_STATUSES];

export function generationLeaseFields(now = new Date()) {
  return {
    heartbeat_at: now.toISOString(),
    lease_expires_at: new Date(now.getTime() + GENERATION_LEASE_MS).toISOString(),
    updated_at: now.toISOString()
  };
}

export function generationTerminalFields(now = new Date()) {
  return {
    heartbeat_at: now.toISOString(),
    updated_at: now.toISOString(),
    completed_at: now.toISOString()
  };
}

export function generationCancelLeaseFields(now = new Date()) {
  return {
    status: 'cancelling',
    message: 'Cancelling — waiting for in-flight work to stop.',
    heartbeat_at: now.toISOString(),
    lease_expires_at: new Date(now.getTime() + CANCEL_GRACE_MS).toISOString(),
    updated_at: now.toISOString()
  };
}

export function generationCancelledTerminalFields(now = new Date()) {
  return {
    status: 'cancelled',
    stage: 'done',
    message: 'Cancelled by user',
    ...generationTerminalFields(now)
  };
}

export function sameRunFilter(query, runId) {
  return runId ? query.eq('run_id', runId) : query.is('run_id', null);
}

// The caller must identify the checkpoint the person saw, not just the job.
// Status/run CAS below still protects changes between this read and the write.
export function requireGenerationExpectation(expected, job = null) {
  const valid = expected && typeof expected.status === 'string'
    && Object.hasOwn(expected, 'runId')
    && (expected.runId === null || (typeof expected.runId === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(expected.runId)));
  if (!valid || (job && (expected.status !== job.status || expected.runId !== (job.run_id || null)))) {
    const error = new Error('This course changed, or this page is out of date. Refresh the latest course state and review it before trying again. No action was taken.');
    error.statusCode = 409; error.code = 'GENERATION_CHANGED'; throw error;
  }
  return expected;
}
