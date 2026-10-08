import assert from 'node:assert/strict';
import { compactBriefForLocalJob, createJob, getJob, updateJob } from '../web/js/jobs.js';

const store = new Map();
globalThis.localStorage = {
  getItem(key) { return store.has(key) ? store.get(key) : null; },
  setItem(key, value) { store.set(key, String(value)); },
  removeItem(key) { store.delete(key); }
};

const fullBrief = {
  topic: 'Design systems',
  source_text: 'Original notes',
  pdfs: [{
    file_index: 0,
    name: 'source.pdf',
    base64: 'x'.repeat(200_000),
    pageThumbs: ['data:image/png;base64,thumb'],
    sizeBytes: 12345
  }]
};

const compact = compactBriefForLocalJob(fullBrief);
assert.equal(compact.topic, fullBrief.topic);
assert.equal(compact.pdfs[0].base64, undefined);
assert.equal(compact.pdfs[0].name, 'source.pdf');
assert.deepEqual(compact.pdfs[0].pageThumbs, ['data:image/png;base64,thumb']);

const job = createJob(fullBrief);
assert.equal(getJob(job.id).brief.pdfs[0].base64, undefined);
assert.equal(store.get('learnable-gen-jobs').includes('x'.repeat(1000)), false);

updateJob(job.id, {
  brief: {
    ...fullBrief,
    pdfRefs: [{ file_index: 0, name: 'source.pdf', storage_path: 'owner/job/source.pdf' }]
  }
});
const updated = getJob(job.id);
assert.equal(updated.brief.pdfs[0].base64, undefined);
assert.equal(updated.brief.pdfRefs[0].storage_path, 'owner/job/source.pdf');
assert.equal(store.get('learnable-gen-jobs').includes('x'.repeat(1000)), false);

console.log('job brief compaction tests passed');
