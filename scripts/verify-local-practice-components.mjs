// Phase 2A.1: actual local Auth/Postgres/runner/checkpoints/account course save.
// Not creator UI acceptance. The new choices stay gated until learner QA passes.
// Every external request is blocked except synthetic model responses.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig } from './dev-setup-server.mjs';
import { richComponentCombinations, curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';

const config = await loadPreviewConfig(new URL('../.env.preview.local', import.meta.url));
assert.equal(config.mode, 'local'); assert.equal(config.url, 'http://127.0.0.1:54321');
Object.assign(process.env, { SUPABASE_URL: config.url, SUPABASE_ANON_KEY: config.publicKey, SUPABASE_SECRET_KEY: config.secretKey, LEARNABLE_PROVIDER_VAULT_KEY: config.vaultKey });
const { runGeneration } = await import('../web/api/_lib/gen-runner.mjs');
const { buildReviewTransition } = await import('../web/api/gen/review.js');
const { generationLeaseFields, sameRunFilter } = await import('../web/api/_lib/gen-state.mjs');
const { checkpointForJob, resumeModeFor, resumeStageFor } = await import('../web/api/_lib/gen-recovery.mjs');
const admin = createClient(config.url, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const originalFetch = globalThis.fetch, users = [], modelCalls = [];
let activeComponents = [], omitChecklist = 0, checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; };
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.origin === 'https://api.anthropic.com' && url.pathname === '/v1/messages') {
    const payload = JSON.parse(options.body);
    const name = payload.tool_choice?.name || payload.tools?.find(tool => tool.name === 'submit_research_bundle')?.name;
    let value, topic;
    if (name === 'submit_course_brief') value = curriculumFixture();
    else if (name === 'submit_research_bundle') value = { module_id: 'foundations', key_concepts: ['Natural light', 'Composition'], examples: ['Compare an angle', 'Choose one subject'], experts: [], misconceptions: [], sources: [], images: [] };
    else if (name === 'submit_topic') {
      topic = payload.messages[0].content.match(/Topic id: ([a-z0-9-]+)/)?.[1]; assert.ok(topic);
      value = lessonFixture(activeComponents, { id: topic, title: `Photography ${topic}` });
      if (topic === 'lesson-2' && omitChecklist > 0) {
        omitChecklist--; value.sections = value.sections.filter(section => section.type !== 'checklist');
      }
    } else throw new Error('Unexpected model tool in practice integration QA.');
    modelCalls.push({ name, topic, components: [...activeComponents] });
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', name, input: value }], usage: { input_tokens: 10, output_tokens: 10 } }), { headers: { 'Content-Type': 'application/json' } });
  }
  if (url.origin !== config.url) throw new Error('External request blocked in practice integration QA.');
  return originalFetch(input, options);
};
try {
  const email = `practice-contract-${randomUUID()}@example.test`, password = `${randomUUID()}Aa9!`;
  const made = await admin.auth.admin.createUser({ email, password, email_confirm: true }); assert.ok(!made.error);
  const owner = made.data.user.id; users.push(owner);
  const client = createClient(config.url, config.publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  assert.ok(!(await client.auth.signInWithPassword({ email, password })).error);
  const load = async id => {
    const result = await admin.from('generation_jobs').select('*').eq('id', id).eq('owner_id', owner).single();
    assert.ok(!result.error); return result.data;
  };
  const courseFor = async job => {
    const result = await client.from('user_courses').select('id,payload').eq('id', job.saved_course_id).single();
    assert.ok(!result.error); return result.data;
  };
  for (const [index, components] of richComponentCombinations.entries()) {
    activeComponents = components;
    const shouldFail = index === 15; omitChecklist = shouldFail ? 2 : 0;
    const id = `job-${randomUUID()}`, runId = randomUUID();
    const userBrief = { topic: 'Practice component integration QA', audience: 'New photographers', components, tone: 'conversational', source_text: '', source_urls: [] };
    const insert = await admin.from('generation_jobs').insert({ id, owner_id: owner, user_brief: userBrief, status: 'running', stage: 'intake', run_id: runId, ...generationLeaseFields() });
    assert.ok(!insert.error);
    const run = (leaseId, checkpoint, mode) => runGeneration({ supabase: admin, jobId: id, ownerId: owner, runId: leaseId, apiKey: 'sk-ant-synthetic-practice-QA', userBrief, checkpoint, pdfRefs: [], mode });
    await run(runId, null, 'curriculum');
    let job = await load(id);
    check(job.status === 'review_curriculum' && JSON.stringify(job.brief.components) === JSON.stringify(components), `${components}: canonical choices survive intake`);
    for (const action of ['approve_curriculum', 'approve_research']) {
      const nextRun = randomUUID();
      const transition = buildReviewTransition({ action, job, runId: nextRun, lease: generationLeaseFields() });
      const update = await admin.from('generation_jobs').update(transition.patch).eq('id', id).eq('owner_id', owner).eq('status', transition.expectedStatus).select('id').single();
      assert.ok(!update.error);
      await run(nextRun, transition.checkpoint, transition.runnerMode);
      job = await load(id);
      check(job.status === (action === 'approve_curriculum' ? 'review_research' : shouldFail ? 'partial' : 'completed'), `${components}: ${action} reaches honest status`);
    }
    if (shouldFail) {
      const partialCourse = await courseFor(job), accepted = structuredClone(job.topics_by_key);
      check(Object.keys(accepted).length === 2, 'missing checklist does not become a falsely complete third lesson');
      check(Object.keys(partialCourse.payload.modules[1]).length === 2, 'two accepted lessons remain account-saved in partial course');
      check(job.failures.some(failure => JSON.stringify(failure).includes('Checklists are selected')), 'durable failure identifies missing checklist');
      const checkpoint = checkpointForJob(job), nextRun = randomUUID(), before = modelCalls.length;
      const query = admin.from('generation_jobs').update({ status: 'running', run_id: nextRun, stage: resumeStageFor(job), error: null, completed_at: null, ...generationLeaseFields() }).eq('id', id).eq('owner_id', owner).eq('status', 'partial');
      const update = await sameRunFilter(query, job.run_id).select('id').single();
      assert.ok(!update.error, update.error?.message);
      await run(nextRun, checkpoint, resumeModeFor(job)); job = await load(id);
      check(job.status === 'completed' && job.saved_course_id === partialCourse.id, 'retry completes the same account course');
      check(modelCalls.length === before + 1 && modelCalls.at(-1).topic === 'lesson-2', 'retry regenerates only the failed lesson, not accepted content');
      for (const [key, content] of Object.entries(accepted)) { assert.deepEqual(job.topics_by_key[key], content); checks++; }
      check(!job.failures.length, 'resolved component failure is cleared');
    }
    const saved = await courseFor(job), payload = saved.payload;
    check(JSON.stringify(payload.config.components) === JSON.stringify(components), 'reopened durable course retains chosen components');
    check(Object.keys(payload.modules[1]).length === 3 && Object.values(payload.modules[1]).every(topic =>
      topic.sections.some(s => s.type === 'practice') === components.includes('practice') &&
      topic.sections.some(s => s.type === 'checklist') === components.includes('checklists') &&
      topic.sections.some(s => s.type === 'quiz') === components.includes('quizzes') &&
      !!topic.flashcards.length === components.includes('flashcards')
    ), 'all reopened lessons contain exactly the selected tools');
    check(payload._generationJobId === id, 'course provenance still points to its one source job');
  }
  check(modelCalls.length === 82, '16 complete courses plus one bounded failure/retry use 82 synthetic responses');
  const second = await admin.auth.admin.createUser({ email: `other-practice-${randomUUID()}@example.test`, password, email_confirm: true }); assert.ok(!second.error); users.push(second.data.user.id);
  const other = createClient(config.url, config.publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  assert.ok(!(await other.auth.signInWithPassword({ email: second.data.user.email, password })).error);
  const denied = await other.from('user_courses').select('id').eq('owner_id', owner);
  check(!denied.error && denied.data.length === 0, 'other account cannot read these private courses');
  const rows = await client.from('user_courses').select('id').eq('owner_id', owner);
  check(!rows.error && rows.data.length === 16, 'exactly one saved course per combination, including retried run');
  console.log(`Practice pipeline: ${checks} checks passed; 16 real local account courses, 82 synthetic model responses, one failed-component recovery. Not learner UI or paid-output acceptance.`);
} finally {
  for (const owner of users) {
    for (const table of ['generation_jobs', 'user_courses']) { const result = await admin.from(table).delete().eq('owner_id', owner); assert.ok(!result.error); }
    assert.ok(!(await admin.auth.admin.deleteUser(owner)).error);
  }
  globalThis.fetch = originalFetch;
  console.log('Removed only this run’s disposable local accounts, jobs and synthetic courses. User work unchanged.');
}
