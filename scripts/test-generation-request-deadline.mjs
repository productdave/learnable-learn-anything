// Offline only: actual transport code, synthetic ledger/provider, no credentials.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createClient as createGuard, MODEL, STAGING_URL } from './staging-safeguard/client.mjs';
import { createClient as createNormal } from '../web/js/generator/anthropic-fetch.js';
import { readFileSync } from 'node:fs';
import { bindGenerationClient, createGenerationRequestBudget, GENERATION_PAUSE, GENERATION_UNCERTAIN, GENERATION_IO_UNCERTAIN, GENERATION_MEDIA_TIMEOUT } from '../web/api/_lib/gen-request-budget.mjs';
import { checkpointForJob, resumeModeFor } from '../web/api/_lib/gen-recovery.mjs';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';
import { embedWebImagesInTopicResults } from '../web/api/_lib/media-resolve.mjs';
import { createRequire } from 'node:module';
import { createResumeHandler } from '../web/api/gen/resume.js';
import { createSweepHandler } from '../web/api/gen/sweep.js';
import { sealProviderKey } from '../web/api/_lib/provider-vault.mjs';
import { randomBytes } from 'node:crypto';

const ownerId = '11111111-1111-4111-8111-111111111111';
const runId = '22222222-2222-4222-8222-222222222222';
const jobId = 'job-33333333-3333-4333-8333-333333333333';
const request = { model: MODEL, max_tokens: 4096, system: 'Synthetic only',
  messages: [{ role: 'user', content: 'Synthetic only' }],
  tools: [{ name: 'submit_course_brief', input_schema: { type: 'object' } }] };
const response = () => ({ ok: true, headers: new Headers(), json: async () => ({
  model: MODEL, content: [], usage: { input_tokens: 100, output_tokens: 10 }
}) });

// Contract probe used for the failing-before reproduction. The implementation
// also receives separate real-clock-policy tests below once it exists.
function budgetProbe(clock) {
  return {
    assertCanStart() {
      if (clock.ms > 150000) throw Object.assign(new Error('Pause before dispatch'), { code: 'GENERATION_TIME_SLICE_COMPLETE' });
    },
    beginRequest() { this.assertCanStart(); return { signal: new AbortController().signal, close() {} }; }
  };
}
function fixture({ requestBudget, fetcher, beforeDispatch, reserve } = {}) {
  const state = { calls: 0, reservations: 0, settled: 0, held: false, halted: false };
  const supabase = { async rpc(name, args) {
    if (name === 'reserve_learnable_staging_spend') {
      state.reservations++;
      if (state.held || state.halted) return { data: { ok: false, reason: 'pending' } };
      state.held = true;
      await reserve?.();
      return { data: { ok: true } };
    }
    if (name === 'halt_learnable_staging_spend') { state.halted = true; return { data: { ok: true } }; }
    assert.equal(name, 'settle_learnable_staging_spend');
    state.settled++; state.held = false;
    return { data: { ok: true } };
  } };
  const options = { apiKey: 'synthetic', ownerId, runId, jobId, supabase, requestBudget, beforeDispatch,
    env: { SUPABASE_URL: STAGING_URL, LEARNABLE_SETUP_GENERATION: '1' },
    fetcher: async (...args) => { state.calls++; return fetcher ? fetcher(...args) : response(); } };
  return { state, options, client: createGuard(options) };
}

test('queued third request checks the shared clock before making a reservation', async () => {
  const clock = { ms: 0 };
  const f = fixture({ requestBudget: budgetProbe(clock), fetcher: async () => { clock.ms += 120000; return response(); } });
  const results = await Promise.allSettled([1, 2, 3].map(() => f.client.messages.create(request)));
  assert.deepEqual(results.map(r => r.status), ['fulfilled', 'fulfilled', 'rejected']);
  assert.equal(results[2].reason.code, 'GENERATION_TIME_SLICE_COMPLETE');
  assert.deepEqual(f.state, { calls: 2, reservations: 2, settled: 2, held: false, halted: false });
});

test('expired invocation never reserves or dispatches', async () => {
  const f = fixture({ requestBudget: budgetProbe({ ms: 270000 }) });
  await assert.rejects(f.client.messages.create(request), { code: 'GENERATION_TIME_SLICE_COMPLETE' });
  assert.equal(f.state.reservations, 0); assert.equal(f.state.calls, 0);
});

test('queued cancellation is checked at dispatch, not at enqueue', async () => {
  let release, cancelled = false;
  const f = fixture({ beforeDispatch: async () => {
    if (cancelled) throw Object.assign(new Error('Cancelled'), { code: 'CheckpointWriteError' });
  }, fetcher: () => new Promise(resolve => { release = resolve; }) });
  const pending = [f.client.messages.create(request), f.client.messages.create(request)];
  const finished = Promise.allSettled(pending);
  await new Promise(resolve => setImmediate(resolve));
  cancelled = true; release(response());
  // A second dispatch is itself the failure: release it to keep the baseline test finite.
  await new Promise(resolve => setImmediate(resolve));
  if (f.state.calls > 1) release(response());
  const results = await finished;
  assert.equal(results[1].status, 'rejected');
  assert.equal(f.state.reservations, 1); assert.equal(f.state.calls, 1);
});

test('normal transport also refuses an expired invocation before fetch', async () => {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async () => { calls++; return response(); };
  try {
    const client = createNormal({ apiKey: 'synthetic', requestBudget: budgetProbe({ ms: 270000 }) });
    await assert.rejects(client.messages.create(request), { code: 'GENERATION_TIME_SLICE_COMPLETE' });
    assert.equal(calls, 0);
  } finally { globalThis.fetch = original; }
});

function clockFixture() {
  const clock = { ms: 0, timers: new Map(), next: 0 };
  clock.options = { now: () => clock.ms,
    setTimer: (fn, ms) => { const id = ++clock.next; clock.timers.set(id, { fn, at: clock.ms + ms }); return id; },
    clearTimer: id => clock.timers.delete(id) };
  clock.advance = ms => {
    clock.ms += ms;
    for (const [id, timer] of [...clock.timers]) if (timer.at <= clock.ms) { clock.timers.delete(id); timer.fn(); }
  };
  clock.budget = () => createGenerationRequestBudget(clock.options);
  return clock;
}

