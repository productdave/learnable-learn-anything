import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const cloud = readFileSync(join(root, 'web/js/cloud-gen-client.js'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const localCourseForCurrentUser = cloud.slice(
  cloud.indexOf('function localCourseForCurrentUser'),
  cloud.indexOf('function researchResultsFromRow')
);

assert.ok(
  cloud.includes('courseCanSyncToAccount, coursePayloadForAccount, courseRemoteTimestamp, hasLocalChangesSinceSync, shouldInstallRemoteCourse, syncCoursesNow'),
  'cloud client should import the exact account ownership helper.'
);
assert.ok(
  !cloud.includes('courseVisibleToEmail'),
  'cloud completion install checks should not use admin-visible UI visibility.'
);
assert.ok(localCourseForCurrentUser.includes('const user = getUser();'));
assert.ok(localCourseForCurrentUser.includes("if (jobId && !coursePayloadBelongsToJob(local, jobId)) return null;"));
assert.ok(localCourseForCurrentUser.includes("courseCanSyncToAccount(local, user.email || '', user.id || '')"));
assert.ok(
  localCourseForCurrentUser.includes("if (!user) return courseCanSyncToAccount(local, '', '') ? local : null;"),
  'unsigned fallback should use the same exact-account helper instead of admin visibility.'
);
assert.ok(cloud.includes('courseInstalled: savedCourseRunMatchesCompletedRow(localCourseForCurrentUser(row.saved_course_id, row.id), row)'));
assert.ok(cloud.includes('export function savedCourseRunMatchesCompletedRow'));
assert.ok(cloud.includes('export function savedCoursePayloadMatchesRun'));
assert.ok(cloud.includes('function completedCourseAlreadyInstalled(row)'));
assert.ok(cloud.includes('function coursePayloadBelongsToJob(course, jobId)'));
assert.ok(cloud.includes('course._generationJobId === jobId'));
assert.ok(cloud.includes('export function shouldInstallSavedCloudCourse'));
assert.ok(cloud.includes('if (local._syncedAt && hasLocalChangesSinceSync(local)) return false;'));
assert.ok(cloud.includes('remoteRunId && remoteRunId !== localRunId'));
assert.ok(
  cloud.includes('_installCourseFromRemote(row.id, { ...coursePayloadForAccount(row.payload, getUser()), _courseUpdatedAt: row.updatedAt, _syncedAt: remoteTs });'),
  'direct completed cloud installs should stamp legacy ownerless payloads to the signed-in account before local install.'
);
assert.ok(packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-completed-account-ownership'));

console.log('cloud completed account ownership tests passed');
