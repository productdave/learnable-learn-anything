// The actual generation runner, lesson/schema/assembly/save and integrated-image
// orchestration execute here. Only I/O is synthetic: text fetch, image provider,
// receipt/object stores and Supabase queries. No paid/hosted request is possible.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';
import { syntheticImageResponse } from './fixtures/generated-image.mjs';
import { decodeImagePNG } from '../web/api/_lib/openai-image.mjs';
import { ImageGenerationError } from '../web/api/_lib/image-policy.mjs';
import { ImageRequestError } from '../web/api/_lib/image-request-store.mjs';
import { checkpointForJob } from '../web/api/_lib/gen-recovery.mjs';
import { createGenerationRequestBudget } from '../web/api/_lib/gen-request-budget.mjs';

const clone = value => structuredClone(value);
async function loadRunner(dependencies) {
  const key = 'learnable.integration.runner.test.' + randomUUID();
  globalThis[Symbol.for(key)] = dependencies;
  const url = new URL('../web/api/_lib/gen-runner.mjs', import.meta.url);
  let source = readFileSync(url, 'utf8');
  // Inject only the existing helper's I/O dependencies. Keep its real code,
  // runner control flow, checkpoints, error handling and finalization intact.
  const call = 'await runIntegratedCourseImages({ supabase, ownerId, jobId, runId, courseId, requestBudget,';
  assert.equal(source.split(call).length, 2);
  source = source.replace(call, 'await runIntegratedCourseImages({ ...globalThis[Symbol.for(' + JSON.stringify(key) + ')], supabase, ownerId, jobId, runId, courseId, requestBudget,');
  source = source.replace(/from '(\.[^']+)'/g, (_match, path) => "from '" + new URL(path, url).href + "'");
  source += '\n//# sourceURL=learnable-generation-runner-synthetic.mjs';
  const { runGeneration } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  return { runGeneration, close() { delete globalThis[Symbol.for(key)]; } };
}