test('real policy leaves 30s for checkpoints and checks the 120s dispatch floor', () => {
  const c = clockFixture(), budget = c.budget();
  assert.equal(budget.remainingMs(), 270000);
  c.advance(150000); budget.assertCanStart();
  c.advance(1); assert.throws(() => budget.assertCanStart(), { code: GENERATION_PAUSE });
  assert.equal(c.timers.size, 0);
});
test('request deadline is capped by both the request limit and remaining invocation time', () => {
  for (const elapsed of [0, 120000, 150000]) {
    const c = clockFixture(), budget = c.budget(); c.advance(elapsed);
    const window = budget.beginRequest();
    const duration = Math.min(240000, 270000 - elapsed);
    c.advance(duration - 1); assert.equal(window.signal.aborted, false);
    c.advance(1); assert.equal(window.signal.reason.code, GENERATION_UNCERTAIN);
    assert.throws(() => budget.assertCanStart(), { code: GENERATION_UNCERTAIN });
    window.close(); assert.equal(c.timers.size, 0);
  }
});
test('successful request cleanup cancels its timer without cancelling sibling requests', () => {
  const c = clockFixture(), budget = c.budget(), a = budget.beginRequest(), b = budget.beginRequest();
  a.close(); c.advance(240000);
  assert.equal(a.signal.aborted, false); assert.equal(b.signal.aborted, true);
  b.close(); assert.equal(c.timers.size, 0);
});
test('an uncertain in-flight result outranks an earlier safe queued pause', () => {
  const c = clockFixture(), budget = c.budget(), pending = budget.beginRequest();
  c.advance(151000); assert.throws(() => budget.assertCanStart(), { code: GENERATION_PAUSE });
  c.advance(89000); assert.throws(() => budget.assertCanStart(), { code: GENERATION_UNCERTAIN });
  pending.close();
});
test('real clock policy stops queued request 3 after two settled 120s calls', async () => {
  const c = clockFixture();
  const f = fixture({ requestBudget: c.budget(), fetcher: async () => { c.advance(120000); return response(); } });
  const settled = await Promise.allSettled([1, 2, 3].map(() => f.client.messages.create(request)));
  assert.deepEqual(settled.map(r => r.status), ['fulfilled', 'fulfilled', 'rejected']);
  assert.equal(f.state.reservations, 2); assert.equal(f.state.settled, 2);
  assert.equal(f.state.held, false); assert.equal(c.timers.size, 0);
});
test('time consumed by reservation is rechecked before provider dispatch; no invented refund', async () => {
  const c = clockFixture();
  const f = fixture({ requestBudget: c.budget(), reserve: async () => c.advance(151000) });
  await assert.rejects(f.client.messages.create(request), { code: 'uncertain' });
  assert.equal(f.state.calls, 0); assert.equal(f.state.held, true); assert.equal(f.state.halted, true);
  await assert.rejects(f.client.messages.create(request), { code: 'uncertain' });
  assert.equal(f.state.reservations, 1); assert.equal(f.state.settled, 0); assert.equal(c.timers.size, 0);
});
test('in-flight abort retains the reservation, halts the grant and denies queued spending', async () => {
  const c = clockFixture();
  const f = fixture({ requestBudget: c.budget(), fetcher: async (_url, options) => {
    c.advance(240000); options.signal.throwIfAborted(); return response();
  } });
  const results = await Promise.allSettled([f.client.messages.create(request), f.client.messages.create(request)]);
  assert.deepEqual(results.map(r => r.reason.code), ['uncertain', 'uncertain']);
  assert.equal(f.state.calls, 1); assert.equal(f.state.held, true); assert.equal(f.state.halted, true);
  assert.equal(f.state.reservations, 1); assert.equal(f.state.settled, 0); assert.equal(c.timers.size, 0);
});
test('normal transport abort uses a distinct uncertain code, not an automatic safe-pause retry', async () => {
  const c = clockFixture(), budget = c.budget(); let calls = 0;
  const client = createNormal({ apiKey: 'synthetic', requestBudget: budget, fetcher: async (_url, options) => {
    calls++; c.advance(240000); options.signal.throwIfAborted(); return response();
  } });
  await assert.rejects(client.messages.create(request), { code: GENERATION_UNCERTAIN });
  await assert.rejects(client.messages.create(request), { code: GENERATION_UNCERTAIN });
  assert.equal(calls, 1); assert.equal(c.timers.size, 0);
});

