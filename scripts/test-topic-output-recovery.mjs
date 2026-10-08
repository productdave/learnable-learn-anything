// Offline behavioral checks against the real writer. No provider/network calls.
import assert from 'node:assert/strict';
import test from 'node:test';
import { pathToFileURL } from 'node:url';
import { createClient as createGuard, MODEL, STAGING_URL } from './staging-safeguard/client.mjs';
import { getTone } from '../web/js/generator/tones/conversational.mjs';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';

// Also exercise the immutable deployed writer without editing its release.
const { runTopic } = await import(process.env.LEARNABLE_TOPIC_UNDER_TEST
  ? pathToFileURL(process.env.LEARNABLE_TOPIC_UNDER_TEST).href
  : new URL('../web/js/generator/stages/topic.mjs', import.meta.url).href);
globalThis.fetch = async () => { throw new Error('Network disabled'); };
const components = ['lessons', 'practice', 'checklists', 'quizzes', 'flashcards'];
const brief = { ...curriculumFixture(), components };
const mod = brief.modules[0], topic = mod.topics[0];
const bundle = { key_concepts: [], examples: [], experts: [], misconceptions: [], sources: [], images: [] };
const lesson = () => lessonFixture(components, topic);
const response = (input, stop_reason = 'tool_use') => ({
  stop_reason, usage: { input_tokens: 100, output_tokens: 20 },
  content: [{ type: 'tool_use', name: 'submit_topic', input }]
});
async function execute(reply, opts = {}) {
  const requests = [], usage = [], logs = [];
  const oldError = console.error;
  console.error = (...args) => logs.push(args);
  try {
    const client = { messages: { create: async request => {
      requests.push(request);
      return reply(requests.length, request);
    } } };
    const result = await runTopic(client, brief, mod, topic, bundle, getTone(), {
      onUsage: (...args) => usage.push(args), ...opts
    });
    return { result, requests, usage, logs };
  } catch (error) { return { error, requests, usage, logs }; }
  finally { console.error = oldError; }
}

for (const [name, encode] of [
  ['native arrays', value => value],
  ['JSON strings', JSON.stringify],
  ['double-encoded JSON', value => JSON.stringify(JSON.stringify(value))],
  ['fenced JSON', value => '```json\n' + JSON.stringify(value) + '\n```'],
  ['fenced JSON inside a JSON string', value => JSON.stringify('```json\n' + JSON.stringify(value) + '\n```')]
]) test(`${name}: selected components recover without an extra call or content changes`, async () => {
  const original = lesson(), input = structuredClone(original);
  for (const section of input.sections) {
    for (const field of ['options', 'acceptable_answers', 'points', 'equipment', 'steps', 'regressions', 'progressions', 'safetyStops', 'readinessChecks', 'items']) {
      if (Array.isArray(section[field])) section[field] = encode(section[field]);
    }
  }
  input.sections = encode(input.sections); input.flashcards = encode(input.flashcards);
  const untouched = structuredClone(input);
  const run = await execute(() => response(input));
  assert.ifError(run.error);
  assert.deepEqual(run.result, original);
  assert.equal(run.requests.length, 1);
  assert.equal(run.usage.length, 1);
  assert.deepEqual(input, untouched, 'Normalization must not overwrite the provider response');
});

test('whole tool input can be a bounded JSON object string', async () => {
  const run = await execute(() => response(JSON.stringify(lesson())));
  assert.ifError(run.error); assert.deepEqual(run.result, lesson());
  assert.equal(run.requests.length, 1);
});

test('schema retry includes actionable field feedback, not the rejected lesson text', async () => {
  const rejected = lesson(); rejected.sections = 'PRIVATE_SENTINEL broken JSON';
  const run = await execute(n => response(n === 1 ? rejected : lesson()));
  assert.ifError(run.error); assert.equal(run.requests.length, 2); assert.equal(run.usage.length, 2);
  assert.match(run.requests[1].messages[0].content, /sections: Expected array, received string/);
  assert.ok(!JSON.stringify(run.requests[1]).includes('PRIVATE_SENTINEL'));
  assert.ok(!JSON.stringify(run.logs).includes('PRIVATE_SENTINEL'));
});

