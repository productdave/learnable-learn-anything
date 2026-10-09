import assert from 'node:assert/strict';
import { test } from 'node:test';
import { z } from 'zod';
import { createOpenRouterPolicy, validateOpenRouterPolicy, openRouterRoute, quoteOpenRouterText } from '../web/api/_lib/openrouter-policy.mjs';
import { createOpenRouterClient, prepareOpenRouterText } from '../web/api/_lib/openrouter-client.mjs';
import { createAiSpendLedger } from '../web/api/_lib/ai-spend-ledger.mjs';

const now = Date.parse('2026-10-09T15:00:00Z');
const makePolicy = extra => createOpenRouterPolicy({ reviewedAt: '2026-10-09T14:00:00Z', validUntil: '2026-10-10T14:00:00Z', now, ...extra });
const policy = makePolicy(), route = openRouterRoute(policy, 'lesson', { now });
const schema = z.object({ title: z.string().min(1) }).strict();
const opts = () => ({ model: route.model, max_tokens: 1000, system: 'Write from supplied notes.',
  tools: [{ name: 'submit_topic', input_schema: { type: 'object', properties: { title: { type: 'string' } }, required: ['title'], additionalProperties: false } }],
  tool_choice: { type: 'tool', name: 'submit_topic' }, messages: [{ role: 'user', content: [{ type: 'text', text: 'A short useful lesson.' }] }] });
const result = () => ({ id: 'gen-test_1', model: route.model, provider: route.provider,
  usage: { prompt_tokens: 100, completion_tokens: 20, cost: 0.000054, completion_tokens_details: { reasoning_tokens: 0 } },
  choices: [{ finish_reason: 'stop', message: { content: '{"title":"A useful draft"}' } }] });
function fixture({ value = result(), response, reserve, settle, beforeDispatch, budget, validateResult = v => schema.parse(v) } = {}) {
  const events = [], holds = []; let fetches = 0;
  const ledger = {
    async reserve(r) { events.push('reserve'); if (reserve) return reserve(r); const h = { requestId: 'local', reservedMicrousd: r.reservedMicrousd }; holds.push(h); return h; },
    async settle(h, r) { events.push('settle'); h.actual = r.actualMicrousd; if (settle) await settle(h, r); },
    async hold() { events.push('hold'); }
  };
  const client = createOpenRouterClient({ apiKey: 'synthetic-key-not-a-credential', policy, task: 'lesson', ledger,
    validateResult, beforeDispatch, requestBudget: budget, now: () => now,
    fetcher: async (url, request) => { fetches++; events.push('fetch');
      assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions'); assert.equal(request.redirect, 'error');
      const body = JSON.parse(request.body); assert.equal(body.provider.allow_fallbacks, false);
      assert.deepEqual(body.provider.only, ['Parasail']); assert.equal(body.provider.require_parameters, true);
      assert.equal(body.response_format.json_schema.name, 'submit_topic');
      assert.equal(body.tool_choice, undefined); assert.equal(body.temperature, undefined);
      if (response) return response(); return new Response(JSON.stringify(value), { status: 200 });
    } });
  return { client, events, holds, fetches: () => fetches };
}

test('policy is immutable, task-specific, fingerprinted and price-window bounded', () => {
  assert.equal(policy.routes.curriculum.model, 'anthropic/claude-sonnet-5.5');
  assert.equal(policy.routes.visual_review.model, policy.routes.curriculum.model);
  assert.equal(policy.routes.visual_refinement.model, policy.routes.curriculum.model);
  assert.equal(policy.routes.lesson.model, 'deepseek/deepseek-v4.1-flash');
  assert.throws(() => { policy.routes.lesson.model = 'auto'; }, TypeError);
  assert.deepEqual(validateOpenRouterPolicy(JSON.parse(JSON.stringify(policy)), { now }), policy);
  const edited = structuredClone(policy); edited.routes.lesson.inputDollarsPerMillion = 0;
  assert.throws(() => validateOpenRouterPolicy(edited, { now }), /fingerprint/);
  assert.throws(() => validateOpenRouterPolicy(policy, { now: now + 86400000 }), /price window/);
  assert.throws(() => createOpenRouterPolicy(), /price window/);
  assert.throws(() => makePolicy({ lessonModel: 'openrouter/auto' }), /Unreviewed/);
  assert.equal(makePolicy({ lessonModel: 'qwen/qwen3.6-35b-a3b' }).routes.lesson.provider, 'Parasail');
});