// Run the actual runner/stage/schema code. Only select the staging adapter in
// memory and add its server identity args, as packaging does. No release file
// is changed; this is not a claim about the current hosted artifact.
async function loadRunner({ guard = false, earlyReject = false, unsafeRollback = null, manualPause = false } = {}) {
  const url = new URL('../web/api/_lib/gen-runner.mjs', import.meta.url);
  let source = readFileSync(url, 'utf8');
  if (guard) {
    source = source.replace("from '../../js/generator/anthropic-fetch.js'", `from '${new URL('./staging-safeguard/client.mjs', import.meta.url).href}'`);
    source = source.replace('createAnthropic({ apiKey,', 'createAnthropic({ supabase, ownerId, jobId, runId, apiKey,');
  }
  if (earlyReject) source = source.replaceAll('await drainWorkers(', 'await Promise.all(');
  if (manualPause) source = source.replace('if (await pauseForContinuation({ supabase, jobId, ownerId, runId, requestBudget })) return;', '');
  if (unsafeRollback === 'final') source = source.replace('if (courseSaveAttempt && err?.code !== GENERATION_IO_UNCERTAIN)', 'if (courseSaveAttempt)');
  if (unsafeRollback === 'pointer') {
    const saveUrl = new URL('../web/api/_lib/course-save.mjs', import.meta.url);
    const unsafeSave = readFileSync(saveUrl, 'utf8')
      .replace('if (err?.code === GENERATION_IO_UNCERTAIN) throw err;', '')
      .replace(/from '(\.[^']+)'/g, (_match, path) => `from '${new URL(path, saveUrl).href}'`);
    source = source.replace("from './course-save.mjs'", `from 'data:text/javascript;base64,${Buffer.from(unsafeSave).toString('base64')}'`);
  }
  source = source.replace(/from '(\.[^']+)'/g, (_match, path) => `from '${new URL(path, url).href}'`);
  return (await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'))).runGeneration;
}
function runnerFixture({ research = true, checkpointHook = null, reserveHook = null, afterCheckpoint = null, commitHook = null } = {}) {
  const brief = { ...curriculumFixture(), components: ['lessons'] };
  const bundle = { module_id: 'foundations', key_concepts: ['Light', 'Composition'], examples: ['A window', 'A simple frame'], experts: [], misconceptions: [], sources: [], images: [] };
  const row = { id: jobId, owner_id: ownerId, run_id: runId, status: 'queued', stage: research ? 'topics' : 'research', brief,
    user_brief: { goal: 'Photography', components: ['lessons'] }, research: research ? { foundations: bundle } : {}, topics_by_key: {}, failures: [] };
  const state = { row, courses: new Map(), updates: [], calls: [], reserved: 0, settled: 0, held: null, halted: false };
  const supabase = {
    from(table) {
      assert.ok(['generation_jobs', 'user_courses'].includes(table));
      const filters = []; let fields = null;
      const finish = async () => {
        const records = table === 'generation_jobs' ? [row] : [...state.courses.values()];
        const found = records.find(record => filters.every(filter => filter(record)));
        if (!found) return { data: null, error: null };
        if (fields) {
          await checkpointHook?.(fields, state);
          if (!filters.every(filter => filter(found))) return { data: null, error: null };
          Object.assign(found, structuredClone(fields)); state.updates.push(structuredClone(fields));
          await afterCheckpoint?.(fields, state);
        }
        return { data: structuredClone(found), error: null };
      };
      return { select() { return this; }, update(value) { fields = value; return this; },
        eq(key, value) { filters.push(record => {
          const [column, member] = key.split('->>'); return (member ? record[column]?.[member] : record[column]) === value;
        }); return this; },
        in(key, values) { filters.push(record => values.includes(record[key])); return this; },
        // PostgREST builders are lazy: even maybeSingle() only configures the
        // query. Execute after the deadline facade installs its abort signal.
        maybeSingle() { return this; }, then(resolve, reject) { return finish().then(resolve, reject); } };
    },
    rpc(name, args) {
      const execute = async () => {
      if (name === 'commit_user_course') {
        assert.equal(args.p_owner, ownerId);
        if (args.p_action === 'delete') { state.courses.delete(args.p_id); return { data: { deleted: true } }; }
        const payload = { ...args.p_payload, _courseRevision: 'synthetic-revision' }, updatedAt = new Date().toISOString();
        state.courses.set(args.p_id, { id: args.p_id, owner_id: ownerId, payload, updated_at: updatedAt });
        await commitHook?.(state);
        return { data: { saved: true, payload, updatedAt } };
      }
      assert.equal(args.p_owner_id, ownerId); assert.equal(args.p_job_id, jobId);
      assert.equal(args.p_run_id, row.run_id);
      if (name === 'reserve_learnable_staging_spend') {
        if (state.halted || state.held) return { data: { ok: false, reason: 'pending' } };
        state.reserved++; state.held = args; await reserveHook?.(state);
        return { data: { ok: true } };
      }
      if (name === 'halt_learnable_staging_spend') { state.halted = true; return { data: { ok: true } }; }
      assert.equal(name, 'settle_learnable_staging_spend'); state.held = null; state.settled++;
      return { data: { ok: true } };
      };
      return { then(resolve, reject) { return execute().then(resolve, reject); } };
    }
  };
  const lessonResponse = topic => ({ ...response(), json: async () => ({ model: MODEL, stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 10 },
    content: [{ type: 'tool_use', name: 'submit_topic', input: lessonFixture(['lessons'], topic) }] }) });
  return { state, brief, bundle, lessonResponse, args: { supabase, jobId, ownerId, runId, apiKey: 'synthetic', userBrief: row.user_brief,
    checkpoint: checkpointForJob(row), pdfRefs: [], mode: research ? 'complete' : 'research' } };
}
async function syntheticRun(fetcher, work, { continuationFetch } = {}) {
  const originalFetch = globalThis.fetch, originalError = console.error;
  const previous = { SUPABASE_URL: process.env.SUPABASE_URL, LEARNABLE_SETUP_GENERATION: process.env.LEARNABLE_SETUP_GENERATION };
  globalThis.fetch = async (url, options) => {
    if (continuationFetch && url === 'https://learnable-staging.vercel.app/api/gen/sweep') return continuationFetch(url, options);
    assert.equal(url, 'https://api.anthropic.com/v1/messages', 'No external IO allowed'); return fetcher(JSON.parse(options.body), options);
  };
  console.error = () => {}; // Expected synthetic stop diagnostics only.
  process.env.SUPABASE_URL = STAGING_URL; process.env.LEARNABLE_SETUP_GENERATION = '1';
  try { return await work(); }
  finally {
    globalThis.fetch = originalFetch; console.error = originalError;
    for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
}

test('real runner checkpoints two settled lessons, resumes only the third, then saves the complete course', async () => {
  const run = await loadRunner({ guard: true }), c = clockFixture(), f = runnerFixture();
  await syntheticRun(async body => {
    const id = body.messages[0].content.match(/and id "([^"]+)"/)[1];
    const topic = f.brief.modules[0].topics.find(t => t.id === id); assert.ok(topic);
    f.state.calls.push(id); c.advance(120000); return f.lessonResponse(topic);
  }, async () => {
    await run({ ...f.args, requestBudget: c.budget() });
    assert.equal(f.state.row.status, 'timed_out', JSON.stringify(f.state.row.failures)); assert.equal(f.state.row.stage, 'topics');
    assert.equal(f.state.row.topics_done, 2); assert.equal(Object.keys(f.state.row.topics_by_key).length, 2);
    assert.deepEqual(f.state.row.failures, []); assert.equal(f.state.courses.size, 0);
    assert.equal(f.state.reserved, 2); assert.equal(f.state.settled, 2); assert.equal(f.state.held, null);
    const saved = structuredClone(f.state.row.topics_by_key);
    const nextRun = '44444444-4444-4444-8444-444444444444';
    f.state.row.status = 'queued'; f.state.row.run_id = nextRun;
    await run({ ...f.args, runId: nextRun, checkpoint: checkpointForJob(f.state.row), mode: resumeModeFor(f.state.row), requestBudget: c.budget() });
    assert.equal(f.state.row.status, 'completed'); assert.equal(f.state.courses.size, 1);
    assert.deepEqual(f.state.calls, ['lesson-1', 'lesson-2', 'lesson-3']);
    for (const [key, value] of Object.entries(saved)) assert.deepEqual(f.state.row.topics_by_key[key], value);
    assert.equal(f.state.reserved, 3); assert.equal(f.state.settled, 3); assert.equal(c.timers.size, 0);
  });
});

