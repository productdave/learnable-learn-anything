// Real orchestration/receipt/attachment helpers with synthetic provider/storage.
// No network, credentials, paid calls or hosted writes.
import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { runIntegratedCourseImages, attachGenerationImage, generationImageIdentity, integratedImageInventory,
  integratedImageProgress, usesIntegratedVisuals } from '../web/api/_lib/integrated-course-images.mjs';
import { ImageRequestError } from '../web/api/_lib/image-request-store.mjs';
import { ImageGenerationError } from '../web/api/_lib/image-policy.mjs';
import { decodeImagePNG } from '../web/api/_lib/openai-image.mjs';
import { syntheticImageResponse } from './fixtures/generated-image.mjs';
import { GENERATION_PAUSE } from '../web/api/_lib/gen-request-budget.mjs';
import { checkpointForJob, isImageOnlyRecovery, resumeStageFor } from '../web/api/_lib/gen-recovery.mjs';
import { continuationProgress } from '../web/api/_lib/gen-continuation.mjs';

const clone = value => structuredClone(value);
function fixture(decisions = ['generate', 'omit', 'generate']) {
  const ownerId = randomUUID(), jobId = 'job-integrated-test', runId = randomUUID(), courseId = 'integrated-test';
  const rows = new Map(), objects = new Map(), patches = [], hooks = {};
  const lessons = decisions.map((decision, i) => ({ id: `lesson-${i + 1}`, moduleId: 'basics', title: `Lesson ${i + 1}`,
    sections: [{ type: 'concept', title: 'A concept', content: '<p>Useful lesson content that stays unchanged.</p>' },
      { type: 'takeaway', points: ['Use evidence', 'Check assumptions', 'Keep learning'] }], flashcards: [],
    visual: decision === 'omit' ? { decision, reason: 'This short reflective lesson is clearer in text.' }
      : { decision, reason: 'A process diagram makes the feedback relationship clear.', prompt: `A clear process diagram for lesson ${i + 1}.`, alt: 'A process with a feedback loop.', caption: 'The feedback loop.', afterSectionIndex: 0 } }));
  let course = { id: courseId, created_at: '2026-10-01T00:00:00Z', updated_at: '2026-10-01T00:00:00Z',
    payload: { config: { id: courseId }, _generationJobId: jobId, _brief: { materials_policy: 'integrated-visuals-v2' },
      curriculum: { modules: [{ id: 'basics', number: 1, topics: lessons.map(lesson => ({ id: lesson.id, title: lesson.title })) }] },
      modules: { 1: Object.fromEntries(lessons.map(lesson => [lesson.id, lesson])) }, failedTopics: [] } };
  let calls = 0, clock = Date.now(), remaining = 270000, active = true, progress = null, commits = 0;
  const store = {
    async course(owner, id) { return owner === ownerId && id === courseId ? clone(course) : null; },
    async get(owner, id) { return owner === ownerId ? clone(rows.get(id) || null) : null; },
    async begin(row, expected, ack) {
      const existing = rows.get(row.id);
      if (existing) { if (existing.payload.requestHash !== row.payload.requestHash) throw new ImageRequestError('conflict'); return { row: clone(existing), replayed: true }; }
      const previous = [...rows.values()].find(item => item.slot_key === row.slot_key && item.is_current);
      if ((previous?.id || null) !== expected) throw new ImageRequestError('conflict');
      if (['queued', 'running', 'persisting'].includes(previous?.payload.status)) throw new ImageRequestError('busy');
      if (previous?.payload.mayHaveCharged && !ack) throw new ImageRequestError('charge_ack');
      if (previous) previous.is_current = false;
      const saved = { ...clone(row), revision: 1, is_current: true, accepted: false, status: 'queued' };
      rows.set(row.id, saved); return { row: clone(saved), replayed: false };
    },
    async update(row, patch) {
      const existing = rows.get(row.id);
      if (existing.revision !== row.revision) return null;
      const saved = { ...existing, revision: existing.revision + 1, status: patch.status || existing.status,
        payload: { ...existing.payload, ...clone(patch) } };
      rows.set(row.id, saved); return clone(saved);
    }
  };
  const assets = {
    async put(row, bytes) { objects.set(row.id, Buffer.from(bytes)); return true; },
    async read(row) { return objects.has(row.id) ? decodeImagePNG(objects.get(row.id).toString('base64')) : null; }
  };
  const supabase = { async rpc(name, input) {
    assert.equal(name, 'attach_generation_course_image');
    if (!active || input.p_owner !== ownerId || input.p_job !== jobId || input.p_run !== runId) return { data: { error: 'conflict' } };
    const row = rows.get(input.p_id);
    assert.equal(row.payload.status, 'ready'); assert.equal(input.p_revision, row.revision);
    assert.equal(course.updated_at, input.p_updated_at);
    course = { ...course, updated_at: new Date(++clock).toISOString(), payload: clone(input.p_payload) };
    row.accepted = true; row.revision++;
    row.payload.acceptance = { kind: 'generation-draft', jobId, operationId: input.p_operation, hash: input.p_hash };
    commits++;
    if (hooks.lostAttach) { hooks.lostAttach = false; throw new Error('Lost commit acknowledgement'); }
    return { data: { saved: true, payload: clone(course.payload), updatedAt: course.updated_at } };
  } };
  const args = { supabase, ownerId, jobId, runId, courseId, store, assets, env: { LEARNABLE_GPT_IMAGES: '1' },
    requestBudget: { remainingMs: () => remaining, runOperation: operation => operation(new AbortController().signal) },
    assertRunnerWritable: async () => { if (!active) throw new Error('Cancelled or superseded generation lease'); },
    patch: async value => { patches.push(clone(value)); progress = clone(value.image_progress); },
    generate: async input => {
      calls++; assert.equal(input.courseId, courseId); assert.ok(input.operationId); assert.match(input.requestHash, /^[a-f0-9]{64}$/);
      if (hooks.generate) return hooks.generate(input);
      return generated();
    } };
  function generated() { const image = syntheticImageResponse(); return { asset: decodeImagePNG(image.data[0].b64_json), provenance: {
    funding: 'creator', provider: 'openai', model: 'gpt-image-2.5-flare-2026-09-08', n: 1, size: '1024x1024', quality: 'medium',
    outputFormat: 'png', usage: image.usage, requestId: 'req_integrated_test' } }; }
  return { args, rows, objects, patches, hooks, generated, course: () => course,
    stats: () => ({ calls, commits }), checkpoint: () => clone(progress), setRemaining: ms => { remaining = ms; }, stop: () => { active = false; },
    run: options => runIntegratedCourseImages({ ...args, checkpoint: progress || {}, ...options }) };
}

