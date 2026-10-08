import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const cancel = readFileSync(join(root, 'web/api/gen/cancel.js'), 'utf8');
const runner = readFileSync(join(root, 'web/api/_lib/gen-runner.mjs'), 'utf8');
const watchdog = readFileSync(join(root, 'web/api/gen/watchdog.js'), 'utf8');
const sweep = readFileSync(join(root, 'web/api/gen/sweep.js'), 'utf8');
const sweepExpiredJobs = sweep.slice(
  sweep.indexOf('export async function markExpiredJobs'),
  sweep.indexOf('export async function markExpiredCancels')
);
const sweepExpiredCancels = sweep.slice(
  sweep.indexOf('export async function markExpiredCancels'),
  sweep.indexOf('async function loadTimedOutJobs')
);

assert.ok(cancel.includes("import { removePdfUploadsForJob } from './delete.js';"));
assert.ok(cancel.includes('ACTIVE_GENERATION_STATUSES'));
assert.ok(cancel.includes('CANCELLABLE_GENERATION_STATUSES'));
assert.ok(cancel.includes('generationCancelLeaseFields'));
assert.ok(cancel.includes('generationCancelledTerminalFields'));
assert.ok(cancel.includes(".select('status,run_id')"));
assert.ok(cancel.includes('ACTIVE_GENERATION_STATUSES.includes(job.status)'));
assert.ok(cancel.includes(".eq('status', job.status)"));
assert.ok(cancel.includes('sameRunFilter(query, job.run_id)'));
assert.ok(!cancel.includes(".in('status', CANCELLABLE_GENERATION_STATUSES)"));
assert.ok(cancel.includes("if (!data) return res.status(409).json({ code: 'GENERATION_CHANGED', error: 'This course changed. No action was taken. Review the latest course state before trying again.' });"));
assert.ok(cancel.includes("data.status === 'cancelled'"));
assert.ok(cancel.includes('return res.status(200).json({ ok: true, status: data.status, deletedUploads });'));
assert.ok(
  cancel.indexOf('generationCancelLeaseFields()') <
  cancel.indexOf("data.status === 'cancelled'"),
  'active jobs should be signalled as cancelling before terminal cleanup can run'
);

assert.ok(runner.includes("import { removePdfUploadsForJob } from '../gen/delete.js';"));
assert.ok(runner.includes('generationCancelledTerminalFields()'));
assert.ok(runner.includes('RUNNER_CANCELLATION_WRITABLE_STATUSES'));
assert.ok(runner.includes('await removePdfUploadsForJob(supabase, ownerId, jobId);'));

assert.ok(watchdog.includes("import { removePdfUploadsForJob } from './delete.js';"));
assert.ok(watchdog.includes('const cancelled = await markExpiredCancellingJobsCancelled(supabase, { ownerId, now });'));
assert.ok(watchdog.includes('export async function markExpiredCancellingJobsCancelled'));
assert.ok(watchdog.includes(".select('id,owner_id')"));
assert.ok(watchdog.includes('sameRunFilter(updateQuery, row.run_id)'));
assert.ok(watchdog.includes('await Promise.all((cancelled || []).map(row => removePdfUploadsForJob(supabase, row.owner_id, row.id)));'));

assert.ok(sweep.includes("import { removePdfUploadsForJob } from './delete.js';"));
assert.ok(sweep.includes('export async function pruneOldCancelledJobs'));
assert.ok(sweep.includes('const CANCELLED_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;'));
assert.ok(sweep.includes('const CANCELLED_PRUNE_LIMIT = 25;'));
assert.ok(sweep.includes('const prunedCancelled = await pruneOldCancelledJobs(supabase);'));
assert.ok(sweepExpiredJobs.includes(".select('id,owner_id,run_id,error,message,continuation')"));
assert.ok(sweepExpiredJobs.includes('sameRunFilter(update, row.run_id)'));
assert.ok(!sweepExpiredJobs.includes('removePdfUploadsForJob'));
assert.ok(sweepExpiredCancels.includes(".eq('status', 'cancelling')"));
assert.ok(sweepExpiredCancels.includes(".select('id,owner_id')"));
assert.ok(sweepExpiredCancels.includes('sameRunFilter(update, row.run_id)'));
assert.ok(sweepExpiredCancels.includes('if (!data) continue;'));
assert.ok(sweepExpiredCancels.includes('await removePdfUploadsForJob(supabase, row.owner_id, row.id);'));
assert.ok(sweep.includes("rpc('delete_generation_job_for_owner'"));
assert.ok(sweep.includes("p_owner_id: row.owner_id"));

console.log('gen cancel storage cleanup tests passed');