test('actual Resume handler and guarded runner count preflight time, then continue only missing lessons', async () => {
  for (const resetClock of [true, false]) {
    const run = await loadRunner({ guard: true }), c = clockFixture(), f = runnerFixture();
    f.state.row.status = 'timed_out';
    let firstJobRead = true, duration = 130_000;
    const pending = [];
    const client = { ...f.args.supabase, from(table) {
      if (table === 'provider_connections' || table === 'user_state') return {
        select() { return this; }, eq() { return this; }, maybeSingle() { return this; },
        then(resolve, reject) {
          if (table === 'user_state') c.advance(9_000);
          return Promise.resolve({ data: table === 'user_state' ? { state: { _apiKey: 'synthetic' } } : null, error: null }).then(resolve, reject);
        }
      };
      if (table === 'generation_jobs' && firstJobRead) { c.advance(4_000); firstJobRead = false; }
      return f.args.supabase.from(table);
    } };
    const handler = createResumeHandler({
      authenticate: async () => { c.advance(9_000); return { user: { id: ownerId } }; }, admin: () => client,
      createBudget: c.budget, background: promise => { pending.push(promise); },
      // Negative control recreates the old late-start clock without editing source.
      runGeneration: args => run(resetClock ? { ...args, requestBudget: c.budget() } : args)
    });
    async function resume() {
      firstJobRead = true;
      const res = { code: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
      await handler({ method: 'POST', body: { jobId, expected: { status: f.state.row.status, runId: f.state.row.run_id } } }, res);
      await Promise.all(pending); assert.equal(res.code, 200);
    }
    await syntheticRun(async body => {
      const id = body.messages[0].content.match(/and id "([^"]+)"/)[1];
      f.state.calls.push(id); c.advance(duration);
      return f.lessonResponse(f.brief.modules[0].topics.find(topic => topic.id === id));
    }, async () => {
      await resume();
      assert.equal(f.state.row.status, 'timed_out');
      assert.equal(f.state.reserved, resetClock ? 2 : 1, 'late-start control dispatches an extra request');
      assert.equal(f.state.row.topics_done, resetClock ? 2 : 1);
      if (!resetClock) {
        const firstLesson = structuredClone(f.state.row.topics_by_key['foundations/lesson-1']);
        duration = 30_000; await resume();
        assert.equal(f.state.row.status, 'completed'); assert.equal(f.state.courses.size, 1);
        assert.deepEqual(f.state.calls, ['lesson-1', 'lesson-2', 'lesson-3']);
        assert.deepEqual(f.state.row.topics_by_key['foundations/lesson-1'], firstLesson);
        assert.equal(f.state.reserved, 3); assert.equal(f.state.settled, 3); assert.equal(f.state.held, null);
      }
      assert.equal(c.timers.size, 0);
    });
  }
});