test('reserves full input context plus requested output, rounding up', () => {
  assert.equal(quoteOpenRouterText(route, 1000), Math.ceil(1048576 * 0.3 + 1000 * 1.2));
  for (const n of [0, -1, 1.5, 16385, NaN]) assert.throws(() => quoteOpenRouterText(route, n));
});

test('builds fixed schema route and omits incompatible sampling', () => {
  const r = prepareOpenRouterText({ ...opts(), temperature: 0.3, top_p: 0.9 }, route);
  assert.equal(r.body.temperature, undefined); assert.equal(r.body.tools, undefined);
  assert.deepEqual(r.body.reasoning, { enabled: false });
  assert.equal(r.body.response_format.json_schema.strict, true);
  assert.match(r.fingerprint, /^[a-f0-9]{64}$/);
});

for (const [name, edit] of [
  ['a search tool', o => o.tools.push({ type: 'openrouter:web_search' })],
  ['PDF input', o => o.messages[0].content.push({ type: 'document', source: { data: 'synthetic' } })],
  ['automatic fallback', o => { o.models = ['other']; }],
  ['plugins', o => { o.plugins = [{ id: 'web' }]; }],
  ['different tool', o => { o.tools[0].name = 'other'; }],
  ['wrong model', o => { o.model = 'cheap-but-untested'; }],
  ['oversized source', o => { o.messages[0].content = 'a'.repeat(400001); }],
  ['cache control', o => { o.messages[0].content[0].cache_control = { type: 'ephemeral' }; }],
  ['unsupported role', o => { o.messages[0].role = 'developer'; }]
]) test(`rejects ${name} before reservation or dispatch`, async () => {
  const f = fixture(), o = opts(); edit(o);
  await assert.rejects(f.client.messages.create(o), e => e.code === 'unsupported');
  assert.deepEqual(f.events, []);
});

test('settles receipt before returning a validated named result', async () => {
  const f = fixture(); const out = await f.client.messages.create(opts());
  assert.deepEqual(f.events, ['reserve', 'fetch', 'settle']);
  assert.equal(out.content[0].name, 'submit_topic'); assert.deepEqual(out.content[0].input, { title: 'A useful draft' });
  assert.equal(out.usage.cost, 0.000054); assert.equal(f.holds[0].actual, 54);
});

for (const [name, edit] of [
  ['missing cost', r => { delete r.usage.cost; }],
  ['wrong model', r => { r.model = 'other'; }],
  ['wrong provider', r => { r.provider = 'Other'; }],
  ['excess cost', r => { r.usage.cost = 100; }],
  ['excess tokens', r => { r.usage.completion_tokens = 1001; }],
  ['missing generation ID', r => { r.id = ''; }],
  ['gateway error body', r => { r.error = { message: 'synthetic provider error' }; }]
]) test(`${name} holds funds and stops subsequent dispatch`, async () => {
  const r = result(); edit(r); const f = fixture({ value: r });
  await assert.rejects(f.client.messages.create(opts()), e => e.code === 'uncertain');
  await assert.rejects(f.client.messages.create(opts()));
  assert.equal(f.fetches(), 1); assert.deepEqual(f.events, ['reserve', 'fetch', 'hold']);
});

for (const [name, edit] of [
  ['truncation', r => { r.choices[0].finish_reason = 'length'; }],
  ['refusal', r => { r.choices[0].message.refusal = 'Cannot comply'; }],
  ['invalid JSON', r => { r.choices[0].message.content = '```json'; }],
  ['invalid schema', r => { r.choices[0].message.content = '{"title":4}'; }],
  ['unexpected tool call', r => { r.choices[0].message.tool_calls = [{ function: { name: 'other' } }]; }]
]) test(`${name} remains paid but does not return course data or retry`, async () => {
  const r = result(); edit(r); const f = fixture({ value: r });
  await assert.rejects(f.client.messages.create(opts()), e => e.code === 'invalid_output');
  assert.deepEqual(f.events, ['reserve', 'fetch', 'settle']); assert.equal(f.fetches(), 1);
});