function fixture(decisions = ['generate', 'omit', 'generate'], { visualDesigner = false } = {}) {
  const ownerId = randomUUID(), jobId = 'job-integrated-runner-test', runId = randomUUID();
  const brief = { ...curriculumFixture(), materials_policy: 'integrated-visuals-v2', components: ['lessons', 'images'],
    ...(visualDesigner ? { visual_designer_policy: 'learner-experience-v1', human_feedback: 'Explain light direction in plain language for beginners.' } : {}) };
  const bundle = { module_id: 'foundations', key_concepts: ['Light', 'Composition'], examples: ['A window', 'A simple frame'],
    experts: [], misconceptions: [], sources: [], images: [] };
  const row = { id: jobId, owner_id: ownerId, run_id: runId, status: 'running', stage: 'topics', brief,
    user_brief: { goal: 'Photography', components: brief.components, materials_policy: brief.materials_policy,
      ...(visualDesigner ? { visual_designer_policy: brief.visual_designer_policy } : {}) },
    research: { foundations: bundle }, topics_by_key: {}, failures: [], topics_done: 0, topics_total: 3 };
  const state = { row, courses: new Map(), receipts: new Map(), objects: new Map(), events: [], textCalls: [], designCalls: [], imageCalls: [],
    imageFailure: null, designFailure: null, designUncertain: false, designCommits: 0,
    commits: 0, deletes: 0, cleanup: 0, lostFinalAck: false, afterTextDispatch: null };
  let tick = Date.now();
  const timestamp = () => new Date(++tick).toISOString();
  const supabase = {
    from(table) {
      assert.ok(['generation_jobs', 'user_courses'].includes(table), 'Unexpected table: ' + table);
      const filters = []; let fields = null;
      const finish = async () => {
        const records = table === 'generation_jobs' ? [row] : [...state.courses.values()];
        const found = records.find(record => filters.every(filter => filter(record)));
        if (!found) return { data: null, error: null };
        if (fields) {
          if (fields.status === 'completed' && state.lostFinalAck) {
            state.lostFinalAck = false;
            return { data: null, error: { message: 'Synthetic final checkpoint failure' } };
          }
          Object.assign(found, clone(fields));
          if (fields.saved_course_id) state.events.push('job:course-pointer');
          if (fields.stage) state.events.push('stage:' + fields.stage);
          if (fields.status === 'completed') state.events.push('job:completed');
        }
        return { data: clone(found), error: null };
      };
      return { select() { return this; }, update(value) { fields = value; return this; },
        eq(key, value) { filters.push(record => record[key] === value); return this; },
        in(key, values) { filters.push(record => values.includes(record[key])); return this; },
        maybeSingle() { return this; }, then(resolve, reject) { return finish().then(resolve, reject); } };
    },
    rpc(name, args) {
      const execute = async () => {
        if (name === 'commit_user_course') {
          assert.equal(args.p_owner, ownerId);
          if (args.p_action === 'delete') { state.deletes++; state.courses.delete(args.p_id); return { data: { deleted: true } }; }
          const existing = state.courses.get(args.p_id);
          if (existing && (existing.payload._courseRevision !== args.p_expected_revision || existing.updated_at !== args.p_updated_at)) {
            return { data: { error: 'conflict' } };
          }
          const updatedAt = timestamp(), payload = { ...clone(args.p_payload), _courseRevision: randomUUID() };
          state.courses.set(args.p_id, { id: args.p_id, owner_id: ownerId, payload,
            created_at: existing?.created_at || updatedAt, updated_at: updatedAt });
          state.commits++; state.events.push('course:saved');
          return { data: { saved: true, payload: clone(payload), updatedAt } };
        }
        if (name === 'commit_generation_design') {
          assert.equal(args.p_owner, ownerId); assert.equal(args.p_job, jobId); assert.equal(args.p_run, row.run_id);
          assert.equal(row.stage, 'design'); assert.equal(row.status, 'running'); assert.equal(row.saved_course_id, args.p_course);
          const course = state.courses.get(args.p_course);
          assert.equal(course.updated_at, args.p_updated_at); assert.equal(course.payload._courseRevision, args.p_revision);
          const before = course.payload._visualDesign?.items || {}, updatedAt = timestamp();
          const payload = { ...clone(args.p_payload), _courseRevision: randomUUID() };
          course.payload = payload; course.updated_at = updatedAt;
          row.design_progress = clone(args.p_progress);
          state.designCommits++; state.events.push('design:saved');
          for (const key of Object.keys(payload._visualDesign.items)) if (!before[key]) state.events.push('design:refined:' + key);
          if (payload._visualDesign.status === 'complete') state.events.push('design:complete');
          return { data: { saved: true, payload: clone(payload), updatedAt } };
        }
        assert.equal(name, 'attach_generation_course_image');
        assert.equal(args.p_owner, ownerId); assert.equal(args.p_job, jobId); assert.equal(args.p_run, row.run_id);
        assert.equal(row.stage, 'images'); assert.equal(row.status, 'running'); assert.equal(row.saved_course_id, args.p_course);
        const course = state.courses.get(args.p_course), receipt = state.receipts.get(args.p_id);
        assert.equal(receipt.revision, args.p_revision); assert.equal(receipt.payload.status, 'ready');
        assert.equal(course.updated_at, args.p_updated_at);
        const updatedAt = timestamp(), payload = { ...clone(args.p_payload), _courseRevision: randomUUID() };
        course.payload = payload; course.updated_at = updatedAt;
        receipt.accepted = true; receipt.revision++;
        receipt.payload.acceptance = { kind: 'generation-draft', jobId, operationId: args.p_operation, hash: args.p_hash };
        state.events.push('image:attached');
        return { data: { saved: true, payload: clone(payload), updatedAt } };
      };
      return { then(resolve, reject) { return execute().then(resolve, reject); } };
    },
    storage: { from(bucket) {
      assert.equal(bucket, 'course-uploads');
      return { async list() { state.cleanup++; state.events.push('sources:cleanup'); return { data: [] }; } };
    } }
  };
  const store = {
    async course(owner, id) { return owner === ownerId ? clone(state.courses.get(id) || null) : null; },
    async get(owner, id) { return owner === ownerId ? clone(state.receipts.get(id) || null) : null; },
    async begin(receipt, expected, acknowledgement) {
      assert.equal(receipt.owner_id, ownerId);
      const prior = [...state.receipts.values()].find(item => item.slot_key === receipt.slot_key && item.is_current);
      if ((prior?.id || null) !== expected) throw new ImageRequestError('conflict');
      if (prior?.payload.mayHaveCharged && !acknowledgement) throw new ImageRequestError('charge_ack');
      if (prior) prior.is_current = false;
      const saved = { ...clone(receipt), revision: 1, is_current: true, accepted: false, status: 'queued' };
      state.receipts.set(receipt.id, saved); return { row: clone(saved), replayed: false };
    },
    async update(receipt, fields) {
      const current = state.receipts.get(receipt.id);
      if (current.revision !== receipt.revision) return null;
      const saved = { ...current, revision: current.revision + 1, status: fields.status || current.status,
        payload: { ...current.payload, ...clone(fields) } };
      state.receipts.set(saved.id, saved); return clone(saved);
    }
  };
  const imageDependencies = { env: { LEARNABLE_GPT_IMAGES: '1' }, store,
    assets: { async put(receipt, bytes) { state.objects.set(receipt.id, Buffer.from(bytes)); },
      async read(receipt) { const bytes = state.objects.get(receipt.id); return bytes ? decodeImagePNG(bytes.toString('base64')) : null; } },
    generate: async args => {
      assert.equal(row.stage, 'images'); assert.equal(row.saved_course_id, args.courseId);
      assert.ok(state.courses.has(args.courseId), 'Save lessons before any image dispatch');
      if (visualDesigner) {
        const course = state.courses.get(args.courseId).payload;
        assert.equal(course._visualDesign.status, 'complete', 'Save every refined lesson before image dispatch');
        assert.equal(Object.keys(course._visualDesign.items).length, 3);
        for (const lesson of Object.values(course.modules[1])) assert.equal(lesson.sections[0].title, 'Notice the light direction');
      }
      state.imageCalls.push(args.operationId); state.events.push('image:dispatch');
      if (state.imageFailure) throw new ImageGenerationError(state.imageFailure, { dispatched: true });
      const image = syntheticImageResponse();
      return { asset: decodeImagePNG(image.data[0].b64_json), provenance: { funding: 'creator', provider: 'openai',
        model: 'gpt-image-2.5-flare-2026-09-08', n: 1, size: '1024x1024', quality: 'medium', outputFormat: 'png',
        usage: image.usage, requestId: 'req_integrated_runner_test' } };
    } };
  const fetcher = async (url, options) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages', 'Unexpected network operation blocked');
    const body = JSON.parse(options.body), content = body.messages[0].content;
    if (body.tool_choice?.name === 'submit_course_visual_review' || body.tool_choice?.name === 'submit_lesson_visual_design') {
      assert.equal(visualDesigner, true); assert.equal(row.stage, 'design'); assert.ok(row.saved_course_id);
      const course = state.courses.get(row.saved_course_id).payload;
      assert.equal(Object.keys(course.modules[1]).length, 3, 'All lessons saved before first review');
      assert.equal(course._visualDesign.pending.status, 'started', 'Durable intent precedes every text-provider call');
      const input = JSON.parse(content), kind = body.tool_choice.name;
      let output;
      if (kind === 'submit_course_visual_review') {
        assert.equal(input.course.lessons.length, 3);
        state.designCalls.push('course'); state.events.push('design:review');
        output = { summary: 'Teach light direction before comparing the photographs.', guidance: ['Use consistent concrete names and short explanations.'], flags: [],
          lessons: input.course.lessons.map(lesson => ({ moduleId: lesson.moduleId, topicId: lesson.topicId, guidance: ['Keep the explanation easy to scan.'], flags: [] })) };
      } else {
        const topicId = input.target.topicId, index = brief.modules[0].topics.findIndex(topic => topic.id === topicId);
        assert.ok(index >= 0); assert.deepEqual(input.savedLesson, course.modules[1][topicId]);
        state.designCalls.push(topicId); state.events.push('design:dispatch:' + topicId);
        if (state.designUncertain) throw new Error('Synthetic uncertain visual response');
        output = { summary: 'Clarified the heading and teaching sequence for beginners.',
          edits: [{ scope: 'section', sectionIndex: 0, field: 'title', value: 'Notice the light direction' },
            { scope: 'section', sectionIndex: 0, field: 'content', value: '<p>Start beside a window. Notice which side of the subject is bright and which side is in shadow.</p><p>Move around the subject and compare the two sides.</p>' }],
          visual: decisions[index] === 'generate' ? {
            decision: 'generate', reason: 'The revised explanation benefits from comparing the bright and shadow sides.',
            prompt: 'Create an illustrative comparison of an object beside a window. Show its bright side and its shadow side with restrained arrows for the light direction.',
            alt: 'An object beside a window with a bright side and a shadow side.', caption: 'Illustrative comparison of the bright side and shadow side of the subject.', afterSectionIndex: 0
          } : { decision: 'omit', reason: 'The revised explanation and worked example make this relationship clear without an extra image.' },
          flags: [], alignment: { quizAnswersPreserved: true, checksMatchTeaching: true } };
        if (state.designFailure === topicId) output.edits = 'malformed edits';
      }
      return new Response(JSON.stringify({ model: body.model, stop_reason: 'tool_use', usage: { input_tokens: 120, output_tokens: 40 },
        content: [{ type: 'tool_use', name: kind, input: output }] }));
    }
    const id = content.match(/and id "([^"]+)"/)?.[1];
    const topic = brief.modules[0].topics.find(item => item.id === id);
    assert.ok(topic, 'Only expected lesson calls may run');
    const lesson = lessonFixture(brief.components, topic);
    if (decisions[brief.modules[0].topics.indexOf(topic)] === 'generate') lesson.visual = {
      decision: 'generate', reason: 'A labeled light-and-shadow diagram clarifies direction.',
      prompt: 'Create an instructional illustration of window light illuminating an object, with short arrows for light direction.',
      alt: 'Window light falls from the left, leaving a shadow to the right.', caption: 'Directional light creates an opposite-side shadow.', afterSectionIndex: 0
    };
    state.textCalls.push(topic.id); state.events.push('text:' + topic.id);
    state.afterTextDispatch?.();
    return new Response(JSON.stringify({ model: body.model, stop_reason: 'tool_use', usage: { input_tokens: 100, output_tokens: 20 },
      content: [{ type: 'tool_use', name: 'submit_topic', input: lesson }] }));
  };
  return { state, imageDependencies, fetcher, args: () => ({ supabase, ownerId, jobId, runId: row.run_id, apiKey: 'synthetic-only',
    userBrief: row.user_brief, checkpoint: checkpointForJob(row), pdfRefs: [], mode: 'complete' }),
    resume() { row.status = 'running'; row.run_id = randomUUID(); row.completed_at = null; row.error = null; } };
}