for (const scenario of ['manual', 'complete', 'research']) {
const manualPause = scenario === 'manual';
test(manualPause ? 'control: without the handoff a real guarded runner still needs manual Resume'
  : scenario === 'research' ? 'automatic research handoffs finish at human review and never dispatch a lesson'
  : 'real guarded runner automatically spans three requests, keeps each lesson and saves one course without browser Resume', async () => {
  const env = { LEARNABLE_GENERATION_CONTINUATION: '1', LEARNABLE_GENERATION_ORIGIN: 'https://learnable-staging.vercel.app',
    GEN_SWEEP_SECRET: 'synthetic-pipeline-secret', LEARNABLE_PROVIDER_VAULT_KEY: randomBytes(32).toString('hex') };
  const previous = Object.fromEntries(Object.keys(env).map(key => [key, process.env[key]])); Object.assign(process.env, env);
  try {
    const run = await loadRunner({ guard: true, manualPause });
    const f = runnerFixture({ research: scenario !== 'research' }), clocks = [clockFixture()], backgrounds = [], handoffs = [], invocations = [runId];
    if (scenario === 'research') {
      f.brief.modules = [1, 2, 3].map(i => ({ ...f.brief.modules[0], id: `module-${i}`, number: i }));
      f.args.checkpoint = checkpointForJob(f.state.row);
    }
    let activeClock = clocks[0], entryClock, providerCalls = 0;
    const raw = f.args.supabase;
    const keyRow = { encrypted_key: sealProviderKey('sk-ant-synthetic-continuation', ownerId) };
    const client = { ...raw, auth: { admin: { getUserById: async () => ({ data: { user: { email: 'synthetic@example.test' } } }) } }, from(table) {
      if (table === 'provider_connections') return {
        select() { return this; }, eq() { return this; }, maybeSingle() { return this; }, abortSignal() { return this; },
        then(resolve, reject) { return Promise.resolve({ data: keyRow, error: null }).then(resolve, reject); }
      };
      return raw.from(table);
    } };
    const handler = createSweepHandler({ admin: () => client, createBudget: () => {
      entryClock = clockFixture(); clocks.push(entryClock); const budget = entryClock.budget(); entryClock.advance(10_000); return budget;
    }, background: promise => backgrounds.push(promise), runGeneration: async args => {
      invocations.push(args.runId); activeClock = entryClock; await run(args);
    } });
    await syntheticRun(async body => {
      providerCalls++;
      activeClock.advance(160_000);
      if (scenario === 'research') {
        assert.equal(body.tools.at(-1).name, 'submit_research_bundle');
        const text = body.messages[0].content.find(block => block.type === 'text').text;
        const moduleId = text.match(/module_id you submit must be "([^"]+)"/)[1];
        return { ...response(), json: async () => ({ model: MODEL, stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 10, server_tool_use: { web_search_requests: 0 } },
          content: [{ type: 'tool_use', name: 'submit_research_bundle', input: { ...f.bundle, module_id: moduleId } }] }) };
      }
      assert.equal(body.tools.at(-1).name, 'submit_topic');
      return f.lessonResponse(f.brief.modules[0].topics[providerCalls - 1]);
    }, async () => {
      await run({ ...f.args, supabase: client, requestBudget: clocks[0].budget() });
      for (let i = 0; i < backgrounds.length; i++) await backgrounds[i];
    }, { continuationFetch: async (_url, options) => {
      handoffs.push({ ...JSON.parse(options.body), completed: Object.keys(scenario === 'research' ? f.state.row.research : f.state.row.topics_by_key) });
      const res = { code: 0, body: null, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
      await handler({ method: 'POST', headers: options.headers, body: JSON.parse(options.body) }, res);
      return { ok: res.code === 200, json: async () => res.body };
    } });
    if (manualPause) {
      assert.equal(f.state.row.status, 'timed_out'); assert.equal(providerCalls, 1); assert.equal(handoffs.length, 0); assert.equal(f.state.courses.size, 0);
    } else {
      assert.equal(f.state.row.status, scenario === 'research' ? 'review_research' : 'completed'); assert.equal(providerCalls, 3); assert.equal(handoffs.length, 2);
      assert.deepEqual(handoffs.map(item => item.completed.length), [1, 2]);
      assert.equal(new Set(invocations).size, 3); assert.equal(Object.keys(f.state.row.topics_by_key).length, scenario === 'research' ? 0 : 3);
      assert.equal(f.state.courses.size, scenario === 'research' ? 0 : 1); assert.equal(f.state.reserved, 3); assert.equal(f.state.settled, 3);
      assert.equal(f.state.held, null); assert.equal(f.state.halted, false);
      assert.equal(f.state.row.continuation.sequence, 2);
    }
    for (const clock of clocks) assert.equal(clock.timers.size, 0);
  } finally { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
}

test('safe pause drains a sibling response and checkpoint before terminalizing the job', async () => {
  const run = await loadRunner(), c = clockFixture(), f = runnerFixture(); let release;
  await syntheticRun(async () => {
    c.advance(151000);
    return new Promise(resolve => { release = () => resolve(f.lessonResponse(f.brief.modules[0].topics[0])); });
  }, async () => {
    const pending = run({ ...f.args, requestBudget: c.budget() });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.state.row.status, 'queued', 'No terminal pause while paid sibling is still in flight');
    release(); await pending;
    assert.equal(f.state.row.status, 'timed_out'); assert.equal(f.state.row.topics_done, 1);
    assert.ok(f.state.row.topics_by_key['foundations/lesson-1']); assert.deepEqual(f.state.row.failures, []);
    const terminal = f.state.updates.findIndex(update => update.status === 'timed_out');
    assert.ok(terminal > f.state.updates.findIndex(update => update.topics_by_key));
  });
});

test('the same sibling scenario loses the checkpoint with early Promise.all rejection', async () => {
  const run = await loadRunner({ earlyReject: true }), c = clockFixture(), f = runnerFixture(); let release;
  await syntheticRun(async () => {
    c.advance(151000);
    return new Promise(resolve => { release = () => resolve(f.lessonResponse(f.brief.modules[0].topics[0])); });
  }, async () => {
    const pending = run({ ...f.args, requestBudget: c.budget() });
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(f.state.row.status, 'timed_out');
    release(); await pending; await new Promise(resolve => setImmediate(resolve));
    assert.equal(Object.keys(f.state.row.topics_by_key).length, 0, 'Control reproduces lost successful output');
  });
});

test('cancelled and superseded jobs cannot be revived by late success or a deadline pause', async () => {
  const run = await loadRunner();
  for (const change of ['cancel', 'supersede']) {
    const c = clockFixture(), f = runnerFixture(); let release;
    await syntheticRun(async () => {
      c.advance(151000);
      return new Promise(resolve => { release = () => resolve(f.lessonResponse(f.brief.modules[0].topics[0])); });
    }, async () => {
      const pending = run({ ...f.args, requestBudget: c.budget() });
      await new Promise(resolve => setImmediate(resolve));
      if (change === 'cancel') f.state.row.status = 'cancelling';
      else { f.state.row.status = 'running'; f.state.row.run_id = '55555555-5555-4555-8555-555555555555'; }
      release(); await pending;
      assert.equal(f.state.row.status, change === 'cancel' ? 'cancelled' : 'running');
      assert.equal(Object.keys(f.state.row.topics_by_key).length, 0);
      assert.equal(f.state.courses.size, 0);
    });
  }
});

test('uncertain staging call preserves earlier lessons and the hold, without labelling unstarted work failed', async () => {
  const run = await loadRunner({ guard: true }), c = clockFixture(), f = runnerFixture(); let count = 0;
  await syntheticRun(async () => {
    if (++count === 1) { c.advance(120000); return f.lessonResponse(f.brief.modules[0].topics[0]); }
    c.advance(150000); throw new Error('Synthetic uncertain timeout');
  }, async () => {
    await assert.rejects(run({ ...f.args, requestBudget: c.budget() }), { code: 'uncertain' });
    assert.equal(f.state.row.status, 'failed'); assert.equal(f.state.row.topics_done, 1);
    assert.ok(f.state.row.topics_by_key['foundations/lesson-1']); assert.deepEqual(f.state.row.failures, []);
    assert.equal(f.state.reserved, 2); assert.equal(f.state.settled, 1); assert.ok(f.state.held); assert.ok(f.state.halted);
    assert.equal(count, 2); assert.equal(f.state.courses.size, 0);
  });
});

test('enabled continuation never hands off an uncertain guarded provider call or clears its spending hold', async () => {
  const settings = { LEARNABLE_GENERATION_CONTINUATION: '1', LEARNABLE_GENERATION_ORIGIN: 'https://learnable-staging.vercel.app', GEN_SWEEP_SECRET: 'synthetic-no-handoff' };
  const previous = Object.fromEntries(Object.keys(settings).map(key => [key, process.env[key]])); Object.assign(process.env, settings);
  try {
    const run = await loadRunner({ guard: true }), c = clockFixture(), f = runnerFixture(); let handoffs = 0, calls = 0;
    await syntheticRun(async () => { calls++; c.advance(270_000); throw new Error('Synthetic uncertain provider result'); }, async () => {
      await assert.rejects(run({ ...f.args, requestBudget: c.budget() }), { code: 'uncertain' });
      assert.equal(f.state.row.status, 'failed'); assert.equal(handoffs, 0); assert.equal(calls, 1);
      assert.equal(f.state.reserved, 1); assert.equal(f.state.settled, 0); assert.ok(f.state.held); assert.equal(f.state.halted, true);
      assert.equal(f.state.row.continuation, undefined);
    }, { continuationFetch: async () => { handoffs++; throw Error('Unexpected handoff'); } });
  } finally { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

test('expired curriculum invocation saves a resumable intake state without a provider or reservation call', async () => {
  const run = await loadRunner({ guard: true }), c = clockFixture(), f = runnerFixture();
  const budget = c.budget(); c.advance(160000);
  f.state.row.brief = null; f.state.row.stage = 'intake';
  await syntheticRun(() => { throw Error('Must not dispatch'); }, async () => {
    await run({ ...f.args, mode: 'curriculum', checkpoint: null, requestBudget: budget });
    assert.equal(f.state.row.status, 'timed_out'); assert.equal(f.state.row.stage, 'intake');
    assert.equal(resumeModeFor(f.state.row), 'curriculum'); assert.equal(f.state.reserved, 0);
    assert.equal(f.state.row.brief, null); assert.deepEqual(f.state.row.user_brief, f.args.userBrief);
  });
});

test('research pause preserves settled bundles; resume reaches human research review, not lesson dispatch', async () => {
  const run = await loadRunner({ guard: true }), c = clockFixture(), f = runnerFixture({ research: false });
  f.brief.modules = [1, 2, 3].map(i => ({ ...f.brief.modules[0], id: `module-${i}`, number: i }));
  f.args.checkpoint = checkpointForJob(f.state.row);
  await syntheticRun(async body => {
    assert.ok(body.tools.some(tool => tool.name === 'submit_research_bundle'));
    const text = body.messages[0].content.find(block => block.type === 'text').text;
    const moduleId = text.match(/module_id you submit must be "([^"]+)"/)[1];
    f.state.calls.push(moduleId); c.advance(120000);
    return { ...response(), json: async () => ({ model: MODEL, stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 10, server_tool_use: { web_search_requests: 0 } },
      content: [{ type: 'tool_use', name: 'submit_research_bundle', input: { ...f.bundle, module_id: moduleId } }] }) };
  }, async () => {
    await run({ ...f.args, requestBudget: c.budget() });
    assert.equal(f.state.row.status, 'timed_out'); assert.equal(f.state.row.stage, 'research');
    assert.equal(Object.keys(f.state.row.research).length, 2); assert.deepEqual(f.state.row.failures, []);
    f.state.row.status = 'queued';
    await run({ ...f.args, checkpoint: checkpointForJob(f.state.row), mode: resumeModeFor(f.state.row), requestBudget: c.budget() });
    assert.equal(f.state.row.status, 'review_research'); assert.equal(f.state.courses.size, 0);
    assert.equal(Object.keys(f.state.row.topics_by_key).length, 0);
    assert.deepEqual(f.state.calls, ['module-1', 'module-2', 'module-3']);
  });
});

test('checkpoint write failure outranks pause and cannot claim a saved lesson', async () => {
  const run = await loadRunner(), c = clockFixture();
  const f = runnerFixture({ checkpointHook: async fields => {
    if (fields.topics_by_key) throw Object.assign(Error('Synthetic persistence failure'), { code: 'CheckpointWriteError' });
  } });
  await syntheticRun(async () => { c.advance(151000); return f.lessonResponse(f.brief.modules[0].topics[0]); }, async () => {
    await assert.rejects(run({ ...f.args, requestBudget: c.budget() }), /persistence failure/);
    assert.equal(f.state.row.status, 'failed'); assert.equal(Object.keys(f.state.row.topics_by_key).length, 0);
    assert.equal(f.state.courses.size, 0); assert.deepEqual(f.state.row.failures, []);
  });
});

test('ledger requests receive abort signals and a lost reservation reply never permits a second spend', async () => {
  const c = clockFixture(), f = fixture({ requestBudget: c.budget() });
  const signals = []; let reservations = 0, halted = false;
  const supabase = { rpc(name) {
    let signal;
    return { abortSignal(value) { signal = value; signals.push(value); return this; },
      async then(resolve, reject) {
        try {
          assert.ok(signal);
          if (name === 'reserve_learnable_staging_spend') { reservations++; c.advance(240000); throw Error('Lost acknowledgement'); }
          assert.equal(name, 'halt_learnable_staging_spend'); assert.equal(signal.aborted, false); halted = true;
          return resolve({ data: { ok: true } });
        } catch (error) { return reject(error); }
      } };
  } };
  const client = createGuard({ ...f.options, supabase });
  await assert.rejects(client.messages.create(request), { code: 'ledger' });
  await assert.rejects(client.messages.create(request), { code: 'ledger' });
  assert.equal(reservations, 1); assert.equal(f.state.calls, 0); assert.ok(halted);
  assert.equal(signals.length, 2); assert.equal(signals[0].aborted, true); assert.equal(c.timers.size, 0);
});

function externalImageTopics() {
  return [{ moduleId: 'module', topicId: 'topic', content: { sections: [1, 2].map(i => ({
    type: 'image', src: `https://example.com/figure-${i}.png`, alt: `Figure ${i}`, caption: 'Original teaching reference'
  })) } }];
}
test('expired optional image batch preserves existing references without starting any fetch', async () => {
  const controller = new AbortController(); controller.abort();
  const original = externalImageTopics(); let calls = 0;
  const result = await embedWebImagesInTopicResults(original, { signal: controller.signal, fetchImpl: async () => {
    calls++; return new Response(new Uint8Array(128), { headers: { 'content-type': 'image/png' } });
  } });
  assert.deepEqual(result, original); assert.equal(calls, 0);
});
test('image batch abort stops remaining candidates and leaves source metadata unchanged', async () => {
  const controller = new AbortController(), original = externalImageTopics(); let calls = 0;
  const result = await embedWebImagesInTopicResults(original, { signal: controller.signal, fetchImpl: async () => {
    calls++; controller.abort(); return new Response(new Uint8Array(128), { headers: { 'content-type': 'image/png' } });
  } });
  assert.deepEqual(result, original); assert.equal(calls, 1);
});

test('non-provider work is interrupted at the shared cutoff, with finishing time reserved', async () => {
  const c = clockFixture(), budget = c.budget(); let signal;
  c.advance(269000);
  const pending = budget.runOperation(s => { signal = s; return new Promise(() => {}); });
  const rejected = assert.rejects(pending, { code: GENERATION_PAUSE });
  await new Promise(resolve => setImmediate(resolve)); c.advance(1000); await rejected;
  assert.ok(signal.aborted); assert.equal(c.timers.size, 0);
  assert.equal(await budget.runOperation(async () => 'checkpoint', { phase: 'finish', code: GENERATION_IO_UNCERTAIN }), 'checkpoint');
  c.advance(25000);
  let calls = 0;
  await assert.rejects(budget.runOperation(() => { calls++; }, { phase: 'finish', code: GENERATION_IO_UNCERTAIN }), { code: GENERATION_IO_UNCERTAIN });
  assert.equal(calls, 0);
});
test('operation timeout returns even when an injected transport ignores cancellation', async () => {
  const c = clockFixture(), budget = c.budget();
  const pending = budget.runOperation(() => new Promise(() => {}), { timeoutMs: 1000, code: GENERATION_IO_UNCERTAIN });
  const rejected = assert.rejects(pending, { code: GENERATION_IO_UNCERTAIN });
  await new Promise(resolve => setImmediate(resolve)); c.advance(1000); await rejected;
  assert.equal(c.timers.size, 0);
});
test('external abort and failures clean operation timers and never start expired work', async () => {
  const c = clockFixture(), budget = c.budget(), controller = new AbortController();
  const pending = budget.runOperation(() => new Promise(() => {}), { signal: controller.signal });
  const rejected = assert.rejects(pending, /Cancelled fixture/);
  controller.abort(Error('Cancelled fixture')); await rejected; assert.equal(c.timers.size, 0);
  await assert.rejects(budget.runOperation(() => { throw Error('Fixture error'); }), /Fixture error/);
  assert.equal(c.timers.size, 0); c.advance(270000);
  await assert.rejects(budget.runOperation(() => { throw Error('Must not start'); }), { code: GENERATION_PAUSE });
});
test('actual Supabase query builders retain filters and get a bounded abort signal', async () => {
  const require = createRequire(new URL('../web/api/_lib/supabase-server.mjs', import.meta.url));
  const { createClient } = require('@supabase/supabase-js');
  const c = clockFixture(), calls = [];
  const original = createClient('https://example.supabase.co', 'synthetic-key', { auth: { persistSession: false, autoRefreshToken: false }, global: {
    fetch: async (url, init) => { calls.push({ url: String(url), init });
      return new Response(JSON.stringify([{ id: jobId }]), { status: 200, headers: { 'Content-Type': 'application/json' } }); }
  } });
  const nativeFrom = original.from, client = bindGenerationClient(original, c.budget());
  const result = await client.from('generation_jobs').update({ status: 'running' }).eq('id', jobId).eq('owner_id', ownerId).eq('run_id', runId).in('status', ['queued', 'running']).select('id').maybeSingle();
  assert.equal(result.data.id, jobId); assert.equal(calls.length, 1); assert.ok(calls[0].init.signal);
  const url = new URL(calls[0].url);
  for (const [key, value] of Object.entries({ id: jobId, owner_id: ownerId, run_id: runId })) assert.equal(url.searchParams.get(key), `eq.${value}`);
  assert.equal(url.searchParams.get('status'), 'in.(queued,running)');
  assert.deepEqual(JSON.parse(calls[0].init.body), { status: 'running' });
  assert.equal(original.from, nativeFrom, 'Shared service client not mutated'); assert.equal(c.timers.size, 0);
});
test('database and storage operations stop at their own limits and the final invocation boundary', async () => {
  const c = clockFixture(), budget = c.budget(); let started = 0, signal;
  const builder = { abortSignal(s) { signal = s; return this; }, then() { started++; return new Promise(() => {}); } };
  const raw = { from: () => builder, rpc: () => builder, storage: { from: () => ({ createSignedUrl() { started++; return new Promise(() => {}); } }) } };
  const client = bindGenerationClient(raw, budget);
  const pending = Promise.resolve(client.rpc('synthetic'));
  const rejected = assert.rejects(pending, { code: GENERATION_IO_UNCERTAIN });
  await new Promise(resolve => setImmediate(resolve)); c.advance(10000); await rejected;
  assert.equal(signal.aborted, true);
  const storage = client.storage.from('synthetic').createSignedUrl('owned-path');
  const storageRejected = assert.rejects(storage, { code: GENERATION_IO_UNCERTAIN });
  await new Promise(resolve => setImmediate(resolve)); c.advance(10000); await storageRejected;
  c.advance(275000);
  await assert.rejects(Promise.resolve(client.rpc('synthetic')), { code: GENERATION_IO_UNCERTAIN });
  assert.equal(started, 2); assert.equal(c.timers.size, 0);
});
test('source batch saves finished URLs but leaves interrupted URLs pending for resume', async () => {
  const { serverFetchUrls } = await import('../web/api/_lib/gen-runner.mjs');
  const c = clockFixture(), budget = c.budget(); c.advance(269000);
  let checkpoint = [], waitingSignal;
  const pending = serverFetchUrls(['https://example.com/done', 'https://example.com/slow'], { requestBudget: budget,
    onProgress: async results => { checkpoint = structuredClone(results); },
    fetchImpl: async (url, init) => {
      if (url.endsWith('/slow')) {
        waitingSignal = init.signal;
        return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
      }
      return new Response('<html><head><title>Fixture</title></head><body><article><p>' + 'An ordinary photo guide explains how to compare light and composition. '.repeat(30) + '</p></article></body></html>', { headers: { 'Content-Type': 'text/html' } });
    } });
  const rejected = assert.rejects(pending, { code: GENERATION_PAUSE });
  await new Promise(resolve => setImmediate(resolve));
  assert.equal(checkpoint.length, 1); assert.equal(checkpoint[0].ok, true);
  c.advance(1000); await rejected;
  assert.ok(waitingSignal.aborted); assert.equal(checkpoint.length, 1);
  assert.equal(checkpoint[0].requestedUrl, 'https://example.com/done'); assert.equal(c.timers.size, 0);
});
test('optional media time limit retains completed embeds and skips unfinished references', async () => {
  const c = clockFixture(), budget = c.budget(), original = externalImageTopics(); let partial = original, calls = 0;
  const pending = budget.runOperation(signal => embedWebImagesInTopicResults(original, { signal,
    onProgress: results => { partial = results; }, fetchImpl: async (_url, init) => {
      calls++;
      if (calls === 1) return new Response(new Uint8Array(128), { headers: { 'Content-Type': 'image/png' } });
      return new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true }));
    } }), { timeoutMs: 20000, code: GENERATION_MEDIA_TIMEOUT });
  const rejected = assert.rejects(pending, { code: GENERATION_MEDIA_TIMEOUT });
  await new Promise(resolve => setImmediate(resolve)); c.advance(20000); await rejected;
  assert.match(partial[0].content.sections[0].src, /^data:image/);
  assert.deepEqual(partial[0].content.sections[1], original[0].content.sections[1]);
  assert.equal(calls, 2); assert.equal(c.timers.size, 0);
});

