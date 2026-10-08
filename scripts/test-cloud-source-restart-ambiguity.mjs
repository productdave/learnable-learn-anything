import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const cloud = readFileSync(join(root, 'web/js/cloud-gen-client.js'), 'utf8');
const intake = readFileSync(join(root, 'web/js/intake.js'), 'utf8');

function bodyBetween(source, start, end) {
  const startIndex = source.indexOf(start);
  assert.ok(startIndex >= 0, `missing ${start}`);
  const endIndex = source.indexOf(end, startIndex);
  assert.ok(endIndex > startIndex, `missing ${end}`);
  return source.slice(startIndex, endIndex);
}

const restartWithSources = bodyBetween(
  cloud,
  'export async function restartCloudGenerationWithSources',
  '/** Restart a known cloud row'
);
const startReviewableGeneration = bodyBetween(
  intake,
  'async function startReviewableGeneration',
  'onUserChange((user) => {'
);
const catchBody = startReviewableGeneration.slice(startReviewableGeneration.indexOf('} catch (err) {'));

assert.ok(restartWithSources.includes('const existingPdfRefs = userBrief.pdfRefs || [];'));
assert.ok(restartWithSources.includes('const uploadedThisCall = !existingPdfRefs.length;'));
assert.ok(restartWithSources.includes('pdfRefs = existingPdfRefs.length'));
assert.ok(restartWithSources.includes('await uploadPdfsToStorage(jobId, userBrief.pdfs || [])'));
assert.ok(
  restartWithSources.includes('if (uploadedThisCall) await removeUploadedPdfRefs(pdfRefs);'),
  'restart should only clean up PDFs uploaded by the failed HTTP call.'
);
assert.ok(
  restartWithSources.includes('if (isMissingApiKeyError(err)) {') &&
  restartWithSources.indexOf('if (isMissingApiKeyError(err)) {') <
    restartWithSources.indexOf('if (uploadedThisCall) await removeUploadedPdfRefs(pdfRefs);') &&
  restartWithSources.includes('await reattachCloudGeneration(jobId);'),
  'missing-key reattached-source restarts should hydrate the saved pending restart instead of deleting uploaded refs.'
);
assert.ok(
  restartWithSources.includes('try {') &&
  restartWithSources.includes('resp = await fetch') &&
  restartWithSources.includes('if (await reattachCloudGeneration(jobId)) return;') &&
  restartWithSources.includes('The reattached source files are still saved for retry.'),
  'ambiguous reattached-source restarts should keep refs and try durable reattach.'
);
assert.ok(
  catchBody.includes('if (await reattachCloudGeneration(jobId)) return;') &&
  !catchBody.includes('if (!options.replacingSources)'),
  'intake should reattach after ambiguous start failures even when replacing source files.'
);

console.log('cloud source restart ambiguity tests passed');
