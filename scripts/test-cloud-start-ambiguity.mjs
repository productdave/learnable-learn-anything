import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const cloud = readFileSync(join(root, 'web/js/cloud-gen-client.js'), 'utf8');
const intake = readFileSync(join(root, 'web/js/intake.js'), 'utf8');
const app = readFileSync(join(root, 'web/js/app.js'), 'utf8');

const startBody = cloud.slice(
  cloud.indexOf('export async function startCloudGeneration'),
  cloud.indexOf('/** Cancel a running cloud generation')
);

assert.ok(
  startBody.includes('const slimBrief = slimBriefForCloud(userBrief, pdfRefs);'),
  'cloud start should build a compact brief with uploaded PDF refs.'
);
assert.ok(
  startBody.includes('updateJob(jobId, { brief: slimBrief });'),
  'cloud start should save the compact brief locally before the network request.'
);
assert.ok(
  startBody.indexOf('updateJob(jobId, { brief: slimBrief });') < startBody.indexOf("fetch('/api/gen/start'"),
  'cloud start should persist pdfRefs before posting so ambiguous network failures can retry.'
);

const fetchIndex = startBody.indexOf("fetch('/api/gen/start'");
const definiteRejectionIndex = startBody.indexOf('if (!resp.ok)');
const cleanupIndex = startBody.indexOf('await removeUploadedPdfRefs(pdfRefs)');
const postStartRequestBody = startBody.slice(fetchIndex);
assert.ok(fetchIndex > -1, 'cloud start should post to /api/gen/start.');
assert.ok(
  definiteRejectionIndex > fetchIndex,
  'cloud start should distinguish a definite HTTP rejection from a thrown/ambiguous request.'
);
assert.ok(
  cleanupIndex > definiteRejectionIndex,
  'uploaded start PDFs should only be cleaned up after a definite HTTP rejection.'
);
assert.equal(
  postStartRequestBody.includes('catch (err)'),
  false,
  'ambiguous start fetch failures should bubble with pdfRefs preserved for reattach/retry.'
);
assert.ok(
  startBody.includes('brief: { ...slimBrief, pdfRefs: [] }'),
  'definite start rejection should clear local source refs and ask the user to reattach.'
);

const intakeStartBody = intake.slice(
  intake.indexOf('async function startReviewableGeneration'),
  intake.indexOf('onUserChange((user) => {')
);
const intakeCatchBody = intakeStartBody.slice(intakeStartBody.indexOf('} catch (err) {'));
assert.ok(
  intakeCatchBody.indexOf('if (await reattachCloudGeneration(jobId)) return;')
    < intakeCatchBody.indexOf("updateJob(jobId, { status: 'failed'"),
  'intake should try to reattach an ambiguous cloud start before marking it failed.'
);

assert.ok(
  app.includes("restartOrStartCloudGeneration(id, job.brief, '', expected)"),
  'recent-course retry should reuse the saved brief, including any durable pdfRefs.'
);

console.log('cloud start ambiguity tests passed');
