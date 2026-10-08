import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { requirePdfRefsBelongToJob, requireSafeJobId } from '../web/api/_lib/supabase-server.mjs';

const root = process.cwd();
const server = readFileSync(join(root, 'web/api/_lib/supabase-server.mjs'), 'utf8');
const endpoints = [
  'web/api/gen/start.js',
  'web/api/gen/resume.js',
  'web/api/gen/restart.js',
  'web/api/gen/review.js',
  'web/api/gen/cancel.js',
  'web/api/gen/delete.js',
  'web/api/gen/credentials-ready.js'
];

assert.equal(requireSafeJobId('job-abc_123'), 'job-abc_123');
assert.equal(requireSafeJobId(' job-abc_123 '), 'job-abc_123');
assert.equal(requireSafeJobId('job-00000000-0000-4000-8000-000000000000'), 'job-00000000-0000-4000-8000-000000000000');

for (const bad of ['', '   ', '../job', 'job/other', 'job.other', '-job', 'job?x=1', 'job:abc', 'a'.repeat(129)]) {
  assert.throws(() => requireSafeJobId(bad), /Missing|Invalid/);
}

assert.ok(server.includes('export function requireSafeJobId'));
assert.ok(server.includes('/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)'));
assert.equal(
  requirePdfRefsBelongToJob([{ storage_path: 'owner-1/job-1/0-source.pdf' }], { ownerId: 'owner-1', jobId: 'job-1' })[0].storage_path,
  'owner-1/job-1/0-source.pdf'
);
assert.throws(
  () => requirePdfRefsBelongToJob([{ storage_path: 'owner-2/job-1/0-source.pdf' }], { ownerId: 'owner-1', jobId: 'job-1' }),
  /signed-in user and generation job/
);
assert.throws(
  () => requirePdfRefsBelongToJob([{ storage_path: 'owner-1/job-2/0-source.pdf' }], { ownerId: 'owner-1', jobId: 'job-1' }),
  /signed-in user and generation job/
);
assert.throws(
  () => requirePdfRefsBelongToJob([{ storage_path: 'owner-1/job-1/../0-source.pdf' }], { ownerId: 'owner-1', jobId: 'job-1' }),
  /signed-in user and generation job/
);
assert.throws(
  () => requirePdfRefsBelongToJob({ storage_path: 'owner-1/job-1/0-source.pdf' }, { ownerId: 'owner-1', jobId: 'job-1' }),
  /Invalid pdfRefs/
);

for (const endpoint of endpoints) {
  const source = readFileSync(join(root, endpoint), 'utf8');
  assert.ok(source.includes('requireSafeJobId'), `${endpoint} should validate browser-supplied job ids.`);
}

const start = readFileSync(join(root, 'web/api/gen/start.js'), 'utf8');
assert.ok(
  start.indexOf('requestedJobId = requireSafeJobId(body.jobId)') < start.indexOf('apiKey = await readApiKey'),
  'start should reject malformed job ids before reading credentials or inserting rows.'
);
assert.ok(start.includes('const jobId = requestedJobId || `job-${randomUUID()}`;'));
assert.ok(
  start.includes('requirePdfRefsBelongToJob(pdfRefs, { ownerId: user.id, jobId })') &&
    start.indexOf('requirePdfRefsBelongToJob(pdfRefs, { ownerId: user.id, jobId })') < start.indexOf('apiKey = await readApiKey') &&
    start.indexOf('requirePdfRefsBelongToJob(pdfRefs, { ownerId: user.id, jobId })') < start.indexOf("supabase.from('generation_jobs').insert"),
  'start should reject cross-owner or cross-job PDF refs before reading credentials or inserting rows.'
);

const restart = readFileSync(join(root, 'web/api/gen/restart.js'), 'utf8');
assert.ok(
  restart.includes('requirePdfRefsBelongToJob(userBrief.pdfRefs || [], { ownerId: user.id, jobId })') &&
    restart.indexOf('requirePdfRefsBelongToJob(userBrief.pdfRefs || [], { ownerId: user.id, jobId })') < restart.indexOf('apiKey = await readApiKey') &&
    restart.indexOf('requirePdfRefsBelongToJob(userBrief.pdfRefs || [], { ownerId: user.id, jobId })') < restart.indexOf(".from('generation_jobs')\n    .update"),
  'restart should reject replacement PDF refs before saving restart state.'
);

console.log('cloud job id validation tests passed');
