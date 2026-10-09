// Saved-state orchestration: synthetic model and database only, never network.
import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';
import { assembleCourse } from '../web/js/generator/assemble-course.js';
import { creationBrief, retainComponentChoices } from '../web/js/generator/component-policy.mjs';
import { runVisualDesigner, designContentHash, assertDesignComplete } from '../web/api/_lib/visual-designer.mjs';
import { GENERATION_PAUSE as GENERATION_TIME_SLICE_COMPLETE } from '../web/api/_lib/gen-request-budget.mjs';

const clone = value => structuredClone(value);
function fixture() {
  const brief = retainComponentChoices(curriculumFixture(), creationBrief({ components: ['lessons', 'quizzes', 'checklists', 'flashcards'] }));
  const course = { ...assembleCourse(brief, brief.modules.flatMap(mod => mod.topics.map(topic => ({ moduleId: mod.id, topicId: topic.id, content: lessonFixture(brief.components, topic) })))),
    _brief: brief, _generationJobId: 'job-test-design', _courseRevision: randomUUID() };
  const state = { row: { payload: course, updated_at: new Date().toISOString() }, calls: [], writes: [], patches: [],
    writable: true, budgetChecks: 0, loseAck: null, afterCommit: null, afterCall: null, beforeCall: null, conflict: false };
  const args = { ownerId: randomUUID(), jobId: course._generationJobId, runId: randomUUID(), courseId: course.config.id,
    client: {}, model: 'synthetic', requestBudget: { assertCanStart() { state.budgetChecks++; } },
    async assertRunnerWritable() { if (!state.writable) throw new Error('lease lost'); },
    async patch(value) { state.patches.push(clone(value)); },
    supabase: {
      from(table) { assert.equal(table, 'user_courses'); return { select() { return this; }, eq() { return this; }, async maybeSingle() { return { data: clone(state.row) }; } }; },
      async rpc(name, params) {
        assert.equal(name, 'commit_generation_design');
        assert.equal(params.p_owner, args.ownerId); assert.equal(params.p_run, args.runId);
        assert.equal(params.p_job, args.jobId); assert.equal(params.p_course, args.courseId);
        if (state.conflict || state.row.payload._courseRevision !== params.p_revision || state.row.updated_at !== params.p_updated_at) return { data: { error: 'conflict' } };
        assert.ok(state.writable);
        const payload = { ...clone(params.p_payload), _courseRevision: randomUUID() }, updatedAt = new Date(Date.parse(state.row.updated_at) + 1).toISOString();
        state.row = { payload, updated_at: updatedAt }; state.writes.push(clone(payload._visualDesign));
        state.afterCommit?.(payload);
        if (state.loseAck?.(payload)) return { error: { message: 'synthetic lost acknowledgement' } };
        return { data: { saved: true, payload: clone(payload), updatedAt } };
      }
    },
    async review(_client, input, opts) {
      await called('course', opts);
      return { summary: 'Use short, concrete explanations.', guidance: ['Explain before assessing.'], flags: [],
        lessons: input.curriculum.modules.flatMap(mod => mod.topics.map(topic => ({ moduleId: mod.id, topicId: topic.id, guidance: [], flags: [] }))) };
    },
    async refine(_client, input, target, _review, opts) {
      await called(target.topicId, opts);
      const lesson = clone(input.modules[1][target.topicId]);
      lesson.sections[0].content = '<p>Notice where the window light falls. Move your camera and compare the shadows.</p>';
      lesson.visual = { decision: 'omit', reason: 'The short explanation is enough for this lesson.' };
      return { lesson, flags: ['Check this example against your own context.'], summary: 'Shortened the explanation.', changed: true };
    }
  };
  async function called(key, opts) {
    assert.equal(state.row.payload._visualDesign.pending.status, 'started', 'intent saved before dispatch');
    state.beforeCall?.(key);
    state.calls.push(key);
    opts.onUsage({ input_tokens: 40, output_tokens: 20 }, { task: 'lesson', operation: key === 'course' ? 'course_review' : 'lesson_refinement' });
    await state.afterCall?.(key);
  }
  return { state, args, run: extras => runVisualDesigner({ ...args, ...extras }) };
}

