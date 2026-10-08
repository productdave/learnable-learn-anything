// Offline test of the diagnostic harness with the real Supabase SDK and the
// actual continuation/sweep code. The network adapter is entirely in memory.
import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { setImmediate as tick } from 'node:timers/promises';
import { activateProbe, validateProbe, createProbeFetch, createProbeHandler, PROBE_CASES,
  PROBE_CLOSED_FLAGS, PROBE_DATABASE, PROBE_PROJECT } from './testing/continuation-probe.mjs';
import { closedFlags } from './rollout-continuation-staging.mjs';

const base = resolve(process.env.LEARNABLE_PROBE_BUNDLE || 'web');
const from = path => import(pathToFileURL(resolve(base, path)));
const { createSweepHandler } = await from('api/gen/sweep.js');
const { createGenerationRequestBudget, bindGenerationClient } = await from('api/_lib/gen-request-budget.mjs');
const { pauseForContinuation, continuationAuthorized, continuationProgress } = await from('api/_lib/gen-continuation.mjs');
const { boundedJson } = await from('api/_lib/bounded-json.mjs');
const { generationLeaseFields } = await from('api/_lib/gen-state.mjs');
const ID = '55555555-5555-4555-8555-555555555555';
const OWNER = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';
const OTHER = '99999999-9999-4999-8999-999999999999';
const NOW = Date.now();
const env = { VERCEL_ENV: 'preview', VERCEL_PROJECT_ID: PROBE_PROJECT,
  VERCEL_URL: 'learnable-staging-offline-test.vercel.app', VERCEL_DEPLOYMENT_ID: 'offline-not-hosted',
  SUPABASE_URL: PROBE_DATABASE, VERCEL_AUTOMATION_BYPASS_SECRET: 'offline-bypass-fixture',
  GEN_SWEEP_SECRET: 'offline-sweep-fixture', ...Object.fromEntries(PROBE_CLOSED_FLAGS.map(name => [name, '0'])) };
const manifest = { version: 1, id: ID, ownerId: OWNER, createdAt: NOW - 1000, expiresAt: NOW + 60_000,
  jobs: PROBE_CASES.map(scenario => ({ id: `continuation-probe-${ID}-${scenario}`, scenario, initialRunId: RUN })) };
const savedEnv = Object.fromEntries(['GEN_SWEEP_SECRET', 'LEARNABLE_PROVIDER_VAULT_KEY',
  'LEARNABLE_GENERATION_CONTINUATION', 'LEARNABLE_GENERATION_ORIGIN'].map(key => [key, process.env[key]]));
Object.assign(process.env, { GEN_SWEEP_SECRET: env.GEN_SWEEP_SECRET, LEARNABLE_PROVIDER_VAULT_KEY: '',
  LEARNABLE_GENERATION_CONTINUATION: '1', LEARNABLE_GENERATION_ORIGIN: `https://${env.VERCEL_URL}` });
