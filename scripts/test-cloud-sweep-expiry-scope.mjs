import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { markExpiredCancels, markExpiredJobs } from '../web/api/gen/sweep.js';

const root = process.cwd();
const sweep = readFileSync(join(root, 'web/api/gen/sweep.js'), 'utf8');

assert.ok(sweep.includes('export async function markExpiredJobs'));
assert.ok(sweep.includes('export async function markExpiredCancels'));
assert.ok(sweep.includes(".select('id,owner_id,run_id,error,message,continuation')"));
assert.ok(sweep.includes('sameRunFilter(update, row.run_id)'));

function makeSupabaseMock({ staleRows = [], updateData = null } = {}) {
  const calls = [];
  const storageCalls = [];

  function makeQuery(table) {
    const query = {
      mode: '',
      filters: {},
      from(nextTable) {
        calls.push({ type: 'from', table: nextTable });
        return makeQuery(nextTable);
      },
      select(columns) {
        calls.push({ type: 'select', table, columns });
        query.mode ||= 'select';
        return query;
      },
      update(patch) {
        calls.push({ type: 'update', table, patch });
        query.mode = 'update';
        return query;
      },
      eq(field, value) {
        calls.push({ type: 'eq', table, field, value });
        query.filters[field] = value;
        return query;
      },
      is(field, value) {
        calls.push({ type: 'is', table, field, value });
        query.filters[field] = value;
        return query;
      },
      in(field, value) {
        calls.push({ type: 'in', table, field, value });
        query.filters[field] = value;
        return query;
      },
      lt(field, value) {
        calls.push({ type: 'lt', table, field, value });
        query.filters[field] = value;
        return query;
      },
      maybeSingle() {
        calls.push({ type: 'maybeSingle', table, filters: { ...query.filters } });
        return Promise.resolve({ data: updateData, error: null });
      },
      then(resolve, reject) {
        return Promise.resolve({ data: staleRows, error: null }).then(resolve, reject);
      }
    };
    return query;
  }

  const bucket = {
    list(prefix, options) {
      storageCalls.push({ type: 'list', prefix, options });
      return Promise.resolve({
        data: [{ name: '0-source.pdf', id: `${prefix}-file` }],
        error: null
      });
    },
    remove(paths) {
      storageCalls.push({ type: 'remove', paths });
      return Promise.resolve({ data: paths, error: null });
    }
  };

  return {
    calls,
    storageCalls,
    from(table) {
      calls.push({ type: 'from', table });
      return makeQuery(table);
    },
    storage: {
      from(bucketName) {
        storageCalls.push({ type: 'from', bucket: bucketName });
        return bucket;
      }
    }
  };
}

{
  const supabase = makeSupabaseMock({
    staleRows: [{ id: 'job-live', owner_id: 'owner-1', run_id: 'run-live', message: 'Cloud recovery is restarting from the saved request...' }],
    updateData: { id: 'job-live' }
  });
  const timedOut = await markExpiredJobs(supabase, '2026-06-29T00:00:00.000Z');
  assert.deepEqual(timedOut, ['job-live']);
  assert.ok(supabase.calls.some(call => call.type === 'select' && call.columns === 'id,owner_id,run_id,error,message,continuation'));
  assert.ok(supabase.calls.some(call => call.type === 'update' && call.patch.message === 'Generation timed out while restarting. You can restart from the saved request.'));
  assert.ok(supabase.calls.some(call => call.type === 'eq' && call.field === 'owner_id' && call.value === 'owner-1'));
  assert.ok(supabase.calls.some(call => call.type === 'eq' && call.field === 'run_id' && call.value === 'run-live'));
  assert.ok(supabase.calls.some(call => call.type === 'in' && call.field === 'status'));
  assert.ok(supabase.calls.some(call => call.type === 'lt' && call.field === 'lease_expires_at'));
}

{
  const supabase = makeSupabaseMock({
    staleRows: [{ id: 'job-cancel', owner_id: 'owner-2', run_id: null }],
    updateData: { id: 'job-cancel', owner_id: 'owner-2' }
  });
  const cancelled = await markExpiredCancels(supabase, '2026-06-29T00:00:00.000Z');
  assert.deepEqual(cancelled, ['job-cancel']);
  assert.ok(supabase.calls.some(call => call.type === 'is' && call.field === 'run_id' && call.value === null));
  assert.ok(supabase.storageCalls.some(call => call.type === 'remove' && call.paths.includes('owner-2/job-cancel/0-source.pdf')));
}

{
  const supabase = makeSupabaseMock({
    staleRows: [{ id: 'job-raced-cancel', owner_id: 'owner-3', run_id: 'old-run' }],
    updateData: null
  });
  const cancelled = await markExpiredCancels(supabase, '2026-06-29T00:00:00.000Z');
  assert.deepEqual(cancelled, []);
  assert.equal(supabase.storageCalls.some(call => call.type === 'remove'), false);
}

console.log('cloud sweep expiry scope tests passed');
