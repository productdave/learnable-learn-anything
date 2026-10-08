import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const cloud = readFileSync(join(root, 'web/js/cloud-gen-client.js'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function bodyBetween(start, end) {
  const startIndex = cloud.indexOf(start);
  assert.ok(startIndex >= 0, `missing start anchor: ${start}`);
  const endIndex = cloud.indexOf(end, startIndex);
  assert.ok(endIndex > startIndex, `missing end anchor after ${start}`);
  return cloud.slice(startIndex, endIndex);
}

function assertSuccessReattaches(name, body, afterSnippet) {
  assert.ok(body.includes('await reattachCloudGeneration(jobId);'), `${name} should hydrate the accepted server transition.`);
  assert.ok(body.includes(afterSnippet), `${name} should keep its follow-up behavior.`);
  assert.ok(
    body.indexOf('await reattachCloudGeneration(jobId);') >
      body.indexOf('if (!resp.ok) {'),
    `${name} should reattach only after the server accepts the action.`
  );
  assert.ok(
    body.indexOf('await reattachCloudGeneration(jobId);') <
      body.indexOf(afterSnippet),
    `${name} should rehydrate durable state before relying on follow-up behavior.`
  );
}

const startBody = bodyBetween(
  'export async function startCloudGeneration',
  '/** Cancel a running cloud generation.'
);
assert.ok(startBody.includes('const finalJobId = data.jobId || jobId;'));
assert.ok(startBody.includes('await reattachCloudGeneration(finalJobId);'));
assert.ok(startBody.includes('subscribeToJob(finalJobId);'));
assert.ok(
  startBody.indexOf('await reattachCloudGeneration(finalJobId);') >
    startBody.indexOf('if (!resp.ok) {'),
  'start should reattach only after the server accepts or reuses a durable job.'
);
assert.ok(
  startBody.indexOf('await reattachCloudGeneration(finalJobId);') <
    startBody.indexOf('subscribeToJob(finalJobId);'),
  'start should hydrate the accepted durable job before relying on realtime updates.'
);

assertSuccessReattaches(
  'cancel',
  bodyBetween('export async function cancelCloudGeneration', '/** Delete a cloud generation row'),
  'setTimeout(async () => {'
);

assertSuccessReattaches(
  'resume',
  bodyBetween('export async function resumeCloudGeneration', '/** Restart a recoverable cloud job'),
  'subscribeToJob(jobId);'
);

assertSuccessReattaches(
  'restart',
  bodyBetween('export async function restartCloudGeneration', '/** Restart a recoverable cloud job after the user reattached lost source files.'),
  'subscribeToJob(jobId);'
);

assertSuccessReattaches(
  'reattached-source restart',
  bodyBetween('export async function restartCloudGenerationWithSources', '/** Restart a known cloud row'),
  'subscribeToJob(jobId);'
);

assert.ok(packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-action-success-reattach'));

console.log('cloud action success reattach tests passed');
