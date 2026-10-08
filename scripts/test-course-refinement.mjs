import assert from 'node:assert/strict';
import { withCourseCommitRpc } from './fixtures/course-commit-rpc.mjs';
import { curriculumFixture, lessonFixture, richComponentCombinations } from './fixtures/component-course.mjs';
import { retainComponentChoices } from '../web/js/generator/component-policy.mjs';
import { assembleCourse } from '../web/js/generator/assemble-course.js';
import { refinementFingerprint, refinementTarget, proposeCourseRefinement, acceptCourseRefinement } from '../web/api/_lib/course-refinement.mjs';

let checks = 0;
const check = (ok, label) => { assert.ok(ok, label); checks++; };
const equal = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
const reject = (fn, code) => { assert.throws(fn, error => error.code === code); checks++; };
const target = { kind: 'lesson', moduleId: 'foundations', topicId: 'lesson-1' };
function fixture(components = richComponentCombinations[15]) {
  const brief = retainComponentChoices(curriculumFixture(), { components });
  return { ...assembleCourse(brief, brief.modules.flatMap(mod => mod.topics.map(topic => ({ moduleId: mod.id, topicId: topic.id, content: lessonFixture(components, topic) })))), _brief: brief, _research: { foundations: { sources: [{ title: 'Preserved reference' }] } }, _generationJobId: 'job-refinement', _generationRunId: 'run-original', createdByUserId: 'owner', extraPrivate: { retained: true } };
}
for (const components of richComponentCombinations) {
  const course = fixture(components), original = structuredClone(course), lesson = course.modules[1]['lesson-1'];
  check(!proposeCourseRefinement(course, target, lesson).changed, 'unchanged lesson is a no-op');
  const replacement = structuredClone(lesson); replacement.title += ' improved';
  const result = proposeCourseRefinement(course, target, replacement);
  check(result.changed && result.impact.lessonCompletion, 'changed lesson requests a fresh completion check');
  equal(result.course.modules[1]['lesson-2'], original.modules[1]['lesson-2'], 'other lesson unchanged');
  equal(result.course._research, course._research, 'research stays private and unchanged');
  equal(result.course.config, course.config, 'component choices and configuration unchanged');
  equal(course, original, 'preview never mutates the current saved course');
  equal(result.impact.interactions, 0, 'title-only edit preserves interactive progress identities');
  equal(result.impact.flashcards, 0, 'title-only edit preserves card identities');
  for (let index = 0; index < lesson.sections.length; index++) {
    const section = structuredClone(lesson.sections[index]);
    if (section.type === 'quiz') {
      if (section.statement) section.statement += ' Consider the stated setting.';
      else if (section.question) section.question += ' Consider the stated setting.';
      else section.sentence += ' Consider the stated setting.';
    } else if (section.type === 'takeaway') section.points[0] += ' Review this again.';
    else section.title += ' improved';
    const edited = proposeCourseRefinement(course, { ...target, kind: 'section', index }, section);
    check(edited.changed, 'each selected section can be changed');
    equal(edited.course.modules[1]['lesson-1'].sections.filter((_, i) => i !== index), lesson.sections.filter((_, i) => i !== index), 'single-item edit leaves all other sections intact');
    equal(edited.impact.interactions, section.id ? 1 : 0, 'only the changed interaction starts fresh');
  }
  if (lesson.flashcards.length) {
    const card = { ...lesson.flashcards[0], front: 'What is a more specific lighting question?' };
    const edited = proposeCourseRefinement(course, { ...target, kind: 'flashcard', index: 0 }, card);
    equal(edited.impact.flashcards, 1, 'only changed flashcard starts fresh');
    equal(edited.lesson.flashcards.slice(1), lesson.flashcards.slice(1), 'remaining flashcards unchanged');
    equal(edited.lesson.sections, lesson.sections, 'flashcard edit preserves all lesson sections');
  }
}
const course = fixture(), lesson = course.modules[1]['lesson-1'];
const concept = { ...target, kind: 'section', index: 0 };
equal(refinementFingerprint({ a: 1, b: { x: 2, y: 3 } }), refinementFingerprint({ b: { y: 3, x: 2 }, a: 1 }), 'Postgres JSON key order cannot change the base fingerprint');
reject(() => refinementTarget(course, { ...target, moduleId: '__proto__' }), 'target');
reject(() => refinementTarget(course, { ...target, kind: 'section', index: -1 }), 'target');
reject(() => refinementTarget(course, { ...target, kind: 'flashcard', index: 999 }), 'target');
const absent = structuredClone(course); delete absent.modules[1]['lesson-1'];
reject(() => refinementTarget(absent, target), 'unavailable');
const ambiguous = structuredClone(course); ambiguous.curriculum.modules.push({ ...ambiguous.curriculum.modules[0], id: 'another-module' });
reject(() => refinementTarget(ambiguous, target), 'target');
reject(() => proposeCourseRefinement(course, target, { ...lesson, id: 'other-lesson' }), 'identity');
reject(() => proposeCourseRefinement(course, concept, { type: 'quiz' }), 'identity');
reject(() => proposeCourseRefinement(course, concept, { ...lesson.sections[0], content: 'short' }), 'validation');
reject(() => proposeCourseRefinement(course, concept, { ...lesson.sections[0], content: 'x'.repeat(1024 * 1024 + 1) }), 'size');
for (const html of ['<script>alert(1)</script>', '<img src=x onerror=alert(1)>', '<svg onload=alert(1)>', '<a href="java&#x73;cript:alert(1)">Open</a>', '<p style="background:url(javascript:alert(1))">bad</p>', '<a href="https://name:secret@example.com">bad</a>']) {
  reject(() => proposeCourseRefinement(course, concept, { ...lesson.sections[0], content: `<p>Enough explanatory text to reach the validation minimum.</p>${html}` }), 'markup');
}
check(proposeCourseRefinement(course, concept, { ...lesson.sections[0], content: '<p>Read the <a href="https://example.com/reference">reference</a> before applying this idea to your own photograph.</p>' }).changed, 'simple formatting and safe HTTPS links are allowed');
for (const rel of ['noopener noreferrer', 'noreferrer noopener']) {
  const content = `<p>Read the <a href="https://example.com/reference" target="_blank" rel="${rel}">reference</a> before applying this idea to your own photograph.</p>`;
  const result = proposeCourseRefinement(course, concept, { ...lesson.sections[0], content });
  equal(result.lesson.sections[0].content, content, 'safe external-link attributes are preserved');
}
for (const attrs of ['target="_blank"', 'target="_blank" rel="opener"', 'target="named-window" rel="noopener noreferrer"', 'target="_blank" rel="noopener noreferrer" onclick="alert(1)"']) {
  reject(() => proposeCourseRefinement(course, concept, { ...lesson.sections[0], content: `<p>Read this useful <a href="https://example.com/reference" ${attrs}>reference</a> before applying the idea to your own photograph.</p>` }), 'markup');
}
const qi = lesson.sections.findIndex(section => section.variant === 'multiple-choice');
reject(() => proposeCourseRefinement(course, { ...target, kind: 'section', index: qi }, { ...lesson.sections[qi], correct: 'absent' }), 'validation');
reject(() => proposeCourseRefinement(course, { ...target, kind: 'section', index: qi }, { ...lesson.sections[qi], variant: 'true-false' }), 'identity');
const imageCourse = fixture(); imageCourse.modules[1]['lesson-1'].sections.push({ type: 'image', src: 'https://example.com/image.png', alt: 'Side lighting on the subject' });
const imageTarget = { ...target, kind: 'section', index: imageCourse.modules[1]['lesson-1'].sections.length - 1 };
for (const image of [{ type: 'image', url: 'https://example.com/new.png', ref_kind: 'web', alt: 'New lighting' }, { type: 'image', src: 'javascript:alert(1)', alt: 'New lighting' }, { type: 'image', src: 'data:image/svg+xml;base64,YQ==', alt: 'New lighting' }, { type: 'image', src: 'https://example.com/new.png', alt: 'New lighting', source_url: 'javascript:alert(1)' }]) reject(() => proposeCourseRefinement(imageCourse, imageTarget, image), 'media');
check(proposeCourseRefinement(imageCourse, imageTarget, { type: 'image', src: 'https://example.com/new.png', alt: 'The changed lighting angle' }).changed, 'saved image and alternative text can be replaced, without claiming generation');
const edited = proposeCourseRefinement(course, { ...target, kind: 'section', index: qi }, { ...lesson.sections[qi], question: 'Which adjustment simplifies the composition in this new example?' });
check(!proposeCourseRefinement(edited.course, { ...target, kind: 'section', index: qi }, edited.lesson.sections[qi]).changed, 'a previously refined interaction is still a no-op when unchanged');