function seedFinishedLessons(f) {
  for (const topic of f.brief.modules[0].topics) f.state.row.topics_by_key[`foundations/${topic.id}`] = lessonFixture(['lessons'], topic);
  f.args.checkpoint = checkpointForJob(f.state.row);
}
test('completed lessons can assemble and save in the reserved final window without new AI work', async () => {
  const run = await loadRunner(), c = clockFixture(), budget = c.budget(), f = runnerFixture(); seedFinishedLessons(f);
  c.advance(270000);
  await syntheticRun(() => { throw Error('No AI dispatch allowed'); }, async () => {
    await run({ ...f.args, requestBudget: budget });
    assert.equal(f.state.row.status, 'completed'); assert.equal(f.state.courses.size, 1); assert.equal(c.timers.size, 0);
  });
});
test('a lost course-save acknowledgement keeps the committed draft; resume reconciles the same course', async () => {
  const run = await loadRunner(), c = clockFixture(); let loseReply = true;
  const f = runnerFixture({ commitHook: async () => {
    if (loseReply) { loseReply = false; assert.ok(c.timers.size, 'Save deadline armed before dispatch'); c.advance(10000); }
  } }); seedFinishedLessons(f);
  await syntheticRun(() => { throw Error('No AI dispatch allowed'); }, async () => {
    await assert.rejects(run({ ...f.args, requestBudget: c.budget() }), { code: GENERATION_IO_UNCERTAIN });
    assert.equal(f.state.row.status, 'failed'); assert.equal(f.state.courses.size, 1); assert.equal(Object.keys(f.state.row.topics_by_key).length, 3);
    f.state.row.status = 'queued';
    await run({ ...f.args, checkpoint: checkpointForJob(f.state.row), requestBudget: c.budget() });
    assert.equal(f.state.row.status, 'completed'); assert.equal(f.state.courses.size, 1);
    assert.equal(f.state.row.saved_course_id, f.brief.id);
  });
});
test('a lost saved-course pointer acknowledgement never rolls back the confirmed course', async () => {
  const run = await loadRunner(), c = clockFixture(); let loseReply = true;
  const f = runnerFixture({ afterCheckpoint: async fields => {
    if (fields.saved_course_id && !fields.status && loseReply) {
      loseReply = false; assert.ok(c.timers.size, 'Pointer deadline armed before dispatch'); c.advance(10000);
    }
  } });
  seedFinishedLessons(f);
  await syntheticRun(() => { throw Error('No AI dispatch allowed'); }, async () => {
    await assert.rejects(run({ ...f.args, requestBudget: c.budget() }), { code: GENERATION_IO_UNCERTAIN });
    assert.equal(f.state.courses.size, 1); assert.ok(f.state.courses.get(f.brief.id).payload.config);
    assert.equal(f.state.row.saved_course_id, f.brief.id);
    f.state.row.status = 'queued';
    await run({ ...f.args, checkpoint: checkpointForJob(f.state.row), requestBudget: c.budget() });
    assert.equal(f.state.row.status, 'completed'); assert.equal(f.state.courses.size, 1);
  });
});
test('a lost final-job acknowledgement preserves the confirmed completed course', async () => {
  const run = await loadRunner(), c = clockFixture(), budget = c.budget(); let uncertain = 0;
  const operation = budget.runOperation;
  budget.runOperation = async (...args) => {
    try { return await operation(...args); }
    catch (error) { if (error.code === GENERATION_IO_UNCERTAIN) uncertain++; throw error; }
  };
  const f = runnerFixture({ afterCheckpoint: async fields => {
    if (fields.status === 'completed') { assert.ok(c.timers.size, 'Finalization deadline armed before dispatch'); c.advance(10000); }
  } }); seedFinishedLessons(f);
  await syntheticRun(() => { throw Error('No AI dispatch allowed'); }, async () => {
    await run({ ...f.args, requestBudget: budget });
    assert.equal(uncertain, 1, 'The lost acknowledgement was actually observed and reconciled');
    assert.equal(f.state.row.status, 'completed'); assert.equal(f.state.courses.size, 1);
    assert.ok(f.state.courses.get(f.brief.id).payload.config, 'Never compensate an unknown acknowledgement by deleting saved output');
  });
});

