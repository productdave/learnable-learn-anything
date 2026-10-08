// Read-only hosted preflight + offline tests. Does NOT create a bypass secret,
// fixture, deployment, grant or provider request. Writes only fresh local evidence.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { probeRelease, verifyProbeRelease } from './testing/continuation-probe-release.mjs';
import { staging } from './rollout-continuation-staging.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
const artifact = probeRelease.artifact;
const parent = join(root, 'output/diagnostics/m3-continuation-probe-20260930');
mkdirSync(parent, { recursive: true });
const output = mkdtempSync(join(parent, 'check-'));
const save = (name, value) => writeFileSync(join(output, name), typeof value === 'string' ? value
  : JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
const hash = path => createHash('sha256').update(readFileSync(join(root, path))).digest('hex');
const pins = Object.fromEntries(['scripts/testing/continuation-probe.mjs', 'scripts/test-continuation-probe.mjs',
  'scripts/testing/continuation-probe-release.mjs', 'scripts/test-continuation-probe-release.mjs',
  'scripts/verify-continuation-probe.mjs'].map(path => [path, hash(path)]));
const verified = verifyProbeRelease();
function runTests(label, files, expected, extraEnv = {}) {
  const tap = execFileSync(process.execPath, ['--test', ...files], { cwd: root, encoding: 'utf8', timeout: 30_000,
    env: { ...process.env, ...extraEnv }, stdio: ['ignore', 'pipe', 'pipe'] });
  save(label + '.tap', tap);
  const number = key => Number(tap.match(new RegExp(`^# ${key} (\\d+)$`, 'm'))?.[1]);
  assert.equal(number('tests'), expected); assert.equal(number('pass'), expected);
  for (const key of ['fail', 'cancelled', 'skipped', 'todo']) assert.equal(number(key), 0);
  return { tests: expected, passed: expected, fixtureServices: true, liveNetwork: false, log: label + '.tap' };
}
const snapshot = runTests('snapshot', ['scripts/test-continuation-probe-release.mjs'], 13);
const negative = spawnSync(process.execPath, ['--test', '--test-name-pattern=accepted frozen snapshot',
  'scripts/test-continuation-probe-release.mjs'], { cwd: root, encoding: 'utf8', timeout: 30_000,
  env: { ...process.env, LEARNABLE_PROBE_LEGACY_VERIFIER: '1' }, stdio: ['ignore', 'pipe', 'pipe'] });
assert.equal(negative.status, 1);
assert.match(negative.stdout, /Legacy source-coupled verifier rejected the pinned package: ERR_ASSERTION/);
assert.match(negative.stdout, /^# fail 1$/m);
save('legacy-negative-control.tap', negative.stdout);
const negativeControl = { legacyRejected: true, exitCode: negative.status, log: 'legacy-negative-control.tap' };
const source = runTests('source', ['scripts/test-continuation-probe.mjs'], 62);
const packaged = runTests('packaged', ['scripts/test-continuation-probe.mjs'], 62,
  { LEARNABLE_PROBE_BUNDLE: join(root, artifact, '.vercel/output/functions/_functions/generation.func') });
const adjacent = runTests('adjacent', ['scripts/test-generation-continuation.mjs', 'scripts/test-continuation-rollout.mjs'], 58);
function api(path) {
  try { return JSON.parse(execFileSync('vercel', ['api', `${path}?teamId=${staging.teamId}`],
    { cwd: root, encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] })); }
  catch { throw Error('Read-only Vercel preflight unconfirmed; raw output suppressed.'); }
}
const project = api('/v9/projects/' + staging.projectId), alias = api('/v4/aliases/' + staging.alias);
assert.equal(project.id, staging.projectId); assert.equal(project.name, 'learnable-staging');
assert.equal(alias.projectId, staging.projectId);
const deploymentId = alias.deploymentId || alias.deployment?.id;
assert.equal(deploymentId, probeRelease.deploymentId);
const deployment = api('/v13/deployments/' + deploymentId);
assert.equal(deployment.projectId, staging.projectId); assert.equal(deployment.readyState, 'READY');
const endpoints = [];
for (const origin of [`https://${staging.alias}`, `https://${deployment.url}`]) {
  const response = await fetch(origin + '/api/health/cloud', { redirect: 'manual', signal: AbortSignal.timeout(15_000) });
  const location = response.headers.get('location');
  endpoints.push({ origin, status: response.status, redirectOrigin: location ? new URL(location, origin).origin : null });
}
assert.equal(endpoints[0].status, 200);
assert.equal(endpoints[1].status, 302); assert.equal(endpoints[1].redirectOrigin, 'https://vercel.com');
const protection = { projectId: project.id, systemVariablesAvailable: project.autoExposeSystemEnvs === true,
  scope: project.ssoProtection?.deploymentType, passwordProtection: !!project.passwordProtection,
  trustedIps: !!project.trustedIps, bypassConfigured: !!project.protectionBypass };
assert.equal(protection.scope, 'all_except_custom_domains'); assert.equal(protection.bypassConfigured, false);
const report = { at: new Date().toISOString(), status: 'offline-passed-hosted-authorization-pending',
  pins, package: verified, snapshot, negativeControl, source, packaged, adjacent, protection, endpoints, currentDeployment: deploymentId,
  hostedTestRun: false, fixturesCreated: 0, credentialsCreated: 0, deployed: false, paidCalls: 0,
  limitations: ['Synthetic runner and in-memory network/DB; not hosted waitUntil or server self-delivery proof.',
    'Preview protection is unchanged. Temporary automation credential needs user approval.',
    'Fresh fixture creation, diagnostic package and hosted execution still required after approval.',
    'No evidence of real-model course quality, physical phone or production acceptance.'] };
save('verification.json', report);
console.log(JSON.stringify({ output, status: report.status, snapshot: snapshot.tests, source: source.tests,
  packaged: packaged.tests, adjacent: adjacent.tests, hostedTestRun: false, paidCalls: 0 }, null, 2));
