import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const intake = readFileSync(join(root, 'web/js/intake.js'), 'utf8');

const importLine = "reattachCloudGeneration, submitCloudReview";
assert.ok(
  intake.includes(importLine),
  'intake should import reattachCloudGeneration for ambiguous start failures.'
);

const startBody = intake.slice(
  intake.indexOf('async function startReviewableGeneration'),
  intake.indexOf('onUserChange((user) => {')
);

assert.ok(startBody.includes('await startCloudGeneration(jobId, userBrief);'));
const catchBody = startBody.slice(startBody.indexOf('} catch (err) {'));
assert.ok(catchBody.includes('if (await reattachCloudGeneration(jobId)) return;'));
assert.ok(
  catchBody.indexOf('if (await reattachCloudGeneration(jobId)) return;')
    < catchBody.indexOf("updateJob(jobId, { status: 'failed'"),
  'intake should try to reattach before marking the local job failed.'
);
assert.ok(
  !catchBody.includes('if (!options.replacingSources)'),
  'source reattach restarts should also be treated as potentially ambiguous server-side starts.'
);

console.log('intake start reattach tests passed');
