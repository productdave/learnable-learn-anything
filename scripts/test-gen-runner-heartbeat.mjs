import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const runner = readFileSync(join(root, 'web/api/_lib/gen-runner.mjs'), 'utf8');
const runBody = runner.slice(
  runner.indexOf('export async function runGeneration'),
  runner.indexOf('async function resolvePdfs')
);

assert.ok(runner.includes('const ACTIVE_HEARTBEAT_MS = 60 * 1000;'), 'runner should heartbeat during long active calls.');
assert.ok(runBody.includes('async function heartbeatLease(label = \'\')'), 'runner should define a lease renewal helper.');
assert.ok(runBody.includes('async function withLeaseHeartbeat(label, work)'), 'runner should wrap long work in heartbeat helper.');
assert.ok(runBody.includes('.update(leasePatch({}))'), 'heartbeat should extend heartbeat_at and lease_expires_at.');
assert.ok(runBody.includes(".eq('id', jobId)"), 'heartbeat should scope by job id.');
assert.ok(runBody.includes(".eq('owner_id', ownerId)"), 'heartbeat should scope by owner id.');
assert.ok(runBody.includes(".eq('run_id', runId)"), 'heartbeat should scope by active run id.');
assert.ok(runBody.includes(".in('status', RUNNER_WRITABLE_STATUSES)"), 'heartbeat must not renew terminal or review-paused rows.');
assert.ok(runBody.includes('if (!data) return false;'), 'heartbeat should detect stale or superseded runners.');
assert.ok(runBody.includes("if (typeof timer.unref === 'function') timer.unref();"), 'heartbeat timer should not keep the runtime alive by itself.');
assert.ok(runBody.includes('clearInterval(timer);'), 'heartbeat timer should stop when the long call finishes.');

const wrappers = [
  'pdfResolutionPromise = withLeaseHeartbeat(label, async () => {',
  "withLeaseHeartbeat('source URL extraction', () => serverFetchUrls(pendingSourceUrls, {",
  "withLeaseHeartbeat('curriculum design', async () => runIntake(client, enrichedBrief, {",
  'withLeaseHeartbeat(`research for ${mod.id}`, async () => runResearch(client, brief, mod, {',
  'withLeaseHeartbeat(`lesson writing for ${key}`, () => runTopic(client, brief, mod, topic, bundle, tone, {'
];
for (const snippet of wrappers) {
  assert.ok(runBody.includes(snippet), `long runner work should be heartbeat-wrapped: ${snippet}`);
}
assert.ok(runBody.includes('model: aiModels.lesson.model'), 'lesson writing should pass the configured model while heartbeat-wrapped.');

console.log('gen runner heartbeat tests passed');
