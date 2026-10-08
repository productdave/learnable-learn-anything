import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const cloud = readFileSync(join(root, 'web/js/cloud-gen-client.js'), 'utf8');

const deleteBody = cloud.slice(
  cloud.indexOf('export async function deleteCloudGeneration'),
  cloud.indexOf('/** Resume an interrupted')
);
assert.ok(deleteBody.includes('removeCloudJobMirror(jobId);'));

const deleteMirrorBody = cloud.slice(
  cloud.indexOf('export function removeCloudJobMirror(jobId)'),
  cloud.indexOf('export function pruneMissingCloudJobMirrors')
);
assert.ok(deleteMirrorBody.includes('removeJobSubscription(jobId);'));
assert.ok(deleteMirrorBody.includes('removeJob(jobId);'));
assert.ok(deleteMirrorBody.indexOf('removeJobSubscription(jobId);') < deleteMirrorBody.indexOf('removeJob(jobId);'));
assert.ok(deleteMirrorBody.includes('if (removedCourseIds.size) {'));
assert.ok(deleteMirrorBody.includes('syncCoursesNow().catch(() => {});'));
assert.ok(
  deleteMirrorBody.indexOf('if (removedCourseIds.size) {') <
  deleteMirrorBody.indexOf('syncCoursesNow().catch(() => {});'),
  'cloud job mirror cleanup should sync courses only after removing current-account local courses.'
);

const watchdogBody = cloud.slice(
  cloud.indexOf('export async function markStaleCloudJobs'),
  cloud.indexOf('// --------------------------------------------------------------------\n// Realtime subscription')
);
assert.ok(watchdogBody.includes('for (const id of cancelled) {'));
assert.ok(watchdogBody.includes('removeJobSubscription(id);'));
assert.ok(watchdogBody.includes('removeJob(id);'));

const cancelBody = cloud.slice(
  cloud.indexOf('export async function cancelCloudGeneration'),
  cloud.indexOf('/** Delete a cloud generation row')
);
assert.ok(cancelBody.includes('removeJobSubscription(jobId);'));
assert.ok(cancelBody.includes('removeJob(jobId);'));
assert.ok(!cancelBody.includes('localCourseForCurrentUser(j.savedCourseId)'));
assert.ok(!cancelBody.includes('_removeCourseLocalSilent(j.savedCourseId)'));
assert.ok(!cancelBody.includes('removeUserCourse(j.savedCourseId)'));

console.log('cloud local cleanup tests passed');