const oldFetch = globalThis.fetch;
globalThis.fetch = () => { throw Error('Offline diagnostic: live network forbidden'); };
test.after(() => {
  globalThis.fetch = oldFetch;
  for (const [key, value] of Object.entries(savedEnv)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
});
function response() { return { code: 0, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }
function initial(scenario) {
  const job = manifest.jobs.find(j => j.scenario === scenario);
  const row = { id: job.id, owner_id: OWNER, run_id: RUN, status: 'queued', stage: 'topics',
    topics_by_key: {}, topics_done: 0, topics_total: 3, brief: null, research: {}, extracted_urls: [],
    user_brief: { topic: 'Synthetic continuation diagnostic, not a course' },
    outline: { diagnostic: true, probeRuns: [] }, failures: [], completed_at: null, continuation: null };
  if (['stall', 'hop_limit', 'review', 'cancelled'].includes(scenario)) row.continuation = {
    version: 1, phase: ['review', 'cancelled'].includes(scenario) ? 'pending' : 'running', runId: RUN,
    sequence: scenario === 'hop_limit' ? 63 : 1, stalls: 0, progress: continuationProgress(row) };
  if (scenario === 'review') row.status = 'review_research';
  if (scenario === 'cancelled') { row.status = 'cancelled'; row.completed_at = new Date(NOW).toISOString(); }
  return row;
}
function fixture(scenario = 'chain', options = {}) {
  const row = initial(scenario), requests = [], waits = [], deliveries = [], logs = [];
  const activeEnv = { ...env }, clock = { now: NOW };
  let handler;
  const adapter = async (input, init) => {
    const url = new URL(input), method = init.method || 'GET';
    requests.push({ url, method, headers: new Headers(init.headers), body: init.body });
    if (url.origin === `https://${env.VERCEL_URL}`) {
      const body = JSON.parse(init.body); deliveries.push(body);
      const res = response(); await handler({ method, url: url.pathname,
        headers: Object.fromEntries(init.headers), body }, res);
      return Response.json(res.body, { status: res.code });
    }
    if (url.pathname.startsWith('/auth/')) return Response.json({ id: OWNER, email: 'probe@example.test' });
    const table = url.pathname.split('/').pop();
    const rows = table === 'generation_jobs' ? [row] : table === 'user_state'
      ? [{ user_id: OWNER, state: { _apiKey: 'not-a-provider-key-diagnostic-only' } }] : [];
    const matches = rows.filter(item => [...url.searchParams].every(([key, value]) => {
      if (['select', 'limit', 'order'].includes(key)) return true;
      const [column, property] = key.split('->>'), actual = property ? item[column]?.[property] : item[column];
      if (!value.startsWith('eq.')) throw Error('Unsupported offline filter');
      return String(actual) === value.slice(3);
    }));
    if (method === 'PATCH') matches.forEach(item => Object.assign(item, JSON.parse(init.body)));
    const object = new Headers(init.headers).get('accept')?.includes('object');
    return Response.json(object ? matches[0] || null : matches);
  };
  const fetchImpl = activateProbe({ manifest, env: activeEnv, nativeFetch: adapter, now: () => clock.now });
  const client = createClient(PROBE_DATABASE, 'offline-diagnostic-service-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: fetchImpl } });
  handler = createProbeHandler({ manifest, env: activeEnv, now: () => clock.now, client,
    createSweepHandler, createBudget: createGenerationRequestBudget, bindClient: bindGenerationClient,
    pauseForContinuation, continuationAuthorized, boundedJson, leaseFields: generationLeaseFields,
    background: promise => waits.push(promise), fetchImpl, delay: options.delay || (() => tick()), log: value => logs.push(value) });
  const body = { jobId: row.id, ownerId: OWNER, runId: RUN };
  const headers = { authorization: `Bearer ${env.GEN_SWEEP_SECRET}`, 'x-learnable-continuation': '1' };
  async function call(change = {}) { const res = response();
    await handler({ method: 'POST', url: '/api/diagnostic/start', body, headers, ...change }, res); return res; }
  async function drain() {
    let count = 0;
    while (count < waits.length) { const batch = waits.slice(count); count = waits.length; await Promise.all(batch); }
  }
  return { row, body, headers, requests, deliveries, waits, logs, call, drain, clock, activeEnv };
}

test('diagnostic closed flags match the rollout safeguard exactly', () => assert.deepEqual(PROBE_CLOSED_FLAGS, closedFlags));
test('activating the preview preserves every spending flag', () => {
  const copy = { ...env }; activateProbe({ manifest, env: copy, nativeFetch() {} , now: () => NOW });
  assert.equal(copy.LEARNABLE_GENERATION_CONTINUATION, '1');
  for (const flag of closedFlags) assert.equal(copy[flag], '0');
  assert.equal(env.LEARNABLE_GENERATION_CONTINUATION, undefined);
});
for (const change of [ { VERCEL_ENV: 'production' }, { VERCEL_PROJECT_ID: 'a-different-project' },
  { SUPABASE_URL: 'https://production.invalid' }, { VERCEL_URL: 'learnable-staging.vercel.app' },
  { VERCEL_URL: 'learnable-staging-test.vercel.app.evil.test' }, { VERCEL_AUTOMATION_BYPASS_SECRET: '' },
  { GEN_SWEEP_SECRET: '' }, { LEARNABLE_AI_REFINEMENT: '1' },
  { LEARNABLE_GENERATION_CONTINUATION: '1', LEARNABLE_GENERATION_ORIGIN: 'https://wrong.vercel.app' },
  ...closedFlags.map(flag => ({ [flag]: '1' })) ]) {
  test(`runtime refuses ${Object.keys(change).join(',')}`, () => assert.throws(() => validateProbe(manifest, { ...env, ...change }, NOW), /scope refused/));
}
for (const change of [{ expiresAt: NOW }, { createdAt: NOW + 1000 }, { expiresAt: NOW + 3_600_001 },
  { ownerId: 'not-an-owner' }, { jobs: manifest.jobs.slice(1) }, { jobs: [...manifest.jobs.slice(1), manifest.jobs[1]] }]) {
  test(`manifest refuses invalid ${Object.keys(change)[0]}`, () => assert.throws(() => validateProbe({ ...manifest, ...change }, env, NOW)));
}
const jobUrl = `${PROBE_DATABASE}/rest/v1/generation_jobs?id=eq.${manifest.jobs[0].id}&owner_id=eq.${OWNER}`;
for (const [label, url, options = {}] of [
  ['Anthropic', 'https://api.anthropic.com/v1/messages'], ['OpenAI', 'https://api.openai.com/v1/images/generations'],
  ['other database', 'https://another.supabase.co/rest/v1/generation_jobs'],
  ['all jobs', `${PROBE_DATABASE}/rest/v1/generation_jobs`], ['other owner', jobUrl.replace(OWNER, OTHER)],
  ['duplicate owner filter', `${jobUrl}&owner_id=eq.${OTHER}`], ['or filter', `${jobUrl}&or=(owner_id.eq.${OTHER})`],
  ['unscoped update', jobUrl, { method: 'PATCH', body: '{}' }], ['delete', jobUrl, { method: 'DELETE' }],
  ['ownership-changing update', `${jobUrl}&run_id=eq.${RUN}&status=eq.running`, { method: 'PATCH', body: JSON.stringify({ owner_id: OTHER }) }],
  ['duplicate run filter', `${jobUrl}&run_id=eq.${RUN}&run_id=eq.${OTHER}&status=eq.running`, { method: 'PATCH', body: '{}' }],
  ['insert', jobUrl, { method: 'POST' }], ['RPC', `${PROBE_DATABASE}/rest/v1/rpc/a_function`, { method: 'POST' }],
  ['storage', `${PROBE_DATABASE}/storage/v1/object/course-uploads`],
  ['other credentials', `${PROBE_DATABASE}/rest/v1/user_state?user_id=eq.${OTHER}`],
  ['other auth user', `${PROBE_DATABASE}/auth/v1/admin/users/${OTHER}`],
  ['credential forwarded to DB', jobUrl, { headers: { 'x-vercel-protection-bypass': 'not-allowed' } }],
  ['arbitrary own path', `https://${env.VERCEL_URL}/api/gen/start`],
  ['query token', `https://${env.VERCEL_URL}/api/gen/sweep?secret=invalid`],
]) {
  test(`network guard blocks ${label} before network`, async () => {
    let calls = 0; const guarded = createProbeFetch({ manifest, env, nativeFetch: () => calls++, now: () => NOW });
    await assert.rejects(guarded(url, options), /scope refused/); assert.equal(calls, 0);
  });
}
test('network guard expires before a later request', async () => {
  const guarded = createProbeFetch({ manifest, env, nativeFetch: () => assert.fail('must not fetch'), now: () => manifest.expiresAt });
  await assert.rejects(guarded(jobUrl));
});
for (const change of [{ method: 'GET' }, { url: '/api/gen/start' }, { headers: {} },
  { url: '/api/gen/sweep', headers: { authorization: `Bearer ${env.GEN_SWEEP_SECRET}` } },
  { body: { jobId: manifest.jobs[0].id, ownerId: OTHER, runId: RUN } },
  { body: { jobId: 'unrelated-real-job', ownerId: OWNER, runId: RUN } }, { body: { secret: 'x'.repeat(2048) } }]) {
  test(`request rejection performs no database request (${JSON.stringify(Object.keys(change))})`, async () => {
    const f = fixture(); const res = await f.call(change);
    assert.ok([400, 401, 404, 405].includes(res.code)); assert.equal(f.requests.length, 0); assert.equal(f.waits.length, 0);
  });
}
test('three requests persist three checkpoints after the first HTTP response, then stop for review', async () => {
  const f = fixture(); const res = await f.call(); assert.equal(res.code, 202);
  assert.equal(f.row.status, 'running'); assert.equal(f.row.topics_done, 0);
  await f.drain(); assert.equal(f.row.status, 'review_research'); assert.equal(f.row.topics_done, 3);
  assert.equal(f.waits.length, 3); assert.equal(f.deliveries.length, 2);
  assert.equal(new Set(f.row.outline.probeRuns.map(run => run.runId)).size, 3);
  assert.equal(f.row.completed_at, null); assert.equal(f.row.saved_course_id, undefined);
  assert.ok(f.requests.filter(r => r.url.origin === PROBE_DATABASE).every(r => !r.headers.has('x-vercel-protection-bypass')));
  assert.ok(f.requests.filter(r => r.url.origin !== PROBE_DATABASE).every(r => r.headers.get('x-vercel-protection-bypass') === env.VERCEL_AUTOMATION_BYPASS_SECRET));
  const before = structuredClone(f.row);
  const replay = await f.call({ url: '/api/gen/sweep', body: f.deliveries[0] });
  assert.equal(replay.body.accepted, false); assert.deepEqual(f.row, before);
});
test('concurrent starts claim one background run', async () => {
  const f = fixture(); const results = await Promise.all([f.call(), f.call(), f.call()]);
  assert.equal(results.filter(r => r.code === 202).length, 1); await f.drain(); assert.equal(f.waits.length, 3);
});
test('failed delivery retains the exact first checkpoint and pending run without retry', async () => {
  const f = fixture('delivery_unavailable'); await f.call(); await f.drain();
  assert.equal(f.row.status, 'queued'); assert.equal(f.row.topics_done, 1); assert.equal(f.row.continuation.phase, 'pending');
  assert.equal(f.row.continuation.runId, f.row.run_id); assert.equal(f.deliveries.length, 1);
  assert.equal(f.waits.length, 1); assert.deepEqual(f.logs.map(entry => entry.deliveryStatus), [503]);
});
test('lost acknowledgements do not replay or overwrite the successfully claimed child', async () => {
  const f = fixture('lost_ack'); await f.call(); await f.drain();
  assert.equal(f.row.status, 'review_research'); assert.equal(f.row.topics_done, 3);
  assert.equal(f.waits.length, 3); assert.equal(f.deliveries.length, 2);
  assert.equal(new Set(f.row.outline.probeRuns.map(run => run.runId)).size, 3);
  assert.deepEqual(f.logs.map(entry => entry.deliveryStatus), [503, 503]);
});
for (const [scenario, reason] of [['stall', 'no_progress'], ['hop_limit', 'hop_limit']]) {
  test(`${scenario} persists a hold without another delivery`, async () => {
    const f = fixture(scenario); await f.call(); await f.drain();
    assert.equal(f.row.status, 'failed'); assert.equal(f.row.continuation.phase, 'held');
    assert.equal(f.row.continuation.reason, reason); assert.equal(f.waits.length, 2);
    assert.equal(f.deliveries.length, 1); assert.ok(f.row.completed_at);
  });
}
for (const scenario of ['review', 'cancelled']) {
  test(`${scenario} is not revived by start or continuation`, async () => {
    const f = fixture(scenario), before = structuredClone(f.row);
    assert.equal((await f.call()).code, 409);
    assert.equal((await f.call({ url: '/api/gen/sweep' })).body.accepted, false);
    assert.deepEqual(f.row, before); assert.equal(f.waits.length, 0);
  });
}
test('runtime expiry after background scheduling stops all further writes', async () => {
  const f = fixture('chain', { delay: async () => { f.clock.now = manifest.expiresAt; } });
  assert.equal((await f.call()).code, 202);
  await assert.rejects(f.drain(), /scope refused/); assert.equal(f.row.topics_done, 0); assert.equal(f.deliveries.length, 0);
});
test('only the platform origin is used, regardless of incoming Host or forwarded headers', async () => {
  const f = fixture(); await f.call({ headers: { ...f.headers, host: 'attacker.test', 'x-forwarded-host': 'attacker.test' } });
  await f.drain(); assert.equal(f.row.topics_done, 3);
  assert.ok(f.requests.every(r => [PROBE_DATABASE, `https://${env.VERCEL_URL}`].includes(r.url.origin)));
});
