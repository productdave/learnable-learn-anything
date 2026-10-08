import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';

const { pruneOldCancelledJobs } = await import('../web/api/gen/sweep.js');

function makeSupabaseMock({ rows = [], deleteErrorFor = '' } = {}) {
  const calls = [];
  const generationChain = {
    select(columns) {
      calls.push({ type: 'select', columns });
      return generationChain;
    },
    eq(field, value) {
      calls.push({ type: 'eq', field, value });
      return generationChain;
    },
    lt(field, value) {
      calls.push({ type: 'lt', field, value });
      return generationChain;
    },
    limit(value) {
      calls.push({ type: 'limit', value });
      return Promise.resolve({ data: rows, error: null });
    }
  };
  const bucket = {
    list(prefix, options) {
      calls.push({ type: 'storage.list', prefix, options });
      return Promise.resolve({
        data: [{ name: '0-source.pdf', id: `${prefix}-file` }],
        error: null
      });
    },
    remove(paths) {
      calls.push({ type: 'storage.remove', paths });
      return Promise.resolve({ data: paths, error: null });
    }
  };
  return {
    calls,
    from(table) {
      calls.push({ type: 'from', table });
      assert.equal(table, 'generation_jobs');
      return generationChain;
    },
    storage: {
      from(bucketName) {
        calls.push({ type: 'storage.from', bucket: bucketName });
        return bucket;
      }
    },
    rpc(name, params) {
      calls.push({ type: 'rpc', name, params });
      const error = params.p_job_id === deleteErrorFor ? new Error('delete failed') : null;
      return Promise.resolve({ data: error ? null : { ok: true }, error });
    }
  };
}

{
  const now = Date.parse('2026-06-29T00:00:00.000Z');
  const supabase = makeSupabaseMock({
    rows: [
      { id: 'job-cancelled-1', owner_id: 'owner-1' },
      { id: 'job-cancelled-2', owner_id: 'owner-2' }
    ]
  });
  const pruned = await pruneOldCancelledJobs(supabase, now);

  assert.deepEqual(pruned, ['job-cancelled-1', 'job-cancelled-2']);
  assert.ok(supabase.calls.some(call => call.type === 'eq' && call.field === 'status' && call.value === 'cancelled'));
  assert.ok(supabase.calls.some(call => call.type === 'lt' && call.field === 'updated_at' && call.value === '2026-06-22T00:00:00.000Z'));
  assert.ok(supabase.calls.some(call => call.type === 'limit' && call.value === 25));
  assert.deepEqual(supabase.calls.filter(call => call.type === 'rpc'), [
    {
      type: 'rpc',
      name: 'delete_generation_job_for_owner',
      params: { p_job_id: 'job-cancelled-1', p_owner_id: 'owner-1' }
    },
    {
      type: 'rpc',
      name: 'delete_generation_job_for_owner',
      params: { p_job_id: 'job-cancelled-2', p_owner_id: 'owner-2' }
    }
  ]);
  assert.ok(
    supabase.calls.some(call => call.type === 'storage.remove' && call.paths.includes('owner-1/job-cancelled-1/0-source.pdf')),
    'cancelled retention cleanup should remove job upload prefixes before deleting rows.'
  );
}

{
  const supabase = makeSupabaseMock({
    rows: [{ id: 'job-kept-after-delete-error', owner_id: 'owner-1' }],
    deleteErrorFor: 'job-kept-after-delete-error'
  });
  const warn = console.warn;
  console.warn = () => {};
  const pruned = await pruneOldCancelledJobs(supabase, Date.parse('2026-06-29T00:00:00.000Z'));
  console.warn = warn;
  assert.deepEqual(pruned, []);
}

console.log('cloud cancelled retention tests passed');