test('control: old rollback behavior deletes a confirmed draft after either lost acknowledgement', async () => {
  for (const unsafeRollback of ['pointer', 'final']) {
    const run = await loadRunner({ unsafeRollback }), c = clockFixture(); let loseReply = true;
    const f = runnerFixture({ afterCheckpoint: async fields => {
      const target = unsafeRollback === 'pointer' ? fields.saved_course_id && !fields.status : fields.status === 'completed';
      if (target && loseReply) { loseReply = false; c.advance(10000); }
    } }); seedFinishedLessons(f);
    await syntheticRun(() => { throw Error('No AI dispatch allowed'); }, async () => {
      if (unsafeRollback === 'pointer') await assert.rejects(run({ ...f.args, requestBudget: c.budget() }), { code: GENERATION_IO_UNCERTAIN });
      else await run({ ...f.args, requestBudget: c.budget() });
      assert.equal(f.state.courses.size, 0, `${unsafeRollback} rollback reproduces loss without the fix`);
    });
  }
});

test('PDF body reads honor the shared cutoff, not only the initial response headers', async () => {
  const { fetchPdfBuffer } = await import('../web/api/_lib/gen-runner.mjs');
  const c = clockFixture(), budget = c.budget(); let signal;
  c.advance(269000);
  const pending = budget.runOperation(parent => fetchPdfBuffer('https://example.com/fixture.pdf', 'fixture.pdf', {
    signal: parent, fetchImpl: async (_url, init) => {
      signal = init.signal;
      return new Response(new ReadableStream({ start(controller) {
        controller.enqueue(new Uint8Array([37, 80, 68, 70]));
        signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
      } }));
    }
  }));
  const rejected = assert.rejects(pending, { code: GENERATION_PAUSE });
  await new Promise(resolve => setImmediate(resolve)); c.advance(1000); await rejected;
  assert.equal(signal.aborted, true); assert.equal(c.timers.size, 0);
});

