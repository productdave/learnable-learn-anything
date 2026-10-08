import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  isCloudJobStateConflictError,
  isMissingCloudJobError
} from '../web/js/cloud-gen-client.js';

const statusErr = new Error('Anything');
statusErr.status = 404;
assert.equal(isMissingCloudJobError(statusErr), true);

assert.equal(
  isMissingCloudJobError(new Error('Restart request failed (404): Job not found')),
  true
);

assert.equal(
  isMissingCloudJobError(new Error('Restart request failed (409): Job is completed')),
  false
);

assert.equal(
  isMissingCloudJobError(new Error('Resume request failed (404): Different missing thing')),
  false
);

assert.equal(isMissingCloudJobError(null), false);

const conflictErr = new Error('Anything');
conflictErr.status = 409;
assert.equal(isCloudJobStateConflictError(conflictErr), true);

assert.equal(
  isCloudJobStateConflictError(new Error('Restart request failed (409): Job is running; only failed, timed-out, or partial jobs can be restarted.')),
  true
);

assert.equal(
  isCloudJobStateConflictError(new Error('Restart request failed (404): Job not found')),
  false
);

assert.equal(isCloudJobStateConflictError(null), false);

const cloudSource = readFileSync(join(process.cwd(), 'web/js/cloud-gen-client.js'), 'utf8');
function bodyBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `missing ${start}`);
  const endIndex = source.indexOf(end, startIndex);
  assert.ok(endIndex > startIndex, `missing ${end}`);
  return source.slice(startIndex, endIndex);
}

const restartBody = bodyBetween(
  cloudSource,
  'export async function restartCloudGeneration',
  '/** Restart a recoverable cloud job after the user reattached lost source files.'
);
assert.ok(
  restartBody.includes('if (isMissingApiKeyError(err)) {') &&
  restartBody.indexOf('if (isMissingApiKeyError(err)) {') <
    restartBody.indexOf('restoreJobAfterActionError(jobId, prior, err);') &&
  restartBody.includes('await reattachCloudGeneration(jobId);'),
  'restart should hydrate pending restart intent on missing API key before restoring local state.'
);

console.log('cloud restart fallback tests passed');