// A real-shaped CAS double tests failure and races without exposing an endpoint.
function db({ status = 'completed', race = false, failWrite = false } = {}) {
  const state = { course: { id: course.config.id, owner_id: 'owner', payload: structuredClone(course), updated_at: '2026-09-16T00:00:00.000Z' }, writes: 0 };
  state.client = { from(table) {
    const filters = {}, q = { select() { return q; }, eq(k, v) { filters[k] = v; return q; }, is(k, v) { filters[k] = v; return q; }, update(value) { q.patch = value; return q; }, async maybeSingle() {
      if (table === 'generation_jobs') return { data: filters.owner_id === 'owner' ? { status } : null, error: null };
      const row = state.course;
      if (filters.owner_id !== row.owner_id || filters.id !== row.id) return { data: null, error: null };
      if (q.patch) {
        if (failWrite) return { error: new Error('offline') };
        if (race) row.updated_at = '2026-09-16T00:00:01.000Z';
        if (row.updated_at !== filters.updated_at) return { data: null, error: null };
        state.writes++; Object.assign(row, structuredClone(q.patch));
      }
      return { data: structuredClone(row), error: null };
    } }; return q;
  } }; withCourseCommitRpc(state.client); return state;
}
const request = { ownerId: 'owner', courseId: course.config.id, target: concept, replacement: { ...lesson.sections[0], title: 'A more focused first concept' }, baseHash: refinementFingerprint(course), operationId: 'operation-first-change', now: () => Date.parse('2026-09-16T00:00:00.000Z') };
const saved = db(); let result = await acceptCourseRefinement({ ...request, supabase: saved.client });
check(result.saved && saved.writes === 1, 'explicit accept saves one owned revision');
equal(result.payload.extraPrivate, course.extraPrivate, 'unrelated metadata survives accepted edit');
check(Date.parse(result.updatedAt) > Date.parse('2026-09-16T00:00:00.000Z'), 'CAS timestamp advances even with equal clock');
result = await acceptCourseRefinement({ ...request, supabase: saved.client });
check(result.replayed && saved.writes === 1, 'lost response retries the same operation without reapplying');
await assert.rejects(acceptCourseRefinement({ ...request, operationId: 'operation-second-change', supabase: saved.client }), error => error.code === 'conflict'); checks++;
await assert.rejects(acceptCourseRefinement({ ...request, replacement: { ...request.replacement, title: 'Different reused operation' }, supabase: saved.client }), error => error.code === 'conflict'); checks++;
for (const options of [{ status: 'running' }, { status: 'partial' }, { race: true }, { failWrite: true }]) {
  const store = db(options), before = structuredClone(store.course.payload);
  await assert.rejects(acceptCourseRefinement({ ...request, supabase: store.client })); checks++;
  equal(store.course.payload, before, 'busy, conflicting or failed save preserves accepted content');
}
const denied = db(); await assert.rejects(acceptCourseRefinement({ ...request, ownerId: 'other', supabase: denied.client }), error => error.code === 'not_found'); checks++;
check(denied.writes === 0, 'other account cannot replace the saved course');
console.log(`Focused refinement foundation: ${checks} checks passed; no UI or provider calls.`);