test('actual SDK RPC body timeout remains uncertain and never retries the committed operation', async () => {
  const require = createRequire(new URL('../web/api/_lib/supabase-server.mjs', import.meta.url));
  const { createClient } = require('@supabase/supabase-js');
  const c = clockFixture(); let calls = 0, signal;
  const original = createClient('https://example.supabase.co', 'synthetic-key', {
    auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (_url, init) => {
      calls++; signal = init.signal;
      return new Response(new ReadableStream({ start(controller) {
        signal.addEventListener('abort', () => controller.error(signal.reason), { once: true });
      } }), { headers: { 'Content-Type': 'application/json' } });
    } }
  });
  const client = bindGenerationClient(original, c.budget());
  const pending = Promise.resolve(client.rpc('commit_user_course', { p_owner: ownerId }));
  const rejected = assert.rejects(pending, { code: GENERATION_IO_UNCERTAIN });
  await new Promise(resolve => setImmediate(resolve)); c.advance(10000); await rejected;
  assert.equal(calls, 1); assert.equal(signal.aborted, true); assert.equal(c.timers.size, 0);
});

test('exhausted finish window retains saved output but never invents a completed job status', async () => {
  const run = await loadRunner(), c = clockFixture();
  const f = runnerFixture({ commitHook: async () => c.advance(295000) }); seedFinishedLessons(f);
  await syntheticRun(() => { throw Error('No AI dispatch allowed'); }, async () => {
    await assert.rejects(run({ ...f.args, requestBudget: c.budget() }), { code: GENERATION_IO_UNCERTAIN });
    assert.notEqual(f.state.row.status, 'completed'); assert.equal(f.state.courses.size, 1);
    assert.equal(Object.keys(f.state.row.topics_by_key).length, 3); assert.equal(c.timers.size, 0);
    assert.equal(f.state.updates.some(fields => fields.status === 'completed'), false);
  });
});