async function usingFixture(fixture, work) {
  const runner = await loadRunner(fixture.imageDependencies), originalFetch = globalThis.fetch, originalError = console.error;
  const continuation = process.env.LEARNABLE_GENERATION_CONTINUATION;
  globalThis.fetch = fixture.fetcher; console.error = () => {};
  process.env.LEARNABLE_GENERATION_CONTINUATION = '0';
  try { await work(runner.runGeneration); }
  finally {
    runner.close(); globalThis.fetch = originalFetch; console.error = originalError;
    if (continuation === undefined) delete process.env.LEARNABLE_GENERATION_CONTINUATION;
    else process.env.LEARNABLE_GENERATION_CONTINUATION = continuation;
  }
}

test('real runner saves lessons, generates and attaches purposeful images, then completes one draft', async () => {
  const f = fixture();
  await usingFixture(f, async run => { await run(f.args()); });
  const s = f.state;
  assert.equal(s.textCalls.length, 3); assert.equal(s.imageCalls.length, 2); assert.equal(s.commits, 1); assert.equal(s.deletes, 0);
  assert.equal(s.row.status, 'completed'); assert.equal(s.row.stage, 'done'); assert.equal(s.row.topics_done, 3);
  assert.equal(s.row.image_progress.completed, 2); assert.equal(s.row.image_progress.omitted, 1);
  assert.ok(s.events.indexOf('course:saved') < s.events.indexOf('job:course-pointer'));
  assert.ok(s.events.indexOf('job:course-pointer') < s.events.indexOf('image:dispatch'));
  assert.ok(s.events.lastIndexOf('image:attached') < s.events.indexOf('stage:assemble'));
  assert.ok(s.events.indexOf('stage:assemble') < s.events.indexOf('job:completed'));
  assert.ok(s.events.indexOf('job:completed') < s.events.indexOf('sources:cleanup'));
  const lessons = s.courses.get(s.row.saved_course_id).payload.modules[1];
  assert.equal(lessons['lesson-1'].sections[1].type, 'image');
  assert.equal(lessons['lesson-2'].sections.some(section => section.type === 'image'), false);
  assert.equal(lessons['lesson-3'].sections[1].type, 'image');
});

