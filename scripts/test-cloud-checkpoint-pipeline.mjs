import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const read = file => readFileSync(join(root, file), 'utf8');

const start = read('web/api/gen/start.js');
const restart = read('web/api/gen/restart.js');
const resume = read('web/api/gen/resume.js');
const review = read('web/api/gen/review.js');
const runner = read('web/api/_lib/gen-runner.mjs');
const genState = read('web/api/_lib/gen-state.mjs');
const cloud = read('web/js/cloud-gen-client.js');
const intake = read('web/js/intake.js');
const generatorIndex = read('web/js/generator/index.js');

function body(source, from, to) {
  const startIndex = source.indexOf(from);
  assert.ok(startIndex > -1, `Missing anchor: ${from}`);
  const endIndex = to ? source.indexOf(to, startIndex) : source.length;
  assert.ok(endIndex > startIndex, `Missing end anchor after: ${from}`);
  return source.slice(startIndex, endIndex);
}

const startRun = body(start, 'runGeneration({', '}).catch');
const restartRun = body(restart, 'runGeneration({', '}).catch');
const reviewRun = body(review, 'function run(row, key, mode, checkpoint)', 'export function buildReviewTransition');
const resumeHandler = body(resume, 'export function createResumeHandler', 'export async function markRecoverableWaitingForApiKey');
assert.ok(resumeHandler.includes('export default createResumeHandler();') && resumeHandler.includes('const requestBudget = createBudget({ request: req });'),
  'deployed resume export must use the entry-budget handler factory');

assert.ok(
  genState.includes("export const HUMAN_REVIEW_STATUSES = ['review_curriculum', 'review_research'];"),
  'human checkpoint statuses should be shared primitives.'
);

assert.ok(
  runner.includes('mode === \'curriculum\' ? \'review_curriculum\' : \'running\'') &&
  runner.includes("if (mode === 'curriculum') return;"),
  'cloud runner should pause after curriculum design.'
);
assert.ok(
  runner.includes("status: 'review_research'") &&
  runner.includes("message: missingResearch.length") &&
  runner.includes("'Review the research direction before lessons are written.'"),
  'cloud runner should pause after research before lesson writing.'
);

assert.ok(
  startRun.includes("mode: 'curriculum'"),
  '/api/gen/start should only run to the curriculum checkpoint.'
);
assert.ok(
  restartRun.includes("mode: 'curriculum'"),
  '/api/gen/restart should rebuild from the curriculum checkpoint.'
);
assert.ok(
  resumeHandler.includes('if (isReviewStatus(job.status))') &&
  resumeHandler.includes('Use the review action instead of resume.'),
  '/api/gen/resume should not skip human review checkpoints.'
);

assert.ok(
  review.includes("action === 'approve_curriculum'") &&
  review.includes("runnerMode: 'research'") &&
  review.includes("action === 'revise_curriculum'") &&
  review.includes("runnerMode: 'curriculum'") &&
  review.includes("action === 'approve_research'") &&
  review.includes("runnerMode: 'complete'") &&
  review.includes("action === 'rerun_research'") &&
  review.includes("runnerMode: 'research'"),
  '/api/gen/review should be the only transition between checkpointed stages.'
);
assert.ok(
  reviewRun.includes('runGeneration({') &&
  reviewRun.includes('checkpoint,') &&
  reviewRun.includes('mode'),
  'review actions should resume the cloud runner from durable checkpoint state.'
);

assert.ok(
  cloud.includes('const CLOUD_REVIEW_STATUSES = [\'review_curriculum\', \'review_research\'];') &&
  cloud.includes('export async function submitCloudReview') &&
  cloud.includes("fetch('/api/gen/review'") &&
  intake.includes('await submitCloudReview(jobId, action, feedback, expected);'),
  'browser UI should submit review decisions to the cloud checkpoint endpoint.'
);

assert.equal(existsSync(join(root, 'web/sw.js')), false, 'legacy service worker runner should stay deleted.');
assert.equal(existsSync(join(root, 'web/js/sw-client.js')), false, 'legacy service worker client should stay deleted.');
assert.equal(generatorIndex.includes('generateCourse'), false, 'browser generator should not export a course pipeline.');
assert.equal(generatorIndex.includes('runIntake'), false, 'browser generator should not export stage runners.');

console.log('cloud checkpoint pipeline contract tests passed');
