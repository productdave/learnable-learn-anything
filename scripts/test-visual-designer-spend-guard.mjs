// Source-only, synthetic text-provider/ledger IO. No grants, hosted requests,
// frozen packages, live identities or real credentials are read or changed.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createClient, requestReservation, MODEL, STAGING_URL, PROFILE } from './staging-safeguard/client.mjs';
import { createManualAwareTextClient } from './staging-manual-testing/policy.mjs';
import { runCourseVisualReview, runLessonVisualDesign } from '../web/js/generator/stages/visual-design.mjs';
import { assembleCourse } from '../web/js/generator/assemble-course.js';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';

const ownerId = '11111111-1111-4111-8111-111111111111', runId = '22222222-2222-4222-8222-222222222222';
const jobId = 'job-33333333-3333-4333-8333-333333333333';
const response = (name, input) => ({ model: MODEL, stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 10 }, content: [{ type: 'tool_use', name, input }] });
const brief = { ...curriculumFixture(), materials_policy: 'integrated-visuals-v2', visual_designer_policy: 'learner-experience-v1', components: ['lessons', 'images'] };
const course = { ...assembleCourse(brief, brief.modules.flatMap(mod => mod.topics.map(topic => ({ moduleId: mod.id, topicId: topic.id, content: lessonFixture(brief.components, topic) })))), _brief: brief };
const review = { summary: 'Explain light direction before asking the learner to compare photographs.', guidance: ['Keep the explanations concrete and concise.'], flags: [],
  lessons: brief.modules.flatMap(mod => mod.topics.map(topic => ({ moduleId: mod.id, topicId: topic.id, guidance: ['Explain the example plainly.'], flags: [] }))) };
const design = { summary: 'The current explanation is clear enough for this first draft.', edits: [], flags: [], alignment: { quizAnswersPreserved: true, checksMatchTeaching: true },
  visual: { decision: 'omit', reason: 'The worked example explains this relationship without needing another image.' } };
const target = { moduleId: 'foundations', topicId: 'lesson-1' };
const requests = [];
const capture = { messages: { create: async request => { requests.push(request); return response(request.tool_choice.name, requests.length === 1 ? review : design); } } };
await runCourseVisualReview(capture, course, { model: MODEL });
await runLessonVisualDesign(capture, course, target, review, { model: MODEL });

function fixture({ cap = 5000000, approved = true, manual = false, manualEnabled = false, uncertain = false, output } = {}) {
  const state = { events: [], reservations: [], actuals: [], charged: 0, pending: null, halted: false, dispatches: 0, classifications: [] };
  const supabase = { async rpc(name, args) {
    state.events.push(name);
    if (name === 'learnable_staging_manual_test_scope') {
      assert.equal(args.p_owner_id, ownerId); assert.equal(args.p_kind, 'text'); assert.equal(args.p_scope_id, jobId);
      state.classifications.push({ ...args }); return { data: { manual } };
    }
    assert.equal(args.p_owner_id, ownerId); assert.equal(args.p_job_id, jobId); assert.equal(args.p_run_id, runId);
    if (name === 'reserve_learnable_staging_spend') {
      assert.equal(args.p_profile, PROFILE);
      const reason = !approved ? 'approval' : state.pending || state.halted ? 'pending' : args.p_reserved_microusd > cap - state.charged ? 'budget' : null;
      if (reason) return { data: { ok: false, reason } };
      state.pending = args; state.reservations.push(args.p_reserved_microusd); state.charged += args.p_reserved_microusd;
      return { data: { ok: true } };
    }
    if (name === 'halt_learnable_staging_spend') { state.halted = true; return { data: { ok: true } }; }
    assert.equal(name, 'settle_learnable_staging_spend'); assert.equal(args.p_request_id, state.pending.p_request_id);
    state.actuals.push(args.p_actual_microusd); state.charged -= state.pending.p_reserved_microusd - args.p_actual_microusd; state.pending = null;
    return { data: { ok: true } };
  } };
  const options = { apiKey: 'synthetic-only', supabase, ownerId, runId, jobId,
    env: { SUPABASE_URL: STAGING_URL, LEARNABLE_SETUP_GENERATION: '1', ...(manualEnabled ? { LEARNABLE_MANUAL_TESTING: '1', LEARNABLE_MANUAL_TESTING_OWNER_ID: ownerId, LEARNABLE_GENERATION_ORIGIN: 'https://learnable-staging.vercel.app' } : {}) },
    fetcher: async (url, options) => {
      assert.equal(url, 'https://api.anthropic.com/v1/messages');
      if (!manual || !manualEnabled) assert.ok(state.pending, 'Reserve the whole worst-case request before provider dispatch');
      state.dispatches++; state.events.push('provider');
      if (uncertain) throw new Error('Synthetic transport uncertainty');
      const request = JSON.parse(options.body), name = request.tool_choice.name;
      return { ok: true, headers: new Headers(), json: async () => response(name, output || (name === 'submit_course_visual_review' ? review : design)) };
    } };
  return { state, options, client: manualEnabled ? createManualAwareTextClient(options, createClient) : createClient(options) };
}

test('actual review/refinement request contracts fit the reviewed guard with unchanged conservative reservation math', () => {
  for (const [index, request] of requests.entries()) {
    const reservation = requestReservation(request);
    assert.deepEqual(reservation.body, request); assert.equal(reservation.searches, 0); assert.equal(reservation.inputTokens, 200000);
    assert.equal(reservation.outputTokens, index === 0 ? 12000 : 16000); assert.equal(reservation.microusd, index === 0 ? 780000 : 840000);
    assert.equal(request.tools.length, 1);
  }
});

