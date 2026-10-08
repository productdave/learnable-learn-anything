// Offline only. Real recovery endpoint, lazy synthetic PostgREST, no network.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { createSweepHandler } from '../web/api/gen/sweep.js';
import { createResumeHandler } from '../web/api/gen/resume.js';
import { createGenerationRequestBudget } from '../web/api/_lib/gen-request-budget.mjs';
import { sealProviderKey } from '../web/api/_lib/provider-vault.mjs';
import { pauseForContinuation, continuationConfig, continuationProgress, nextContinuation, isPendingContinuation, claimContinuation,
  MAX_CONTINUATION_HOPS, MAX_CONTINUATION_STALLS } from '../web/api/_lib/gen-continuation.mjs';
import { canAutoRecover, timeoutPatch, autoRecoveryFailurePatch } from '../web/api/_lib/gen-recovery.mjs';
import { bindGenerationClient, GENERATION_IO_UNCERTAIN } from '../web/api/_lib/gen-request-budget.mjs';
import { setImmediate as tick } from 'node:timers/promises';
import { markExpiredLiveJobsTimedOut, watchdogResponse } from '../web/api/gen/watchdog.js';
import { createClient } from '@supabase/supabase-js';
import { needsApiKeyForRow } from '../web/js/cloud-gen-client.js';
import { jobPresentation } from '../web/js/home-model.js';