test('review then each refinement commits before images; complete rerun does no paid work', async () => {
  const f = fixture(), before = clone(f.state.row.payload);
  const result = await f.run();
  assert.deepEqual(f.state.calls, ['course', 'lesson-1', 'lesson-2', 'lesson-3']);
  assert.equal(result.progress.completed, 3); assert.equal(result.progress.status, 'complete');
  assert.equal(f.state.row.payload._visualDesign.usage.total.calls, 4);
  assert.equal(f.state.row.payload._visualDesign.usage.total.totalTokens, 240);
  assert.equal(f.state.row.payload._tokenUsage.total.totalTokens, 240, 'existing course usage display includes known designer tokens');
  assert.deepEqual(f.state.row.payload._visualDesign.usage.calls.map(call => call.task), ['visual_review', 'visual_refinement', 'visual_refinement', 'visual_refinement']);
  assert.deepEqual(f.state.row.payload.modules[1]['lesson-1'].sections.filter(s => s.type === 'quiz'), before.modules[1]['lesson-1'].sections.filter(s => s.type === 'quiz'));
  const saved = clone(f.state.row), writes = f.state.writes.length;
  await f.run({ client: null });
  assert.equal(f.state.writes.length, writes); assert.equal(f.state.calls.length, 4); assert.deepEqual(f.state.row, saved);
});

test('safe scheduling pause preserves completed steps and resumes without repeating review', async () => {
  const f = fixture();
  f.args.requestBudget.assertCanStart = () => { if (++f.state.budgetChecks === 3) throw Object.assign(new Error('pause'), { code: GENERATION_TIME_SLICE_COMPLETE }); };
  await assert.rejects(f.run(), { code: GENERATION_TIME_SLICE_COMPLETE });
  assert.deepEqual(f.state.calls, ['course', 'lesson-1']); assert.equal(f.state.row.payload._visualDesign.pending, null);
  f.args.requestBudget.assertCanStart = () => {};
  await f.run(); assert.deepEqual(f.state.calls, ['course', 'lesson-1', 'lesson-2', 'lesson-3']);
});

test('pre-dispatch pause after saved intent clears only that intent', async () => {
  const f = fixture(); f.state.beforeCall = key => { if (key === 'lesson-1') throw Object.assign(new Error('pause'), { code: GENERATION_TIME_SLICE_COMPLETE }); };
  await assert.rejects(f.run(), { code: GENERATION_TIME_SLICE_COMPLETE });
  assert.equal(f.state.row.payload._visualDesign.pending, null); assert.deepEqual(f.state.calls, ['course']);
  f.state.beforeCall = null; await f.run(); assert.equal(f.state.calls.length, 4);
});

test('invalid returned output retains token usage and requires explicit retry of only failed step', async () => {
  const f = fixture(); f.state.afterCall = key => { if (key === 'lesson-2') throw Object.assign(new Error('bad output'), { kind: 'visual_design' }); };
  await assert.rejects(f.run(), { code: 'VISUAL_DESIGN_FAILED' });
  assert.equal(f.state.row.payload._visualDesign.pending.status, 'failed');
  assert.equal(f.state.row.payload._visualDesign.usage.total.calls, 3);
  assert.equal(f.state.row.payload._visualDesign.lastFailure.operation, 'lesson_refinement');
  const previousFailure = clone(f.state.row.payload._visualDesign.lastFailure);
  await assert.rejects(f.run(), { code: 'VISUAL_DESIGN_UNCERTAIN' }); assert.equal(f.state.calls.length, 3);
  f.state.afterCall = null; await f.run({ retryFailedDesign: true });
  assert.deepEqual(f.state.calls, ['course', 'lesson-1', 'lesson-2', 'lesson-2', 'lesson-3']);
  assert.equal(f.state.row.payload._visualDesign.usage.total.calls, 5);
  assert.equal(f.state.row.payload._tokenUsage.total.calls, 5);
  assert.deepEqual(f.state.row.payload._visualDesign.lastFailure, previousFailure, 'retry retains the last failed operation for diagnosis');
});