test('one course action creates, saves and attaches only purposeful visuals', async () => {
  const f = fixture(), before = clone(f.course().payload.modules[1]);
  const result = await f.run();
  assert.deepEqual(f.stats(), { calls: 2, commits: 2 });
  assert.equal(result.progress.planned, 2); assert.equal(result.progress.completed, 2); assert.equal(result.progress.omitted, 1);
  assert.equal(result.progress.status, 'complete');
  assert.deepEqual(f.course().payload.modules[1]['lesson-2'], before['lesson-2']);
  assert.equal(f.course().payload.modules[1]['lesson-1'].sections[1].type, 'image');
  assert.equal(f.course().payload.modules[1]['lesson-1'].sections[2].type, 'takeaway');
  for (const row of f.rows.values()) {
    assert.equal(row.accepted, true); assert.equal(row.payload.acceptance.kind, 'generation-draft');
    assert.equal(row.payload.acceptance.reviewed, undefined);
  }
});

test('omitting every visual is a valid complete draft and makes no provider call', async () => {
  const f = fixture(['omit', 'omit']); const result = await f.run();
  assert.deepEqual(f.stats(), { calls: 0, commits: 0 }); assert.equal(f.rows.size, 0);
  assert.equal(result.progress.completed, 0); assert.equal(result.progress.planned, 0); assert.equal(result.progress.omitted, 2);
});

test('saved visuals survive repeated course Resume without reassembly or billing', async () => {
  const f = fixture(); await f.run(); const first = clone(f.course());
  await f.run({ retryFailedImages: true });
  assert.deepEqual(f.stats(), { calls: 2, commits: 2 }); assert.deepEqual(f.course(), first);
});

test('hosting slice pause persists attempt identity before any receipt or provider call', async () => {
  const f = fixture(['generate']); f.setRemaining(209999);
  await assert.rejects(f.run(), error => error.code === GENERATION_PAUSE);
  const item = f.checkpoint().items['basics/lesson-1']; assert.ok(item.operationId);
  assert.equal(f.rows.size, 0); assert.equal(f.stats().calls, 0);
  f.setRemaining(270000); await f.run(); assert.equal(f.rows.keys().next().value, item.operationId);
  assert.equal(f.stats().calls, 1);
});

