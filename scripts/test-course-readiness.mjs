import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { inspectSavedCourse } from '../web/js/course-readiness.js';
import { savedCourseReadinessHTML } from '../web/js/course-readiness-view.js';
import { createHomeController } from '../web/js/home.js';
import { assembleCourse } from '../web/js/generator/assemble-course.js';
import { retainComponentChoices } from '../web/js/generator/component-policy.mjs';
import { curriculumFixture, lessonFixture, richComponentCombinations } from './fixtures/component-course.mjs';
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
function fixture(components = ['lessons', 'practice', 'checklists', 'quizzes', 'flashcards']) {
  const brief = retainComponentChoices(curriculumFixture(), { components });
  const course = assembleCourse(brief, brief.modules.flatMap(mod => mod.topics.map(topic => ({ moduleId: mod.id, topicId: topic.id, content: lessonFixture(components, topic) }))));
  return { ...course, _brief: brief, _generationJobId: 'ready-job', createdByUserId: 'owner', _research: { foundations: { key_concepts: ['Light', 'Composition'], sources: [{ title: 'Fixture source', url: 'https://example.com/source' }] } } };
}
for (const components of richComponentCombinations) {
  const course = fixture(components), before = JSON.stringify(course), report = inspectSavedCourse(course);
  check(report.available && report.saved === 3 && report.total === 3 && report.gaps.length === 0, 'supported combination inventory complete');
  for (const material of report.materials) check(material.selected === components.includes(material.id) && material.lessons === (material.selected ? 3 : 0), `${material.id} counted from content`);
  const html = savedCourseReadinessHTML(course);
  check(!html.includes('Lesson not saved') && html.includes('not certify accuracy'), 'inventory is not quality certification');
  check(JSON.stringify(course) === before, 'read-only inspection never mutates saved content');
}
const course = fixture();
delete course.modules[1]['lesson-2']; course.failedTopics = ['foundations/lesson-2'];
let report = inspectSavedCourse(course);
check(report.saved === 2 && report.total === 3 && report.gaps.length === 1 && report.partial, 'missing saved lesson stays partial');
let dom = parseHTML(savedCourseReadinessHTML(course));
check(!dom.document.querySelector('a[href$="/lesson-2"]') && dom.document.querySelector('a[href$="/lesson-1"]') === null, 'affected-only list has no broken missing-lesson link');
check(dom.document.toString().includes('Not available to open yet'), 'missing content has a useful explanation');
const incomplete = fixture();
incomplete.modules[1]['lesson-1'].sections = incomplete.modules[1]['lesson-1'].sections.filter(s => s.type !== 'checklist');
incomplete.modules[1]['lesson-3'].flashcards = [{ front: '', back: '' }];
report = inspectSavedCourse(incomplete);
check(report.saved === 3 && report.gaps.length === 2 && report.needsAttention, 'missing selected materials do not become ready');
dom = parseHTML(savedCourseReadinessHTML(incomplete));
check(dom.document.querySelectorAll('.ready-lesson-list a').length === 2, 'saved affected lessons are directly reviewable');
const malformedQuiz = fixture();
malformedQuiz.modules[1]['lesson-1'].sections.find(s => s.variant === 'multiple-choice').correct = 'nonexistent-answer';
check(inspectSavedCourse(malformedQuiz).lessons[0].gaps.includes('quizzes'), 'unusable quiz answer is flagged');
const shortQuiz = fixture(); shortQuiz.modules[1]['lesson-1'].sections = shortQuiz.modules[1]['lesson-1'].sections.filter(s => s.type !== 'quiz' || s.variant === 'true-false');
check(inspectSavedCourse(shortQuiz).lessons[0].gaps.includes('quizzes'), 'one quiz does not satisfy a selected 3–5 quiz lesson');
const images = fixture();
images.modules[1]['lesson-1'].sections.push({ type: 'image', ref_kind: 'pdf', file_index: 0, page: 1, alt: '' });
report = inspectSavedCourse(images);
check(report.images === 1 && report.lessons[0].warnings.length === 2, 'unresolved source and missing alt text flagged');
check(savedCourseReadinessHTML(images).includes('they don’t confirm GPT-generated illustrations'), 'reference images never prove generated-image delivery');
const unsafe = fixture(); unsafe._research.foundations.sources = [{ title: '<img src=x onerror=alert(1)>', url: 'javascript:alert(1)' }, { title: 'Credentials', url: 'https://name:secret@example.com' }];
unsafe.curriculum.modules[0].topics[0].title = '<script>alert(1)</script>';
dom = parseHTML(savedCourseReadinessHTML(unsafe));
check(dom.document.querySelectorAll('img,script,[onerror],a[href^="javascript:"]').length === 0, 'saved labels and references render as escaped safe text');
check(!dom.document.toString().includes('name:secret'), 'unsafe reference URL credentials are not displayed');
const legacy = fixture(['lessons']); delete legacy.config.components; delete legacy._brief.components;
report = inspectSavedCourse(legacy);
check(report.materials.every(material => material.selected === null) && report.gaps.length === 0, 'legacy course does not invent requested quizzes/flashcards');
check(report.warnings.some(w => w.includes('no saved material selection')), 'unknown expectations are explicit');
const missingResearch = fixture(); delete missingResearch._research;
report = inspectSavedCourse(missingResearch);
check(report.evidence.missing === 1 && report.warnings.some(w => w.includes('no inspectable')), 'missing research is not a passed evidence check');
for (const data of [null, {}, { config: {}, curriculum: { modules: [null] } }, { config: {}, curriculum: { modules: [{ id: 'm', number: 1, topics: [null] }] } }]) check(!inspectSavedCourse(data).available, 'unavailable/corrupt curriculum is unknown, not zero-success');
const duplicate = fixture(); duplicate.curriculum.modules[0].topics[1].id = 'lesson-1';
check(inspectSavedCourse(duplicate).needsAttention, 'duplicate internal identifiers need attention');
const unsupported = fixture(); unsupported.config.components.push('images');
check(inspectSavedCourse(unsupported).needsAttention, 'unsupported requested images do not imply delivery');
const noLessons = fixture(); noLessons.config.components = [];
check(inspectSavedCourse(noLessons).needsAttention, 'invalid selection without required lessons needs attention');
const badAddress = fixture(); badAddress.curriculum.modules[0].id = 'unsupported_module';
check(!inspectSavedCourse(badAddress).lessons[0].openable, 'unsupported learner address has no broken review link');
check(!savedCourseReadinessHTML(incomplete, { jobAvailable: true }).includes('build history is not available'), 'completed job with gaps does not falsely claim missing build history');
check(savedCourseReadinessHTML(incomplete, { jobAvailable: true, recoveryAvailable: true }).includes('recovery controls above'), 'recoverable job points to existing recovery controls');

