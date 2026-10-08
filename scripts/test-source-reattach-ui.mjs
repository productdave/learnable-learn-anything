import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const app = readFileSync(join(root, 'web/js/app.js'), 'utf8');
const intake = readFileSync(join(root, 'web/js/intake.js'), 'utf8');
const cloud = readFileSync(join(root, 'web/js/cloud-gen-client.js'), 'utf8');

assert.ok(cloud.includes('needsSourceReattach: true'));
assert.ok(cloud.includes('PDF upload failed before the source files were saved.'));
assert.ok(cloud.includes("brief: { ...slimBrief, pdfRefs: [] }"));
assert.ok(cloud.includes('Cloud start failed before the uploaded source files were saved.'));
assert.ok(cloud.includes('export async function restartCloudGenerationWithSources'));
assert.ok(cloud.includes("fetch('/api/gen/restart'"));
assert.ok(cloud.includes('body: JSON.stringify({ jobId, feedback, brief: slimBrief, expected })'));
assert.ok(cloud.includes('export function needsSourceReattachForRow'));
assert.ok(cloud.includes('Could not download PDF|not attached to this generation job'));

assert.ok(intake.includes('function needsSourceReattach(job)'));
assert.ok(intake.includes('reuseJobIdForSubmit'));
assert.ok(intake.includes('options.reuseJobId || null'));
assert.ok(intake.includes('const reusableJobId = reuseJobIdForSubmit'));
assert.ok(intake.includes('const replacingSources = !!(reusableJobId && getJob(reusableJobId)?.needsSourceReattach)'));
assert.ok(intake.includes('const job = replacingSources ? getJob(reusableJobId) : reusableJobId'), 'source replacement retains the real prior checkpoint for failed refresh recovery');
assert.ok(intake.includes("if (!options.replacingSources) updateJob(jobId, { runner: 'cloud', status: 'running'"), 'outer intake does not overwrite the checkpoint before replacement preflight');
assert.ok(intake.includes("restartCloudGenerationWithSources(jobId, userBrief, '', options.expected)"));
assert.ok(intake.includes("const recoveryAction = needsKey ? 'api-key' : (mustReattach ? 'reattach'"));
assert.ok(intake.includes('data-${recoveryAction}'));
assert.ok(intake.includes('Reattach source files'));
assert.ok(intake.includes('The saved source files could not be used. Reattach the PDFs, then start again.'));

assert.ok(app.includes('openIntakeWithDraft'));
assert.ok(app.includes("const needsSourceReattach = !!j.needsSourceReattach"));
assert.ok(app.includes("needsSourceReattach ? 'reattach'"));
assert.ok(app.includes("openIntakeWithDraft(job?.brief || {}, { reuseJobId: id, expected })"));

console.log('source reattach UI tests passed');
