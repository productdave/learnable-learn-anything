import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as sleep } from 'node:timers/promises';
import { IMAGE_EXECUTION_MS, IMAGE_FOREGROUND_MS, IMAGE_IO_MS, IMAGE_SAVE_RESERVE_MS } from '../web/api/_lib/image-execution.mjs';
import { executionClock, deferred, flush } from './fixtures/image-execution-clock.mjs';
import { createCourseImageHandler, config } from '../web/api/courses/images.js';

let checks = 0;
const check = async (name, test) => { await test(); checks++; };
const response = () => ({ headers: {}, sends: 0, setHeader(k,v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; this.sends++; return this; } });
await check('reviewed budgets fit Hobby with a shutdown reserve', () => {
  assert.equal(config.maxDuration, 300); assert.equal(IMAGE_EXECUTION_MS, 270000);
  assert.equal(IMAGE_FOREGROUND_MS, 25000); assert.equal(IMAGE_IO_MS, 30000); assert.equal(IMAGE_SAVE_RESERVE_MS, 60000);
});
await check('foreground uses remaining request budget, not a new 25 seconds per operation', async () => {
  const c = executionClock(); c.advance(10000); assert.equal(c.budget.foregroundMs(), 15000);
  assert.equal(await c.budget.wait(() => 42), 42); assert.equal(c.timers.size, 1);
  c.advance(16000); assert.equal(c.budget.foregroundMs(), 0);
  let calls = 0; await assert.rejects(c.budget.wait(() => calls++, { timeoutMs: c.budget.foregroundMs() }));
  assert.equal(calls, 0); c.budget.close(); assert.equal(c.timers.size, 0);
});
await check('uncooperative operation cannot keep the invocation alive indefinitely', async () => {
  const c = executionClock(), pending = deferred();
  const work = c.budget.wait(() => pending.promise), stopped = assert.rejects(work, { name: 'ImageExecutionTimeout' });
  await flush(); c.advance(270000); await stopped;
  pending.reject(Error('late error must be consumed')); await flush();
  assert.equal(c.budget.remainingMs(), 0); assert.equal(c.timers.size, 0); c.budget.close();
});
await check('closing before queued microtask prevents side effects', async () => {
  const c = executionClock(); let calls = 0;
  const pending = c.budget.wait(() => calls++); c.budget.close();
  await assert.rejects(pending); assert.equal(calls, 0); assert.equal(c.timers.size, 0);
});
await check('per-I/O signal remains active after headers arrive', async () => {
  let signal;
  const c = executionClock({ ioMs: 10, fetcher: async (_url, init) => { signal = init.signal; return new Response('headers arrived'); } });
  await c.budget.fetch('https://not-contacted.invalid'); assert.equal(signal.aborted, false);
  await sleep(30); assert.equal(signal.aborted, true); c.budget.close();
});
await check('inherited init and Request abort signals cannot be dropped', async () => {
  let signal, calls = 0;
  const c = executionClock({ fetcher: async (_url, init) => { signal = init.signal; calls++; return new Response('ok'); } });
  const first = new AbortController(); await c.budget.fetch('https://not-contacted.invalid', { signal: first.signal });
  first.abort(); assert.equal(signal.aborted, true);
  const second = new AbortController(); await c.budget.fetch(new Request('https://not-contacted.invalid', { signal: second.signal }));
  second.abort(); assert.equal(signal.aborted, true);
  c.budget.close(); assert.throws(() => c.budget.fetch('https://not-contacted.invalid')); assert.equal(calls, 2);
});
await check('request payload and headers reach bounded fetch unchanged', async () => {
  let observed; const c = executionClock({ fetcher: async (url, init) => { observed = { url, ...init }; return new Response('ok'); } });
  await c.budget.fetch('https://not-contacted.invalid', { method: 'POST', body: 'café', headers: { 'x-test': 'present' } });
  assert.equal(observed.method, 'POST'); assert.equal(observed.body, 'café'); assert.equal(observed.headers['x-test'], 'present');
  c.advance(270000); assert.equal(observed.signal.aborted, true); c.budget.close();
});
for (const stage of ['auth', 'body', 'action']) await check(`${stage} stall returns one sanitized recoverable reply`, async () => {
  const c = executionClock(), stalled = deferred(), res = response(); let adminCalls = 0;
  const handler = createCourseImageHandler({ execution: () => c.budget,
    authenticate: async (_req, options) => { assert.equal(options.fetcher, c.budget.fetch); if (stage === 'auth') await stalled.promise; return { user: { id: randomUUID() } }; },
    admin: options => { adminCalls++; assert.equal(options.fetcher, c.budget.fetch); return { from: () => ({ select() { return this; }, eq() { return this; }, maybeSingle: () => stalled.promise }) }; },
  });
  const req = { method: stage === 'body' ? 'POST' : 'GET', headers: {}, url: `/api/courses/images?courseId=test&operationId=${randomUUID()}`,
    async *[Symbol.asyncIterator]() { await stalled.promise; yield Buffer.from('{}'); } };
  const work = handler(req, res); await flush(); c.advance(25000); await work;
  assert.equal(res.code, 503); assert.equal(res.body.code, 'unavailable'); assert.match(res.body.error, /same attempt/);
  assert.equal(res.headers['Cache-Control'], 'private, no-store'); assert.equal(c.timers.size, 0);
  stalled.resolve({ data: null, error: null }); await flush(); assert.equal(res.sends, 1);
  if (stage !== 'action') assert.equal(adminCalls, 0);
});
await check('real authentication rejection remains 401 and cleans up timers', async () => {
  const c = executionClock(), res = response();
  await createCourseImageHandler({ execution: () => c.budget, authenticate: async () => { throw Error('private detail'); } })({ method: 'GET', headers: {}, url: '/api/courses/images' }, res);
  assert.equal(res.code, 401); assert.doesNotMatch(JSON.stringify(res.body), /private detail/); assert.equal(c.timers.size, 0);
});
await check('202 hands the remaining budget to background, not a new invocation or premature close', async () => {
  const c = executionClock(), res = response(), pending = deferred(), owner = randomUUID(), operationId = randomUUID(), messages = [];
  let courseReads = 0, background;
  const row = { id: operationId, owner_id: owner, course_id: 'test', is_current: true,
    payload: { status: 'queued', expiresAt: Date.now() + 300000, quote: {}, target: {}, baseHash: 'unneeded' } };
  const client = { from: table => ({ select() { return this; }, eq() { return this; },
    async maybeSingle() { if (table === 'course_image_requests') return { data: row }; if (++courseReads === 1) return { data: null }; return pending.promise; },
  }) };
  const handler = createCourseImageHandler({ execution: () => c.budget, authenticate: async () => ({ user: { id: owner } }), admin: () => client,
    enabled: () => true, background: promise => { background = promise; }, report: message => messages.push(message) });
  await handler({ method: 'POST', headers: {}, url: '/api/courses/images', body: { action: 'resume', courseId: 'test', operationId } }, res);
  assert.equal(res.code, 202); assert.equal(c.budget.signal.aborted, false); assert.ok(background);
  await flush(); c.advance(270000); await background;
  assert.deepEqual(messages, ['request-unconfirmed']); assert.equal(c.timers.size, 0);
  pending.resolve({ data: null }); await flush(); assert.equal(res.sends, 1);
});

