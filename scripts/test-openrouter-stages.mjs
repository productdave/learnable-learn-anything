// Real curriculum and lesson stages, synthetic gateway receipts; no network.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createOpenRouterClient } from '../web/api/_lib/openrouter-client.mjs';
import { createOpenRouterPolicy } from '../web/api/_lib/openrouter-policy.mjs';
import { runIntake } from '../web/js/generator/stages/intake.mjs';
import { runTopic } from '../web/js/generator/stages/topic.mjs';
import { courseBriefSchemaFor, topicContentSchemaFor } from '../web/js/generator/schema.mjs';
import { getTone } from '../web/js/generator/tones/conversational.mjs';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';

const now = Date.now();
const policy = createOpenRouterPolicy({ reviewedAt: new Date(now).toISOString(), validUntil: new Date(now + 3600000).toISOString(), now });
const components = ['lessons', 'practice', 'checklists', 'quizzes', 'flashcards'];
const brief = { ...curriculumFixture(), components };
const mod = brief.modules[0], topic = mod.topics[0];
const research = { key_concepts: ['Light'], examples: [], experts: [], misconceptions: [], sources: [], images: [] };
function harness(task, validateResult, makeOutput, { expiryOnReserve = false } = {}) {
  const requests = [], settled = [], holds = [], reservations = []; let clock = now;
  const route = policy.routes[task];
  const client = createOpenRouterClient({ apiKey: 'synthetic-test-only', policy, task, validateResult, now: () => clock,
    ledger: {
      async reserve(input) { reservations.push(input); if (expiryOnReserve) clock += 7200000; return { requestId: `request-${reservations.length}` }; },
      async settle(hold, receipt) { settled.push({ hold, receipt }); },
      async hold(hold) { holds.push(hold); }
    },
    fetcher: async (_, opts) => {
      const body = JSON.parse(opts.body); requests.push(body);
      const overrides = makeOutput(requests.length);
      if (overrides instanceof Error) throw overrides;
      return new Response(JSON.stringify({ id: `gen-local-${requests.length}`, provider: route.provider, model: route.model,
        usage: { prompt_tokens: 200, completion_tokens: 100, cost: 0.001 },
        choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(lessonFixture(components, topic)) } }],
        ...overrides }), { status: 200 });
    }
  });
  return { client, requests, settled, holds, reservations };
}

test('real curriculum stage accepts the frontier adapter and retains source context', async () => {
  const userBrief = { topic: 'Photography', source_text: 'Compare light and composition.', components };
  const h = harness('curriculum', v => courseBriefSchemaFor(userBrief).parse(v), () => ({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(curriculumFixture()) } }]
  }));
  const result = await runIntake(h.client, userBrief, { model: policy.routes.curriculum.model });
  assert.equal(result.title, curriculumFixture().title);
  assert.equal(result.source_text, userBrief.source_text);
  assert.equal(h.requests.length, 1); assert.equal(h.settled.length, 1);
  assert.equal(h.requests[0].response_format.json_schema.name, 'submit_course_brief');
});

async function lessonRun(output, options) {
  const h = harness('lesson', v => topicContentSchemaFor(brief, topic, { allowGeneratedAssets: false }).parse(v), output, options);
  const usage = [], logs = [], previous = console.error;
  console.error = (...args) => logs.push(args);
  try {
    const result = await runTopic(h.client, brief, mod, topic, research, getTone(), {
      model: policy.routes.lesson.model, onUsage: u => usage.push(u)
    });
    return { ...h, result, usage, logs };
  } catch (error) { return { ...h, error, usage, logs }; }
  finally { console.error = previous; }
}

test('real open-weight lesson stage preserves all selected components', async () => {
  const h = await lessonRun(() => ({}));
  assert.ifError(h.error); assert.deepEqual(h.result, lessonFixture(components, topic));
  assert.equal(h.requests.length, 1); assert.equal(h.usage.length, 1);
});

for (const [label, badChoice] of [
  ['schema failure', { finish_reason: 'stop', message: { content: '{"private":"REJECTED_OUTPUT_SENTINEL"}' } }],
  ['invalid JSON', { finish_reason: 'stop', message: { content: 'REJECTED_OUTPUT_SENTINEL' } }],
  ['truncation', { finish_reason: 'length', message: { content: '{}' } }]
]) test(`${label} uses only the existing second attempt and records both charges`, async () => {
  const h = await lessonRun(n => n === 1 ? { choices: [badChoice] } : {});
  assert.ifError(h.error); assert.equal(h.requests.length, 2); assert.equal(h.settled.length, 2); assert.equal(h.usage.length, 2);
  assert.notEqual(h.reservations[0].fingerprint, h.reservations[1].fingerprint);
  assert.ok(!JSON.stringify(h.requests[1]).includes('REJECTED_OUTPUT_SENTINEL'));
  assert.ok(!JSON.stringify(h.logs).includes('REJECTED_OUTPUT_SENTINEL'));
});

test('two invalid responses stop after two settled calls', async () => {
  const h = await lessonRun(() => ({ choices: [{ finish_reason: 'length', message: { content: '{}' } }] }));
  assert.ok(h.error); assert.equal(h.requests.length, 2); assert.equal(h.usage.length, 2);
});

test('a refusal is charged and stops without a corrective attempt', async () => {
  const h = await lessonRun(() => ({ choices: [{ finish_reason: 'stop', message: { refusal: 'Cannot comply.' } }] }));
  assert.ok(h.error); assert.equal(h.requests.length, 1); assert.equal(h.usage.length, 1); assert.equal(h.holds.length, 0);
});

for (const [name, output] of [
  ['lost transport', () => new Error('NETWORK_SENTINEL')],
  ['missing cost', () => ({ usage: { prompt_tokens: 200, completion_tokens: 100 } })]
]) test(`${name} sends no correction and retains its reservation`, async () => {
  const h = await lessonRun(output);
  assert.equal(h.error.code, 'uncertain'); assert.equal(h.requests.length, 1);
  assert.equal(h.settled.length, 0); assert.equal(h.holds.length, 1); assert.equal(h.usage.length, 0);
});

test('policy expiry during reservation stops before the paid dispatch', async () => {
  const h = await lessonRun(() => ({}), { expiryOnReserve: true });
  assert.ok(h.error); assert.equal(h.requests.length, 0); assert.equal(h.holds.length, 1);
});