test('both new calls reserve before dispatch and settle against the same whole-run allowance', async () => {
  const f = fixture();
  for (const request of requests) await f.client.messages.create(request);
  assert.deepEqual(f.state.reservations, [780000, 840000]); assert.deepEqual(f.state.actuals, [450, 450]);
  assert.equal(f.state.charged, 900); assert.equal(f.state.pending, null);
  assert.deepEqual(f.state.events, ['reserve_learnable_staging_spend', 'provider', 'settle_learnable_staging_spend', 'reserve_learnable_staging_spend', 'provider', 'settle_learnable_staging_spend']);
});

test('missing approval and a one-microdollar reservation shortfall deny both new calls before dispatch', async () => {
  for (const request of requests) for (const options of [{ approved: false }, { cap: requestReservation(request).microusd - 1 }]) {
    const f = fixture(options); await assert.rejects(f.client.messages.create(request), /budget|cover the next AI request/);
    assert.equal(f.state.dispatches, 0); assert.equal(f.state.charged, 0);
  }
});

test('new tools do not permit search, a second client tool, hidden caching or a higher output ceiling', async () => {
  for (const request of requests) for (const invalid of [
    { ...request, tools: [...request.tools, { type: 'web_search_20250305', name: 'web_search', max_uses: 1 }] },
    { ...request, tools: [...request.tools, requests[0].tools[0]] },
    { ...request, max_tokens: 16385 }, { ...request, thinking: { type: 'enabled' } },
    { ...request, messages: [{ role: 'user', content: [{ type: 'text', text: 'Do not cache this.', cache_control: { type: 'ephemeral' } }] }] }
  ]) {
    const f = fixture(); await assert.rejects(f.client.messages.create(invalid));
    assert.equal(f.state.dispatches, 0); assert.deepEqual(f.state.events, []);
  }
});

test('uncertain review holds its full reservation and blocks refinement and a replacement invocation', async () => {
  const f = fixture({ uncertain: true });
  await assert.rejects(f.client.messages.create(requests[0]), /reservation is held/);
  assert.equal(f.state.charged, 780000); assert.equal(f.state.dispatches, 1); assert.equal(f.state.halted, true);
  await assert.rejects(f.client.messages.create(requests[1]));
  await assert.rejects(createClient(f.options).messages.create(requests[0]), /previous AI request/);
  assert.equal(f.state.dispatches, 1); assert.equal(f.state.charged, 780000);
});

test('invalid refinement, correction and final no-edit plan are separately reserved and accounted', async () => {
  const f = fixture({ output: { ...design, edits: 'malformed' } }); let usage = 0;
  await assert.rejects(runLessonVisualDesign(f.client, course, target, review, { model: MODEL, onUsage: () => usage++ }), { kind: 'visual_design' });
  assert.equal(usage, 3); assert.equal(f.state.dispatches, 3); assert.equal(f.state.charged, 1350); assert.equal(f.state.pending, null);
  assert.deepEqual(f.state.reservations, [840000, 840000, 840000]);
});

test('malformed-output correction cannot exceed remaining budget or start preserve-copy recovery', async () => {
  const f = fixture({ cap: 840000, output: { ...design, edits: 'malformed' } });
  await assert.rejects(runLessonVisualDesign(f.client, course, target, review, { model: MODEL }), /cover the next AI request/);
  assert.equal(f.state.dispatches, 1); assert.equal(f.state.charged, 450);
  assert.equal(f.state.pending, null);
});

test('preserve-copy planning is reserved separately and stops before dispatch if allowance is insufficient', async () => {
  const saved = structuredClone(course);
  saved.modules[1]['lesson-1'].sections[0].content = '<p>The result may vary. Original teaching stays here.</p>';
  const rejected = { ...design, edits: [{scope:'section',sectionIndex:0,field:'content',value:'<p>Rejected rewrite removes the qualification.</p>'}] };
  const f = fixture({ cap:840800, output:rejected }); let usage=0;
  await assert.rejects(runLessonVisualDesign(f.client,saved,target,review,{model:MODEL,onUsage:()=>usage++}),/cover the next AI request/);
  assert.equal(f.state.dispatches,2); assert.equal(usage,2);
  assert.equal(f.state.charged,900); assert.equal(f.state.pending,null);
});

test('manual-aware QA classification routes both new tools through the same unchanged paid guard', async () => {
  const f = fixture({ manualEnabled: true, manual: false });
  for (const request of requests) await f.client.messages.create(request);
  assert.equal(f.state.classifications.length, 2); assert.deepEqual(f.state.reservations, [780000, 840000]); assert.equal(f.state.charged, 900);
  assert.equal(f.state.dispatches, 2);
});

test('synthetic explicit-owner classification remains separate and cannot turn a QA scope into manual testing', async () => {
  const owner = fixture({ manualEnabled: true, manual: true });
  for (const request of requests) await owner.client.messages.create(request);
  assert.equal(owner.state.classifications.length, 2); assert.equal(owner.state.dispatches, 2); assert.deepEqual(owner.state.reservations, []);
  const qa = fixture({ manualEnabled: true, manual: false, approved: false });
  await assert.rejects(qa.client.messages.create(requests[0]), /approved test budget/);
  assert.equal(qa.state.classifications.length, 1); assert.equal(qa.state.dispatches, 0); assert.equal(qa.state.charged, 0);
});
