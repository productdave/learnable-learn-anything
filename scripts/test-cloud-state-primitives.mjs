import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  ACTIVE_GENERATION_STATUSES,
  API_KEY_WAITING_STATUSES,
  CANCELLABLE_GENERATION_STATUSES,
  CANCELLATION_STATUSES,
  CANCEL_GRACE_MS,
  GENERATION_LEASE_MS,
  HUMAN_REVIEW_STATUSES,
  LIVE_GENERATION_STATUSES,
  RUNNER_CANCELLATION_WRITABLE_STATUSES,
  RUNNER_WRITABLE_STATUSES,
  generationCancelledTerminalFields,
  generationCancelLeaseFields,
  generationLeaseFields,
  generationTerminalFields,
  sameRunFilter
} from '../web/api/_lib/gen-state.mjs';

const root = process.cwd();
const read = file => readFileSync(join(root, file), 'utf8');

assert.equal(GENERATION_LEASE_MS, 6 * 60 * 1000);
assert.equal(CANCEL_GRACE_MS, 90 * 1000);
assert.deepEqual(LIVE_GENERATION_STATUSES, ['queued', 'running']);
assert.equal(RUNNER_WRITABLE_STATUSES, LIVE_GENERATION_STATUSES);
assert.deepEqual(CANCELLATION_STATUSES, ['cancelling', 'cancelled']);
assert.deepEqual(ACTIVE_GENERATION_STATUSES, ['queued', 'running', 'cancelling']);
assert.deepEqual(RUNNER_CANCELLATION_WRITABLE_STATUSES, ['queued', 'running', 'cancelling', 'cancelled']);
assert.deepEqual(HUMAN_REVIEW_STATUSES, ['review_curriculum', 'review_research']);
assert.deepEqual(CANCELLABLE_GENERATION_STATUSES, ['queued', 'running', 'cancelling', 'review_curriculum', 'review_research']);
assert.deepEqual(API_KEY_WAITING_STATUSES, ['failed', 'timed_out', 'partial', 'review_curriculum', 'review_research']);

const base = new Date('2026-06-29T00:00:00.000Z');
assert.deepEqual(generationLeaseFields(base), {
  heartbeat_at: '2026-06-29T00:00:00.000Z',
  lease_expires_at: '2026-06-29T00:06:00.000Z',
  updated_at: '2026-06-29T00:00:00.000Z'
});
assert.deepEqual(generationTerminalFields(base), {
  heartbeat_at: '2026-06-29T00:00:00.000Z',
  updated_at: '2026-06-29T00:00:00.000Z',
  completed_at: '2026-06-29T00:00:00.000Z'
});
assert.deepEqual(generationCancelLeaseFields(base), {
  status: 'cancelling',
  message: 'Cancelling — waiting for in-flight work to stop.',
  heartbeat_at: '2026-06-29T00:00:00.000Z',
  lease_expires_at: '2026-06-29T00:01:30.000Z',
  updated_at: '2026-06-29T00:00:00.000Z'
});
assert.deepEqual(generationCancelledTerminalFields(base), {
  status: 'cancelled',
  stage: 'done',
  message: 'Cancelled by user',
  heartbeat_at: '2026-06-29T00:00:00.000Z',
  updated_at: '2026-06-29T00:00:00.000Z',
  completed_at: '2026-06-29T00:00:00.000Z'
});

{
  const calls = [];
  const query = {
    eq(field, value) {
      calls.push({ type: 'eq', field, value });
      return query;
    },
    is(field, value) {
      calls.push({ type: 'is', field, value });
      return query;
    }
  };
  assert.equal(sameRunFilter(query, 'run-1'), query);
  assert.equal(sameRunFilter(query, null), query);
  assert.deepEqual(calls, [
    { type: 'eq', field: 'run_id', value: 'run-1' },
    { type: 'is', field: 'run_id', value: null }
  ]);
}

for (const file of [
  'web/api/_lib/gen-runner.mjs',
  'web/api/_lib/course-save.mjs',
  'web/api/_lib/gen-recovery.mjs',
  'web/api/gen/cancel.js',
  'web/api/gen/credentials-ready.js',
  'web/api/gen/start.js',
  'web/api/gen/resume.js',
  'web/api/gen/restart.js',
  'web/api/gen/review.js',
  'web/api/gen/sweep.js',
  'web/api/gen/watchdog.js'
]) {
  assert.ok(read(file).includes('gen-state.mjs'), `${file} should use shared generation state primitives.`);
}

for (const file of [
  'web/api/_lib/gen-runner.mjs',
  'web/api/_lib/course-save.mjs',
  'web/api/_lib/gen-recovery.mjs',
  'web/api/gen/cancel.js',
  'web/api/gen/credentials-ready.js',
  'web/api/gen/start.js',
  'web/api/gen/resume.js',
  'web/api/gen/restart.js',
  'web/api/gen/review.js',
  'web/api/gen/sweep.js',
  'web/api/gen/watchdog.js'
]) {
  const source = read(file);
  assert.equal(source.includes('const LEASE_MS = 6 * 60 * 1000'), false, `${file} should not define a local lease duration.`);
  assert.equal(source.includes("['queued', 'running']"), false, `${file} should not define local live runner statuses.`);
  assert.equal(source.includes("const LIVE_STATUSES"), false, `${file} should not define local live statuses.`);
  assert.equal(source.includes("const ACTIVE_STATUSES"), false, `${file} should not define local active statuses.`);
  assert.equal(source.includes("const CANCELLABLE_STATUSES"), false, `${file} should not define local cancellable statuses.`);
  assert.equal(source.includes("const WAITING_STATUSES"), false, `${file} should not define local API-key waiting statuses.`);
  assert.equal(source.includes("const REVIEW_STATUSES = ['review_curriculum', 'review_research']"), false, `${file} should not define local review statuses.`);
  assert.equal(source.includes("['queued', 'running', 'cancelling', 'cancelled']"), false, `${file} should not define local runner cancellation writable statuses.`);
  assert.equal(source.includes("const COURSE_SAVE_WRITABLE_STATUSES"), false, `${file} should not define local course-save statuses.`);
}

console.log('cloud state primitive tests passed');