for (const boundary of ['receipt', 'claim']) {
  test(`dispatch-margin loss after ${boundary} pauses safely and a fresh automatic slice replaces only the undispatched attempt`, async () => {
    const f = fixture(['generate', 'generate']);
    const originalPatch = f.args.patch;
    f.args.patch = async fields => { await originalPatch(fields); if (fields.image_progress.completed === 1) f.setRemaining(210001); };
    const original = f.args.store[boundary === 'receipt' ? 'begin' : 'update'];
    let changed = false;
    f.args.store[boundary === 'receipt' ? 'begin' : 'update'] = async (...args) => {
      const result = await original(...args);
      if (!changed && f.stats().calls === 1 && (boundary === 'receipt' || args[1]?.status === 'running')) {
        changed = true; f.setRemaining(209999);
      }
      return result;
    };
    await assert.rejects(f.run(), error => error.code === GENERATION_PAUSE);
    assert.deepEqual(f.stats(), { calls: 1, commits: 1 });
    assert.equal(f.checkpoint().status, 'running'); assert.equal(f.checkpoint().completed, 1);
    const failed = [...f.rows.values()].find(row => row.payload.error === 'not_started');
    assert.equal(failed.payload.workerDone, true); assert.equal(failed.payload.mayHaveCharged, false);
    assert.equal(failed.payload.usage, null); assert.equal(failed.payload.asset, null);
    const firstAsset = f.course().payload.modules[1]['lesson-1'].sections.find(section => section.asset_id).asset_id;
    f.args.patch = originalPatch; f.setRemaining(270000);
    await f.run(); // No explicit retryFailedImages permission on this automatic slice.
    assert.deepEqual(f.stats(), { calls: 2, commits: 2 });
    assert.equal(f.rows.size, 3); assert.equal(f.checkpoint().status, 'complete');
    assert.equal(f.rows.get(failed.id).payload.mayHaveCharged, false);
    assert.equal(f.rows.get(failed.id).is_current, false);
    assert.equal(f.course().payload.modules[1]['lesson-1'].sections.find(section => section.asset_id).asset_id, firstAsset);
    const replacement = f.checkpoint().items['basics/lesson-2'];
    assert.equal(replacement.attempt, 1); assert.equal(replacement.expectedRequestId, failed.id);
    assert.notEqual(replacement.operationId, failed.id);
  });
}

const noDispatchEvidenceDamage = {
  'unfinished worker': row => { row.payload.workerDone = false; },
  'possible prior charge': row => { row.payload.mayHaveCharged = true; },
  'missing charge evidence': row => { delete row.payload.mayHaveCharged; },
  'returned usage': row => { row.payload.usage = { input_tokens: 1, output_tokens: 1, total_tokens: 2 }; },
  'missing usage evidence': row => { delete row.payload.usage; },
  'provider request identity': row => { row.payload.providerRequestId = 'req_already_dispatched'; },
  'saved asset evidence': row => { row.payload.asset = { sha256: 'a'.repeat(64) }; },
  'noncurrent receipt': row => { row.is_current = false; },
  'accepted receipt': row => { row.accepted = true; },
  'changed lesson hash': row => { row.payload.baseHash = 'b'.repeat(64); },
  'different target': row => { row.payload.target.topicId = 'another-lesson'; },
  'different failure': row => { row.payload.error = 'quota'; },
  'unknown status': row => { row.status = row.payload.status = 'unknown'; },
};
for (const [name, damage] of Object.entries(noDispatchEvidenceDamage)) {
  test(`no-dispatch scheduling recovery requires proof: ${name}`, async () => {
    const f = fixture(['generate']);
    const begin = f.args.store.begin;
    f.args.store.begin = async (...args) => { const result = await begin(...args); f.setRemaining(209999); return result; };
    // Either the historical fatal error or the corrected safe pause gets us to
    // the same durable, known-undispatched fixture. Only the next-slice policy
    // is under test here.
    await assert.rejects(f.run());
    const row = [...f.rows.values()][0]; assert.equal(row.payload.error, 'not_started'); damage(row);
    f.args.store.begin = begin; f.setRemaining(270000);
    f.args.assets.read = async () => null; // Don't turn synthetic asset evidence into an accepted image.
    await assert.rejects(f.run());
    assert.deepEqual(f.stats(), { calls: 0, commits: 0 }); assert.equal(f.rows.size, 1);
  });
}

test('a later slice reuses the saved image and starts only remaining planned work', async () => {
  const f = fixture(['generate', 'generate']);
  const original = f.args.patch;
  f.args.patch = async fields => { await original(fields); if (fields.image_progress.completed === 1) f.setRemaining(100000); };
  await assert.rejects(f.run(), error => error.code === GENERATION_PAUSE);
  assert.equal(f.stats().calls, 1); assert.equal(f.checkpoint().completed, 1);
  f.args.patch = original; f.setRemaining(270000); await f.run();
  assert.equal(f.stats().calls, 2); assert.equal(f.checkpoint().completed, 2);
});