const OWNER = '11111111-1111-4111-8111-111111111111';
const RUN = '22222222-2222-4222-8222-222222222222';
const SECRET = 'synthetic-continuation-only';
const envNames = ['LEARNABLE_PROVIDER_VAULT_KEY', 'GEN_SWEEP_SECRET', 'LEARNABLE_GENERATION_CONTINUATION', 'LEARNABLE_GENERATION_ORIGIN'];
const previousEnv = Object.fromEntries(envNames.map(key => [key, process.env[key]]));
const previousFetch = globalThis.fetch;
process.env.LEARNABLE_PROVIDER_VAULT_KEY = randomBytes(32).toString('hex');
process.env.GEN_SWEEP_SECRET = SECRET;
process.env.LEARNABLE_GENERATION_CONTINUATION = '1';
process.env.LEARNABLE_GENERATION_ORIGIN = 'https://learnable-staging.vercel.app';
globalThis.fetch = async () => { throw new Error('External network forbidden in continuation tests'); };
test.after(() => {
  globalThis.fetch = previousFetch;
  for (const [key, value] of Object.entries(previousEnv)) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

function row(overrides = {}) {
  return {
    id: 'continuation-test', owner_id: OWNER, run_id: RUN, status: 'queued', stage: 'topics',
    recovery_attempts: 0, error: null, failures: [], extracted_urls: [],
    user_brief: { topic: 'An introductory course' },
    brief: { id: 'intro', modules: [{ id: 'basics', topics: [{ id: 'one' }, { id: 'two' }] }] },
    research: { basics: { key_concepts: ['A source concept'] } }, topics_by_key: { 'basics/one': { title: 'Saved first lesson' } },
    continuation: { version: 1, phase: 'pending', runId: RUN, sequence: 1, stalls: 0, progress: 'a'.repeat(64) },
    lease_expires_at: '2099-01-01T00:00:00Z', updated_at: '2026-09-30T00:00:00Z', ...overrides
  };
}
function response() { return { code: null, body: null, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }
function fixture(jobs = [row()], options = {}) {
  const calls = [], runs = [], waits = [];
  const tables = { generation_jobs: jobs, provider_connections: [{ owner_id: OWNER, provider: 'anthropic', encrypted_key: sealProviderKey('sk-ant-synthetic-continuation', OWNER) }], user_state: [] };
  const client = { auth: { admin: { async getUserById() { return { data: { user: { email: 'synthetic@example.test' } } }; } } }, from(table) {
    let value, operation = 'select', single = false, signal, limit = Infinity;
    const filters = [];
    function field(item, key) { const [column, member] = key.split('->>'); return member ? item[column]?.[member] : item[column]; }
    const query = {
      select() { return this; }, update(input) { operation = 'update'; value = input; return this; },
      eq(key, value) { filters.push([key, value, 'eq']); return this; }, is(key, value) { return this.eq(key, value); },
      in(key, value) { filters.push([key, value, 'in']); return this; }, lt(key, value) { filters.push([key, value, 'lt']); return this; },
      gte(key, value) { filters.push([key, value, 'gte']); return this; }, neq(key, value) { filters.push([key, value, 'neq']); return this; },
      limit(n) { limit = n; return this; }, order() { return this; }, maybeSingle() { single = true; return this; },
      abortSignal(input) { signal = input; return this; },
      then(resolve, reject) { return Promise.resolve().then(async () => {
        signal?.throwIfAborted(); const call = { table, operation, filters, value, signal }; calls.push(call);
        await options.beforeQuery?.(call, tables); signal?.throwIfAborted();
        const matches = (tables[table] || []).filter(item => filters.every(([key, expected, operator]) => {
          const actual = field(item, key);
          return operator === 'eq' ? actual === expected : operator === 'in' ? expected.includes(actual)
            : operator === 'lt' ? actual < expected : operator === 'gte' ? actual >= expected : actual != null && actual !== expected;
        })).slice(0, limit);
        if (operation === 'update') matches.forEach(item => Object.assign(item, structuredClone(value)));
        await options.afterCommit?.(call, tables);
        return { data: structuredClone(single ? matches[0] || null : matches), error: null };
      }).then(resolve, reject); }
    };
    return query;
  } };
  const handler = createSweepHandler({ admin: () => client, createBudget: options.createBudget || createGenerationRequestBudget,
    background: promise => waits.push(promise), runGeneration: async args => { runs.push(args); await options.run?.(args); } });
  const request = { method: 'POST', headers: { authorization: `Bearer ${SECRET}`, 'x-learnable-continuation': '1' },
    body: { jobId: jobs[0]?.id, ownerId: OWNER, runId: RUN } };
  async function call(overrides = {}) { const res = response(); await handler({ ...request, ...overrides }, res); await Promise.all(waits); return res; }
  return { client, calls, runs, waits, tables, handler, request, call };
}

test('a continuation request claims only its saved job, not unrelated timed-out work', async () => {
  const target = row(), other = row({ id: 'unrelated-job', status: 'timed_out', continuation: null });
  const f = fixture([target, other]); const res = await f.call();
  assert.equal(res.code, 200);
  assert.deepEqual(f.runs.map(run => run.jobId), [target.id]);
  assert.equal(other.status, 'timed_out');
  assert.deepEqual(f.runs[0].checkpoint.topics_by_key, { 'basics/one': { title: 'Saved first lesson' } });
});

for (const stage of ['images', 'assemble']) test(`integrated ${stage} continuation does not require an Anthropic key after text is saved`, async () => {
  const f = fixture([row({ stage, saved_course_id: 'draft',
    user_brief: { materials_policy: 'integrated-visuals-v2' },
    image_progress: { version: 1, planned: 2, completed: 1, omitted: 1, items: {}, status: stage === 'assemble' ? 'complete' : 'running' } })]);
  f.tables.provider_connections = [];
  const res = await f.call();
  assert.equal(res.body.accepted, true); assert.equal(f.runs.length, 1);
  assert.equal(f.runs[0].apiKey, null); assert.equal(f.runs[0].checkpoint.image_progress.completed, 1);
  assert.equal(f.calls.some(call => call.table === 'provider_connections'), false);
  assert.equal(f.runs[0].retryFailedImages, undefined);
});

for (const stage of ['images', 'assemble']) test(`explicit ${stage} Resume retains checkpoints without reading the text provider key`, async () => {
  const job = row({ status: 'failed', stage, continuation: null, saved_course_id: 'draft',
    user_brief: { materials_policy: 'integrated-visuals-v2' }, image_progress: { version: 1, items: {}, status: stage === 'assemble' ? 'complete' : 'running' } });
  const f = fixture([job]); f.tables.provider_connections = [];
  const runs = [], waits = [];
  const handler = createResumeHandler({ authenticate: async () => ({ user: { id: OWNER } }), admin: () => f.client,
    runGeneration: async input => runs.push(input), background: promise => waits.push(promise) });
  const res = response();
  await handler({ method: 'POST', body: { jobId: job.id, expected: { status: job.status, runId: RUN } } }, res);
  await Promise.all(waits);
  assert.equal(res.code, 200); assert.equal(runs.length, 1); assert.equal(runs[0].apiKey, null);
  assert.equal(runs[0].retryFailedImages, true); assert.equal(runs[0].checkpoint.saved_course_id, 'draft');
  assert.equal(f.calls.some(call => call.table === 'provider_connections'), false);
});

function clock() {
  let ms = 0, next = 0; const timers = new Map();
  const options = { now: () => ms, setTimer(fn, delay) { const id = ++next; timers.set(id, { at: ms + delay, fn }); return id; }, clearTimer: id => timers.delete(id) };
  return { timers, budget: () => createGenerationRequestBudget(options), advance(amount) {
    ms += amount; for (const [id, timer] of [...timers]) if (timer.at <= ms) { timers.delete(id); timer.fn(); }
  } };
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function flush() { for (let i = 0; i < 5; i++) await tick(); }
async function pause(f, options = {}) {
  return pauseForContinuation({ supabase: f.client, jobId: f.tables.generation_jobs[0].id, ownerId: OWNER, runId: RUN,
    requestBudget: createGenerationRequestBudget(), fetchImpl: async () => ({ ok: true, json: async () => ({ ok: true, accepted: true }) }), ...options });
}

test('duplicate deliveries atomically claim one new run', async () => {
  const f = fixture(); const results = await Promise.all([f.call(), f.call(), f.call()]);
  assert.equal(results.filter(result => result.body.accepted).length, 1); assert.equal(f.runs.length, 1);
  assert.notEqual(f.tables.generation_jobs[0].run_id, RUN);
  assert.equal(f.tables.generation_jobs[0].continuation.phase, 'running');
  const late = await f.call(); assert.equal(late.body.accepted, false); assert.equal(f.runs.length, 1);
});

test('the actual Supabase SDK sends exact owner, run, status and JSON marker claim filters', async () => {
  const requests = [], nextRun = '33333333-3333-4333-8333-333333333333';
  const client = createClient('https://synthetic.invalid', 'synthetic-service-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
    requests.push({ url: new URL(input), init });
    return new Response(JSON.stringify({ id: 'continuation-test' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  } } });
  assert.deepEqual(await claimContinuation(bindGenerationClient(client, createGenerationRequestBudget()), row(), nextRun), { runId: nextRun });
  assert.equal(requests.length, 1); const { url, init } = requests[0];
  assert.equal(url.pathname, '/rest/v1/generation_jobs'); assert.equal(init.method, 'PATCH');
  for (const [key, value] of Object.entries({ id: 'continuation-test', owner_id: OWNER, run_id: RUN, status: 'queued', 'continuation->>phase': 'pending', 'continuation->>runId': RUN })) {
    assert.equal(url.searchParams.get(key), `eq.${value}`);
  }
  assert.ok(init.signal instanceof AbortSignal);
  const body = JSON.parse(init.body); assert.equal(body.run_id, nextRun); assert.equal(body.continuation.runId, nextRun); assert.equal(body.continuation.phase, 'running');
});

for (const status of ['review_curriculum', 'review_research', 'cancelling', 'cancelled', 'completed', 'partial', 'failed', 'running']) {
  test(`handoff cannot revive a ${status} job or bypass its user action`, async () => {
    const f = fixture([row({ status })]); const res = await f.call();
    assert.equal(res.body.accepted, false); assert.equal(f.runs.length, 0);
    assert.equal(f.calls.some(call => call.operation === 'update'), false);
  });
}
for (const overrides of [{ ownerId: '99999999-9999-4999-8999-999999999999' }, { runId: '99999999-9999-4999-8999-999999999999' }, { jobId: 'not-this-job' }]) {
  test(`wrong ${Object.keys(overrides)[0]} cannot claim or reveal another job`, async () => {
    const f = fixture(); const res = await f.call({ body: { ...f.request.body, ...overrides } });
    assert.equal(res.body.accepted, false); assert.equal(f.runs.length, 0);
    assert.equal(f.calls.some(call => call.operation === 'update'), false);
  });
}

test('targeted delivery requires bearer authorization, not a user session or query secret', async () => {
  for (const authorization of [undefined, 'Bearer user-session', 'Bearer wrong']) {
    const f = fixture(); const res = await f.call({ headers: { 'x-learnable-continuation': '1', authorization }, query: { secret: SECRET } });
    assert.equal(res.code, 401); assert.equal(f.calls.length, 0);
  }
});
test('malformed/oversized bodies and GET cannot turn a handoff into a general sweep', async () => {
  for (const body of [{}, { jobId: '../bad', ownerId: OWNER, runId: RUN }, { jobId: 'test', ownerId: OWNER, runId: 'bad' }, { jobId: 'test', ownerId: OWNER, runId: RUN, budget: 99 }, 'x'.repeat(2048)]) {
    const f = fixture(); const res = await f.call({ body }); assert.equal(res.code, 400); assert.equal(f.calls.length, 0);
  }
  const f = fixture(); assert.equal((await f.call({ method: 'GET' })).code, 405); assert.equal(f.calls.length, 0);
  assert.equal((await f.call({ headers: { authorization: `Bearer ${SECRET}`, 'x-learnable-continuation': '2' } })).code, 400);
  assert.equal(f.calls.length, 0);
});

test('malformed handoff state fails closed instead of falling back to generic automatic recovery', async () => {
  for (const change of [{ phase: 'held' }, { sequence: MAX_CONTINUATION_HOPS + 1 }, { stalls: MAX_CONTINUATION_STALLS },
    { version: 2 }, { progress: 'invalid' }, { runId: '33333333-3333-4333-8333-333333333333' }]) {
    const job = row({ status: 'timed_out', continuation: { ...row().continuation, ...change } });
    const f = fixture([job]); assert.equal((await f.call()).body.accepted, false); assert.equal(f.runs.length, 0);
    assert.equal(canAutoRecover(job), false); assert.equal(isPendingContinuation(job), false);
  }
});

test('the targeted receiver accounts for preflight time and never gives a late claim a fresh clock', async () => {
  const c = clock(); let budget;
  const f = fixture([row()], { createBudget: () => { budget = c.budget(); c.advance(151_000); return budget; } });
  assert.equal((await f.call()).code, 503); assert.equal(f.runs.length, 0);
  assert.equal(f.calls.some(call => call.operation === 'update'), false);
  assert.equal(f.tables.generation_jobs[0].status, 'queued'); assert.equal(budget.remainingMs(), 119_000);
});

test('a stalled targeted request body is bounded before any privileged lookup', async () => {
  const c = clock(), body = deferred(), f = fixture([row()], { createBudget: c.budget }), res = response();
  const req = { method: 'POST', headers: f.request.headers, async *[Symbol.asyncIterator]() { yield await body.promise; } };
  const pending = f.handler(req, res); await flush(); c.advance(5_000); await flush();
  assert.equal(res.code, 503); body.resolve(Buffer.from(JSON.stringify(f.request.body))); await pending;
  assert.equal(f.calls.length, 0); assert.equal(f.runs.length, 0); assert.equal(c.timers.size, 0);
});

test('disabled handoff and invalid destinations cannot dispatch or leak the server secret', async () => {
  const base = { LEARNABLE_GENERATION_CONTINUATION: '1', CRON_SECRET: SECRET };
  for (const origin of ['http://learnable-staging.vercel.app', 'https://localhost', 'https://127.0.0.1', 'https://evil.test',
    'https://learnable-staging.vercel.app.evil.test', 'https://user:password@learnable-staging.vercel.app',
    'https://learnable-staging.vercel.app:8080', 'https://learnable-staging.vercel.app/path', 'https://learnable-staging.vercel.app?x=1']) {
    assert.equal(continuationConfig({ ...base, LEARNABLE_GENERATION_ORIGIN: origin }), null);
  }
  assert.equal(continuationConfig({ ...base, LEARNABLE_GENERATION_CONTINUATION: '0', LEARNABLE_GENERATION_ORIGIN: process.env.LEARNABLE_GENERATION_ORIGIN }), null);
  const previous = process.env.LEARNABLE_GENERATION_CONTINUATION;
  try { process.env.LEARNABLE_GENERATION_CONTINUATION = '0'; const f = fixture(); assert.equal((await f.call()).code, 503); assert.equal(f.calls.length, 0); }
  finally { process.env.LEARNABLE_GENERATION_CONTINUATION = previous; }
  const f = fixture([row({ status: 'running' })]); assert.equal(await pause(f, { config: null }), false); assert.equal(f.calls.length, 0);
});

test('pause saves its pending marker before one bounded, non-redirecting, credential-free handoff', async () => {
  const f = fixture([row({ status: 'running', continuation: null })]); let sent = 0;
  await pause(f, { fetchImpl: async (url, options) => {
    sent++; assert.equal(url, 'https://learnable-staging.vercel.app/api/gen/sweep'); assert.equal(options.redirect, 'error');
    assert.equal(f.tables.generation_jobs[0].status, 'queued'); assert.equal(f.tables.generation_jobs[0].continuation.phase, 'pending');
    assert.deepEqual(JSON.parse(options.body), { jobId: 'continuation-test', ownerId: OWNER, runId: RUN });
    assert.equal(options.body.includes('source'), false); assert.equal(options.body.includes('sk-ant'), false);
    assert.ok(options.signal instanceof AbortSignal);
    return { ok: true, json: async () => ({ ok: true, accepted: true }) };
  } });
  assert.equal(sent, 1); assert.equal(f.tables.generation_jobs[0].continuation.sequence, 1);
});

test('checkpoint identity ignores repeated content writes and resets stalls only for new completed identities', () => {
  const job = row(); const fingerprint = continuationProgress(job);
  assert.equal(continuationProgress({ ...job, updated_at: 'later', message: 'changed', topics_by_key: { 'basics/one': { title: 'Rewritten same slot' } } }), fingerprint);
  job.continuation = { ...job.continuation, phase: 'running', progress: fingerprint };
  const second = nextContinuation(job); assert.equal(second.stalls, 1); assert.equal(second.sequence, 2);
  job.continuation = { ...second, phase: 'running' }; const third = nextContinuation(job);
  assert.equal(third.phase, 'held'); assert.equal(third.reason, 'no_progress'); assert.equal(third.stalls, MAX_CONTINUATION_STALLS);
  job.topics_by_key['basics/two'] = { title: 'New completed lesson' };
  assert.equal(nextContinuation(job).stalls, 0); assert.equal(nextContinuation(job).phase, 'pending');
  job.continuation.sequence = MAX_CONTINUATION_HOPS;
  assert.equal(nextContinuation(job).reason, 'hop_limit');
  job.run_id = '33333333-3333-4333-8333-333333333333';
  assert.equal(nextContinuation(job).sequence, 1, 'a new explicitly claimed run starts a fresh chain');
});

test('no-progress and hop limits persist a user-visible hold without an HTTP handoff', async () => {
  for (const overrides of [{ stalls: 1 }, { sequence: MAX_CONTINUATION_HOPS }]) {
    const job = row({ status: 'running' }); job.continuation = { ...job.continuation, phase: 'running', progress: continuationProgress(job), ...overrides };
    const f = fixture([job]); let calls = 0;
    await pause(f, { fetchImpl: async () => { calls++; } });
    assert.equal(calls, 0); assert.equal(job.status, 'failed'); assert.equal(job.continuation.phase, 'held');
    assert.equal(canAutoRecover({ ...job, status: 'timed_out' }), false);
  }
});

test('cancellation during pause persistence prevents the handoff', async () => {
  const job = row({ status: 'running', continuation: null }); let deliveries = 0;
  const f = fixture([job], { beforeQuery(call) { if (call.operation === 'update') job.status = 'cancelling'; } });
  await pause(f, { fetchImpl: async () => { deliveries++; } }); assert.equal(job.status, 'cancelling'); assert.equal(deliveries, 0);
});
test('cancellation or a newer claim during receiver preflight prevents dispatch', async () => {
  for (const change of [job => { job.status = 'cancelling'; }, job => { job.run_id = '33333333-3333-4333-8333-333333333333'; }]) {
    const job = row(); const f = fixture([job], { beforeQuery(call) { if (call.table === 'provider_connections') change(job); } });
    assert.equal((await f.call()).body.accepted, false); assert.equal(f.runs.length, 0);
  }
});

test('missing credentials hold the exact job without spending or picking another job', async () => {
  const f = fixture(); f.tables.provider_connections.length = 0;
  const res = await f.call(); assert.equal(res.body.accepted, false); assert.equal(f.runs.length, 0);
  assert.equal(f.tables.generation_jobs[0].status, 'failed'); assert.equal(f.tables.generation_jobs[0].continuation.reason, 'credential_unavailable');
  assert.equal(needsApiKeyForRow(f.tables.generation_jobs[0]), true, 'existing account recovery UI must recognize the missing-key state');
  assert.equal(jobPresentation({ ...f.tables.generation_jobs[0], needsApiKey: true }).label, 'API key needed');
});

test('queued/running handoffs remain In Progress and a held continuation appears under Needs Your Attention', () => {
  for (const status of ['queued', 'running']) assert.equal(jobPresentation({ status, runner: 'cloud' }).group, 'building');
  const held = jobPresentation({ status: 'failed', runner: 'cloud', checkpoint: { brief: row().brief } });
  assert.equal(held.group, 'attention'); assert.equal(held.action, 'Resolve issue'); assert.match(held.detail, /saved/);
});

test('lost claim acknowledgement never dispatches and watchdog does not automatically replay an uncertain run', async () => {
  const c = clock(), ack = deferred();
  const f = fixture([row()], { createBudget: c.budget, afterCommit: async call => { if (call.operation === 'update') await ack.promise; } });
  const pending = f.call(); await flush(); c.advance(10_000); await flush(); ack.resolve();
  const res = await pending; assert.equal(res.code, 503); assert.equal(res.body.code, GENERATION_IO_UNCERTAIN); assert.equal(f.runs.length, 0);
  const job = f.tables.generation_jobs[0]; assert.equal(job.continuation.phase, 'running');
  assert.equal((await f.call()).body.accepted, false);
  job.lease_expires_at = '2000-01-01T00:00:00Z';
  const expired = await markExpiredLiveJobsTimedOut(f.client, { ownerId: OWNER });
  assert.equal(job.status, 'failed'); assert.match(job.error, /uncertain/); assert.equal(canAutoRecover(job), false);
  assert.deepEqual(watchdogResponse(expired), { ok: true, timedOut: [], failed: [job.id], cancelled: [] });
});

test('an unknown pause write never sends a child request', async () => {
  const c = clock(), ack = deferred(), budget = c.budget(); let sends = 0;
  const f = fixture([row({ status: 'running', continuation: null })], { afterCommit: async call => { if (call.operation === 'update') await ack.promise; } });
  const pending = pause(f, { supabase: bindGenerationClient(f.client, budget), requestBudget: budget, fetchImpl: async () => { sends++; } });
  const result = assert.rejects(pending, { code: GENERATION_IO_UNCERTAIN });
  await flush(); c.advance(10_000); await flush(); ack.resolve(); await result;
  assert.equal(sends, 0); assert.equal(f.tables.generation_jobs[0].continuation.phase, 'pending');
});

test('lost HTTP acknowledgement neither replays delivery nor overwrites a newer run', async () => {
  const c = clock(), never = deferred(), job = row({ status: 'running', continuation: null }); const f = fixture([job]); let sends = 0, signal;
  const pending = pause(f, { requestBudget: c.budget(), fetchImpl: async (_url, options) => {
    sends++; signal = options.signal; job.status = 'running'; job.run_id = '33333333-3333-4333-8333-333333333333';
    job.continuation = { ...job.continuation, phase: 'running', runId: job.run_id }; await never.promise;
  } });
  await flush(); c.advance(5_000); await pending;
  assert.equal(signal.aborted, true); assert.equal(sends, 1); assert.equal(job.status, 'running'); assert.notEqual(job.run_id, RUN); assert.equal(c.timers.size, 0);
});

test('delivery does not start after the finishing deadline, even with an already writable in-memory checkpoint', async () => {
  const c = clock(), budget = c.budget(), job = row({ status: 'running', continuation: null }), f = fixture([job]); let sends = 0;
  c.advance(295_000); await pause(f, { requestBudget: budget, fetchImpl: async () => { sends++; } });
  assert.equal(sends, 0); assert.equal(job.continuation.phase, 'pending');
});

test('the daily sweep can recover an unclaimed handoff but cannot revive a crashed continuation', async () => {
  const pending = row({ lease_expires_at: '2000-01-01T00:00:00Z' });
  const crashed = row({ id: 'crashed', status: 'running', lease_expires_at: '2000-01-01T00:00:00Z', continuation: { ...row().continuation, phase: 'running' } });
  const f = fixture([pending, crashed]); const res = await f.call({ method: 'GET', headers: { authorization: `Bearer ${SECRET}` } });
  assert.equal(res.code, 200); assert.deepEqual(f.runs.map(run => run.jobId), [pending.id]);
  assert.equal(crashed.status, 'failed'); assert.match(crashed.error, /uncertain/);
});

test('runner errors during automatic continuation remain failures, not automatic retry candidates', async () => {
  for (const code of ['GENERATION_REQUEST_UNCERTAIN', 'GENERATION_IO_UNCERTAIN', 'pending', 'budget', 'disabled', 'schema']) {
    const f = fixture([row()], { run: async () => { throw Object.assign(new Error(`Synthetic ${code}`), { code }); } });
    const res = await f.call(); assert.equal(res.body.accepted, true);
    assert.equal(f.tables.generation_jobs[0].status, 'failed'); assert.equal(canAutoRecover(f.tables.generation_jobs[0]), false);
  }
  assert.equal(autoRecoveryFailurePatch(row(), new Error('Unknown')).status, 'failed');
  assert.equal(timeoutPatch(row({ status: 'running', continuation: { ...row().continuation, phase: 'running' } })).status, 'failed');
});