test('image failure retains all lessons; course Resume retries only images without text credentials', async () => {
  const f = fixture(); f.state.imageFailure = 'quota';
  await usingFixture(f, async run => {
    await assert.rejects(run(f.args()), /OpenAI course image generation.*quota/);
    const s = f.state, courseId = s.row.saved_course_id;
    assert.equal(s.row.status, 'failed'); assert.equal(s.row.stage, 'images');
    assert.equal(s.row.image_progress.status, 'attention'); assert.equal(s.textCalls.length, 3);
    assert.equal(s.courses.size, 1); assert.equal(s.commits, 1); assert.equal(s.deletes, 0); assert.equal(s.cleanup, 0);
    assert.equal(Object.keys(s.courses.get(courseId).payload.modules[1]).length, 3);
    f.resume(); s.imageFailure = null;
    await run({ ...f.args(), apiKey: null, retryFailedImages: true });
    assert.equal(s.row.status, 'completed'); assert.equal(s.row.saved_course_id, courseId);
    assert.equal(s.textCalls.length, 3); assert.equal(s.commits, 2); assert.equal(s.deletes, 0);
    assert.equal(s.courses.get(courseId).payload._generationRunId, s.row.run_id, 'resumed image run can be pulled with its current run ID');
    assert.equal(s.imageCalls.length, 3); assert.equal(s.row.image_progress.completed, 2);
  });
});

