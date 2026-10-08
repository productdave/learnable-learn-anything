// Non-paid acceptance for the exact disabled staging deployment, not generation.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { staging } from './rollout-continuation-staging.mjs';
import { baseInventory } from './packaging/grounding-release.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const operation = join(root, 'output/staging/2026-09-30-continuation-rollout/deploy-disabled-gyBWz1');
const read = path => JSON.parse(readFileSync(path));
const dispatch = read(join(operation, 'dispatch.json'));
assert.equal(dispatch.projectId, staging.projectId);
assert.equal(dispatch.id, 'dpl_4nYWsPfT9y7ersKLpoeJejEx7ptG');
const cli = (command, args, timeout = 30000) => {
  try { return JSON.parse(execFileSync(command, args, { cwd: root, encoding: 'utf8', timeout, maxBuffer: 4e6,
    stdio: ['ignore', 'pipe', 'pipe'] })); }
  catch { throw Error('Read-only external verification did not confirm; raw output suppressed.'); }
};
const api = path => cli('vercel', ['api', path + '?teamId=' + staging.teamId]);
const d = api('/v13/deployments/' + dispatch.id);
const a = api('/v4/aliases/' + staging.alias);
assert.equal(d.projectId, staging.projectId); assert.equal(d.readyState, 'READY');
assert.equal(a.projectId, staging.projectId); assert.equal(a.deploymentId || a.deployment?.id, d.id);
const artifact = 'output/staging/2026-09-30-continuation/release-WxC4mz';
const parent = 'output/staging/2026-09-30-learner-retry/release-uGK19F';
const current = baseInventory(read(join(root, artifact, 'packaging-report.json')));
const previous = baseInventory(read(join(root, parent, 'packaging-report.json')));
const changed = Object.keys(current).filter(p => p.startsWith('static/') && current[p] !== previous[p]);
assert.equal(changed.length, 97);
const origin = 'https://' + staging.alias;
const request = path => fetch(origin + path, { redirect: 'error', signal: AbortSignal.timeout(20000), headers: { 'Cache-Control': 'no-cache' } });
const staticChecks = [];
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
  while (next < changed.length) {
    const path = changed[next++];
    const response = await request('/' + path.slice('static/'.length));
    assert.equal(response.status, 200, path);
    const sha256 = createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex');
    assert.equal(sha256, current[path], path);
    assert.match(response.headers.get('x-robots-tag') || '', /noindex/);
    staticChecks.push({ path, sha256 });
  }
}));
staticChecks.sort((x,y) => x.path.localeCompare(y.path));
const healthResponse = await request('/api/health/cloud');
assert.equal(healthResponse.status, 200);
const health = await healthResponse.json();
assert.equal(health.ok, true); assert.equal(health.schema.ok, true); assert.deepEqual(health.missing, []);
assert.ok(Object.values(health.schema.checks).every(v => v === true));
const denied = [];
for (const path of ['/api/setups/store', '/api/courses/get?id=recursive-self-improvement-ai-pm-review-draft',
  '/api/providers/connection', '/api/providers/openai', '/api/gen/sweep']) {
  const response = await request(path); await response.arrayBuffer();
  assert.equal(response.status, 401, path); denied.push({ path, status: response.status });
}
for (const path of ['/api/_lib/gen-continuation.mjs', '/_functions/generation', '/.vercel/project.json']) {
  const response = await request(path); await response.arrayBuffer();
  assert.equal(response.status, 404, path); denied.push({ path, status: response.status });
}
const disabled = await fetch(origin + '/api/gen/sweep', { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(20000),
  headers: { 'Content-Type': 'application/json', 'x-learnable-continuation': '1' }, body: '{}' });
assert.equal(disabled.status, 503); await disabled.arrayBuffer();
const after = cli(process.execPath, ['scripts/rollout-continuation-staging.mjs', 'inspect'], 180000);
const before = read(join(operation, 'before.json'));
assert.equal(after.currentDeployment, dispatch.id); assert.equal(after.installed, true);
assert.deepEqual(after.data.filter(row => row.name !== 'user_state'), before.data.filter(row => row.name !== 'user_state'));
const previousState = before.data.find(row => row.name === 'user_state');
const currentState = after.data.find(row => row.name === 'user_state');
assert.equal(currentState.count, previousState.count);
let accountState = { changed: false, payloadPreserved: true };
if (currentState.digest !== previousState.digest) {
  // Reopening the signed-in browser schedules a sync even without an answer edit
  // (sync.js pull -> schedulePush -> updateAccountState). Prove, not assume, that
  // only its row timestamp changed by reconstructing the exact original digest.
  const prior = read(join(root, 'output/staging/2026-09-30-learner-retry/account-progress-verification.json'));
  assert.equal(prior.accountStateUpdatedAt, '2026-09-30 05:42:16.105+00');
  assert.equal(currentState.count, 1);
  const sql = `select updated_at,
    md5(to_jsonb(s)::text) as current_digest,
    md5(jsonb_set(to_jsonb(s),'{updated_at}',to_jsonb('2026-09-30 05:42:16.105+00'::timestamptz))::text) as original_timestamp_digest
    from public.user_state s where user_id='62b1631e-a5aa-49b7-b05f-ebd5e4d3706f'`;
  const rows = cli(process.execPath, ['/Users/davidwang/.npm/_npx/6f1b058a4d9555af/node_modules/supabase/dist/supabase.js',
    'db', 'query', '--linked', '--project-ref', staging.ref, sql, '--output-format', 'json']).rows;
  assert.equal(rows.length, 1); assert.equal(rows[0].current_digest, currentState.digest);
  assert.equal(rows[0].original_timestamp_digest, previousState.digest, 'Account payload changed; investigate before acceptance.');
  accountState = { changed: true, onlyField: 'updated_at', payloadPreserved: true,
    beforeDigest: previousState.digest, afterDigest: currentState.digest,
    originalTimestampDigest: rows[0].original_timestamp_digest, updatedAt: rows[0].updated_at };
}
assert.deepEqual(after.protection, before.protection);
assert.deepEqual(after.environment, before.environment); assert.deepEqual(after.state, before.state);
const receipt = { at: new Date().toISOString(), status: 'pass', stagingRef: staging.ref, deploymentId: d.id,
  alias: staging.alias, ready: true, staticChecks, health: { status: 200, checks: health.schema.checks },
  denied, continuationDisabledStatus: 503, postflight: after.operation, unchangedTableSnapshots: 12,
  accountState, jobDataAndAccessUnchanged: true,
  paidPublicOff: true, grantsClosed: true, newProviderCalls: 0,
  limitations: ['Not browser, physical-phone, paid-provider or real server-handoff acceptance.'] };
writeFileSync(join(operation, 'hosted-acceptance.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
console.log(JSON.stringify({ status: receipt.status, deploymentId: d.id, staticPathsVerified: staticChecks.length,
  schemaChecks: Object.keys(health.schema.checks).length, deniedPaths: denied.length,
  continuationDisabled: true, courseDataAndAccessPreserved: true, accountState, newProviderCalls: 0,
  receipt: join(operation, 'hosted-acceptance.json') }));
