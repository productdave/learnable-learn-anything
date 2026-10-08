// Actual image orchestration, receipt and attachment helpers with in-memory IO.
// No credentials, network, hosted changes or real provider calls are used.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { runIntegratedCourseImages, attachGenerationImage } from '../web/api/_lib/integrated-course-images.mjs';
import { designContentHash, designHash, assertDesignComplete } from '../web/api/_lib/visual-designer.mjs';
import { ImageRequestError } from '../web/api/_lib/image-request-store.mjs';
import { decodeImagePNG } from '../web/api/_lib/openai-image.mjs';
import { syntheticImageResponse } from './fixtures/generated-image.mjs';

const clone = value => structuredClone(value);
function fixture(decisions = ['generate', 'generate']) {
  const ownerId = randomUUID(), jobId = 'job-visual-binding', runId = randomUUID(), courseId = 'visual-binding';
  const requests = new Map(), objects = new Map(), patches = [], hooks = {};
  const lessons = decisions.map((decision, index) => ({ id: `lesson-${index + 1}`, moduleId: 'basics', title: `Refined lesson ${index + 1}`,
    sections: [{ type: 'concept', title: 'An explanation', content: '<p>Clear, saved teaching content.</p>' },
      { type: 'takeaway', points: ['Use evidence', 'Check assumptions', 'Keep learning'] }], flashcards: [],
    visual: decision === 'omit' ? { decision, reason: 'This reflective lesson is clearer without another image.' }
      : { decision, reason: 'A process diagram clarifies the feedback relationship.', prompt: `A specific feedback diagram for refined lesson ${index + 1}.`,
        alt: 'A process diagram with a labelled feedback loop.', caption: 'Use feedback to adjust the next step.', afterSectionIndex: 0 } }));
  let row = { id: courseId, created_at: '2026-10-02T00:00:00Z', updated_at: '2026-10-02T00:00:00Z', payload: {
    config: { id: courseId }, _generationJobId: jobId, _courseRevision: randomUUID(),
    _brief: { materials_policy: 'integrated-visuals-v2', visual_designer_policy: 'learner-experience-v1', components: ['lessons', 'images'] },
    curriculum: { modules: [{ id: 'basics', number: 1, topics: lessons.map(lesson => ({ id: lesson.id, title: lesson.title })) }] },
    modules: { 1: Object.fromEntries(lessons.map(lesson => [lesson.id, lesson])) }, failedTopics: []
  } };
  row.payload._visualDesign = { version: 1, policy: 'learner-experience-v1', cycle: randomUUID(), sourceRevision: row.payload._courseRevision,
    status: 'complete', review: { summary: 'Teaching order and copy reviewed.', lessons: lessons.map(lesson => ({ moduleId: 'basics', topicId: lesson.id })) },
    pending: null, items: Object.fromEntries(lessons.map(lesson => [`basics/${lesson.id}`, { status: 'saved', inputHash: designHash(lesson), outputHash: designHash(lesson) }])),
    contentHash: designContentHash(row.payload) };
  let clock = Date.parse(row.updated_at), calls = 0, commits = 0, progress = null;
  const store = {
    async course(owner, id) { return owner === ownerId && id === courseId ? clone(row) : null; },
    async get(owner, id) { return owner === ownerId ? clone(requests.get(id) || null) : null; },
    async begin(request, expected, acknowledge) {
      const prior = requests.get(request.id);
      if (prior) {
        if (prior.payload.requestHash !== request.payload.requestHash) throw new ImageRequestError('conflict');
        return { row: clone(prior), replayed: true };
      }
      const previous = [...requests.values()].find(item => item.slot_key === request.slot_key && item.is_current);
      if ((previous?.id || null) !== expected) throw new ImageRequestError('conflict');
      if (previous?.payload.mayHaveCharged && !acknowledge) throw new ImageRequestError('charge_ack');
      if (previous) previous.is_current = false;
      const saved = { ...clone(request), revision: 1, is_current: true, accepted: false, status: 'queued' };
      requests.set(saved.id, saved); return { row: clone(saved), replayed: false };
    },
    async update(request, fields) {
      const prior = requests.get(request.id);
      if (prior.revision !== request.revision) return null;
      const saved = { ...prior, revision: prior.revision + 1, status: fields.status || prior.status, payload: { ...prior.payload, ...clone(fields) } };
      requests.set(saved.id, saved); hooks.receiptUpdated?.(clone(saved)); return clone(saved);
    }
  };
  const assets = {
    async put(request, bytes) { objects.set(request.id, Buffer.from(bytes)); },
    async read(request) { return objects.has(request.id) ? decodeImagePNG(objects.get(request.id).toString('base64')) : null; }
  };
  const supabase = { async rpc(name, input) {
    assert.equal(name, 'attach_generation_course_image');
    assert.equal(input.p_owner, ownerId); assert.equal(input.p_job, jobId); assert.equal(input.p_run, runId); assert.equal(input.p_course, courseId);
    const request = requests.get(input.p_id);
    assert.equal(request.payload.status, 'ready'); assert.equal(input.p_revision, request.revision);
    assert.equal(input.p_updated_at, row.updated_at);
    row = { ...row, updated_at: new Date(++clock).toISOString(), payload: { ...clone(input.p_payload), _courseRevision: randomUUID() } };
    request.accepted = true; request.revision++;
    request.payload.acceptance = { kind: 'generation-draft', jobId, operationId: input.p_operation, hash: input.p_hash };
    commits++; hooks.attached?.(commits);
    return { data: { saved: true, payload: clone(row.payload), updatedAt: row.updated_at } };
  } };
  const args = { supabase, ownerId, jobId, runId, courseId, store, assets, env: { LEARNABLE_GPT_IMAGES: '1' },
    requestBudget: { remainingMs: () => 270000, runOperation: operation => operation(new AbortController().signal) },
    assertRunnerWritable: async () => {},
    patch: async fields => { patches.push(clone(fields)); progress = clone(fields.image_progress); hooks.patched?.(fields); },
    generate: async input => {
      calls++; assert.equal(input.courseId, courseId); hooks.generated?.(calls);
      const image = syntheticImageResponse();
      return { asset: decodeImagePNG(image.data[0].b64_json), provenance: { funding: 'creator', provider: 'openai',
        model: 'gpt-image-2.5-flare-2026-09-08', n: 1, size: '1024x1024', quality: 'medium', outputFormat: 'png',
        usage: image.usage, requestId: 'req_binding_synthetic' } };
    }
  };
  return { args, hooks, requests, objects, patches, row: () => row, stats: () => ({ calls, commits }),
    editOtherLesson() { row.payload.modules[1]['lesson-2'].sections[0].content = '<p>The creator changed this lesson.</p>'; row.payload._courseRevision = randomUUID(); row.updated_at = new Date(++clock).toISOString(); },
    run: () => runIntegratedCourseImages({ ...args, checkpoint: clone(progress || {}) }) };
}