test('uncertain image outcome stops the whole job and Resume never silently bills a replacement', async () => {
  const f = fixture(); f.state.imageFailure = 'timeout';
  await usingFixture(f, async run => {
    await assert.rejects(run(f.args()), /could not be confirmed/);
    assert.equal(f.state.row.stage, 'images'); assert.equal(f.state.imageCalls.length, 1);
    const operation = f.state.imageCalls[0]; f.resume(); f.state.imageFailure = null;
    await assert.rejects(run({ ...f.args(), apiKey: null, retryFailedImages: true }), /could not be confirmed/);
    assert.deepEqual(f.state.imageCalls, [operation]); assert.equal(f.state.textCalls.length, 3);
    assert.equal(f.state.courses.size, 1); assert.equal(f.state.deletes, 0); assert.equal(f.state.row.status, 'failed');
  });
});

test('final checkpoint failure preserves attached images and resumes without reassembly or provider calls', async () => {
  const f = fixture(); f.state.lostFinalAck = true;
  await usingFixture(f, async run => {
    await assert.rejects(run(f.args()), /Synthetic final checkpoint failure/);
    const s = f.state, saved = clone(s.courses.get(s.row.saved_course_id));
    assert.equal(s.row.stage, 'assemble'); assert.equal(s.row.image_progress.status, 'complete');
    assert.equal(s.deletes, 0); f.resume();
    await run({ ...f.args(), apiKey: null, retryFailedImages: true });
    assert.equal(s.row.status, 'completed'); assert.equal(s.textCalls.length, 3); assert.equal(s.imageCalls.length, 2);
    assert.equal(s.commits, 2);
    const current = s.courses.get(s.row.saved_course_id);
    assert.equal(current.payload._generationRunId, s.row.run_id);
    assert.deepEqual(current.payload.modules, saved.payload.modules, 'finalization never reassembles or replaces saved images');
  });
});

