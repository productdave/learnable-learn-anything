import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const cloud = readFileSync(join(root, 'web/js/cloud-gen-client.js'), 'utf8');
const { savedCoursePayloadMatchesRun, savedCourseRunMatchesCompletedRow } = await import('../web/js/cloud-gen-client.js?v=79');

const rehydrate = cloud.slice(
  cloud.indexOf('export async function rehydrateCloudSubscriptions'),
  cloud.indexOf('/** Ask the backend to mark any expired cloud jobs as timed_out. */')
);

assert.ok(cloud.includes("const CLOUD_REHYDRATE_STATUSES = [...CLOUD_ACTIVE_STATUSES, ...CLOUD_REVIEW_STATUSES, ...CLOUD_RECOVERABLE_STATUSES, 'completed', 'cancelled'];"));
assert.ok(rehydrate.includes(".in('status', CLOUD_REHYDRATE_STATUSES)"));
assert.ok(rehydrate.includes('saved_course_id'));
assert.ok(rehydrate.includes('run_id'));
assert.ok(rehydrate.includes('if (CLOUD_SUBSCRIBABLE_STATUSES.includes(row.status)) subscribeToJob(row.id);'));
assert.ok(!rehydrate.includes('if (row.status === \'completed\') subscribeToJob'));
assert.ok(cloud.includes("installSavedCloudCourse(row.saved_course_id, row.id, row.run_id || '')"));
assert.ok(cloud.includes('if (row.status === \'completed\') removeJobSubscription(row.id);'));
assert.ok(cloud.includes('function completedCourseAlreadyInstalled(row)'));
assert.ok(cloud.includes('function removeCompletedJobMirrorIfInstalled(jobId, courseId)'));
assert.ok(cloud.includes('savedCoursePayloadMatchesRun(local, expectedRunId)'));
assert.ok(cloud.includes('if (completedCourseAlreadyInstalled(row)) {'));
assert.ok(cloud.includes('removeCompletedJobMirrorIfInstalled(jobId, row.id);'));
assert.ok(cloud.includes('const local = localCourseForCurrentUser(row.saved_course_id, row.id);'));
assert.ok(cloud.includes('return savedCourseRunMatchesCompletedRow(local, row);'));
assert.ok(cloud.includes('courseInstalled: savedCourseRunMatchesCompletedRow(localCourseForCurrentUser(row.saved_course_id, row.id), row)'));
assert.ok(cloud.includes('isSavedCourseInstalledForCurrentUser(courseId, jobId)'));
assert.ok(cloud.includes('runId: row.run_id || null'));
assert.ok(
  cloud.indexOf('if (completedCourseAlreadyInstalled(row)) {') <
  cloud.indexOf('if (!getJob(row.id)) {'),
  'completed jobs with an installed saved course should not recreate local mirrors during rehydrate.'
);
assert.equal(
  savedCourseRunMatchesCompletedRow(
    { _generationJobId: 'job-1', _generationRunId: 'run-old' },
    { id: 'job-1', status: 'completed', run_id: 'run-new' }
  ),
  false,
  'completed rehydrate should not hide a job when the local course belongs to an older run.'
);
assert.equal(
  savedCourseRunMatchesCompletedRow(
    { _generationJobId: 'job-1', _generationRunId: 'run-new' },
    { id: 'job-1', status: 'completed', run_id: 'run-new' }
  ),
  true,
  'completed rehydrate may hide a job after the matching run is installed.'
);
assert.equal(
  savedCourseRunMatchesCompletedRow(
    { _generationJobId: 'job-1' },
    { id: 'job-1', status: 'completed', run_id: '' }
  ),
  true,
  'legacy completed rows without run ids should keep the previous installed-course behavior.'
);
assert.equal(savedCoursePayloadMatchesRun({ _generationRunId: 'run-old' }, 'run-new'), false);
assert.equal(savedCoursePayloadMatchesRun({ _generationRunId: 'run-new' }, 'run-new'), true);
assert.equal(savedCoursePayloadMatchesRun({ _generationRunId: 'run-old' }, ''), true);

console.log('cloud completed rehydrate tests passed');
