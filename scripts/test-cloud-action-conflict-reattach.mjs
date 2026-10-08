import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const cloud = readFileSync(join(root, 'web/js/cloud-gen-client.js'), 'utf8');

function bodyBetween(start, end) {
  const startIndex = cloud.indexOf(start);
  assert.ok(startIndex >= 0, `missing start anchor: ${start}`);
  const endIndex = cloud.indexOf(end, startIndex);
  assert.ok(endIndex > startIndex, `missing end anchor after ${start}`);
  return cloud.slice(startIndex, endIndex);
}

function assertConflictReattaches(name, body, fallbackSnippet) {
  const reattachSnippet = 'if (await reattachAfterActionConflict(jobId, err, prior)) return;';
  const reattachIndex = body.indexOf(reattachSnippet);
  const fallbackIndex = body.indexOf(fallbackSnippet, reattachIndex);
  assert.ok(reattachIndex >= 0, `${name} should reattach after state conflicts.`);
  assert.ok(body.includes(fallbackSnippet), `${name} should keep the existing fallback path.`);
  assert.ok(
    reattachIndex < fallbackIndex,
    `${name} should reattach before restoring stale local state.`
  );
}

assertConflictReattaches(
  'cancel',
  bodyBetween('export async function cancelCloudGeneration', '/** Delete a cloud generation row'),
  'restoreJobAfterActionError(jobId, prior, err);'
);

const deleteBody = bodyBetween(
  'export async function deleteCloudGeneration',
  '/** Resume an interrupted'
);
assert.ok(deleteBody.includes('const err = await apiError(resp, \'Delete request failed\');'));
assert.ok(deleteBody.includes('if (isMissingCloudJobError(err)) {'));
assert.ok(deleteBody.includes('const deletedCourseId = prior?.savedCourseId && localCourseForCurrentUser(prior.savedCourseId, jobId)'));
assert.ok(deleteBody.includes('? prior.savedCourseId'));
assert.ok(deleteBody.includes(': null;'));
assert.ok(deleteBody.includes('removeCloudJobMirror(jobId);'));
assert.ok(deleteBody.includes('return { ok: true, missing: true, deletedCourseId };'));
assert.ok(deleteBody.includes('if (await reattachAfterActionConflict(jobId, err, prior)) err.reattached = true;'));
assert.ok(deleteBody.includes('throw err;'));
assert.ok(
  deleteBody.indexOf('if (isMissingCloudJobError(err)) {') <
  deleteBody.indexOf('if (await reattachAfterActionConflict(jobId, err, prior)) err.reattached = true;'),
  'missing cloud rows should remove stale local mirrors before conflict reattach handling.'
);
assert.ok(
  deleteBody.indexOf('if (await reattachAfterActionConflict(jobId, err, prior)) err.reattached = true;') <
  deleteBody.indexOf('throw err;'),
  'delete should reattach current server state before failing protected deletes.'
);
assert.ok(
  deleteBody.indexOf('throw err;') < deleteBody.lastIndexOf('removeCloudJobMirror(jobId);'),
  'delete conflicts must not remove local mirrors as though deletion succeeded.'
);

assertConflictReattaches(
  'resume',
  bodyBetween('export async function resumeCloudGeneration', '/** Restart a recoverable cloud job'),
  'restoreJobAfterActionError(jobId, prior, err);'
);

assertConflictReattaches(
  'restart',
  bodyBetween('export async function restartCloudGeneration', '/** Restart a recoverable cloud job after the user reattached lost source files.'),
  'restoreJobAfterActionError(jobId, prior, err);'
);

assertConflictReattaches(
  'reattached-source restart',
  bodyBetween('export async function restartCloudGenerationWithSources', '/** Restart a known cloud row'),
  'restoreJobAfterActionError(jobId, prior, err);'
);

assertConflictReattaches(
  'human review',
  bodyBetween('export async function submitCloudReview', '/**\n * Re-subscribe'),
  'restoreJobAfterActionError(jobId, prior, err);'
);

const helperBody = bodyBetween('async function reattachAfterActionConflict', 'async function apiErrorMessage');
assert.ok(helperBody.includes('isCloudJobStateConflictError(err)'));
assert.ok(helperBody.includes('return await reattachCloudGeneration(jobId);'));
assert.ok(helperBody.includes('catch { return false; }'));

console.log('cloud action conflict reattach tests passed');
