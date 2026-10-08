import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { checkpointPatchFields } from '../web/api/_lib/gen-runner.mjs';

const root = process.cwd();
const runner = readFileSync(join(root, 'web/api/_lib/gen-runner.mjs'), 'utf8');

assert.deepEqual(checkpointPatchFields({ stage: 'research', message: 'still working' }), {
  stage: 'research',
  message: 'still working'
});

assert.deepEqual(checkpointPatchFields({ failures: [{ moduleId: 'm1' }], message: 'module failed' }), {
  failures: [{ moduleId: 'm1' }],
  message: 'module failed'
});

assert.deepEqual(checkpointPatchFields({ extracted_urls: [{ url: 'https://example.com', ok: true }] }), {
  extracted_urls: [{ url: 'https://example.com', ok: true }],
  recovery_attempts: 0,
  last_recovery_at: null
});

assert.deepEqual(checkpointPatchFields({ brief: { id: 'course-1', modules: [] }, topics_total: 0 }), {
  brief: { id: 'course-1', modules: [] },
  topics_total: 0,
  recovery_attempts: 0,
  last_recovery_at: null
});

assert.deepEqual(checkpointPatchFields({ research: { m1: { sources: [] } }, stage: 'research' }), {
  research: { m1: { sources: [] } },
  stage: 'research',
  recovery_attempts: 0,
  last_recovery_at: null
});

assert.deepEqual(checkpointPatchFields({ topics_by_key: { 'm1/t1': { title: 'Done' } }, topics_done: 1 }), {
  topics_by_key: { 'm1/t1': { title: 'Done' } },
  topics_done: 1,
  recovery_attempts: 0,
  last_recovery_at: null
});

assert.ok(
  runner.includes('function isProgressCheckpoint') &&
  runner.includes('recovery_attempts: 0') &&
  runner.includes('last_recovery_at: null') &&
  runner.includes('leasePatch(checkpointPatchFields(fields))'),
  'runner patch writes should reset automatic recovery attempts only for durable progress checkpoints.'
);
assert.ok(
  runner.includes('.update(leasePatch({}))') &&
  !runner.includes('leasePatch(checkpointPatchFields({}))'),
  'lease heartbeats should not reset recovery attempts.'
);

console.log('gen runner progress recovery tests passed');
