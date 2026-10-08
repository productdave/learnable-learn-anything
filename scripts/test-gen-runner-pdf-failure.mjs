import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';

const { fetchPdfBuffer, runGeneration } = await import('../web/api/_lib/gen-runner.mjs');

function makeSupabaseMock({ status = 'running', runId = 'run-pdf' } = {}) {
  const updates = [];
  return {
    updates,
    from(table) {
      assert.equal(table, 'generation_jobs');
      const builder = {
        op: null,
        patch: null,
        select() { this.op = this.op || 'select'; return this; },
        update(patch) {
          this.op = 'update';
          this.patch = patch;
          updates.push(patch);
          return this;
        },
        eq() { return this; },
        in() { return this; },
        maybeSingle() {
          if (this.op === 'select') return Promise.resolve({ data: { status, run_id: runId }, error: null });
          return Promise.resolve({ data: { id: 'job-pdf' }, error: null });
        },
        then(resolve, reject) {
          return Promise.resolve({ data: { id: 'job-pdf' }, error: null }).then(resolve, reject);
        }
      };
      return builder;
    }
  };
}

const supabase = makeSupabaseMock();
const originalConsoleError = console.error;
console.error = () => {};
try {
  await assert.rejects(
    () => runGeneration({
      supabase,
      jobId: 'job-pdf',
      ownerId: 'owner-1',
      runId: 'run-pdf',
      ownerEmail: 'designer@example.com',
      apiKey: 'test-key',
      userBrief: { topic: 'Code for designers', tone: 'conversational' },
      pdfRefs: [{
        file_index: 0,
        name: 'wrong-job.pdf',
        storage_path: 'owner-1/another-job/0-wrong-job.pdf'
      }],
      checkpoint: null,
      mode: 'curriculum'
    }),
    /not attached to this generation job/
  );
} finally {
  console.error = originalConsoleError;
}

const failedPatch = supabase.updates.at(-1);
assert.equal(failedPatch.status, 'failed');
assert.equal(failedPatch.completed_at?.length > 0, true);
assert.match(failedPatch.error, /not attached to this generation job/);

{
  const buf = await fetchPdfBuffer('https://signed.example/source.pdf', 'source.pdf', {
    fetchImpl: async () => new Response(new Uint8Array([1, 2, 3]), { status: 200 }),
    timeoutMs: 1000,
    maxBytes: 10
  });
  assert.deepEqual([...buf], [1, 2, 3]);
}

{
  await assert.rejects(
    () => fetchPdfBuffer('https://signed.example/too-large.pdf', 'too-large.pdf', {
      fetchImpl: async () => new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(new Uint8Array([1, 2, 3, 4]));
          controller.enqueue(new Uint8Array([5, 6, 7, 8]));
          controller.close();
        }
      }), { status: 200 }),
      timeoutMs: 1000,
      maxBytes: 6
    }),
    /Could not download PDF too-large\.pdf: PDF response exceeded 6 bytes/
  );
}

{
  await assert.rejects(
    () => fetchPdfBuffer('https://signed.example/slow.pdf', 'slow.pdf', {
      fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => {
          const err = new Error('aborted');
          err.name = 'AbortError';
          reject(err);
        });
      }),
      timeoutMs: 5,
      maxBytes: 10
    }),
    /Could not download PDF slow\.pdf: timed out after 5ms/
  );
}

console.log('gen runner PDF failure persistence tests passed');