test('same-job Resume saves bounded reasons without repeating accepted lessons or review', async () => {
  const f = fixture(); f.state.afterCall = key => { if (key === 'lesson-2') throw Object.assign(new Error('rejected output'), { kind: 'visual_design' }); };
  await assert.rejects(f.run(), { code: 'VISUAL_DESIGN_FAILED' });
  const accepted = clone(f.state.row.payload.modules[1]['lesson-1']);
  const review = clone(f.state.row.payload._visualDesign.review);
  const item = clone(f.state.row.payload._visualDesign.items['foundations/lesson-1']);
  const courseId = f.state.row.payload.config.id, jobId = f.state.row.payload._generationJobId, targets = [];
  const client = { messages: { create: async request => {
    const input = JSON.parse(request.messages[0].content); targets.push(input.target.topicId);
    return { usage: { input_tokens: 50, output_tokens: 20 }, stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_lesson_visual_design', input: {
      summary: 'Keep the saved explanation.', edits: [], flags: [], alignment: { quizAnswersPreserved: true, checksMatchTeaching: true },
      visual: { decision: 'omit', reason: 'The complete explanation teaches this relationship without adding a decorative illustration. '.repeat(15) }
    } }] };
  } } };
  f.state.afterCall = null;
  const result = await f.run({ refine: undefined, client, retryFailedDesign: true });
  assert.deepEqual(targets, ['lesson-2', 'lesson-3']);
  assert.deepEqual(f.state.row.payload.modules[1]['lesson-1'], accepted);
  assert.deepEqual(f.state.row.payload._visualDesign.review, review);
  assert.deepEqual(f.state.row.payload._visualDesign.items['foundations/lesson-1'], item);
  assert.equal(f.state.row.payload.config.id, courseId); assert.equal(f.state.row.payload._generationJobId, jobId);
  assert.equal(result.progress.completed, 3); assert.equal(result.progress.status, 'complete');
  assert.equal(f.state.row.payload._visualDesign.usage.total.calls, 5);
  assert.equal(f.state.row.payload._visualDesign.pending, null);
  assert.match(f.state.row.payload.modules[1]['lesson-2'].visual.reason, /\[shortened\]$/);
  assertDesignComplete(f.state.row.payload);
  await f.run({ client: null }); assert.equal(targets.length, 2);
});

test('unconfirmed transport never silently dispatches a replacement, even with Resume', async () => {
  const f = fixture(); const error = new Error('lost network');
  await assert.rejects(f.run({ review: async () => { f.state.calls.push('transport'); throw error; } }), { code: 'VISUAL_DESIGN_UNCERTAIN' });
  assert.equal(f.state.row.payload._visualDesign.pending.status, 'unknown');
  assert.equal(f.state.row.payload._visualDesign.lastFailure.responseReceived, false);
  await assert.rejects(f.run({ retryFailedDesign: true }), { code: 'VISUAL_DESIGN_UNCERTAIN' });
  assert.deepEqual(f.state.calls, ['transport']);
});

test('lost intent acknowledgement dispatches nothing and saved started intent is held', async () => {
  const f = fixture(); f.state.loseAck = payload => payload._visualDesign.pending?.status === 'started';
  await assert.rejects(f.run(), /save could not be confirmed/); assert.equal(f.state.calls.length, 0);
  f.state.loseAck = null;
  await assert.rejects(f.run({ retryFailedDesign: true }), { code: 'VISUAL_DESIGN_UNCERTAIN' }); assert.equal(f.state.calls.length, 0);
});

test('lost result acknowledgement is reconciled by rereading without repeating model call', async () => {
  const f = fixture(); f.state.loseAck = payload => !!payload._visualDesign.items['foundations/lesson-1'];
  await assert.rejects(f.run(), /save could not be confirmed/);
  assert.deepEqual(f.state.calls, ['course', 'lesson-1']);
  f.state.loseAck = null; await f.run(); assert.deepEqual(f.state.calls, ['course', 'lesson-1', 'lesson-2', 'lesson-3']);
});

test('cancellation after provider result cannot apply stale edits or repeat an uncertain call', async () => {
  const f = fixture(), before = clone(f.state.row.payload.modules);
  f.state.afterCall = () => { f.state.writable = false; };
  await assert.rejects(f.run(), /lease lost/); assert.deepEqual(f.state.row.payload.modules, before);
  f.state.writable = true; f.state.afterCall = null;
  await assert.rejects(f.run({ retryFailedDesign: true }), { code: 'VISUAL_DESIGN_UNCERTAIN' }); assert.equal(f.state.calls.length, 1);
});

