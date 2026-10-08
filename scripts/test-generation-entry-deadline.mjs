import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { setImmediate as tick } from 'node:timers/promises';
import { createGenerationRequestBudget, withGenerationSignal, GENERATION_PAUSE, GENERATION_IO_UNCERTAIN, GENERATION_UNCERTAIN } from '../web/api/_lib/gen-request-budget.mjs';
import { createSetupGenerationHandler } from '../web/api/setups/generate.js';
import { createReviewHandler } from '../web/api/gen/review.js';
import { createStartHandler } from '../web/api/gen/start.js';
import { createResumeHandler } from '../web/api/gen/resume.js';
import { createRestartHandler } from '../web/api/gen/restart.js';
import { createCredentialsReadyHandler } from '../web/api/gen/credentials-ready.js';
import { createSweepHandler } from '../web/api/gen/sweep.js';
import { sealProviderKey } from '../web/api/_lib/provider-vault.mjs';
import { setupDraft } from '../web/js/setup-model.js';
import { prepareAccountPayload } from '../web/js/setup-account-model.js';
import { createGroupedHandler } from './packaging/grouped-router.mjs';

// No provider, Auth, storage or database network calls. Lazy query builders model
// PostgREST dispatch at await, not at maybeSingle(). All credentials are synthetic.
process.env.LEARNABLE_CREATION_IMAGES = process.env.LEARNABLE_GPT_IMAGES = process.env.LEARNABLE_IMAGE_REQUESTS = '1';
const previousVault = process.env.LEARNABLE_PROVIDER_VAULT_KEY;
const previousFetch = globalThis.fetch;
const previousSweepSecret = process.env.GEN_SWEEP_SECRET;
const OLD_RUN = '10000000-0000-4000-8000-000000000001';
process.env.LEARNABLE_PROVIDER_VAULT_KEY = randomBytes(32).toString('hex');
process.env.GEN_SWEEP_SECRET = 'synthetic-entry-sweep-secret';
globalThis.fetch = async () => { throw new Error('Network forbidden in entry deadline tests'); };
test.after(() => {
  globalThis.fetch = previousFetch;
  if (previousVault === undefined) delete process.env.LEARNABLE_PROVIDER_VAULT_KEY;
  else process.env.LEARNABLE_PROVIDER_VAULT_KEY = previousVault;
  if (previousSweepSecret === undefined) delete process.env.GEN_SWEEP_SECRET;
  else process.env.GEN_SWEEP_SECRET = previousSweepSecret;
});