// Real Home controller with bounded service doubles: job/checkpoint counts must
// never replace an inventory of the independently saved account copy.
const browser = parseHTML('<html><head></head><body><main id="content"></main></body></html>');
globalThis.window = browser.window; globalThis.document = browser.document;
globalThis.location = new URL('https://example.test/?experience=workspace&workspace=ready-job');
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
globalThis.history = { replaceState() {}, pushState() {} };
let current = incomplete, owner = 'owner', jobs = [{ id: 'ready-job', ownerId: owner, runner: 'cloud', status: 'completed', courseInstalled: true, savedCourseId: incomplete.config.id, topicsTotal: 3, topicsDone: 3 }];
const controller = createHomeController({
  getUser: () => ({ id: owner }), listJobs: () => jobs, getJob: () => jobs[0],
  getSavedCourse: id => owner === 'owner' && id === current?.config.id ? current : null,
  loadLibrary: async () => ({ courses: owner === 'owner' && current ? [{ id: current.config.id, title: 'Saved course', user: true }] : [] }),
  onJobsChange: () => () => {}, canDelete: () => false, wireCourses() {}, wireJobs() {},
  jobControls: job => `<a href="?course=${job.savedCourseId}">Open course</a>`, refreshCloud: async () => {}
});
const host = document.querySelector('#content');
await controller.render(host, 'ready-job');
check(host.querySelector('.home-workspace-head .home-status').textContent === 'Draft needs attention', 'completed job with content gaps is not labelled Ready');
check(host.querySelector('.home-timeline li:last-child').className === 'is-next', 'timeline does not certify incomplete Ready');
check(host.querySelectorAll('.ready-lesson-list a').length === 2, 'workspace lists the actual saved gaps');
jobs = []; current = course; await controller.render(host, 'ready-job');
check(host.querySelector('.home-status').textContent === 'Partially ready', 'removed job history never turns saved partial course into Ready');
current = fixture(); await controller.render(host, 'ready-job');
check(host.querySelector('.home-status').textContent === 'Ready for review' && host.textContent.includes('3 / 3 lessons'), 'saved complete course works without job history and is a draft for human review');
owner = 'other'; await controller.render(host, 'ready-job');
check(host.textContent.includes('Workspace unavailable') && !host.textContent.includes('Fixture source'), 'another account sees no saved content or evidence');
controller.dispose();
console.log(`Saved course readiness: ${checks} model/render/controller checks passed.`);
