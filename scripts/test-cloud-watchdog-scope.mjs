import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { markExpiredCancellingJobsCancelled, markExpiredLiveJobsTimedOut } from '../web/api/gen/watchdog.js';

const root = process.cwd();
const watchdog = readFileSync(join(root, 'web/api/gen/watchdog.js'), 'utf8');

assert.ok(watchdog.includes('const auth = await userFromRequest(req);'));
assert.ok(watchdog.includes('ownerId = auth.user.id;'));
assert.ok(watchdog.includes('markExpiredLiveJobsTimedOut(supabase, { ownerId, now })'));
assert.ok(watchdog.includes('markExpiredCancellingJobsCancelled(supabase, { ownerId, now })'));
assert.ok(watchdog.includes("if (ownerId) staleQuery = staleQuery.eq('owner_id', ownerId);"));
assert.ok(watchdog.includes('if (hasCronSecret(req))'));

assert.ok(watchdog.includes("from '../_lib/gen-state.mjs';"));
assert.ok(watchdog.includes('LIVE_GENERATION_STATUSES'));
assert.ok(watchdog.includes('sameRunFilter(updateQuery, row.run_id)'));
assert.ok(watchdog.includes("import { timeoutPatch } from '../_lib/gen-recovery.mjs';"));
assert.ok(watchdog.includes("import { removePdfUploadsForJob } from './delete.js';"));
assert.ok(watchdog.includes('generationCancelledTerminalFields(new Date(now))'));
assert.ok(watchdog.includes('export async function markExpiredLiveJobsTimedOut'));
assert.ok(watchdog.includes('export async function markExpiredCancellingJobsCancelled'));
assert.ok(watchdog.includes(".select('id,owner_id,run_id,error,message,continuation')"));
assert.ok(watchdog.includes(".in('status', LIVE_GENERATION_STATUSES)"));
assert.ok(watchdog.includes(".eq('status', 'cancelling')"));
assert.ok(watchdog.includes(".lt('lease_expires_at', now)"));
assert.ok(watchdog.includes(".select('id,owner_id')"));
assert.ok(watchdog.includes('await Promise.all((cancelled || []).map(row => removePdfUploadsForJob(supabase, row.owner_id, row.id)));'));

function supabaseWatchdogMock(staleRows = []) {
  const calls = [];
  let selectCount = 0;
  function makeChain(table) {
    const chain = {
      from(nextTable) {
        calls.push({ type: 'from', table: nextTable });
        return makeChain(nextTable);
      },
      select(value) {
        calls.push({ type: 'select', table, value });
        chain.kind = 'select';
        return chain;
      },
      update(patch) {
        calls.push({ type: 'update', table, patch });
        chain.kind = 'update';
        return chain;
      },
      eq(field, value) {
        calls.push({ type: 'eq', table, field, value });
        return chain;
      },
      is(field, value) {
        calls.push({ type: 'is', table, field, value });
        return chain;
      },
      in(field, value) {
        calls.push({ type: 'in', table, field, value });
        return chain;
      },
      lt(field, value) {
        calls.push({ type: 'lt', table, field, value });
        return chain;
      },
      maybeSingle() {
        calls.push({ type: 'maybeSingle', table });
        const id = calls.findLast?.(call => call.type === 'eq' && call.field === 'id')?.value
          || [...calls].reverse().find(call => call.type === 'eq' && call.field === 'id')?.value;
        const ownerId = calls.findLast?.(call => call.type === 'eq' && call.field === 'owner_id')?.value
          || [...calls].reverse().find(call => call.type === 'eq' && call.field === 'owner_id')?.value;
        return Promise.resolve({ data: { id, owner_id: ownerId }, error: null });
      },
      then(resolve, reject) {
        if (chain.kind === 'select') {
          const data = selectCount === 0 ? staleRows : [];
          selectCount += 1;
          return Promise.resolve({ data, error: null }).then(resolve, reject);
        }
        return Promise.resolve({ data: null, error: null }).then(resolve, reject);
      }
    };
    return chain;
  }
  return {
    calls,
    client: {
      from(table) {
        calls.push({ type: 'from', table });
        return makeChain(table);
      }
    }
  };
}

{
  const { client, calls } = supabaseWatchdogMock([{ id: 'job-live', owner_id: 'owner-1', run_id: 'run-live' }]);
  const rows = await markExpiredLiveJobsTimedOut(client, { ownerId: 'owner-1', now: '2026-06-29T00:00:00.000Z' });
  assert.deepEqual(rows, [{ id: 'job-live', owner_id: 'owner-1', status: 'timed_out' }]);
  assert.ok(calls.some(call => call.type === 'eq' && call.field === 'owner_id' && call.value === 'owner-1'));
  assert.ok(calls.some(call => call.type === 'eq' && call.field === 'run_id' && call.value === 'run-live'));
  assert.ok(calls.some(call => call.type === 'select' && call.value === 'id,owner_id,run_id,error,message,continuation'));
  assert.ok(calls.some(call => call.type === 'in' && call.field === 'status'));
  assert.ok(calls.some(call => call.type === 'lt' && call.field === 'lease_expires_at'));
}

{
  const { client, calls } = supabaseWatchdogMock([{ id: 'job-cancel', owner_id: 'owner-2', run_id: null }]);
  const rows = await markExpiredCancellingJobsCancelled(client, { now: '2026-06-29T00:00:00.000Z' });
  assert.deepEqual(rows, [{ id: 'job-cancel', owner_id: 'owner-2' }]);
  assert.ok(calls.some(call => call.type === 'eq' && call.field === 'status' && call.value === 'cancelling'));
  assert.ok(calls.some(call => call.type === 'is' && call.field === 'run_id' && call.value === null));
}

console.log('cloud watchdog scope tests passed');