test('concurrent creator edit wins CAS; no generated overwrite', async () => {
  const f = fixture(); f.state.afterCall = key => {
    if (key === 'lesson-1') { f.state.row.payload.modules[1]['lesson-1'].title = 'My own latest title'; f.state.row.payload._courseRevision = randomUUID(); }
  };
  await assert.rejects(f.run(), { code: 'VISUAL_DESIGN_CONFLICT' });
  assert.equal(f.state.row.payload.modules[1]['lesson-1'].title, 'My own latest title');
  f.state.afterCall = null; await assert.rejects(f.run(), { code: 'VISUAL_DESIGN_CONFLICT' }); assert.equal(f.state.calls.length, 2);
});

test('saved generated images do not invalidate refined text; actual teaching changes do', async () => {
  const f = fixture(); await f.run(); const course = f.state.row.payload, hash = designContentHash(course);
  course.modules[1]['lesson-1'].sections.splice(1, 0, { type: 'image', generated_by: 'openai', image_slot: 'instruction', asset_id: randomUUID(), alt: 'Light diagram' });
  assert.equal(designContentHash(course), hash); assertDesignComplete(course);
  course.modules[1]['lesson-1'].sections[0].content = '<p>Changed content</p>';
  assert.throws(() => assertDesignComplete(course), { code: 'VISUAL_DESIGN_INCOMPLETE' });
});

test('legacy, missing lesson, wrong job and existing generated asset fail without model calls', async () => {
  for (const mutate of [
    course => { delete course._brief.visual_designer_policy; },
    course => { delete course.modules[1]['lesson-2']; },
    course => { course._generationJobId = 'other'; },
    course => { course.modules[1]['lesson-1'].sections.push({ type: 'image', generated_by: 'openai', asset_id: randomUUID() }); }
  ]) {
    const f = fixture(); mutate(f.state.row.payload); await assert.rejects(f.run()); assert.equal(f.state.calls.length, 0); assert.equal(f.state.writes.length, 0);
  }
});

test('metadata capacity is checked before any further provider request', async () => {
  const f = fixture();
  f.args.requestBudget.assertCanStart = () => { if (++f.state.budgetChecks === 2) throw Object.assign(new Error('pause'), { code: GENERATION_TIME_SLICE_COMPLETE }); };
  await assert.rejects(f.run(), { code: GENERATION_TIME_SLICE_COMPLETE });
  f.state.row.payload._visualDesign.review.summary = 'x'.repeat(124000);
  f.args.requestBudget.assertCanStart = () => {};
  await assert.rejects(f.run(), { code: 'VISUAL_DESIGN_CAPACITY' });
  assert.deepEqual(f.state.calls, ['course']); assert.equal(f.state.row.payload._visualDesign.pending, null);
});

test('48-lesson audit remains under DB metadata bounds with useful saved review notes', async () => {
  const f = fixture(), course = f.state.row.payload, mod = course.curriculum.modules[0];
  for (let index = 4; index <= 48; index++) {
    const id = `lesson-${index}`, title = `Photography lesson ${index}`;
    mod.topics.push({ ...clone(mod.topics[0]), id, title });
    course.modules[1][id] = { ...clone(course.modules[1]['lesson-1']), id, title };
  }
  const result = await f.run();
  assert.equal(result.progress.completed, 48); assert.equal(f.state.calls.length, 49);
  assert.ok(Buffer.byteLength(JSON.stringify(f.state.row.payload._visualDesign)) < 124000);
});

test('HTTP timeout without returned usage remains uncertain rather than retry safe', async () => {
  const f = fixture();
  await assert.rejects(f.run({ review: async () => { throw Object.assign(new Error('request timeout'), { status: 408 }); } }), { code: 'VISUAL_DESIGN_UNCERTAIN' });
  assert.equal(f.state.row.payload._visualDesign.pending.status, 'unknown');
});