test('lost attachment acknowledgement reconciles the saved draft without another paid image', async () => {
  const f = fixture(['generate']); f.hooks.lostAttach = true;
  await assert.rejects(f.run(), /Lost commit acknowledgement/);
  assert.equal(f.stats().calls, 1); assert.equal(f.stats().commits, 1);
  await f.run(); assert.equal(f.stats().calls, 1); assert.equal(f.checkpoint().completed, 1);
});

test('a confirmed provider failure preserves lessons and only explicit course Resume retries', async () => {
  const f = fixture(['generate']);
  f.hooks.generate = () => { throw new ImageGenerationError('quota', { dispatched: true }); };
  await assert.rejects(f.run(), /OpenAI course image generation.*quota/);
  assert.equal(f.course().payload.modules[1]['lesson-1'].sections[0].type, 'concept');
  assert.equal(f.checkpoint().status, 'attention');
  await assert.rejects(f.run(), /quota/); assert.equal(f.stats().calls, 1);
  f.hooks.generate = null; await f.run({ retryFailedImages: true });
  assert.equal(f.stats().calls, 2); assert.equal(f.rows.size, 2); assert.equal(f.checkpoint().completed, 1);
});

for (const code of ['timeout', 'response', 'unavailable']) {
  test(`uncertain ${code} never creates a replacement even on explicit Resume`, async () => {
    const f = fixture(['generate']);
    f.hooks.generate = () => { throw new ImageGenerationError(code, { dispatched: true }); };
    await assert.rejects(f.run(), /could not be confirmed/);
    const id = f.rows.keys().next().value;
    f.hooks.generate = null;
    await assert.rejects(f.run({ retryFailedImages: true }), /could not be confirmed/);
    assert.equal(f.stats().calls, 1); assert.equal(f.rows.size, 1); assert.equal(f.rows.keys().next().value, id);
  });
}

test('cancellation after provider return prevents attaching or finalizing the draft', async () => {
  const f = fixture(['generate']); f.hooks.generate = () => { f.stop(); return f.generated(); };
  await assert.rejects(f.run(), /Cancelled/);
  assert.equal(f.stats().calls, 1); assert.equal(f.stats().commits, 0);
  assert.equal(f.course().payload.modules[1]['lesson-1'].sections.some(s => s.type === 'image'), false);
});

test('old saved courses and missing visual decisions cannot silently opt into paid work', async () => {
  const f = fixture(); f.course().payload._brief.materials_policy = 'standard-images-no-practice-v1';
  await assert.rejects(f.run(), /does not|no longer/); assert.equal(f.stats().calls, 0);
  assert.equal(usesIntegratedVisuals(f.course().payload._brief), false);
  const g = fixture(); delete g.course().payload.modules[1]['lesson-1'].visual;
  await assert.rejects(g.run(), /missing its visual teaching decision/); assert.equal(g.stats().calls, 0);
});

test('missing or invalid saved lessons block completion before any image dispatch', async () => {
  for (const damage of [
    course => { delete course.modules[1]['lesson-2']; },
    course => { course.modules[1]['lesson-2'].sections = []; },
    course => { course.modules[1]['lesson-2'].moduleId = 'another-module'; },
    course => { course.curriculum.modules = []; },
    course => { course.curriculum.modules[0].topics = []; }
  ]) {
    const f = fixture(); damage(f.course().payload);
    await assert.rejects(f.run(), /missing.*lesson|lesson.*missing/i);
    assert.equal(f.stats().calls, 0); assert.equal(f.stats().commits, 0); assert.equal(f.rows.size, 0);
  }
});

test('attached asset replay cannot claim success after later lesson replacement', async () => {
  const f = fixture(['generate']); await f.run(); const item = f.checkpoint().items['basics/lesson-1'];
  f.course().payload.modules[1]['lesson-1'].sections = f.course().payload.modules[1]['lesson-1'].sections.filter(s => s.type !== 'image');
  await assert.rejects(attachGenerationImage({ ...f.args, ...item, visual: f.course().payload.modules[1]['lesson-1'].visual }), error => error.code === 'stale');
});

