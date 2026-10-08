import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const cloud = readFileSync(join(root, 'web/js/cloud-gen-client.js'), 'utf8');
const intake = readFileSync(join(root, 'web/js/intake.js'), 'utf8');
const app = readFileSync(join(root, 'web/js/app.js'), 'utf8');
const review = readFileSync(join(root, 'web/api/gen/review.js'), 'utf8');
const submitStart = cloud.indexOf('export async function submitCloudReview');
const submitEnd = cloud.indexOf('/**\n * Re-subscribe to all actionable cloud jobs.', submitStart);
const submitBody = cloud.slice(submitStart, submitEnd);

assert.ok(
    cloud.includes('const missingApiKey = isMissingApiKeyError(error);') &&
    cloud.includes("...(missingApiKey ? { needsApiKey: true } : {})") &&
    cloud.includes("'review_curriculum', 'review_research'") &&
    cloud.includes('Missing API key') &&
    cloud.includes('resume|continue|restart'),
  'cloud action errors caused by missing API keys should mark the local mirror recoverable.'
);

assert.ok(
  submitBody.includes('if (isMissingApiKeyError(err)) {') &&
    submitBody.includes('const reattached = await reattachCloudGeneration(jobId);') &&
    submitBody.includes('if (!reattached) restoreJobAfterActionError(jobId, prior, err);') &&
    submitBody.indexOf('if (isMissingApiKeyError(err)) {') < submitBody.indexOf('if (await reattachAfterActionConflict(jobId, err, prior)) return;'),
  'review missing-key failures should rehydrate the durable checkpoint before falling back to stale local state.'
);

assert.ok(
  review.includes('await markReviewWaitingForApiKey(supabase, jobId, user.id, transition.expectedStatus, job.run_id') &&
    review.includes('transition.patch.review_history') &&
    review.includes('export async function markReviewWaitingForApiKey') &&
    review.includes('review_history: reviewHistory') &&
    review.includes('Review is waiting for an Anthropic API key. Add one to your account, then continue from this checkpoint.') &&
    review.includes(".eq('status', expectedStatus)") &&
    review.includes('sameRunFilter(query, expectedRunId)') &&
    review.includes(".select('id')") &&
    review.includes('.maybeSingle()') &&
    review.includes('if (!marked) return res.status(409)'),
  'review endpoint should persist missing-key recovery context without leaving the review checkpoint.'
);

assert.ok(
  intake.includes('style="${needsKey || isFailed || isInterrupted || isTimedOut || isPartial || (isReview && job?.error) ?') &&
    intake.includes('isReview && needsKey') &&
    intake.includes('data-api-key>Add API key'),
  'review checkpoint modal should expose account setup when approval/rerun needs an API key.'
);

assert.ok(
    app.includes("else if (isReview && j.needsApiKey) stageLabel = 'Waiting for API key';") &&
    app.includes('data-job-action="api-key"') &&
    app.includes('Add API key</button>` : \'\'') &&
    app.includes("openAccount({ intent: 'course-generation', jobId: id })"),
  'dashboard review cards should expose account setup for missing-key review checkpoints.'
);

console.log('cloud review API key recovery tests passed');