const noCompletion = f => assert.equal(f.patches.some(value => value.image_progress?.status === 'complete'), false);

test('completed designer hash remains valid through attachment and image-only replay', async () => {
  const f = fixture(), originalHash = f.row().payload._visualDesign.contentHash;
  const result = await f.run();
  assert.deepEqual(f.stats(), { calls: 2, commits: 2 }); assert.equal(result.progress.status, 'complete');
  assert.equal(designContentHash(f.row().payload), originalHash); assertDesignComplete(f.row().payload);
  const saved = clone(f.row()); await f.run();
  assert.deepEqual(f.stats(), { calls: 2, commits: 2 }); assert.deepEqual(f.row(), saved);
});

test('missing completion or changed content blocks before any receipt or provider call', async () => {
  for (const damage of [
    f => { f.row().payload._visualDesign.status = 'refining'; },
    f => { f.row().payload._visualDesign.pending = { id: randomUUID(), key: 'course', status: 'unknown' }; },
    f => { delete f.row().payload._visualDesign.items['basics/lesson-2']; },
    f => f.editOtherLesson()
  ]) {
    const f = fixture(); damage(f);
    await assert.rejects(f.run(), { code: 'VISUAL_DESIGN_INCOMPLETE' });
    assert.deepEqual(f.stats(), { calls: 0, commits: 0 }); assert.equal(f.requests.size, 0); noCompletion(f);
  }
});

test('other-lesson edit during image one preserves its candidate but prevents attachment, image two and completion', async () => {
  const f = fixture(), originalFirstLesson = clone(f.row().payload.modules[1]['lesson-1']);
  f.hooks.generated = count => { if (count === 1) f.editOtherLesson(); };
  await assert.rejects(f.run(), { code: 'VISUAL_DESIGN_INCOMPLETE' });
  assert.deepEqual(f.stats(), { calls: 1, commits: 0 }); assert.equal(f.requests.size, 1); assert.equal(f.objects.size, 1);
  assert.equal([...f.requests.values()][0].payload.status, 'ready'); assert.equal([...f.requests.values()][0].accepted, false);
  assert.deepEqual(f.row().payload.modules[1]['lesson-1'], originalFirstLesson);
  assert.match(f.row().payload.modules[1]['lesson-2'].sections[0].content, /creator changed/); noCompletion(f);
  await assert.rejects(f.run(), { code: 'VISUAL_DESIGN_INCOMPLETE' });
  assert.deepEqual(f.stats(), { calls: 1, commits: 0 }); assert.equal(f.requests.size, 1);
});