test('image checkpoints survive recovery and advance continuation only on saved results', () => {
  const base = { brief: {}, saved_course_id: 'course', image_progress: { version: 1, items: {} }, stage: 'images' };
  assert.equal(resumeStageFor(base), 'images'); assert.deepEqual(checkpointForJob(base).image_progress, base.image_progress);
  assert.equal(checkpointForJob(base).saved_course_id, 'course');
  const previous = continuationProgress(base);
  base.image_progress.items.a = { operationId: 'one', status: 'running' };
  assert.equal(continuationProgress(base), previous);
  base.image_progress.items.a.status = 'saved'; assert.notEqual(continuationProgress(base), previous);
  const identity = { jobId: 'job', courseId: 'course', key: 'module/lesson', baseHash: 'a'.repeat(64) };
  assert.equal(generationImageIdentity(identity), generationImageIdentity({ ...identity, runId: 'new-lease' }));
  assert.notEqual(generationImageIdentity(identity), generationImageIdentity({ ...identity, attempt: 1 }));
});

test('runner retains integrated drafts and bypasses text reassembly on image recovery', () => {
  const source = readFileSync(new URL('../web/api/_lib/gen-runner.mjs', import.meta.url), 'utf8');
  const guard = source.indexOf("if (mode === 'complete' && usesIntegratedVisuals(userBrief) && checkpoint?.saved_course_id");
  assert.ok(guard > 0 && guard < source.indexOf('assertCloudGenerationModelSupport(aiModels);'));
  assert.equal(source.split('createAnthropic({ apiKey,').length, 2, 'one lazy client factory for both writing and refinement');
  assert.match(source, /courseSaveAttempt = null;\s+if \(status === 'completed'\) \{\s+await patch\(\{ stage: usesVisualDesigner\(userBrief\) \? 'design' : 'images'/);
  assert.match(source, /checkpoint.stage === 'images' \|\| checkpoint.stage === 'assemble' && checkpoint.image_progress\?\.status === 'complete'/);
  assert.match(source, /stage: usesIntegratedVisuals\(userBrief\) \? 'topics' : 'assemble'/);
  const resume = readFileSync(new URL('../web/api/gen/resume.js', import.meta.url), 'utf8');
  const sweep = readFileSync(new URL('../web/api/gen/sweep.js', import.meta.url), 'utf8');
  assert.match(resume, /retryFailedImages: true/); assert.doesNotMatch(sweep, /retryFailedImages: true/);
});

test('explicit Restart can create a new visual cycle without replacing old immutable receipts', async () => {
  const f = fixture(['generate']); await f.run();
  const first = f.checkpoint(), oldId = [...f.rows.keys()][0];
  const lesson = f.course().payload.modules[1]['lesson-1'];
  lesson.sections = lesson.sections.filter(section => section.type !== 'image');
  // A course Restart creates a fresh lease and clears image_progress; unlike
  // Resume it intentionally generates a fresh draft from the original request.
  await f.run({ checkpoint: {}, runId: randomUUID(), attach: async input => {
    const row = f.rows.get(input.operationId); row.accepted = true;
    lesson.sections.push({ type: 'image', image_slot: 'instruction', generated_by: 'openai', asset_id: row.id, alt: row.payload.alt });
    return { saved: true };
  } });
  assert.equal(f.stats().calls, 2); assert.equal(f.rows.size, 2); assert.equal(f.rows.has(oldId), true);
  assert.notEqual(f.checkpoint().cycle, first.cycle);
  const restart = readFileSync(new URL('../web/api/gen/restart.js', import.meta.url), 'utf8');
  const sweep = readFileSync(new URL('../web/api/gen/sweep.js', import.meta.url), 'utf8');
  const ready = readFileSync(new URL('../web/api/gen/credentials-ready.js', import.meta.url), 'utf8');
  for (const source of [restart, sweep, ready]) assert.match(source, /image_progress: null,\s+design_progress: null,\s+continuation: null/);
});

test('image-only recovery does not require the completed text provider again', () => {
  const job = { stage: 'images', saved_course_id: 'draft', user_brief: { materials_policy: 'integrated-visuals-v2' } };
  assert.equal(isImageOnlyRecovery(job), true);
  assert.equal(isImageOnlyRecovery({ ...job, stage: 'assemble', image_progress: { status: 'complete' } }), true);
  assert.equal(isImageOnlyRecovery({ ...job, stage: 'assemble', image_progress: { status: 'running' } }), false);
  assert.equal(isImageOnlyRecovery({ ...job, stage: 'topics' }), false);
  assert.equal(isImageOnlyRecovery({ ...job, saved_course_id: null }), false);
  assert.equal(isImageOnlyRecovery({ ...job, user_brief: {} }), false);
  assert.equal(isImageOnlyRecovery({ ...job, message: 'Restarting from your saved request' }), false);
});
