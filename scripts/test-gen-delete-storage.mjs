import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';

const {
  pdfUploadPrefixForJob,
  listStorageFilesRecursive,
  removePdfUploadsForJob
} = await import('../web/api/gen/delete.js');

const deleteSource = readFileSync(new URL('../web/api/gen/delete.js', import.meta.url), 'utf8');

function makeEntry(name, extra = {}) {
  return { name, id: `${name}-id`, ...extra };
}

function makeFolder(name) {
  return { name };
}

function makeSupabaseStorageMock({ files = [], tree = null, listError = null, removeError = null } = {}) {
  const calls = [];
  const entriesFor = (prefix, offset = 0, limit = 1000) => {
    const source = tree ? (tree[prefix] || []) : files.map(name => makeEntry(name));
    return source.slice(offset, offset + limit);
  };
  return {
    calls,
    storage: {
      from(bucket) {
        calls.push({ type: 'from', bucket });
        return {
          list(prefix, options) {
            calls.push({ type: 'list', prefix, options });
            return Promise.resolve({
              data: entriesFor(prefix, options?.offset || 0, options?.limit || 1000),
              error: listError
            });
          },
          remove(paths) {
            calls.push({ type: 'remove', paths });
            return Promise.resolve({ data: paths, error: removeError });
          }
        };
      }
    }
  };
}

assert.equal(pdfUploadPrefixForJob('owner-1', 'job-1'), 'owner-1/job-1');
assert.ok(
  deleteSource.includes("if (!data) {\n    const deletedUploads = await removePdfUploadsForJob(supabase, user.id, jobId);\n    return res.status(404).json({ error: 'Job not found', deletedUploads });\n  }"),
  'delete endpoint should still clean owner-scoped upload leftovers when the durable job row is already gone.'
);
assert.ok(
  deleteSource.indexOf('if (!data) {') < deleteSource.indexOf("return res.status(404).json({ error: 'Job not found', deletedUploads });"),
  'missing-row upload cleanup should happen before returning the stale-job 404.'
);

{
  const supabase = makeSupabaseStorageMock({ files: ['0-brief.pdf', '', '1-notes.pdf'] });
  const deleted = await removePdfUploadsForJob(supabase, 'owner-1', 'job-1');
  assert.deepEqual(deleted, ['owner-1/job-1/0-brief.pdf', 'owner-1/job-1/1-notes.pdf']);
  assert.deepEqual(supabase.calls, [
    { type: 'from', bucket: 'course-uploads' },
    { type: 'list', prefix: 'owner-1/job-1', options: { limit: 1000, offset: 0 } },
    { type: 'remove', paths: ['owner-1/job-1/0-brief.pdf', 'owner-1/job-1/1-notes.pdf'] }
  ]);
}

{
  const supabase = makeSupabaseStorageMock({
    tree: {
      'owner-1/job-nested': [
        makeEntry('0-brief.pdf'),
        makeFolder('attempt-2')
      ],
      'owner-1/job-nested/attempt-2': [
        makeEntry('1-notes.pdf')
      ]
    }
  });
  const deleted = await removePdfUploadsForJob(supabase, 'owner-1', 'job-nested');
  assert.deepEqual(deleted, [
    'owner-1/job-nested/0-brief.pdf',
    'owner-1/job-nested/attempt-2/1-notes.pdf'
  ]);
}

{
  const calls = [];
  const bucket = {
    list(prefix, options) {
      calls.push({ prefix, options });
      if (options.offset === 0) return Promise.resolve({
        data: [makeEntry('a.pdf'), makeEntry('b.pdf')],
        error: null
      });
      return Promise.resolve({
        data: [makeEntry('c.pdf')],
        error: null
      });
    }
  };
  const files = await listStorageFilesRecursive(bucket, 'owner-1/job-paged', { limit: 2 });
  assert.deepEqual(files, [
    'owner-1/job-paged/a.pdf',
    'owner-1/job-paged/b.pdf',
    'owner-1/job-paged/c.pdf'
  ]);
  assert.deepEqual(calls, [
    { prefix: 'owner-1/job-paged', options: { limit: 2, offset: 0 } },
    { prefix: 'owner-1/job-paged', options: { limit: 2, offset: 2 } }
  ]);
}

{
  const supabase = makeSupabaseStorageMock({ files: [] });
  const deleted = await removePdfUploadsForJob(supabase, 'owner-1', 'job-empty');
  assert.deepEqual(deleted, []);
  assert.equal(supabase.calls.some(call => call.type === 'remove'), false);
}

{
  const supabase = makeSupabaseStorageMock({ files: ['0-brief.pdf'], listError: new Error('list failed') });
  const deleted = await removePdfUploadsForJob(supabase, 'owner-1', 'job-list-fail');
  assert.deepEqual(deleted, []);
  assert.equal(supabase.calls.some(call => call.type === 'remove'), false);
}

{
  const supabase = makeSupabaseStorageMock({ files: ['0-brief.pdf'], removeError: new Error('remove failed') });
  const deleted = await removePdfUploadsForJob(supabase, 'owner-1', 'job-remove-fail');
  assert.deepEqual(deleted, []);
}

console.log('gen delete storage cleanup tests passed');