test('zero selected visuals completes through the same runner without image provider work', async () => {
  const f = fixture(['omit', 'omit', 'omit']);
  await usingFixture(f, async run => { await run(f.args()); });
  assert.equal(f.state.row.status, 'completed'); assert.equal(f.state.textCalls.length, 3);
  assert.equal(f.state.imageCalls.length, 0); assert.equal(f.state.row.image_progress.planned, 0);
  assert.equal(f.state.row.image_progress.omitted, 3); assert.equal(f.state.courses.size, 1);
});

test('hosting slice boundary retains lessons and continues images without spending before enough time remains', async () => {
  const f = fixture(); let elapsed = 0;
  f.state.afterTextDispatch = () => { elapsed = 100000; };
  await usingFixture(f, async run => {
    await run({ ...f.args(), requestBudget: createGenerationRequestBudget({ now: () => elapsed }) });
    const s = f.state;
    assert.equal(s.row.status, 'timed_out'); assert.equal(s.row.stage, 'images');
    assert.equal(s.courses.size, 1); assert.equal(s.deletes, 0); assert.equal(s.textCalls.length, 3);
    assert.equal(s.imageCalls.length, 0); assert.equal(s.receipts.size, 0);
    const planned = Object.values(s.row.image_progress.items)[0].operationId;
    f.resume();
    await run({ ...f.args(), apiKey: null, requestBudget: createGenerationRequestBudget({ now: () => elapsed }) });
    assert.equal(s.row.status, 'completed'); assert.equal(s.textCalls.length, 3);
    assert.equal(s.imageCalls[0], planned); assert.equal(s.imageCalls.length, 2); assert.equal(s.commits, 2);
  });
});

test('missing lesson in a saved draft cannot be silently reported as a complete course', async () => {
  const f = fixture(); f.state.imageFailure = 'quota';
  await usingFixture(f, async run => {
    await assert.rejects(run(f.args()), /OpenAI course image generation.*quota/);
    const s = f.state;
    delete s.courses.get(s.row.saved_course_id).payload.modules[1]['lesson-2'];
    f.resume(); s.imageFailure = null;
    await assert.rejects(run({ ...f.args(), apiKey: null, retryFailedImages: true }), /missing.*lesson|lesson.*missing/i);
    assert.equal(s.row.status, 'failed'); assert.equal(s.imageCalls.length, 1);
    assert.equal(s.courses.size, 1); assert.equal(s.deletes, 0);
  });
});

test('new-cohort real runner reviews the whole saved draft, saves every refinement, then generates images', async () => {
  const f = fixture(undefined, { visualDesigner: true });
  await usingFixture(f, async run => { await run(f.args()); });
  const s = f.state, course = s.courses.get(s.row.saved_course_id).payload;
  assert.equal(s.row.status, 'completed'); assert.equal(s.row.stage, 'done');
  assert.equal(s.textCalls.length, 3); assert.deepEqual(s.designCalls, ['course', 'lesson-1', 'lesson-2', 'lesson-3']);
  assert.equal(s.imageCalls.length, 2); assert.equal(s.commits, 1); assert.equal(s.deletes, 0);
  assert.equal(course._visualDesign.status, 'complete'); assert.equal(s.row.design_progress.status, 'complete');
  assert.equal(s.row.design_progress.completed, 3); assert.equal(course._visualDesign.review.contextCoverage.renderedInspection, false);
  assert.ok(s.events.indexOf('course:saved') < s.events.indexOf('design:review'));
  for (const id of ['lesson-1', 'lesson-2', 'lesson-3']) assert.ok(s.events.indexOf('design:refined:foundations/' + id) < s.events.indexOf('design:complete'));
  assert.ok(s.events.indexOf('design:complete') < s.events.indexOf('image:dispatch'));
  assert.ok(s.events.lastIndexOf('image:attached') < s.events.indexOf('stage:assemble'));
  assert.ok(s.events.indexOf('job:completed') < s.events.indexOf('sources:cleanup'));
  assert.equal(course.modules[1]['lesson-1'].sections[1].type, 'image');
  assert.match(course.modules[1]['lesson-1'].visual.prompt, /bright side and its shadow side/);
});