// Import with isolated fake configuration. The injected fetch never uses network.
await check('Supabase Auth, REST and Storage all use the supplied bounded transport', async () => {
  process.env.SUPABASE_URL = 'https://not-contacted.invalid'; process.env.SUPABASE_ANON_KEY = 'test-anon'; process.env.SUPABASE_SECRET_KEY = 'test-secret';
  const { userFromRequest, serviceClient } = await import('../web/api/_lib/supabase-server.mjs?budget-transport-test');
  const paths = [], c = executionClock({ fetcher: async (input, init) => {
    const path = new URL(input).pathname; paths.push(path); assert.ok(init.signal);
    const data = path.includes('/auth/') ? { id: randomUUID(), aud: 'authenticated' } : path.includes('/storage/') ? { Key: 'test/path' } : [];
    return new Response(JSON.stringify(data), { status: 200, headers: { 'content-type': 'application/json' } });
  } });
  await userFromRequest({ headers: { authorization: 'Bearer test-only' } }, { fetcher: c.budget.fetch });
  const client = serviceClient({ fetcher: c.budget.fetch });
  assert.equal((await client.from('course_image_requests').select('*')).error, null);
  assert.equal((await client.storage.from('course-images').upload('test/path', new Uint8Array([1]))).error, null);
  assert.ok(paths.some(path => path.startsWith('/auth/'))); assert.ok(paths.some(path => path.startsWith('/rest/'))); assert.ok(paths.some(path => path.startsWith('/storage/')));
  c.budget.close();
});
console.log(`Image execution budget: ${checks} contracts passed; synthetic clocks/transports only, no paid calls.`);
