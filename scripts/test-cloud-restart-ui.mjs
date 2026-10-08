import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const app = readFileSync(join(root, 'web/js/app.js'), 'utf8');
const intake = readFileSync(join(root, 'web/js/intake.js'), 'utf8');
const cloud = readFileSync(join(root, 'web/js/cloud-gen-client.js'), 'utf8');

assert.ok(app.includes('data-job-action="restart"'), 'dashboard should expose restart on recoverable cloud jobs.');
assert.ok(app.includes("await restartOrStartCloudGeneration(id, job.brief, '', expected); openIntakeForJob(id);"), 'dashboard restart should use the durable cloud restart path.');
assert.ok(app.includes('Restart from the saved request? Learnable keeps your source context and human feedback'), 'dashboard restart should warn that checkpoints are cleared but context is kept.');
assert.ok(cloud.includes('brief: row.user_brief || null'), 'cloud row hydration should refresh job.brief from durable user_brief before restart UI uses it.');

assert.ok(intake.includes('const canRestart = !!(job?.runner === \'cloud\''), 'intake should decide restart eligibility from cloud recoverability.');
assert.ok(intake.includes('data-restart'), 'intake progress modal should expose a restart action.');
assert.ok(intake.includes('Restart from request'), 'intake restart action should be visible to the user.');
assert.ok(intake.includes("isPartial ? 'Retry missing topics'"), 'partial jobs should keep a cheap retry-missing-topics primary action.');
assert.ok(intake.includes('async function restart(jobId,'), 'intake should route restart through a dedicated cloud action.');
assert.ok(intake.includes("await restartOrStartCloudGeneration(jobId, j.brief, '', expected);"), 'intake restart should use the durable cloud restart path.');

console.log('cloud restart UI tests passed');
