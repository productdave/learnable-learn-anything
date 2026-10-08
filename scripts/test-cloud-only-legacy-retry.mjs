import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const app = readFileSync(join(root, 'web/js/app.js'), 'utf8');
const intake = readFileSync(join(root, 'web/js/intake.js'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

function body(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `missing start anchor: ${start}`);
  const endIndex = source.indexOf(end, startIndex);
  assert.ok(endIndex > startIndex, `missing end anchor after ${start}`);
  return source.slice(startIndex, endIndex);
}

const appJobs = body(app, 'function wireJobsSection(container)', 'async function refreshLibraryCatalog');
assert.ok(appJobs.includes("if (job?.brief && cloudGenAvailable())"), 'dashboard retry/restart should accept any saved brief, including old local mirrors.');
assert.ok(appJobs.includes("await restartOrStartCloudGeneration(id, job.brief, '', expected)"), 'dashboard retry/restart should route saved briefs through the cloud pipeline with the displayed checkpoint.');
const appRetryBranch = body(appJobs, "if (action === 'retry')", 'openIntakeForJob(id);');
const appRestartBranch = body(appJobs, "} else if (action === 'restart')", "} else if (action === 'api-key')");
assert.equal(appRetryBranch.includes("job?.runner === 'cloud'"), false, 'dashboard retry should not require a pre-existing cloud row.');
assert.equal(appRestartBranch.includes("job?.runner === 'cloud'"), false, 'dashboard restart should not require a pre-existing cloud row.');

const intakeActions = body(intake, 'function wireProgressActions(card, jobId, expected)', 'function removeUserCourseForCurrentAccount');
assert.ok(intakeActions.includes('await retry(jobId, expected);'), 'intake resume fallback should retry through cloud with the displayed checkpoint.');
assert.ok(intakeActions.includes('await retryCloudFromLocalMirror(jobId, feedback);'), 'old review mirrors should restart in cloud with feedback.');
assert.equal(intakeActions.includes('retired local runner'), false, 'intake should not surface retired local runner failures.');
assert.equal(intakeActions.includes('legacy local generation job cannot be resumed'), false, 'intake should not surface legacy local resume failures.');

const retryBody = body(intake, 'async function retry(jobId,', 'async function restart(jobId,');
assert.equal(retryBody.includes("j.runner !== 'cloud'"), false, 'retry should not reject old local mirrors.');
assert.ok(retryBody.includes("await restartOrStartCloudGeneration(jobId, j.brief, '', expected)"), 'retry should use the durable cloud start/restart fallback with the displayed checkpoint.');

const bridgeBody = body(intake, 'async function retryCloudFromLocalMirror', 'function escape(s)');
assert.ok(bridgeBody.includes('if (!j?.brief)'), 'legacy bridge should require a saved request.');
assert.ok(bridgeBody.includes('await restartOrStartCloudGeneration(jobId, j.brief, feedback)'), 'legacy bridge should preserve feedback into the cloud restart/start path.');

assert.ok(packageJson.scripts['test:cloud-only-legacy-retry'], 'package script should expose this regression test.');
assert.ok(packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-only-legacy-retry'), 'cloud architecture verify should run this regression test.');

console.log('cloud-only legacy retry tests passed');
