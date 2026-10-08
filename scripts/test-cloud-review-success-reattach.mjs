import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const cloud = readFileSync(join(root, 'web/js/cloud-gen-client.js'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const submitStart = cloud.indexOf('export async function submitCloudReview');
const submitEnd = cloud.indexOf('/**\n * Re-subscribe to all actionable cloud jobs.', submitStart);
const submitBody = cloud.slice(submitStart, submitEnd);
const reviewSuccessSequence = [
  '    }',
  '    await reattachCloudGeneration(jobId);',
  '    updateJob(jobId, { reviewRecovery: null });',
  '    subscribeToJob(jobId);'
].join('\n');

assert.ok(submitBody.includes('await requireCloudBackendReady();'));
assert.ok(submitBody.includes('const pending = reviewPendingForAction(action);'));
assert.ok(submitBody.includes('updateJob(jobId, { error: null, message: pending.message, reviewPending: pending })'));
assert.ok(submitBody.includes('if (!resp.ok) {'));
assert.ok(submitBody.includes('restoreJobAfterActionError(jobId, prior, err);'));
assert.ok(submitBody.includes(reviewSuccessSequence));
assert.ok(
  submitBody.indexOf(reviewSuccessSequence) >
    submitBody.indexOf('if (!resp.ok) {'),
  'review success should reattach only after the server accepts the checkpoint transition.'
);
assert.ok(
  reviewSuccessSequence.indexOf('await reattachCloudGeneration(jobId);') <
    reviewSuccessSequence.indexOf('subscribeToJob(jobId);'),
  'review success should hydrate the durable row before relying on realtime subscription updates.'
);
assert.ok(packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-review-success-reattach'));

console.log('cloud review success reattach tests passed');
