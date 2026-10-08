import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const app = readFileSync(join(root, 'web/js/app.js'), 'utf8');
const cloud = readFileSync(join(root, 'web/js/cloud-gen-client.js'), 'utf8');
const { shouldInstallSavedCloudCourse } = await import('../web/js/cloud-gen-client.js?v=79');

assert.ok(cloud.includes('export async function pullSavedCloudCourseForJob'));
assert.ok(cloud.includes("await installSavedCloudCourse(courseId, jobId, getJob(jobId)?.runId || '')"));
assert.ok(cloud.includes("error: 'Could not sync the saved course yet. Try again in a moment.'"));
assert.ok(cloud.includes('const query = new URLSearchParams({ id: courseId });'));
assert.ok(cloud.includes("if (jobId) query.set('jobId', jobId);"));
assert.ok(cloud.includes("if (expectedRunId) query.set('runId', expectedRunId);"));
assert.ok(cloud.includes('fetch(`/api/courses/get?${query.toString()}`'));
assert.ok(cloud.includes("if (expectedRunId && String(row.payload?._generationRunId || '') !== String(expectedRunId)) return false;"));
assert.ok(cloud.includes('if (!shouldInstallSavedCloudCourse(local, remoteRow, jobId)) {'));
assert.ok(cloud.includes('if (local && savedCoursePayloadMatchesRun(local, expectedRunId)) {'));
assert.ok(cloud.includes('export function shouldInstallSavedCloudCourse'));
assert.ok(cloud.includes('export function savedCoursePayloadMatchesRun'));
assert.ok(cloud.includes('remoteRow.payload?._generationRunId'));
assert.ok(cloud.includes('remoteRunId && remoteRunId !== localRunId'));
assert.ok(cloud.includes('hasLocalChangesSinceSync(local)'));
assert.ok(!cloud.includes('if (local) {'));
assert.ok(cloud.includes('updateJob(jobId, { courseInstalled: true });'));
assert.ok(cloud.includes('return true;'));

assert.ok(app.includes('pullSavedCloudCourseForJob'));
assert.ok(app.includes('data-job-action="sync-completed"'));
assert.ok(app.includes('data-course-id="${escapeHTML(j.savedCourseId || \'\')}"'));
assert.ok(app.includes('data-job-action="delete-job" data-job-id="${j.id}">Delete</button>'));
assert.ok(app.includes('await pullSavedCloudCourseForJob(id, courseId)'));
assert.ok(app.includes("window.location.href = `?course=${encodeURIComponent(courseId)}`;"));

const completedBranch = app.slice(
  app.indexOf('} else if (isDone) {'),
  app.indexOf('} else {\n    // Running.')
);
assert.ok(!completedBranch.includes('aria-disabled="true">Saving'));
assert.ok(completedBranch.includes('data-job-action="sync-completed"'));
assert.ok(completedBranch.includes('data-job-action="delete-job"'));

assert.equal(
  shouldInstallSavedCloudCourse(
    {
      _generationJobId: 'job-1',
      _generationRunId: 'run-old',
      updatedAt: Date.parse('2026-06-29T00:00:30.000Z'),
      _syncedAt: Date.parse('2026-06-29T00:00:30.000Z')
    },
    { payload: { _generationJobId: 'job-1', _generationRunId: 'run-new' }, updated_at: '2026-06-29T00:00:01.000Z' },
    'job-1'
  ),
  true,
  'a newer authoritative generation run should install even if the local clock is ahead.'
);
assert.equal(
  shouldInstallSavedCloudCourse(
    {
      _generationJobId: 'job-1',
      _generationRunId: 'run-old',
      updatedAt: Date.parse('2026-06-29T00:01:00.000Z'),
      _syncedAt: Date.parse('2026-06-29T00:00:30.000Z')
    },
    { payload: { _generationJobId: 'job-1', _generationRunId: 'run-new' }, updated_at: '2026-06-29T00:00:01.000Z' },
    'job-1'
  ),
  false,
  'a newer generation run should not overwrite unsynced local edits to the same generated course.'
);
assert.equal(
  shouldInstallSavedCloudCourse(
    { _generationJobId: 'job-1', _generationRunId: 'run-new', updatedAt: Date.parse('2026-06-29T00:00:30.000Z') },
    { payload: { _generationJobId: 'job-1', _generationRunId: 'run-new' }, updated_at: '2026-06-29T00:00:01.000Z' },
    'job-1'
  ),
  false,
  'matching generation runs should fall back to timestamp policy.'
);

console.log('cloud completed sync action tests passed');