test('unknown HTTP/network/settlement outcomes never silently refund or retry', async () => {
  for (const args of [{ response: () => new Response('secret-looking provider body', { status: 500 }) },
    { response: () => { throw new Error('network details'); } }, { settle: () => { throw new Error('lost commit reply'); } }]) {
    const f = fixture(args); await assert.rejects(f.client.messages.create(opts()), e => !e.message.includes('secret-looking') && !e.message.includes('network details'));
    await assert.rejects(f.client.messages.create(opts())); assert.equal(f.fetches(), 1); assert.equal(f.events.at(-1), 'hold');
  }
});

test('lease loss after reservation sends zero provider requests and retains hold', async () => {
  let reads = 0; const f = fixture({ beforeDispatch: () => { if (++reads === 2) throw new Error('cancelled'); } });
  await assert.rejects(f.client.messages.create(opts())); assert.equal(f.fetches(), 0); assert.deepEqual(f.events, ['reserve', 'hold']);
});

test('reservation denial or lost reservation reply sends zero requests', async () => {
  const f = fixture({ reserve: () => { throw new Error('unknown database commit'); } });
  await assert.rejects(f.client.messages.create(opts())); await assert.rejects(f.client.messages.create(opts()));
  assert.equal(f.fetches(), 0); assert.deepEqual(f.events, ['reserve']);
});

test('oversized receipt stays held before parsing an unbounded response', async () => {
  for (const response of [() => new Response('{}', { headers: { 'content-length': '5000000' } }),
    () => new Response('a'.repeat(4 * 1024 * 1024 + 1))]) {
    const f = fixture({ response });
    await assert.rejects(f.client.messages.create(opts()), e => e.code === 'uncertain');
    assert.equal(f.fetches(), 1); assert.equal(f.events.at(-1), 'hold');
  }
});

test('another call waiting on reservation cannot dispatch after a sibling becomes uncertain', async () => {
  let release, started; const entered = new Promise(r => { started = r; });
  let calls = 0;
  const f = fixture({ reserve: async r => {
    if (++calls === 1) { started(); await new Promise(resolve => { release = resolve; }); }
    return { requestId: `reservation-${calls}`, reservedMicrousd: r.reservedMicrousd };
  }, response: () => { throw new Error('lost outcome'); } });
  const waiting = f.client.messages.create(opts());
  const stopped = assert.rejects(waiting, e => e.code === 'uncertain');
  await entered;
  await assert.rejects(f.client.messages.create(opts()), e => e.code === 'uncertain');
  release(); await stopped;
  assert.equal(f.fetches(), 1);
  assert.equal(f.events.filter(x => x === 'hold').length, 2);
});

test('ledger uses scoped RPCs and does not manufacture allowance/refund', async () => {
  const calls = []; const ledger = createAiSpendLedger({ ownerId: 'owner', jobId: 'job', runId: 'run', policyHash: 'a'.repeat(64),
    supabase: { rpc: async (name, args) => { calls.push({ name, args }); return { data: { ok: true } }; } } });
  const hold = await ledger.reserve({ operationKey: 'lesson:one', fingerprint: 'b'.repeat(64), reservedMicrousd: 10, model: route.model, task: 'lesson' });
  await ledger.settle(hold, { actualMicrousd: 2, providerRequestId: 'gen-test', usage: {} }); await ledger.hold(hold);
  assert.deepEqual(calls.map(x => x.name), ['reserve_learnable_ai_spend', 'settle_learnable_ai_spend', 'halt_learnable_ai_spend']);
  assert.ok(calls.every(x => x.args.p_owner_id === 'owner' && x.args.p_job_id === 'job' && x.args.p_run_id === 'run'));
  assert.equal(calls[0].args.p_budget_ids, undefined);
});
