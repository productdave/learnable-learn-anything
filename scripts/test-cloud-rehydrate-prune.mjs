import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createJob, getJob, listCloudJobMirrors, updateJob } from '../web/js/jobs.js';
import { pruneMissingCloudJobMirrors } from '../web/js/cloud-gen-client.js';

const store = new Map();
globalThis.localStorage = {
  getItem(key) { return store.has(key) ? store.get(key) : null; },
  setItem(key, value) { store.set(key, String(value)); },
  removeItem(key) { store.delete(key); }
};

const freshLocal = createJob({ topic: 'Fresh cloud job before insert' });
updateJob(freshLocal.id, { runner: 'cloud' });

const stillRemote = createJob({ topic: 'Still remote' });
updateJob(stillRemote.id, { runner: 'cloud', cloudSeenAt: Date.now() - 10_000 });

const deletedElsewhere = createJob({ topic: 'Deleted elsewhere' });
updateJob(deletedElsewhere.id, { runner: 'cloud', cloudSeenAt: Date.now() - 10_000 });

const localOnly = createJob({ topic: 'Legacy local job' });
updateJob(localOnly.id, { runner: 'browser' });

assert.deepEqual(
  listCloudJobMirrors().map(job => job.id).sort(),
  [freshLocal.id, stillRemote.id, deletedElsewhere.id].sort()
);

pruneMissingCloudJobMirrors(new Set([stillRemote.id]));

assert.ok(getJob(freshLocal.id), 'unseen cloud mirrors are not pruned before the durable row exists');
assert.ok(getJob(stillRemote.id), 'cloud mirrors still present remotely are kept');
assert.equal(getJob(deletedElsewhere.id), null, 'previously-seen cloud mirrors missing remotely are pruned');
assert.ok(getJob(localOnly.id), 'legacy local jobs are not touched by cloud pruning');

const cloudSource = readFileSync(join(process.cwd(), 'web/js/cloud-gen-client.js'), 'utf8');
const rehydrateBody = cloudSource.slice(
  cloudSource.indexOf('export async function rehydrateCloudSubscriptions'),
  cloudSource.indexOf('/** Ask the backend to mark any expired cloud jobs as timed_out. */')
);
const applyJobRowBody = cloudSource.slice(
  cloudSource.indexOf('function applyJobRow(row)'),
  cloudSource.indexOf('export function shouldInstallSavedCourseForJobStatus')
);
assert.ok(
  rehydrateBody.includes('const { data, error } = await client'),
  'rehydrate should capture Supabase read errors before reconciling local mirrors'
);
assert.ok(
  rehydrateBody.includes('if (error || !Array.isArray(data)) return;'),
  'rehydrate should skip pruning when the remote generation_jobs read fails'
);
assert.ok(
  rehydrateBody.indexOf('if (error || !Array.isArray(data)) return;') < rehydrateBody.indexOf('pruneMissingCloudJobMirrors(remoteIds);'),
  'remote read validation must happen before pruning local mirrors'
);
assert.ok(
  cloudSource.includes("const CLOUD_REHYDRATE_STATUSES = [...CLOUD_ACTIVE_STATUSES, ...CLOUD_REVIEW_STATUSES, ...CLOUD_RECOVERABLE_STATUSES, 'completed', 'cancelled'];") &&
    rehydrateBody.includes(".in('status', CLOUD_REHYDRATE_STATUSES)") &&
    rehydrateBody.includes('CLOUD_SUBSCRIBABLE_STATUSES.includes(row.status)'),
  'rehydrate should include cancelled rows as present remotely but subscribe only active/review rows.'
);
assert.ok(
  applyJobRowBody.includes("if (row.status === 'cancelled')") &&
    applyJobRowBody.includes('removeJob(row.id);') &&
    !applyJobRowBody.includes('removeCloudJobMirror(row.id)'),
  'cancelled rows should remove only the job mirror, preserving any saved partial course.'
);

console.log('cloud rehydrate pruning verified');