function clock() {
  let elapsed = 0, sequence = 0;
  const timers = new Map();
  return {
    timers, now: () => elapsed,
    setTimer(fn, delay) { const id = ++sequence; timers.set(id, { at: elapsed + delay, fn }); return id; },
    clearTimer(id) { timers.delete(id); },
    advance(ms) {
      elapsed += ms;
      for (const [id, timer] of [...timers]) if (timer.at <= elapsed) { timers.delete(id); timer.fn(); }
    }
  };
}
function deferred() { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; }
async function flush() { for (let i = 0; i < 5; i++) await tick(); }
function response() {
  return { code: null, body: null, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
}

async function fixture(kind = 'create', options = {}) {
  const time = clock(), runs = [], calls = [], waits = [];
  const draft = setupDraft('An introductory course');
  Object.assign(draft.brief, { audience: 'Beginners', context: 'Short sessions', goal: 'Understand the basics', starting_point: 'Beginner' });
  const prepared = await prepareAccountPayload(draft);
  const row = { id: 'setup-entry-test', owner_id: 'owner', revision: 1, content_hash: prepared.hash, payload: prepared.payload, deleted: false };
  const job = {
    id: 'job-entry-test', owner_id: 'owner', run_id: OLD_RUN, status: kind === 'review' ? 'review_curriculum' : 'timed_out', stage: 'topics',
    brief: { id: 'test-course', title: 'Introductory course', modules: [{ id: 'basics', title: 'Basics', topics: [{ id: 'intro', title: 'Introduction' }] }] },
    user_brief: { topic: 'An introductory course', source_text: 'Keep this source.' }, review_history: [],
    research: { basics: { key_concepts: ['A source concept'] } }, topics_by_key: { 'basics/saved': { title: 'Saved lesson' } }, recovery_attempts: 0,
    error: kind === 'credentials' ? 'No Anthropic API key' : null, message: null
  };
  const tables = {
    course_setups: [row], generation_jobs: ['create', 'start'].includes(kind) ? [] : [job],
    provider_connections: [{ owner_id: 'owner', provider: 'anthropic', encrypted_key: sealProviderKey('sk-ant-synthetic-entry-test', 'owner') }, { owner_id: 'owner', provider: 'openai', encrypted_key: sealProviderKey('sk-synthetic-image-entry-test', 'owner', 'openai') }], user_state: []
  };
  const db = { auth: { admin: { async getUserById(owner) {
    await options.ownerLookup?.(owner, time); time.advance(options.ownerLookupMs || 0);
    return { data: { user: { email: `${owner}@example.test` } } };
  } } }, from(table) {
    let operation = 'select', value, single = false, signal, limit = Infinity;
    const filters = [];
    const query = {
      select() { return this; }, eq(key, expected) { filters.push([key, expected]); return this; },
      in(key, values) { filters.push([key, values, 'in']); return this; },
      lt(key, value) { filters.push([key, value, 'lt']); return this; },
      gte(key, value) { filters.push([key, value, 'gte']); return this; },
      neq(key, value) { filters.push([key, value, 'neq']); return this; },
      order() { return this; }, limit(value) { limit = value; return this; },
      is(key, expected) { return this.eq(key, expected); }, maybeSingle() { single = true; return this; },
      insert(input) { operation = 'insert'; value = input; return this; }, update(input) { operation = 'update'; value = input; return this; },
      abortSignal(input) { signal = input; return this; },
      then(resolve, reject) {
        return Promise.resolve().then(async () => {
          signal?.throwIfAborted();
          const call = { table, operation, filters, value, signal }; calls.push(call);
          await options.beforeQuery?.(call, time, tables);
          signal?.throwIfAborted();
          time.advance(options.queryMs || 0);
          const matches = tables[table].filter(item => filters.every(([key, expected, operator]) => operator === 'in' ? expected.includes(item[key])
            : operator === 'lt' ? item[key] < expected : operator === 'gte' ? item[key] >= expected
              : operator === 'neq' ? item[key] != null && item[key] !== expected : item[key] === expected)).slice(0, limit);
          let data = matches;
          if (operation === 'insert') {
            if (tables[table].some(item => item.id === value.id)) return { error: { code: '23505' } };
            tables[table].push(structuredClone(value)); data = [value];
          }
          if (operation === 'update') for (const match of matches) Object.assign(match, structuredClone(value));
          await options.afterCommit?.(call, time, tables);
          return { data: structuredClone(single ? data[0] || null : data), error: null };
        }).then(resolve, reject);
      }
    };
    return query;
  } };
  let requestBudget;
  const deps = {
    createBudget: input => { requestBudget = createGenerationRequestBudget({ ...time, ...input }); time.advance(options.entryDelay || 0); return requestBudget; },
    authenticate: async (req, authOptions) => {
      await options.authenticate?.(req, authOptions, time);
      time.advance(options.authMs || 0);
      return { user: { id: options.owner || 'owner', email: 'entry@example.test' } };
    },
    admin: () => db,
    validate: async () => { time.advance(options.validationMs || 0); },
    enabled: () => true,
    background: promise => { waits.push(promise); },
    run: async args => { runs.push(args); await options.run?.(args, time); },
    runGeneration: async args => { runs.push(args); await options.run?.(args, time); }
  };
  const factories = { create: createSetupGenerationHandler, review: createReviewHandler, start: createStartHandler, resume: createResumeHandler, restart: createRestartHandler, credentials: createCredentialsReadyHandler, sweep: createSweepHandler };
  const endpoint = factories[kind](deps);
  const route = kind === 'create' ? '/api/setups/generate' : kind === 'credentials' ? '/api/gen/credentials-ready' : `/api/gen/${kind}`;
  const handler = options.grouped ? createGroupedHandler({ [route]: async () => {
    time.advance(options.importMs || 0); return { default: endpoint };
  } }, { now: time.now }) : endpoint;
  const body = kind === 'create' ? { id: row.id, revision: 1, action: 'start' }
    : kind === 'start' ? { jobId: job.id, brief: job.user_brief }
    : { jobId: job.id, action: 'approve_curriculum', expected: { status: job.status, runId: job.run_id } };
  async function call(overrides = {}, req = {}) {
    const res = response(); await handler({ url: route, method: 'POST', headers: { authorization: 'Bearer synthetic-entry-sweep-secret' }, body: { ...body, ...overrides }, ...req }, res);
    await Promise.all(waits); return res;
  }
  return { time, runs, calls, tables, job, handler, body, call, budget: () => requestBudget };
}

test('direct start checks the image connection before creating or charging a new course', async () => {
  const f = await fixture('start');
  f.tables.provider_connections = f.tables.provider_connections.filter(row => row.provider !== 'openai');
  const res = await f.call();
  assert.equal(res.code, 409);
  assert.equal(res.body.code, 'image_connection');
  assert.equal(f.tables.generation_jobs.length, 0);
  assert.equal(f.runs.length, 0);
});

test('direct start reattaches an existing owned job even after both providers disconnect', async () => {
  const f = await fixture('start');
  f.tables.generation_jobs.push(f.job);
  f.tables.provider_connections = [];
  const res = await f.call();
  assert.equal(res.code, 200);
  assert.equal(res.body.existing, true);
  assert.equal(res.body.jobId, f.job.id);
  assert.equal(f.runs.length, 0);
  assert.equal(f.calls.some(call => call.table === 'provider_connections'), false);
});

for (const kind of ['create', 'review', 'start', 'resume', 'restart', 'credentials', 'sweep']) {
  test(`${kind}: grouped module-loading time counts before claiming or dispatching work`, async () => {
    const f = await fixture(kind, { grouped: true, importMs: 151_000 });
    const res = await f.call();
    assert.equal(res.code, 503); assert.equal(res.body.code, GENERATION_PAUSE);
    assert.equal(f.runs.length, 0);
    assert.equal(f.calls.some(call => call.operation !== 'select'), false);
  });
  test(`${kind}: grouped loading and preflight share the runner's original clock`, async () => {
    const f = await fixture(kind, { grouped: true, importMs: 40_000, authMs: 3_000, queryMs: 1_000 });
    assert.equal((await f.call()).code, 200); assert.equal(f.runs.length, 1);
    assert.equal(f.runs[0].requestBudget.remainingMs(), 270_000 - f.time.now());
    assert.equal(f.time.timers.size, 0);
  });
}

test('concurrent requests share a module import but keep independent invocation clocks', async () => {
  const time = clock(), loaded = deferred(); let imports = 0;
  const router = createGroupedHandler({ '/api/gen/resume': async () => {
    imports++; await loaded.promise;
    return { default: req => createGenerationRequestBudget({ ...time, request: req }) };
  } }, { now: time.now });
  const first = router({ url: '/api/gen/resume' }, response());
  await flush(); time.advance(50_000);
  const second = router({ url: '/api/gen/resume' }, response());
  await flush(); time.advance(50_000); loaded.resolve();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(imports, 1); assert.equal(a.remainingMs(), 170_000); assert.equal(b.remainingMs(), 220_000);
  const warm = await router({ url: '/api/gen/resume' }, response());
  assert.equal(warm.remainingMs(), 270_000); assert.equal(imports, 1);
  a.stop(Object.assign(new Error('uncertain first request'), { code: GENERATION_UNCERTAIN }));
  assert.doesNotThrow(() => b.assertCanStart()); assert.doesNotThrow(() => warm.assertCanStart());
});

test('request headers, query and JSON cannot supply or extend a server invocation timestamp', async () => {
  const time = clock(); time.advance(5_000);
  const req = { url: '/api/gen/start?startedAt=999999999', headers: { 'x-started-at': '999999999' },
    startedAt: 999999999, body: { startedAt: 999999999, 'learnable.generation.startedAt': 999999999 } };
  const original = JSON.stringify(req);
  const router = createGroupedHandler({ '/api/gen/start': async () => {
    time.advance(40_000);
    return { default: request => createGenerationRequestBudget({ ...time, request }) };
  } }, { now: time.now });
  const budget = await router(req, response());
  assert.equal(budget.remainingMs(), 230_000); assert.equal(JSON.stringify(req), original);
  time.advance(255_000);
  await assert.rejects(budget.fork().runOperation(() => assert.fail('expired final write'), { phase: 'finish' }), { code: GENERATION_PAUSE });
});

test('a failed module load does not backdate a later request or reset its own loading time', async () => {
  const time = clock(); let imports = 0;
  const router = createGroupedHandler({ '/api/gen/start': async () => {
    time.advance(40_000); if (++imports === 1) throw new Error('synthetic import failure');
    return { default: request => createGenerationRequestBudget({ ...time, request }) };
  } }, { now: time.now });
  await assert.rejects(router({ url: '/api/gen/start' }, response()), /synthetic import failure/);
  time.advance(100_000);
  const second = await router({ url: '/api/gen/start' }, response());
  assert.equal(second.remainingMs(), 230_000); assert.equal(imports, 2);
});

test('standalone and invalid internal timestamps cannot extend the request budget', () => {
  const time = clock(); time.advance(10_000);
  for (const entered of [undefined, null, '0', -1, NaN, Infinity, 999_999]) {
    const request = { [Symbol.for('learnable.generation.startedAt')]: entered };
    assert.equal(createGenerationRequestBudget({ ...time, request }).remainingMs(), 270_000);
  }
  assert.equal(createGenerationRequestBudget(time).remainingMs(), 270_000);
  assert.equal(createGenerationRequestBudget({ ...time, request: { [Symbol.for('learnable.generation.startedAt')]: 0 } }).remainingMs(), 260_000);
});

test('Create counts authentication, setup lookup, key validation and claim time in the runner budget', async () => {
  const f = await fixture('create', { authMs: 4_000, queryMs: 2_000, validationMs: 6_000 });
  const res = await f.call();
  assert.equal(res.code, 200); assert.equal(f.runs.length, 1);
  assert.ok(f.runs[0].requestBudget, 'the runner must receive the HTTP-entry budget');
  assert.equal(f.runs[0].requestBudget, f.budget());
  assert.equal(f.runs[0].requestBudget.remainingMs(), 270_000 - f.time.now());
  assert.ok(f.time.now() >= 20_000); assert.equal(f.time.timers.size, 0);
  assert.equal(f.runs[0].mode, 'curriculum');
});

test('Create refuses a job claim when preflight used its available time', async () => {
  const f = await fixture('create', { validationMs: 151_000 });
  const res = await f.call();
  assert.equal(res.code, 503); assert.equal(res.body.code, GENERATION_PAUSE);
  assert.equal(f.runs.length, 0); assert.equal(f.tables.generation_jobs.length, 0);
});

for (const kind of ['create', 'review', 'start', 'resume', 'restart', 'credentials']) {
  test(`${kind}: stalled Auth returns retryable 503, aborts its fetch and cannot launch after a late result`, async () => {
    const auth = deferred(); let authSignal;
    const f = await fixture(kind, { authenticate: async (_req, options) => {
      const original = globalThis.fetch;
      globalThis.fetch = async (_url, init) => { authSignal = init.signal; return auth.promise; };
      try { if (options?.fetcher) await options.fetcher('https://auth.example.test'); else await auth.promise; }
      finally { globalThis.fetch = original; }
    } });
    const res = response(), pending = f.handler({ method: 'POST', body: f.body }, res);
    await flush(); f.time.advance(10_000); await flush();
    // Resolve before asserting so the control never leaves a hanging handler.
    const timeoutStatus = res.code, wasAborted = authSignal?.aborted;
    auth.resolve({}); await pending;
    assert.equal(timeoutStatus, 503, 'timeout is not a new sign-in requirement');
    assert.equal(wasAborted, true); assert.equal(f.calls.length, 0); assert.equal(f.runs.length, 0);
    assert.equal(f.time.timers.size, 0);
  });

  test(`${kind}: body stream stalls are bounded without dispatching a job`, async () => {
    const chunks = deferred(), f = await fixture(kind), res = response();
    const req = { method: 'POST', async *[Symbol.asyncIterator]() { yield await chunks.promise; } };
    const pending = f.handler(req, res);
    await flush(); f.time.advance(10_000); await flush(); const timeoutStatus = res.code;
    chunks.resolve(Buffer.from(JSON.stringify(f.body))); await pending;
    assert.equal(timeoutStatus, 503); assert.equal(f.calls.some(call => call.operation !== 'select'), false); assert.equal(f.runs.length, 0);
  });

  test(`${kind}: database timeout retains the setup/review instead of mislabelling a missing API key`, async () => {
    const read = deferred();
    const f = await fixture(kind, { beforeQuery: async call => { if (call.table === 'provider_connections') await read.promise; } });
    const pending = f.call(); await flush(); f.time.advance(10_000); await flush();
    read.resolve(); const res = await pending;
    assert.equal(res.code, 503); assert.equal(res.body.code, GENERATION_IO_UNCERTAIN);
    assert.equal(f.runs.length, 0); assert.equal(f.calls.some(call => call.operation !== 'select'), false);
    if (kind === 'review') assert.equal(f.job.status, 'review_curriculum');
  });

  test(`${kind}: a late claim acknowledgement never dispatches paid work or repeats the claim`, async () => {
    const ack = deferred();
    const f = await fixture(kind, { afterCommit: async call => { if (call.operation !== 'select') await ack.promise; } });
    const pending = f.call(); await flush(); f.time.advance(10_000); await flush();
    ack.resolve(); const res = await pending;
    assert.equal(res.code, 503); assert.equal(res.body.code, GENERATION_IO_UNCERTAIN); assert.equal(f.runs.length, 0);
    assert.equal(f.calls.filter(call => call.operation !== 'select').length, 1);
    assert.equal(f.tables.generation_jobs.length, 1); assert.equal(f.tables.generation_jobs[0].status, 'running');
    const retry = await f.call();
    assert.equal(retry.code, ['create', 'start', 'credentials'].includes(kind) ? 200 : 409); assert.equal(f.runs.length, 0);
    if (['create', 'start'].includes(kind)) assert.equal(retry.body.existing, true);
    // A committed but unacknowledged lease stays for existing watchdog/recovery.
  });

  test(`${kind}: invalid sessions remain 401 and other owners cannot launch`, async () => {
    const f = await fixture(kind, { authenticate: async () => { throw Object.assign(new Error('Invalid session'), { statusCode: 401 }); } });
    assert.equal((await f.call()).code, 401); assert.equal(f.calls.length, 0);
    if (kind !== 'start') {
      const other = await fixture(kind, { owner: 'other-owner' });
      assert.equal((await other.call()).code, kind === 'credentials' ? 400 : 404); assert.equal(other.runs.length, 0);
    }
  });

  test(`${kind}: exhausted dispatch window does not claim a job`, async () => {
    const f = await fixture(kind, { entryDelay: 151_000 });
    const res = await f.call();
    assert.equal(res.code, 503); assert.equal(res.body.code, GENERATION_PAUSE);
    assert.equal(f.calls.some(call => call.operation !== 'select'), false); assert.equal(f.runs.length, 0);
  });
}

for (const kind of ['start', 'resume', 'restart']) {
  test(`${kind}: background runner inherits the HTTP clock, ownership and intended checkpoint`, async () => {
    const f = await fixture(kind, { authMs: 4_000, queryMs: 2_000 });
    const res = await f.call({ feedback: 'Keep the useful source.' });
    assert.equal(res.code, 200); assert.equal(f.runs.length, 1);
    const run = f.runs[0];
    assert.equal(run.requestBudget, f.budget()); assert.equal(run.requestBudget.remainingMs(), 270_000 - f.time.now());
    assert.equal(run.ownerId, 'owner'); assert.equal(run.jobId, 'job-entry-test');
    assert.equal(run.runId, f.tables.generation_jobs[0].run_id);
    assert.equal(run.mode, kind === 'resume' ? 'complete' : 'curriculum');
    if (kind === 'resume') assert.equal(run.checkpoint.topics_by_key['basics/saved'].title, 'Saved lesson');
    if (kind === 'restart') assert.match(run.userBrief.source_text, /Keep the useful source/);
    if (kind !== 'start') assert.deepEqual(f.calls.find(call => call.operation === 'update').filters, [
      ['id', f.job.id], ['owner_id', 'owner'], ['status', 'timed_out'], ['run_id', OLD_RUN]
    ]);
  });
}

test('Resume still refuses to bypass a human review checkpoint', async () => {
  const f = await fixture('resume'); f.job.status = 'review_research';
  const res = await f.call({ expected: { status: f.job.status, runId: OLD_RUN } });
  assert.equal(res.code, 409); assert.match(res.body.error, /human review/); assert.equal(f.runs.length, 0);
});

test('Review passes the same entry budget and preserves review checkpoints and owner/run guards', async () => {
  const f = await fixture('review', { authMs: 4_000, queryMs: 2_000 });
  const res = await f.call({ feedback: 'Keep the examples practical.' });
  assert.equal(res.code, 200); assert.equal(f.runs.length, 1);
  assert.equal(f.runs[0].requestBudget, f.budget());
  assert.equal(f.runs[0].requestBudget.remainingMs(), 270_000 - f.time.now());
  assert.equal(f.runs[0].mode, 'research');
  assert.equal(f.runs[0].checkpoint.brief.human_feedback, 'Keep the examples practical.');
  assert.deepEqual(f.calls.find(call => call.operation === 'update').filters, [
    ['id', f.job.id], ['owner_id', 'owner'], ['status', 'review_curriculum'], ['run_id', OLD_RUN]
  ]);
  assert.equal(f.time.timers.size, 0);
});

test('Review key absence still saves feedback without claiming a run', async () => {
  const f = await fixture('review'); f.tables.provider_connections = [];
  const res = await f.call({ feedback: 'Keep my feedback for later.' });
  assert.equal(res.code, 400); assert.equal(f.runs.length, 0);
  assert.equal(f.job.status, 'review_curriculum'); assert.equal(f.job.run_id, OLD_RUN);
  assert.equal(f.job.review_history.at(-1).feedback, 'Keep my feedback for later.');
});

test('Credential recovery inherits the entry deadline; saving a key alone never starts generation', async () => {
  const f = await fixture('credentials', { authMs: 4_000, queryMs: 2_000 });
  const res = await f.call();
  assert.equal(res.code, 200); assert.deepEqual(res.body.started, ['job-entry-test']); assert.equal(f.runs.length, 1);
  assert.equal(f.runs[0].requestBudget.remainingMs(), 270_000 - f.time.now());
  assert.notEqual(f.runs[0].requestBudget, f.budget());
  assert.equal(f.runs[0].checkpoint.topics_by_key['basics/saved'].title, 'Saved lesson');
  const saveOnly = await fixture('credentials');
  const cleared = await saveOnly.call({ jobId: null });
  assert.equal(cleared.code, 200); assert.deepEqual(cleared.body.started, []); assert.equal(saveOnly.runs.length, 0);
  assert.equal(saveOnly.job.status, 'timed_out'); assert.equal(saveOnly.job.run_id, OLD_RUN);
});

test('Sweep jobs share the handler deadline but not a sibling job’s stop state', async () => {
  const f = await fixture('sweep', { queryMs: 1_000, ownerLookupMs: 2_000, run: async (args, time) => {
    if (args.jobId === 'job-entry-test') args.requestBudget.stop(Object.assign(new Error('Synthetic uncertain result'), { code: GENERATION_UNCERTAIN }));
    else assert.doesNotThrow(() => args.requestBudget.assertCanStart());
    time.advance(2_000);
  } });
  f.tables.generation_jobs.push(...[2, 3, 4].map(number => ({ ...structuredClone(f.job), id: `job-entry-${number}` })));
  const res = await f.call();
  assert.equal(res.code, 200); assert.equal(f.runs.length, 3); assert.equal(res.body.claimed.length, 3);
  assert.equal(f.tables.generation_jobs[3].status, 'timed_out', 'existing batch limit is retained');
  for (const run of f.runs) {
    assert.equal(run.requestBudget.remainingMs(), 270_000 - f.time.now());
    assert.notEqual(run.requestBudget, f.budget()); assert.equal(run.ownerId, 'owner');
    assert.equal(run.checkpoint.topics_by_key['basics/saved'].title, 'Saved lesson');
  }
  assert.notEqual(f.runs[0].requestBudget, f.runs[1].requestBudget);
  assert.doesNotThrow(() => f.budget().assertCanStart());
});

test('Sweep Auth lookup timeout does not claim a job or falsely mark a missing provider key', async () => {
  const lookup = deferred(), f = await fixture('sweep', { ownerLookup: () => lookup.promise });
  const pending = f.call(); await flush(); f.time.advance(10_000); await flush(); lookup.resolve();
  const res = await pending;
  assert.equal(res.code, 503); assert.equal(res.body.code, GENERATION_PAUSE); assert.equal(f.runs.length, 0);
  assert.equal(f.calls.some(call => call.operation !== 'select'), false);
  assert.equal(f.job.status, 'timed_out'); assert.equal(f.job.error, null);
});

test('Sweep lost claim acknowledgement is uncertain and never dispatches the job', async () => {
  const ack = deferred(), f = await fixture('sweep', { afterCommit: call => call.operation === 'update' ? ack.promise : undefined });
  const pending = f.call(); await flush(); f.time.advance(10_000); await flush(); ack.resolve();
  const res = await pending;
  assert.equal(res.code, 503); assert.equal(res.body.code, GENERATION_IO_UNCERTAIN);
  assert.equal(f.runs.length, 0); assert.equal(f.job.status, 'running');
  assert.equal(f.calls.filter(call => call.operation === 'update').length, 1);
});

test('Sweep does not give a later candidate a fresh five-minute window', async () => {
  const f = await fixture('sweep', { run: async (_args, time) => { time.advance(151_000); } });
  f.tables.generation_jobs.push({ ...structuredClone(f.job), id: 'job-entry-second' });
  const res = await f.call();
  assert.equal(res.code, 503); assert.equal(res.body.code, GENERATION_PAUSE); assert.equal(f.runs.length, 1);
  assert.equal(f.tables.generation_jobs[1].status, 'timed_out');
  assert.equal(f.calls.filter(call => call.operation === 'update').length, 1);
});

test('Sweep secret is still required before any privileged lookup', async () => {
  const f = await fixture('sweep'); const res = await f.call({}, { headers: {} });
  assert.equal(res.code, 401); assert.equal(f.calls.length, 0); assert.equal(f.runs.length, 0);
});

test('A budget fork cannot reset finishing time; fetch cancellation preserves both signals', async () => {
  const time = clock(), parent = createGenerationRequestBudget(time);
  time.advance(294_999); const child = parent.fork(); let invoked = false;
  await assert.rejects(child.runOperation(async () => { time.advance(1); }, { phase: 'finish', code: GENERATION_IO_UNCERTAIN }), { code: GENERATION_IO_UNCERTAIN });
  await assert.rejects(child.runOperation(() => { invoked = true; }, { phase: 'finish' }), { code: GENERATION_PAUSE });
  assert.equal(invoked, false); assert.equal(time.timers.size, 0);
  const deadline = new AbortController(), caller = new AbortController(); let observed;
  await withGenerationSignal(deadline.signal, async (_url, init) => { observed = init.signal; })('https://auth.example.test', { signal: caller.signal });
  caller.abort(new Error('Caller cancelled')); assert.equal(observed.reason, caller.signal.reason);
  deadline.abort(new Error('Deadline')); assert.throws(() => withGenerationSignal(deadline.signal)(null), /Deadline/);
});