test('max_tokens never passes merely because the partial tool input happens to validate', async () => {
  const run = await execute(n => response(lesson(), n === 1 ? 'max_tokens' : 'tool_use'));
  assert.ifError(run.error); assert.equal(run.requests.length, 2);
  assert.match(run.requests[1].messages[0].content, /truncat|output limit/i);
});

test('two truncated replies fail with diagnostic shape and both usage records', async () => {
  const run = await execute(() => response(lesson(), 'max_tokens'));
  assert.ok(run.error); assert.equal(run.error.kind, 'truncated');
  assert.equal(run.error.attempts.length, 2); assert.equal(run.usage.length, 2);
  assert.equal(run.error.attempts[0].outputShape.stopReason, 'max_tokens');
  assert.equal(run.error.attempts[0].outputShape.sections.type, 'array');
});

for (const [name, malformed] of [
  ['truncated array', '[{"type":"concept"'],
  ['JavaScript expression', '(()=>{throw new Error("DO_NOT_EVALUATE")})()'],
  ['prose around JSON', 'Here is the JSON: ' + JSON.stringify(lesson().sections)],
  ['object instead of array', JSON.stringify({ sections: lesson().sections })],
  ['too many encoding layers', JSON.stringify(JSON.stringify(JSON.stringify(JSON.stringify(lesson().sections))))],
  ['oversized encoded field', JSON.stringify(lesson().sections) + ' '.repeat(256 * 1024)]
]) test(`${name}: fail closed, bounded to two replies and no invented content`, async () => {
  const input = lesson(); input.sections = malformed;
  const run = await execute(() => response(structuredClone(input)));
  assert.ok(run.error); assert.equal(run.requests.length, 2); assert.equal(run.error.kind, 'schema');
  assert.equal(run.error.attempts[0].outputShape.sections.type, 'string');
  assert.equal(run.error.attempts[0].outputShape.sections.length, malformed.length);
  assert.ok(!JSON.stringify(run.error.attempts).includes(malformed));
});

for (const [name, reply] of [
  ['no tool call', () => ({ stop_reason: 'end_turn', content: [{ type: 'text', text: 'PRIVATE_SENTINEL' }] })],
  ['wrong tool', () => ({ stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'another_tool', input: lesson() }] })]
]) test(`${name}: retry is bounded and does not echo raw text`, async () => {
  const run = await execute(reply);
  assert.ok(run.error); assert.equal(run.error.kind, 'tool'); assert.equal(run.requests.length, 2);
  assert.ok(!JSON.stringify([run.error.attempts, run.requests, run.logs]).includes('PRIVATE_SENTINEL'));
});

for (const [name, properties] of [
  ['rejected credentials', { status: 401, type: 'authentication_error' }],
  ['rate limit', { status: 429, type: 'rate_limit_error' }],
  ['network outcome unknown', { name: 'TypeError' }],
  ['closed spending grant', { name: 'StagingSpendError', code: 'approval' }],
  ['spending outcome uncertain', { name: 'StagingSpendError', code: 'uncertain' }]
]) test(`${name}: do not immediately replay a request without a returned lesson`, async () => {
  const original = Object.assign(new Error('Synthetic request failure'), properties);
  const run = await execute(() => { throw original; });
  assert.ok(run.error); assert.equal(run.requests.length, 1); assert.equal(run.usage.length, 0);
  assert.equal(run.error.attempts.length, 1);
  if (properties.code) assert.equal(run.error.code, properties.code);
});

test('valid selected-component validation remains enforced after decoding', async () => {
  const incomplete = lesson(); incomplete.sections = JSON.stringify(incomplete.sections.filter(s => s.type !== 'practice'));
  const run = await execute(() => response(structuredClone(incomplete)));
  assert.equal(run.error?.kind, 'schema'); assert.equal(run.requests.length, 2);
});