test('new-cohort image-only retry needs no text credentials and never repeats refinement or replaces saved copy', async () => {
  const f = fixture(undefined, { visualDesigner: true }); f.state.imageFailure = 'quota';
  await usingFixture(f, async run => {
    await assert.rejects(run(f.args()), /OpenAI course image generation.*quota/);
    const s = f.state, courseId = s.row.saved_course_id, design = clone(s.courses.get(courseId).payload._visualDesign), designCommits = s.designCommits;
    assert.equal(s.row.stage, 'images'); assert.equal(s.row.design_progress.status, 'complete');
    assert.deepEqual(s.designCalls, ['course', 'lesson-1', 'lesson-2', 'lesson-3']);
    f.resume(); s.imageFailure = null;
    await run({ ...f.args(), apiKey: null, retryFailedImages: true });
    assert.equal(s.row.status, 'completed'); assert.equal(s.row.saved_course_id, courseId);
    assert.equal(s.textCalls.length, 3); assert.equal(s.designCalls.length, 4); assert.equal(s.designCommits, designCommits);
    assert.deepEqual(s.courses.get(courseId).payload._visualDesign, design); assert.equal(s.commits, 2); assert.equal(s.deletes, 0);
    assert.equal(s.courses.get(courseId).payload._generationRunId, s.row.run_id);
    assert.equal(s.imageCalls.length, 3);
  });
});

test('new-cohort invalid refinement preserves earlier saved lessons and requires explicit retry of only its failed step', async () => {
  const f = fixture(undefined, { visualDesigner: true }); f.state.designFailure = 'lesson-2';
  await usingFixture(f, async run => {
    await assert.rejects(run(f.args()), /Visual Designer stopped during lesson refinement/);
    const s = f.state, courseId = s.row.saved_course_id, afterFailure = clone(s.courses.get(courseId).payload);
    assert.equal(s.row.status, 'failed'); assert.equal(s.row.stage, 'design'); assert.equal(s.imageCalls.length, 0);
    assert.equal(s.textCalls.length, 3); assert.deepEqual(s.designCalls, ['course', 'lesson-1', 'lesson-2', 'lesson-2', 'lesson-2']);
    assert.equal(afterFailure._visualDesign.pending.status, 'failed'); assert.equal(afterFailure._visualDesign.items['foundations/lesson-1'].status, 'saved');
    assert.equal(afterFailure._visualDesign.lastFailure.code, 'VISUAL_DESIGN_SCHEMA');
    assert.equal(afterFailure._visualDesign.lastFailure.operation, 'lesson_refinement');
    assert.match(s.row.error, /VISUAL_DESIGN_SCHEMA/);
    assert.equal(afterFailure.modules[1]['lesson-1'].sections[0].title, 'Notice the light direction');
    assert.equal(afterFailure.modules[1]['lesson-2'].sections[0].title, 'Start with natural light');
    assert.equal(s.cleanup, 0); assert.equal(s.deletes, 0);
    f.resume(); s.designFailure = null;
    await assert.rejects(run(f.args()), /Visual Designer needs attention/);
    assert.equal(s.designCalls.length, 5, 'No further implicit retry after correction and no-edit recovery failed');
    assert.deepEqual(s.courses.get(courseId).payload.modules, afterFailure.modules);
    f.resume(); await run({ ...f.args(), retryFailedDesign: true });
    assert.equal(s.row.status, 'completed'); assert.deepEqual(s.designCalls, ['course', 'lesson-1', 'lesson-2', 'lesson-2', 'lesson-2', 'lesson-2', 'lesson-3']);
    assert.equal(s.textCalls.length, 3); assert.equal(s.commits, 2); assert.equal(s.deletes, 0); assert.equal(s.imageCalls.length, 2);
  });
});