test('real course-review validation preserves safe diagnostics, usage and all saved lessons', async () => {
  const f = fixture(), before = clone(f.state.row.payload.modules);
  const client = { messages: { async create() {
    return { usage: { input_tokens: 200, output_tokens: 40 }, stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: 'submit_course_visual_review', input: {
        summary: 'PRIVATE_RESPONSE_BODY', guidance: 'SECRET_TEXT_NOT_AN_ARRAY', lessons: [], flags: []
      } }] };
  } } };
  let failure;
  await assert.rejects(f.run({ review: undefined, client }), error => { failure = error; return error.code === 'VISUAL_DESIGN_FAILED'; });
  const diagnostic = f.state.row.payload._visualDesign.lastFailure;
  assert.equal(diagnostic.code, 'VISUAL_DESIGN_SCHEMA');
  assert.equal(diagnostic.operation, 'course_review');
  assert.equal(diagnostic.stopReason, 'tool_use');
  assert.equal(diagnostic.responseReceived, true);
  assert.deepEqual(diagnostic.issues[0], { path: ['guidance'], code: 'invalid_type' });
  assert.equal(diagnostic.operationId, f.state.row.payload._visualDesign.pending.id);
  assert.deepEqual(failure.diagnostic, diagnostic);
  assert.match(failure.message, /course review/i);
  assert.match(failure.message, /VISUAL_DESIGN_SCHEMA/);
  assert.doesNotMatch(JSON.stringify(diagnostic) + failure.message, /PRIVATE_RESPONSE_BODY|SECRET_TEXT/);
  assert.deepEqual(f.state.row.payload.modules, before);
  assert.equal(f.state.row.payload._visualDesign.usage.total.calls, 2);
  await assert.rejects(f.run({ review: undefined, client }), { code: 'VISUAL_DESIGN_UNCERTAIN' });
  assert.equal(f.state.row.payload._visualDesign.usage.total.calls, 2);
});

test('lost correction response stays uncertain even when first rejected proposal has known usage', async () => {
  const f = fixture(), before = clone(f.state.row.payload.modules); let calls = 0;
  const client = { messages: { async create() {
    if (++calls === 2) throw Object.assign(new Error('unconfirmed correction'), { code: 'ECONNRESET' });
    return { usage: { input_tokens: 20, output_tokens: 10 }, stop_reason: 'tool_use',
      content: [{ type: 'tool_use', name: 'submit_course_visual_review', input: { summary: 'Review', guidance: 'wrong shape', lessons: [], flags: [] } }] };
  } } };
  await assert.rejects(f.run({ review: undefined, client }), { code: 'VISUAL_DESIGN_UNCERTAIN' });
  assert.equal(calls, 2); assert.equal(f.state.row.payload._visualDesign.pending.status, 'unknown');
  assert.equal(f.state.row.payload._visualDesign.usage.total.calls, 1);
  assert.equal(f.state.row.payload._visualDesign.lastFailure.responseReceived, false);
  assert.deepEqual(f.state.row.payload.modules, before);
  await assert.rejects(f.run({ review: undefined, client, retryFailedDesign: true }), { code: 'VISUAL_DESIGN_UNCERTAIN' });
  assert.equal(calls, 2);
});

test('provider errors retain only allowlisted metadata, never arbitrary messages or properties', async () => {
  const f = fixture();
  await assert.rejects(f.run({ review: async () => { throw Object.assign(new Error('SECRET_PROVIDER_KEY'), {
    status: 401, code: 'SECRET_CODE', diagnostic: { stopReason: 'SECRET_STOP', issues: [{ path: ['SECRET_PATH'], code: 'SECRET_ISSUE' }] }
  }); } }), { code: 'VISUAL_DESIGN_FAILED' });
  const d = f.state.row.payload._visualDesign.lastFailure;
  assert.equal(d.code, 'PROVIDER_HTTP_ERROR'); assert.equal(d.httpStatus, 401);
  assert.equal(d.responseReceived, false); assert.doesNotMatch(JSON.stringify(d), /SECRET/);
});

