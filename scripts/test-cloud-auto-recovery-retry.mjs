import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { AUTO_RECOVERY_EXHAUSTED_ERROR, autoRecoveryExhaustedPatch, autoRecoveryFailurePatch } from '../web/api/_lib/gen-recovery.mjs';

const root = process.cwd();
const sweep = readFileSync(join(root, 'web/api/gen/sweep.js'), 'utf8');

const firstFailure = autoRecoveryFailurePatch(
  { status: 'timed_out', recovery_attempts: 0 },
  new Error('temporary model timeout'),
  '2026-06-29T00:00:00.000Z'
);
assert.equal(firstFailure.status, 'timed_out');
assert.equal(firstFailure.recovery_attempts, 1);
assert.match(firstFailure.message, /will retry from the saved checkpoint/i);

const finalFailure = autoRecoveryFailurePatch(
  { status: 'timed_out', recovery_attempts: 1 },
  new Error('still timing out'),
  '2026-06-29T00:01:00.000Z'
);
assert.equal(finalFailure.status, 'timed_out');
assert.equal(finalFailure.recovery_attempts, 2);
assert.match(finalFailure.message, /manually resume from the saved checkpoint/i);

const restartFailure = autoRecoveryFailurePatch(
  {
    status: 'timed_out',
    recovery_attempts: 0,
    message: 'Generation is waiting for an Anthropic API key. Add one to your account, then restart from the saved request.'
  },
  new Error('temporary restart timeout'),
  '2026-06-29T00:02:00.000Z'
);
assert.equal(restartFailure.status, 'timed_out');
assert.equal(restartFailure.recovery_attempts, 1);
assert.match(restartFailure.message, /will retry from the saved request/i);

const restartExhausted = autoRecoveryExhaustedPatch({
  status: 'timed_out',
  message: 'API key saved. Restart from the saved request.'
}, '2026-06-29T00:03:00.000Z');
assert.match(restartExhausted.message, /manually restart from the saved request/i);

assert.ok(
  sweep.includes('autoRecoveryFailurePatch') &&
  sweep.includes('autoRecoveryFailurePatch(job, err)') &&
  sweep.includes('autoRecoveryExhaustedPatch(row, now)'),
  'sweeper should use the shared automatic recovery failure policy.'
);
assert.ok(
  sweep.includes("const RECOVERY_WRITABLE_STATUSES = ['running', 'failed'];"),
  'sweeper should be able to convert the same run-owned failed row back to timed_out.'
);
assert.ok(
  sweep.includes(".eq('run_id', runId)") &&
  sweep.includes(".in('status', RECOVERY_WRITABLE_STATUSES)"),
  'sweeper retry repair must stay scoped to the active recovery run.'
);
assert.ok(
  sweep.includes('export async function claimTimedOutJob') &&
    sweep.includes('export async function markRecoveryWaitingForApiKey') &&
    sweep.includes('sameRunFilter(query, job.run_id)'),
  'sweeper should claim and mark only the exact timed-out run it inspected.'
);
assert.equal(
  sweep.includes("status: 'failed',\n        error: err.message || String(err),\n        message: 'Cloud recovery failed."),
  false,
  'automatic recovery failures should not immediately become hard failed jobs.'
);
assert.ok(
  sweep.includes('export async function markRecoveryExhausted') &&
    sweep.includes(".select('id,owner_id,run_id,error,message')") &&
    sweep.includes(".neq('error', AUTO_RECOVERY_EXHAUSTED_ERROR)") &&
    sweep.includes('sameRunFilter(query, row.run_id)'),
  'exhausted recovery should be exact-run guarded and preserve restart/resume intent.'
);
assert.ok(
  sweep.split(".neq('error', AUTO_RECOVERY_EXHAUSTED_ERROR)").length - 1 >= 2,
  'exhausted recovery should guard both load and update against repeated cron marking.'
);
assert.equal(autoRecoveryExhaustedPatch({}).error, AUTO_RECOVERY_EXHAUSTED_ERROR);

console.log('cloud auto recovery retry tests passed');
