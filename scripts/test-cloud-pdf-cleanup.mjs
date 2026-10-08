import assert from 'node:assert/strict';
import { pdfUploadPath, removeUploadedPdfRefs, unclaimedPdfRefs } from '../web/js/cloud-gen-client.js';

function makeStorageClient({ fail = false } = {}) {
  const calls = [];
  return {
    calls,
    storage: {
      from(bucket) {
        calls.push({ type: 'from', bucket });
        return {
          remove(paths) {
            calls.push({ type: 'remove', paths });
            return Promise.resolve(fail ? { error: new Error('remove failed') } : { error: null });
          }
        };
      }
    }
  };
}

{
  const client = makeStorageClient();
  const paths = await removeUploadedPdfRefs([
    { storage_path: 'user-1/job-1/0-a.pdf' },
    { storage_path: '' },
    null,
    { storage_path: 'user-1/job-1/1-b.pdf' }
  ], client);
  assert.deepEqual(paths, ['user-1/job-1/0-a.pdf', 'user-1/job-1/1-b.pdf']);
  assert.deepEqual(client.calls, [
    { type: 'from', bucket: 'course-uploads' },
    { type: 'remove', paths: ['user-1/job-1/0-a.pdf', 'user-1/job-1/1-b.pdf'] }
  ]);
}

{
  const client = makeStorageClient({ fail: true });
  const paths = await removeUploadedPdfRefs([{ storage_path: 'user-1/job-1/0-a.pdf' }], client);
  assert.deepEqual(paths, ['user-1/job-1/0-a.pdf']);
}

{
  const client = makeStorageClient();
  const paths = await removeUploadedPdfRefs([], client);
  assert.deepEqual(paths, []);
  assert.deepEqual(client.calls, []);
}

assert.equal(
  pdfUploadPath({
    ownerId: 'user-1',
    jobId: 'job-1',
    fileIndex: 0,
    name: 'My Brief!.pdf',
    uploadToken: 'attempt_abc-123'
  }),
  'user-1/job-1/0-attempt_abc-123-My_Brief_.pdf'
);

assert.notEqual(
  pdfUploadPath({ ownerId: 'user-1', jobId: 'job-1', fileIndex: 0, name: 'source.pdf', uploadToken: 'attempt-a' }),
  pdfUploadPath({ ownerId: 'user-1', jobId: 'job-1', fileIndex: 0, name: 'source.pdf', uploadToken: 'attempt-b' })
);

assert.deepEqual(
  unclaimedPdfRefs(
    [
      { storage_path: 'user-1/job-1/0-a.pdf' },
      { storage_path: 'user-1/job-1/1-b.pdf' },
      { storage_path: '' },
      null
    ],
    [
      { storage_path: 'user-1/job-1/0-a.pdf' }
    ]
  ),
  [{ storage_path: 'user-1/job-1/1-b.pdf' }]
);

assert.deepEqual(
  unclaimedPdfRefs(
    [{ storage_path: 'user-1/job-1/0-a.pdf' }],
    [{ storage_path: 'user-1/job-1/0-a.pdf' }]
  ),
  []
);

console.log('cloud PDF cleanup tests passed');