test('edit after receipt claim is caught again immediately before provider dispatch', async () => {
  const f = fixture();
  f.hooks.receiptUpdated = request => { if (request.payload.status === 'running') f.editOtherLesson(); };
  await assert.rejects(f.run(), /cancelled/);
  assert.deepEqual(f.stats(), { calls: 0, commits: 0 }); assert.equal(f.requests.size, 1); assert.equal(f.objects.size, 0);
  const receipt = [...f.requests.values()][0];
  assert.equal(receipt.payload.status, 'failed'); assert.equal(receipt.payload.mayHaveCharged, false); noCompletion(f);
});

test('edit after image one commits is caught on reload while the saved image is retained', async () => {
  const f = fixture(); f.hooks.attached = count => { if (count === 1) f.editOtherLesson(); };
  await assert.rejects(f.run(), { code: 'VISUAL_DESIGN_INCOMPLETE' });
  assert.deepEqual(f.stats(), { calls: 1, commits: 1 }); assert.equal(f.requests.size, 1);
  const receipt = [...f.requests.values()][0]; assert.equal(receipt.accepted, true);
  assert.ok(f.row().payload.modules[1]['lesson-1'].sections.some(section => section.asset_id === receipt.id));
  assert.match(f.row().payload.modules[1]['lesson-2'].sections[0].content, /creator changed/); noCompletion(f);
});

test('accepted-image replay still validates the entire refined-content fingerprint', async () => {
  const f = fixture(); await f.run(); const receipt = [...f.requests.values()][0];
  f.editOtherLesson();
  await assert.rejects(attachGenerationImage({ ...f.args, operationId: receipt.id,
    acceptanceId: receipt.payload.acceptance.operationId, visual: f.row().payload.modules[1]['lesson-1'].visual }), { code: 'VISUAL_DESIGN_INCOMPLETE' });
  assert.deepEqual(f.stats(), { calls: 2, commits: 2 }); assert.equal(receipt.accepted, true);
});

test('all-omit course revalidates its saved refined text before reporting image completion', async () => {
  const f = fixture(['omit', 'omit']);
  f.hooks.patched = fields => { if (fields.image_progress?.status === 'running') f.editOtherLesson(); };
  await assert.rejects(f.run(), { code: 'VISUAL_DESIGN_INCOMPLETE' });
  assert.deepEqual(f.stats(), { calls: 0, commits: 0 }); assert.equal(f.requests.size, 0); noCompletion(f);
});

test('fully illustrated replay also reloads before reporting completion', async () => {
  const f = fixture(); await f.run(); f.patches.length = 0;
  f.hooks.patched = fields => { if (fields.image_progress?.status === 'running') f.editOtherLesson(); };
  await assert.rejects(f.run(), { code: 'VISUAL_DESIGN_INCOMPLETE' });
  assert.deepEqual(f.stats(), { calls: 2, commits: 2 }); assert.equal(f.requests.size, 2); noCompletion(f);
  assert.ok([...f.requests.values()].every(request => request.accepted));
});

test('saved designer metadata cannot silently downgrade to the legacy policy', async () => {
  const f = fixture(); delete f.row().payload._brief.visual_designer_policy;
  await assert.rejects(f.run(), { code: 'VISUAL_DESIGN_POLICY' });
  assert.deepEqual(f.stats(), { calls: 0, commits: 0 }); assert.equal(f.requests.size, 0); noCompletion(f);
});

test('removing both policy and metadata during image generation cannot remove the captured design requirement', async () => {
  const f = fixture(); f.hooks.generated = () => {
    delete f.row().payload._brief.visual_designer_policy;
    delete f.row().payload._visualDesign;
  };
  await assert.rejects(f.run(), { code: 'VISUAL_DESIGN_POLICY' });
  assert.deepEqual(f.stats(), { calls: 1, commits: 0 }); assert.equal(f.requests.size, 1); assert.equal(f.objects.size, 1); noCompletion(f);
});
