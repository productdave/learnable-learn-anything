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

function assertPreflightBeforeLocalMutation(name, body, mutation) {
  assert.ok(body.includes('await requireCloudBackendReady();'), `${name} should check backend readiness.`);
  assert.ok(body.includes(mutation), `${name} should still perform expected local mutation.`);
  assert.ok(
    body.indexOf('await requireCloudBackendReady();') < body.indexOf(mutation),
    `${name} should check backend readiness before optimistic local mutation.`
  );
}

assertPreflightBeforeLocalMutation(
  'cancel',
  bodyBetween('export async function cancelCloudGeneration', '/** Delete a cloud generation row'),
  "updateJob(jobId, { status: 'cancelling'"
);

assertPreflightBeforeLocalMutation(
  'resume',
  bodyBetween('export async function resumeCloudGeneration', '/** Restart a recoverable cloud job'),
  "updateJob(jobId, { status: 'running'"
);

assertPreflightBeforeLocalMutation(
  'restart',
  bodyBetween('export async function restartCloudGeneration(jobId', '/** Restart a recoverable cloud job after'),
  "updateJob(jobId, {\n    status: 'running'"
);

assertPreflightBeforeLocalMutation(
  'review submit',
  bodyBetween('export async function submitCloudReview', '/**\n * Re-subscribe'),
  'updateJob(jobId, { error: null, message: pending.message, reviewPending: pending });'
);

const deleteBody = bodyBetween(
  'export async function deleteCloudGeneration',
  '/** Resume an interrupted'
);
assert.ok(deleteBody.includes('await requireCloudBackendReady();'), 'delete should check backend readiness.');
assert.ok(deleteBody.includes("fetch('/api/gen/delete'"), 'delete should still call the durable delete endpoint.');
assert.ok(
  deleteBody.indexOf('await requireCloudBackendReady();') < deleteBody.indexOf("fetch('/api/gen/delete'"),
  'delete should check backend readiness before calling the durable delete endpoint.'
);

console.log('cloud action preflight tests passed');