test('new-cohort uncertain refinement remains held even on explicit retry and never starts image generation', async () => {
  const f = fixture(undefined, { visualDesigner: true }); f.state.designUncertain = true;
  await usingFixture(f, async run => {
    await assert.rejects(run(f.args()), /result or charge is uncertain/);
    const s = f.state, course = clone(s.courses.get(s.row.saved_course_id).payload);
    assert.equal(course._visualDesign.pending.status, 'unknown'); assert.equal(s.row.stage, 'design'); assert.equal(s.imageCalls.length, 0);
    assert.deepEqual(s.designCalls, ['course', 'lesson-1']);
    f.resume(); s.designUncertain = false;
    await assert.rejects(run({ ...f.args(), retryFailedDesign: true }), /unconfirmed result or charge/);
    assert.deepEqual(s.designCalls, ['course', 'lesson-1']); assert.equal(s.imageCalls.length, 0); assert.equal(s.deletes, 0);
    assert.deepEqual(s.courses.get(s.row.saved_course_id).payload.modules, course.modules);
  });
});

test('new-cohort final checkpoint recovery retains refined draft and images without reassembly or provider calls', async () => {
  const f = fixture(undefined, { visualDesigner: true }); f.state.lostFinalAck = true;
  await usingFixture(f, async run => {
    await assert.rejects(run(f.args()), /Synthetic final checkpoint failure/);
    const s = f.state, snapshot = clone(s.courses.get(s.row.saved_course_id)), designCommits = s.designCommits;
    assert.equal(s.row.stage, 'assemble'); assert.equal(s.row.image_progress.status, 'complete'); assert.equal(s.row.design_progress.status, 'complete');
    f.resume(); await run({ ...f.args(), apiKey: null, retryFailedImages: true, retryFailedDesign: true });
    assert.equal(s.row.status, 'completed'); assert.equal(s.textCalls.length, 3); assert.equal(s.designCalls.length, 4); assert.equal(s.imageCalls.length, 2);
    assert.equal(s.designCommits, designCommits); assert.equal(s.commits, 2); assert.equal(s.deletes, 0);
    const saved = s.courses.get(s.row.saved_course_id).payload;
    assert.equal(saved._generationRunId, s.row.run_id);
    assert.deepEqual(saved.modules, snapshot.payload.modules);
    assert.deepEqual(saved._visualDesign, snapshot.payload._visualDesign);
  });
});

for (const scenario of [
  { name: 'newly recorded missing lessons', mutate: course => { course.failedTopics = ['foundations/lesson-3']; }, pattern: /no longer matches its refinement checkpoint/ },
  { name: 'changed materials policy', mutate: course => { course._brief.materials_policy = 'standard-images-no-practice-v1'; }, pattern: /no longer matches its refinement checkpoint/ },
  { name: 'owner-edited teaching copy', mutate: course => { course.modules[1]['lesson-1'].sections[0].title = 'Owner kept this latest heading'; }, pattern: /course changed after refinement began/i },
  { name: 'changed generation identity', mutate: course => { course._generationJobId = 'job-another-owner-edit'; }, pattern: /no longer matches its refinement checkpoint/ }
]) test(`new-cohort recovery fails closed for ${scenario.name} without overwriting the retained draft`, async () => {
  const f = fixture(undefined, { visualDesigner: true }); f.state.designFailure = 'lesson-2';
  await usingFixture(f, async run => {
    await assert.rejects(run(f.args()), /Visual Designer stopped during lesson refinement/);
    const s = f.state, row = s.courses.get(s.row.saved_course_id);
    assert.equal(row.payload._visualDesign.items['foundations/lesson-1'].status, 'saved');
    scenario.mutate(row.payload);
    const retained = clone(row), counters = { text: s.textCalls.length, design: s.designCalls.length, images: s.imageCalls.length, commits: s.commits, designCommits: s.designCommits };
    f.resume(); s.designFailure = null;
    await assert.rejects(run({ ...f.args(), retryFailedDesign: true, retryFailedImages: true }), scenario.pattern);
    assert.deepEqual(s.courses.get(s.row.saved_course_id), retained, 'The saved draft must not be reassembled from stale original lesson checkpoints');
    assert.equal(s.textCalls.length, counters.text); assert.equal(s.designCalls.length, counters.design); assert.equal(s.imageCalls.length, counters.images);
    assert.equal(s.commits, counters.commits); assert.equal(s.designCommits, counters.designCommits);
    assert.equal(s.deletes, 0); assert.equal(s.cleanup, 0); assert.equal(s.row.status, 'failed');
  });
});
