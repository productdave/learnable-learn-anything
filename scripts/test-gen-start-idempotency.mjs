import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { expireExistingJobIfStale } from '../web/api/gen/start.js';

function supabaseStub() {
  const calls = [];
  const chain = {
    update(patch) {
      calls.push({ type: 'update', patch });
      return chain;
    },
    eq(field, value) {
      calls.push({ type: 'eq', field, value });
      return chain;
    },
    is(field, value) {
      calls.push({ type: 'is', field, value });
      return chain;
    },
    in(field, value) {
      calls.push({ type: 'in', field, value });
      return chain;
    },
    lt(field, value) {
      calls.push({ type: 'lt', field, value });
      return chain;
    },
    select(value) {
      calls.push({ type: 'select', value });
      return chain;
    },
    maybeSingle() {
      const status = calls.find(call => call.type === 'update')?.patch?.status || 'unknown';
      return Promise.resolve({ data: { status }, error: null });
    }
  };
  return {
    calls,
    client: {
      from(table) {
        calls.push({ type: 'from', table });
        return chain;
      }
    }
  };
}

const oldLease = new Date(Date.now() - 60_000).toISOString();
const futureLease = new Date(Date.now() + 60_000).toISOString();
const startSource = readFileSync(join(process.cwd(), 'web/api/gen/start.js'), 'utf8');

assert.ok(startSource.includes(".select('id,status,run_id,lease_expires_at,user_brief,error,message')"));
assert.ok(startSource.includes('pdfRefs: existing.user_brief?.pdfRefs || []'));
assert.ok(startSource.includes('if (!existingErr && !existing)'));
assert.ok(startSource.includes('return res.status(409).json({'));
assert.ok(startSource.includes('its id is already in use'));
assert.ok(startSource.includes('let requestedJobId = null;'));
assert.ok(startSource.includes('requestedJobId = requireSafeJobId(body.jobId);'));
assert.ok(startSource.includes('const jobId = requestedJobId || `job-${randomUUID()}`;'));
assert.ok(startSource.includes('const { pdfRefs = [], ...inputBrief } = body.brief;'));
assert.ok(startSource.includes('userBrief = creationBrief(inputBrief)'));
assert.equal(startSource.includes('delete userBrief.pdfRefs'), false);
assert.ok(startSource.includes("import { removePdfUploadsForJob } from './delete.js';"));
// stale-cancel path cleanup should remove uploads immediately when duplicate-start expiry finalizes cancellation.
assert.ok(startSource.includes("if (data?.status === 'cancelled')"));
assert.ok(startSource.includes('await removePdfUploadsForJob(supabase, ownerId, job.id);'));

{
  const { client, calls } = supabaseStub();
  const status = await expireExistingJobIfStale(client, {
    id: 'job-stale-running',
    status: 'running',
    run_id: 'run-stale-running',
    lease_expires_at: oldLease
  }, 'user-1');
  assert.equal(status, 'timed_out');
  assert.ok(calls.some(call => call.type === 'from' && call.table === 'generation_jobs'));
  assert.ok(calls.some(call => call.type === 'in' && call.field === 'status'));
  assert.ok(calls.some(call => call.type === 'lt' && call.field === 'lease_expires_at'));
  assert.ok(calls.some(call => call.type === 'eq' && call.field === 'run_id' && call.value === 'run-stale-running'));
}

{
  const { client, calls } = supabaseStub();
  const status = await expireExistingJobIfStale(client, {
    id: 'job-stale-cancelling',
    status: 'cancelling',
    run_id: null,
    lease_expires_at: oldLease
  }, 'user-1');
  assert.equal(status, 'cancelled');
  assert.ok(calls.some(call => call.type === 'eq' && call.field === 'status' && call.value === 'cancelling'));
  assert.ok(calls.some(call => call.type === 'lt' && call.field === 'lease_expires_at'));
  assert.ok(calls.some(call => call.type === 'is' && call.field === 'run_id' && call.value === null));
}

{
  const { client, calls } = supabaseStub();
  const status = await expireExistingJobIfStale(client, {
    id: 'job-live-running',
    status: 'running',
    lease_expires_at: futureLease
  }, 'user-1');
  assert.equal(status, 'running');
  assert.equal(calls.length, 0);
}

{
  const { client, calls } = supabaseStub();
  const status = await expireExistingJobIfStale(client, {
    id: 'job-review',
    status: 'review_curriculum',
    lease_expires_at: oldLease
  }, 'user-1');
  assert.equal(status, 'review_curriculum');
  assert.equal(calls.length, 0);
}

console.log('gen start idempotency tests passed');