test('a request deadline is diagnosed but remains unknown and cannot be resumed automatically', async () => {
  const f=fixture();let calls=0;
  const review=async()=>{calls++;throw Object.assign(Error('private transport'),{code:'GENERATION_REQUEST_UNCERTAIN'});};
  await assert.rejects(f.run({review}),{code:'VISUAL_DESIGN_UNCERTAIN'});
  assert.equal(f.state.row.payload._visualDesign.lastFailure.code,'GENERATION_REQUEST_UNCERTAIN');
  assert.equal(f.state.row.payload._visualDesign.pending.status,'unknown');
  await assert.rejects(f.run({review,retryFailedDesign:true}),{code:'VISUAL_DESIGN_UNCERTAIN'});
  assert.equal(calls,1);
});

test('lost preserve-copy planning response retains original draft and blocks another paid resume', async () => {
  const f=fixture();
  f.state.row.payload.modules[1]['lesson-1'].sections[0].content='<p>The result may vary. Original teaching stays here.</p>';
  const before=clone(f.state.row.payload.modules); let calls=0;
  const client={messages:{create:async()=>{
    if(++calls===3) throw Object.assign(new Error('unconfirmed planning response'),{code:'ECONNRESET'});
    return {usage:{input_tokens:20,output_tokens:10},stop_reason:'tool_use',content:[{type:'tool_use',name:'submit_lesson_visual_design',input:{
      summary:'Shortened copy.',edits:[{scope:'section',sectionIndex:0,field:'content',value:'<p>This rewrite removes the original qualification.</p>'}],
      visual:{decision:'omit',reason:'The explanation is already clear enough for this lesson.'},flags:[],alignment:{quizAnswersPreserved:true,checksMatchTeaching:true}
    }}]};
  }}};
  await assert.rejects(f.run({refine:undefined,client}),{code:'VISUAL_DESIGN_UNCERTAIN'});
  assert.equal(calls,3); assert.equal(f.state.row.payload._visualDesign.pending.status,'unknown');
  assert.equal(f.state.row.payload._visualDesign.lastFailure.responseReceived,false);
  assert.equal(f.state.row.payload._visualDesign.usage.total.calls,3,'review plus two returned rewrites, not the lost third response');
  assert.deepEqual(f.state.row.payload.modules,before);
  await assert.rejects(f.run({refine:undefined,client,retryFailedDesign:true}),{code:'VISUAL_DESIGN_UNCERTAIN'});
  assert.equal(calls,3);
});

test('truncated course review records stop reason without applying content or automatically retrying', async () => {
  const f = fixture(); let calls = 0;
  const client = { messages: { async create() { calls++; return { usage: { input_tokens: 10, output_tokens: 12000 }, stop_reason: 'max_tokens', content: [] }; } } };
  await assert.rejects(f.run({ review: undefined, client }), { code: 'VISUAL_DESIGN_FAILED' });
  const d = f.state.row.payload._visualDesign.lastFailure;
  assert.equal(d.code, 'VISUAL_DESIGN_TRUNCATED'); assert.equal(d.stopReason, 'max_tokens');
  assert.equal(calls, 1); assert.equal(f.state.row.payload._visualDesign.review, null);
});

test('diagnostic paths and issue codes are bounded and arbitrary provider data is redacted', async () => {
  const f = fixture();
  await assert.rejects(f.run({ review: async () => { throw Object.assign(new Error('SECRET_RAW'), {
    kind: 'visual_design', code: 'VISUAL_DESIGN_SCHEMA', diagnostic: {
      stopReason: 'tool_use', raw: 'SECRET_RESPONSE',
      issues: Array.from({ length: 200 }, () => ({ path: ['lessons', 2, 'SECRET_PATH', ...Array(100).fill('guidance')], code: 'SECRET_ISSUE', message: 'SECRET_MESSAGE' }))
    }
  }); } }), { code: 'VISUAL_DESIGN_FAILED' });
  const d = f.state.row.payload._visualDesign.lastFailure;
  assert.equal(d.issues.length, 4); assert.equal(d.issues[0].path.length, 8);
  assert.equal(d.issues[0].path[2], '[field]'); assert.equal(d.issues[0].code, 'validation');
  assert.doesNotMatch(JSON.stringify(d), /SECRET/);
  assert.ok(Buffer.byteLength(JSON.stringify(d)) < 2000);
});
