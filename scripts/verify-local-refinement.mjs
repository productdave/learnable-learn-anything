// Disposable local accounts only. This directly tests the persistence contract;
// the creator editor, learner revision consumption and public route are not enabled.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig } from './dev-setup-server.mjs';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';
import { retainComponentChoices } from '../web/js/generator/component-policy.mjs';
import { assembleCourse } from '../web/js/generator/assemble-course.js';
import { acceptCourseRefinement, refinementFingerprint, courseRefinementFingerprint } from '../web/api/_lib/course-refinement.mjs';

const config = await loadPreviewConfig(new URL('../.env.preview.local', import.meta.url));
assert.equal(config.mode, 'local'); assert.equal(config.url, 'http://127.0.0.1:54321');
const admin = createClient(config.url, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const accounts = []; let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const read = async account => { const result = await account.client.from('user_courses').select('payload,updated_at').eq('owner_id', account.owner).eq('id', 'refinement-qa').single(); assert.ok(!result.error); return result.data; };
try {
  const components = ['lessons', 'practice', 'checklists', 'quizzes', 'flashcards'];
  const brief = retainComponentChoices(curriculumFixture(), { components });
  for (let index = 0; index < 2; index++) {
    const email = `refinement-${randomUUID()}@example.test`, password = `${randomUUID()}Aa9!`;
    const made = await admin.auth.admin.createUser({ email, password, email_confirm: true }); assert.ok(!made.error);
    const account = { owner: made.data.user.id, client: createClient(config.url, config.publicKey, { auth: { persistSession: false, autoRefreshToken: false } }), jobId: `refinement-${randomUUID()}` }; accounts.push(account);
    assert.ok(!(await account.client.auth.signInWithPassword({ email, password })).error);
    const course = assembleCourse(brief, brief.modules.flatMap(mod => mod.topics.map(topic => ({ moduleId: mod.id, topicId: topic.id, content: lessonFixture(components, topic) }))));
    course.config.id = 'refinement-qa'; Object.assign(course, { _brief: brief, _generationJobId: account.jobId, createdByUserId: account.owner, privateOriginals: { retained: 'Synthetic private source' } });
    const jobInsert = await admin.from('generation_jobs').insert({ id: account.jobId, owner_id: account.owner, status: 'completed', stage: 'done', completed_at: new Date().toISOString() });
    assert.ok(!jobInsert.error, jobInsert.error?.message);
    assert.ok(!(await account.client.from('user_courses').insert({ owner_id: account.owner, id: 'refinement-qa', payload: course })).error);
    assert.ok(!(await account.client.from('user_state').insert({ user_id: account.owner, state: { _learningV2: { courses: { 'refinement-qa': { quizAnswers: { retained: { selected: 'a' } } } } }, unrelated: 'retained' } })).error);
  }
  const [a, b] = accounts, before = await read(a), otherBefore = await read(b);
  const request = { supabase: a.client, ownerId: a.owner, courseId: 'refinement-qa', target: { kind: 'section', moduleId: 'foundations', topicId: 'lesson-1', index: 0 }, replacement: { ...before.payload.modules[1]['lesson-1'].sections[0], title: 'Changed only in the creator account' }, baseHash: courseRefinementFingerprint(before.payload), operationId: randomUUID() };
  const saved = await acceptCourseRefinement(request);
  check(saved.saved && !saved.replayed, 'owned edit persists through actual Postgres');
  const after = await read(a);
  check(after.payload.modules[1]['lesson-1'].sections[0].title === request.replacement.title, 'fresh read sees accepted replacement');
  check(JSON.stringify(after.payload.modules[1]['lesson-2']) === JSON.stringify(before.payload.modules[1]['lesson-2']), 'another lesson is unchanged');
  check(after.payload.privateOriginals.retained === before.payload.privateOriginals.retained, 'private originals are retained');
  check(refinementFingerprint((await read(b)).payload) === refinementFingerprint(otherBefore.payload), 'same course slug in another account is independent');
  const replay = await acceptCourseRefinement(request);
  check(replay.replayed && replay.updatedAt === after.updated_at, 'lost response retry does not create another write');
  await assert.rejects(acceptCourseRefinement({ ...request, operationId: randomUUID() }), error => error.code === 'conflict'); checks++;
  await assert.rejects(acceptCourseRefinement({ ...request, supabase: b.client, ownerId: a.owner }), error => error.code === 'not_found'); checks++;
  const progress = await a.client.from('user_state').select('state').eq('user_id', a.owner).single(); assert.ok(!progress.error);
  check(progress.data.state._learningV2.courses['refinement-qa'].quizAnswers.retained.selected === 'a' && progress.data.state.unrelated === 'retained', 'content save does not rewrite learning state');
  const next = { ...request, baseHash: courseRefinementFingerprint(after.payload), operationId: randomUUID(), replacement: { ...request.replacement, title: 'One of two competing changes' } };
  const concurrent = await Promise.allSettled([acceptCourseRefinement(next), acceptCourseRefinement({ ...next, operationId: randomUUID(), replacement: { ...next.replacement, title: 'The competing accepted change' } })]);
  check(concurrent.filter(result => result.status === 'fulfilled').length === 1 && concurrent.filter(result => result.status === 'rejected' && result.reason.code === 'conflict').length === 1, 'two competing devices cannot overwrite each other');
  const latest = await read(a);
  assert.ok(!(await admin.from('generation_jobs').update({ status: 'running', completed_at: null }).eq('owner_id', a.owner).eq('id', a.jobId)).error);
  await assert.rejects(acceptCourseRefinement({ ...next, baseHash: courseRefinementFingerprint(latest.payload), operationId: randomUUID() }), error => error.code === 'building'); checks++;
  check(refinementFingerprint((await read(a)).payload) === refinementFingerprint(latest.payload), 'active-build rejection leaves course unchanged');
  console.log(`Local refinement contract: ${checks} checks passed with actual Auth/Postgres/RLS; no provider calls or UI enablement.`);
} finally {
  for (const account of accounts) {
    assert.ok(!(await admin.from('user_state').delete().eq('user_id', account.owner)).error);
    assert.ok(!(await admin.from('user_courses').delete().eq('owner_id', account.owner)).error);
    assert.ok(!(await admin.from('generation_jobs').delete().eq('owner_id', account.owner)).error);
    assert.ok(!(await admin.auth.admin.deleteUser(account.owner)).error);
  }
  console.log('Removed only disposable refinement QA accounts and their test records.');
}
