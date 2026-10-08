import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { markReviewWaitingForApiKey } from '../web/api/gen/review.js';

function supabaseUpdateMock() {
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
    select(columns) {
      calls.push({ type: 'select', columns });
      return chain;
    },
    maybeSingle() {
      calls.push({ type: 'maybeSingle' });
      return Promise.resolve({ data: { id: 'job-1' }, error: null });
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

const reviewHistory = [{
  action: 'approve_curriculum',
  from_status: 'review_curriculum',
  feedback: 'Make module 2 more practical.',
  run_id: 'run-review',
  at: '2026-06-29T00:00:00.000Z'
}];

{
  const { client, calls } = supabaseUpdateMock();
  const marked = await markReviewWaitingForApiKey(
    client,
    'job-1',
    'owner-1',
    'review_curriculum',
    'checkpoint-run',
    'Missing Anthropic API key',
    reviewHistory
  );
  assert.equal(marked, true);

  const update = calls.find(call => call.type === 'update');
  assert.ok(update, 'review API-key wait should update the durable job row.');
  assert.equal(update.patch.error, 'Missing Anthropic API key');
  assert.equal(update.patch.message, 'Review is waiting for an Anthropic API key. Add one to your account, then continue from this checkpoint.');
  assert.deepEqual(update.patch.review_history, reviewHistory);
  assert.ok(update.patch.updated_at, 'review API-key wait should refresh updated_at.');
  assert.equal(Object.hasOwn(update.patch, 'status'), false, 'missing-key review wait must not leave the review checkpoint.');
  assert.deepEqual(calls.filter(call => call.type === 'eq'), [
    { type: 'eq', field: 'id', value: 'job-1' },
    { type: 'eq', field: 'owner_id', value: 'owner-1' },
    { type: 'eq', field: 'status', value: 'review_curriculum' },
    { type: 'eq', field: 'run_id', value: 'checkpoint-run' }
  ]);
  assert.deepEqual(calls.filter(call => call.type === 'select'), [{ type: 'select', columns: 'id' }]);
  assert.equal(calls.some(call => call.type === 'maybeSingle'), true);
}

{
  const { client, calls } = supabaseUpdateMock();
  const marked = await markReviewWaitingForApiKey(
    client,
    'job-2',
    'owner-1',
    'review_research',
    null,
    'Missing Anthropic API key'
  );
  assert.equal(marked, true);
  const update = calls.find(call => call.type === 'update');
  assert.equal(Object.hasOwn(update.patch, 'review_history'), false, 'review history is only patched when a validated transition supplied it.');
  assert.deepEqual(calls.filter(call => call.type === 'is'), [
    { type: 'is', field: 'run_id', value: null }
  ]);
}

const reviewSource = readFileSync(join(process.cwd(), 'web/api/gen/review.js'), 'utf8');
assert.ok(
  reviewSource.includes('transition.patch.review_history'),
  'review handler should preserve validated human feedback when API-key lookup fails.'
);

console.log('cloud review feedback durable on key missing tests passed');
