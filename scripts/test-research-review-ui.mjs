import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const intake = readFileSync(join(root, 'web/js/intake.js'), 'utf8');
const cloud = readFileSync(join(root, 'web/js/cloud-gen-client.js'), 'utf8');

assert.ok(intake.includes('const evidence = researchEvidence(job);'));
assert.ok(intake.includes('const hasCompleteResearch = evidence.complete;'));
assert.ok(intake.includes('researchEvidenceHTML(evidence)'));
assert.ok(intake.includes('captureReviewState(card, identity)'));
assert.ok(intake.includes('restoreReviewState(card, state)'));
assert.ok(intake.includes('continueDisabled: !hasCompleteResearch'));
assert.ok(intake.includes("continueTitle: hasCompleteResearch ? '' : 'Rerun incomplete research before lesson writing.'"));
assert.ok(intake.includes('disabled aria-disabled="true"'));
assert.ok(intake.includes('title="${escape(options.continueTitle)}"'));
assert.ok(intake.includes('function reviewHistoryHTML(history = [])'));
assert.ok(intake.includes('Previous feedback'));
assert.ok(intake.includes('reviewActionLabel(entry.action)'));
assert.ok(intake.includes('curriculumReviewHTML(job.review?.brief, job.reviewHistory || [], job.reviewPending)'));
assert.ok(intake.includes('researchReviewHTML(job, job.reviewHistory || [], job.reviewPending)'));
assert.ok(intake.includes('function setReviewActionPending(card, action)'));
assert.ok(intake.includes('function reviewActionIsBusy(card)'));
assert.ok(intake.includes('reviewPendingForAction(action)'));
assert.ok(intake.includes('data-review-status aria-live="polite"'));
assert.ok(intake.includes('aria-disabled="true"'));
const reviewPending = intake.slice(intake.indexOf('function setReviewActionPending('), intake.indexOf('\nfunction ', intake.indexOf('function setReviewActionPending(') + 1));
assert.equal(reviewPending.includes('button.disabled = true;'), false, 'review pending state remains durable; unrelated provider connection forms can disable their own submit');
assert.ok(cloud.includes('reviewPendingForAction(action)'));
assert.ok(cloud.includes('Starting lesson writing...'));

console.log('research review UI tests passed');