// HANDOFF-001: a returned invalid lesson followed by a denied correction must
// report the final stop, not imply that two provider outputs failed validation.
for (const [name, properties, message] of [
  ['request-count or dollar cap', { name: 'StagingSpendError', code: 'budget' }, 'This test cannot safely cover the next AI request. Your work is saved; review the test budget before continuing.'],
  ['safe invocation pause', { code: 'GENERATION_TIME_SLICE_COMPLETE' }, 'Generation paused before starting another AI request. Completed work is saved; resume from the checkpoint.'],
  ['uncertain provider charge', { name: 'StagingSpendError', code: 'uncertain' }, 'The AI result is uncertain. Its budget reservation is held and automatic spending is stopped.'],
  ['closed grant', { name: 'StagingSpendError', code: 'approval' }, 'This staging course does not have an active approved test budget. No AI request was sent.'],
  ['network failure', { name: 'TypeError' }, 'Connection interrupted; outcome unknown.']
]) test(`${name} after schema failure: final stop takes priority without another replay`, async () => {
  const invalid = lesson(); invalid.sections = 'PRIVATE_SENTINEL invalid JSON';
  const run = await execute(n => {
    if (n === 1) return response(invalid);
    throw Object.assign(new Error(message), properties);
  });
  assert.ok(run.error); assert.equal(run.requests.length, 2); assert.equal(run.usage.length, 1);
  assert.equal(run.error.message, `Stage 3 [${topic.id}]: ${message}`);
  assert.equal(run.error.kind, 'unknown');
  assert.equal(run.error.code, properties.code);
  assert.equal(run.error.attempts.length, 2);
  assert.equal(run.error.attempts[0].kind, 'schema', 'Earlier diagnostic stays available');
  assert.equal(run.error.attempts[1].message, message);
  assert.equal(run.error.attempts[1].outputShape, undefined, 'No provider reply was returned for correction');
  assert.ok(!JSON.stringify([run.error.attempts, run.logs, run.requests]).includes('PRIVATE_SENTINEL'));
});

test('a truncated correction is reported as truncated rather than an earlier schema failure', async () => {
  const invalid = lesson(); invalid.sections = 'invalid JSON';
  const run = await execute(n => response(n === 1 ? invalid : lesson(), n === 1 ? 'tool_use' : 'max_tokens'));
  assert.equal(run.requests.length, 2); assert.equal(run.usage.length, 2);
  assert.equal(run.error.kind, 'truncated');
  assert.match(run.error.message, /output was truncated/);
  assert.equal(run.error.attempts[0].kind, 'schema');
  assert.equal(run.error.attempts[1].kind, 'truncated');
});

test('real staging guard denies the ninth call and surfaces that stop after an invalid eighth reply', async () => {
  const state = { calls: 7, reservations: 0, dispatches: 0, settlements: 0, halts: 0 };
  const invalid = lesson(); invalid.sections = 'PRIVATE_SENTINEL invalid JSON';
  const guard = createGuard({
    apiKey: 'synthetic', ownerId: '11111111-1111-4111-8111-111111111111',
    jobId: 'job-33333333-3333-4333-8333-333333333333', runId: '22222222-2222-4222-8222-222222222222',
    env: { SUPABASE_URL: STAGING_URL, LEARNABLE_SETUP_GENERATION: '1' },
    supabase: { async rpc(name) {
      if (name === 'reserve_learnable_staging_spend') {
        state.reservations++;
        if (state.calls === 8) return { data: { ok: false, reason: 'budget' } };
        state.calls++; return { data: { ok: true } };
      }
      if (name === 'settle_learnable_staging_spend') { state.settlements++; return { data: { ok: true } }; }
      if (name === 'halt_learnable_staging_spend') { state.halts++; return { data: { ok: true } }; }
      throw Error('Unexpected ledger operation');
    } },
    fetcher: async () => {
      state.dispatches++;
      return { ok: true, headers: new Headers(), json: async () => ({ ...response(invalid), model: MODEL }) };
    }
  });
  const run = await execute((_n, request) => guard.messages.create(request), { model: MODEL });
  assert.equal(run.error?.code, 'budget');
  assert.match(run.error.message, /This test cannot safely cover the next AI request/);
  assert.doesNotMatch(run.error.message, /Schema mismatch/);
  assert.equal(run.error.attempts[0].kind, 'schema');
  assert.equal(run.usage.length, 1);
  assert.deepEqual(state, { calls: 8, reservations: 2, dispatches: 1, settlements: 1, halts: 0 });
});
