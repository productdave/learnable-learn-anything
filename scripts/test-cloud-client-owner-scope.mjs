import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const cloud = readFileSync(join(process.cwd(), 'web/js/cloud-gen-client.js'), 'utf8');

function bodyBetween(start, end) {
  const startIndex = cloud.indexOf(start);
  assert.notEqual(startIndex, -1, `missing ${start}`);
  const endIndex = cloud.indexOf(end, startIndex);
  assert.notEqual(endIndex, -1, `missing ${end}`);
  return cloud.slice(startIndex, endIndex);
}

const reattach = bodyBetween('export async function reattachCloudGeneration', 'export function isMissingCloudJobError');
assert.ok(reattach.includes('const user = getUser();'));
assert.ok(reattach.includes('if (!user) return false;'));
assert.ok(reattach.includes('const ownerId = user.id;'));
assert.ok(reattach.includes(".eq('id', jobId)"));
assert.ok(reattach.includes(".eq('owner_id', ownerId)"));
assert.ok(reattach.includes('if (!isCurrentCloudOwner(ownerId)) return false;'));
assert.ok(
  reattach.indexOf(".eq('id', jobId)") < reattach.indexOf(".eq('owner_id', ownerId)"),
  'reattach should constrain the exact job before owner scope'
);

const rehydrate = bodyBetween('export async function rehydrateCloudSubscriptions', '/** Ask the backend to mark any expired cloud jobs as timed_out. */');
assert.ok(rehydrate.includes('const user = getUser();'));
assert.ok(rehydrate.includes('if (!user) return;'));
assert.ok(rehydrate.includes('const ownerId = user.id;'));
assert.ok(rehydrate.includes(".select('id, owner_id, status"));
assert.ok(rehydrate.includes(".eq('owner_id', ownerId)"));
assert.ok(rehydrate.includes('if (!isCurrentCloudOwner(ownerId)) return;'));
assert.ok(
  rehydrate.indexOf(".eq('owner_id', ownerId)") < rehydrate.indexOf(".in('status'"),
  'rehydrate should owner-scope generation_jobs before status filtering'
);
assert.ok(
  rehydrate.indexOf('if (!isCurrentCloudOwner(ownerId)) return;') < rehydrate.indexOf('const remoteIds = new Set'),
  'rehydrate should stop stale account responses before applying job rows.'
);

const subscribe = bodyBetween('function subscribeToJob(jobId)', 'function isSubscriptionCurrent(jobId, token)');
assert.ok(subscribe.includes('const user = getUser();'));
assert.ok(subscribe.includes("if (!user) {\n      if (isSubscriptionCurrent(jobId, token)) subs.delete(jobId);"));
assert.ok(subscribe.includes('const ownerId = user.id;'));
assert.ok(subscribe.includes(".eq('id', jobId)"));
assert.ok(subscribe.includes(".eq('owner_id', ownerId)"));
assert.ok(subscribe.includes('if (!isCurrentCloudOwner(ownerId)) {'));
assert.ok(subscribe.includes('rowBelongsToCurrentOwner(payload.new, jobId)'));
assert.ok(subscribe.includes('rowBelongsToCurrentOwner(payload.old, jobId)'));
assert.ok(
  subscribe.indexOf(".eq('id', jobId)") < subscribe.indexOf(".eq('owner_id', ownerId)"),
  'subscription hydration should constrain the exact job before owner scope'
);

const markStale = bodyBetween('export async function markStaleCloudJobs', 'export function markTimedOutJobsFromWatchdog');
assert.ok(markStale.includes('const ownerId = getUser()?.id || null;'));
assert.ok(markStale.includes('if (!ownerId) return [];'));
assert.ok(markStale.includes('if (!isCurrentCloudOwner(ownerId)) return [];'));
assert.ok(
  markStale.indexOf('if (!isCurrentCloudOwner(ownerId)) return [];') < markStale.indexOf('markTimedOutJobsFromWatchdog(ids);'),
  'watchdog responses should stop stale account results before mutating local mirrors.'
);

const installSaved = bodyBetween('async function installSavedCloudCourse', 'export function isSavedCourseInstalledForCurrentUser');
assert.ok(installSaved.includes('const ownerId = getUser()?.id || null;'));
assert.ok(installSaved.includes('if (!ownerId) return false;'));
assert.ok(installSaved.includes('if (!isCurrentCloudOwner(ownerId)) return false;'));
assert.ok(
  installSaved.indexOf('if (!isCurrentCloudOwner(ownerId)) return false;') < installSaved.indexOf('const remoteRow ='),
  'saved course install should stop stale account responses before local install.'
);
assert.ok(installSaved.includes('if (jobId && !coursePayloadBelongsToJob(row.payload, jobId)) return false;'));
assert.ok(installSaved.includes("if (expectedRunId) query.set('runId', expectedRunId);"));
assert.ok(installSaved.includes("if (expectedRunId && String(row.payload?._generationRunId || '') !== String(expectedRunId)) return false;"));
assert.ok(
  installSaved.indexOf('if (jobId && !coursePayloadBelongsToJob(row.payload, jobId)) return false;') <
    installSaved.indexOf('const remoteRow ='),
  'saved course install should reject job-mismatched course payloads before local install.'
);
assert.ok(
  installSaved.indexOf("if (expectedRunId && String(row.payload?._generationRunId || '') !== String(expectedRunId)) return false;") <
    installSaved.indexOf('const remoteRow ='),
  'saved course install should reject run-mismatched course payloads before local install.'
);

assert.ok(cloud.includes('function isCurrentCloudOwner(ownerId)'));
assert.ok(cloud.includes('return !!ownerId && getUser()?.id === ownerId;'));
assert.ok(cloud.includes("function rowBelongsToCurrentOwner(row, fallbackJobId = '')"));
assert.ok(cloud.includes('const ownerId = row?.owner_id || \'\';'));
assert.ok(cloud.includes('if (ownerId) return isCurrentCloudOwner(ownerId);'));
assert.ok(cloud.includes("const mirrorOwnerId = fallbackJobId ? getJob(fallbackJobId)?.ownerId || '' : '';"));
assert.ok(cloud.includes('return !!mirrorOwnerId && isCurrentCloudOwner(mirrorOwnerId);'));
assert.ok(cloud.includes('ownerId: row.owner_id || null'));
assert.ok(cloud.includes('if (!rowBelongsToCurrentOwner(row)) return;'));
assert.ok(cloud.includes('function coursePayloadBelongsToJob(course, jobId)'));

console.log('cloud client owner scope tests passed');
