import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { HOME_URL, HOME_FILTERS, HOME_STATUSES, normalizeHomeFilter, normalizeHomeStatus, homeSelection, homeURL, workspaceExperience, visibleHomeJobs, jobPresentation, homeGroups, lifecycleSteps, matchesHomeSearch } from '../web/js/home-model.js';
import { homeJobHTML, homeCourseHTML, homeAuthorHTML } from '../web/js/home.js';
import { normalizePublicAuthor, publicAuthorInitials } from '../web/js/public-author.js';

let count = 0;
function test(name, fn) { fn(); count++; console.log(`ok - ${name}`); }
const job = (patch = {}) => ({ id: 'job-one', title: 'Swimming', runner: 'cloud', ownerId: 'owner', status: 'running', stage: 'intake', ...patch });

test('workspace replaces the legacy default without requiring a query switch', () => {
  assert.equal(HOME_URL, '/');
  assert.equal(workspaceExperience(''), true);
  assert.equal(workspaceExperience('?experience=legacy'), true);
  assert.equal(workspaceExperience('?experience=workspace'), true);
  assert.equal(workspaceExperience('?course=little-swimmer#/module/lesson'), true);
  assert.equal(workspaceExperience(HOME_URL), true);
});
test('workspace/course IDs and query are encoded without route injection', () => {
  const url = new URL(homeURL({ workspace: 'a&course=bad', q: '<text>', filter: 'attention' }), 'https://test.invalid');
  assert.equal(url.searchParams.get('workspace'), 'a&course=bad');
  assert.equal(url.searchParams.has('course'), false);
  assert.equal(url.searchParams.get('q'), '<text>');
  assert.equal(homeURL({ course: 'little-swimmer' }), '?course=little-swimmer');
});
test('cloud jobs require exact current owner; anonymous cannot see cached cloud jobs', () => {
  const jobs = [job(), job({ id: 'other', ownerId: 'other' }), job({ id: 'missing', ownerId: null })];
  assert.deepEqual(visibleHomeJobs(jobs, 'owner').map(j => j.id), ['job-one']);
  assert.deepEqual(visibleHomeJobs(jobs, ''), []);
});
test('explicitly owned legacy jobs also respect owner boundaries', () => {
  assert.equal(visibleHomeJobs([job({ runner: 'local', ownerId: 'other' })], 'owner').length, 0);
});
for (const status of ['review_curriculum', 'review_research', 'failed', 'interrupted', 'timed_out', 'partial', 'cancelled']) {
  test(`${status} appears under Needs Your Attention`, () => assert.equal(jobPresentation(job({ status })).group, 'attention'));
}
for (const status of ['running', 'queued', 'cancelling']) {
  test(`${status} appears under In progress`, () => assert.equal(jobPresentation(job({ status })).group, 'building'));
}
test('missing provider/file states have specific recovery messages', () => {
  assert.equal(jobPresentation(job({ needsApiKey: true })).label, 'API key needed');
  assert.equal(jobPresentation(job({ needsSourceReattach: true })).label, 'Files needed');
});
test('completion without installation is sync-needed, never Ready', () => {
  const j = job({ status: 'completed', savedCourseId: 'saved', courseInstalled: false });
  assert.equal(jobPresentation(j).label, 'Sync needed');
  assert.ok(!lifecycleSteps(j).every(step => step.state === 'done'));
  assert.match(homeJobHTML(j), /workspace=job-one/);
});
test('completed installed course links to learner without mutation', () => {
  const j = job({ status: 'completed', savedCourseId: 'saved', courseInstalled: true });
  assert.equal(jobPresentation(j).label, 'Ready');
  assert.ok(lifecycleSteps(j).every(step => step.state === 'done'));
  assert.match(homeJobHTML(j), /course=saved/);
});
test('unknown stages stay neutral; completed lesson counts do not claim full course readiness', () => {
  const state = jobPresentation(job({ stage: 'done', topicsDone: 5, topicsTotal: 5 }));
  assert.equal(state.label, 'Finishing save');
  assert.equal(state.group, 'building');
  assert.equal(jobPresentation(job({ stage: 'unexpected' })).label, 'Creating course');
});
test('progress uses bounded finite saved unit counts and no invented percentage', () => {
  for (const n of [-20, Infinity, NaN, 100]) {
    const state = jobPresentation(job({ topicsDone: n, topicsTotal: 3 }));
    assert.ok(state.done >= 0 && state.done <= 3);
  }
  assert.equal(jobPresentation(job({ topicsDone: 4, topicsTotal: 0 })).done, 0);
  assert.ok(!homeJobHTML(job()).includes('%'));
});
test('review checkpoints are current, not marked approved', () => {
  assert.equal(lifecycleSteps(job({ status: 'review_curriculum' }))[1].state, 'current');
  assert.equal(lifecycleSteps(job({ status: 'review_research' }))[2].state, 'current');
});
test('partial attempts are not presented as saved lessons or a completed lesson stage', () => {
  const partial = job({ status: 'partial', stage: 'done', topicsDone: 3, topicsTotal: 3,
    failures: [{ topicId: 'lesson-2' }], checkpoint: { topicsByKey: { 'm/lesson-1': { id: 'lesson-1' }, 'm/lesson-3': { id: 'lesson-3' } } } });
  assert.equal(jobPresentation(partial).done, 2);
  assert.equal(jobPresentation({ ...partial, checkpoint: null }).done, 2);
  assert.equal(lifecycleSteps(partial)[3].state, 'current');
  assert.equal(lifecycleSteps(partial)[4].state, 'next');
  assert.match(homeJobHTML(partial), /2 of 3 lessons saved/);
});
test('search supports case-insensitive multi-word queries', () => {
  assert.ok(matchesHomeSearch({ title: 'Little Swimmer', subtitle: 'Parent led' }, 'SWIM parent'));
  assert.ok(!matchesHomeSearch({ title: 'Little Swimmer' }, 'guitar'));
});
test('grouping separates jobs and courses and excludes duplicate partial cards', () => {
  const courses = [{ id: 'private', title: 'One', user: true }, { id: 'partial', title: 'Partial', user: true }, { id: 'public', title: 'Two' }, { id: 'internal', internal: true }];
  const jobs = [job({ status: 'partial', savedCourseId: 'partial' }), job({ id: 'two' })];
  assert.equal(homeGroups(courses, jobs, '', 'attention').attention.length, 1);
  assert.equal(homeGroups(courses, jobs, '', 'building').building.length, 1);
  assert.deepEqual(homeGroups(courses, jobs, '', 'mine').mine.map(c => c.id), ['private']);
  assert.deepEqual(homeGroups(courses, jobs).community.map(c => c.id), ['public']);
  assert.deepEqual(homeGroups(courses, [], '', 'attention').mine, []);
});
test('course and job text is escaped, and course actions are not nested in links', () => {
  const html = homeCourseHTML({ id: 'a" onfocus="x', title: '<img src=x onerror=alert(1)>', subtitle: '<script>x</script>', modules: 1, topics: 1 }, true);
  const { document } = parseHTML(`<div>${html}${homeJobHTML(job({ title: '<script>x</script>', id: 'x" bad="1' }))}</div>`);
  assert.equal(document.querySelectorAll('script, img, a button, a summary, [onfocus]').length, 0);
  assert.equal(document.querySelectorAll('[data-delete-course]').length, 1);
  assert.match(html, /1 module · 1 lesson/);
});
test('each card has a course-specific accessible action label', () => {
  const { document } = parseHTML(homeJobHTML(job()));
  assert.match(document.querySelector('a').textContent, /Swimming/);
});
test('Community Courses is a first-class filter with legacy library bookmark compatibility', () => {
  assert.ok(HOME_FILTERS.includes('community'));
  assert.ok(!HOME_FILTERS.includes('library'));
  assert.equal(normalizeHomeFilter('library'), 'community');
  assert.equal(normalizeHomeFilter('unknown'), 'community');
  assert.equal(homeURL({ filter: 'library', q: 'Swimming' }), '?filter=community&q=Swimming');
});
test('navigation order and default replace All with Community Courses', () => {
  assert.deepEqual(HOME_FILTERS, ['community', 'mine']);
  for (const filter of [undefined, null, '', 'all', 'library', 'unknown']) {
    assert.equal(normalizeHomeFilter(filter), 'community');
    const groups = homeGroups([{ id: 'public' }, { id: 'mine', user: true }], [job()], '', filter);
    assert.deepEqual(groups.community.map(c => c.id), ['public']);
    assert.equal(groups.mine.length + groups.attention.length + groups.building.length, 0);
  }
  assert.equal(homeURL(), HOME_URL);
  assert.equal(homeURL({ workspace: 'job-one' }), '?workspace=job-one');
  assert.equal(homeURL({ filter: 'all' }), '?filter=community');
});
test('statuses belong to Your Courses and old status links remain compatible', () => {
  assert.deepEqual(HOME_STATUSES, ['all', 'attention', 'building']);
  for (const status of ['attention', 'building']) {
    assert.equal(normalizeHomeFilter(status), 'mine');
    assert.deepEqual(homeSelection(`?filter=${status}&q=swim`), { filter: 'mine', status });
    assert.equal(homeURL({ filter: status, q: 'swim' }), `?filter=mine&status=${status}&q=swim`);
    assert.deepEqual(homeSelection(`?filter=mine&status=${status}`), { filter: 'mine', status });
  }
  assert.equal(normalizeHomeStatus('unexpected'), 'all');
  assert.deepEqual(homeSelection('?filter=mine&status=unexpected'), { filter: 'mine', status: 'all' });
  assert.deepEqual(homeSelection('?filter=community&status=attention'), { filter: 'community', status: 'all' });
  assert.equal(homeURL({ filter: 'community', status: 'attention' }), '?filter=community');
});
test('personal All includes saved courses and jobs; status filters narrow without duplicates', () => {
  const courses = [{ id: 'saved', user: true }, { id: 'linked', user: true, partial: true }, { id: 'orphan', user: true, partial: true }, { id: 'public' }];
  const jobs = [job({ id: 'review', status: 'partial', savedCourseId: 'linked' }), job({ id: 'working' })];
  const all = homeGroups(courses, jobs, '', 'mine');
  assert.deepEqual(all.mine.map(c => c.id), ['saved', 'orphan']);
  assert.deepEqual(all.attention.map(j => j.id), ['review']);
  assert.deepEqual(all.building.map(j => j.id), ['working']);
  assert.equal(all.community.length, 0);
  const attention = homeGroups(courses, jobs, '', 'mine', 'attention');
  assert.deepEqual(attention.mine.map(c => c.id), ['orphan']);
  assert.equal(attention.attention.length, 1);
  assert.equal(attention.building.length, 0);
  const building = homeGroups(courses, jobs, 'Swimming', 'mine', 'building');
  assert.equal(building.building.length, 1);
  assert.equal(building.attention.length + building.mine.length, 0);
});
test('community excludes personal, internal, private and unlisted courses; keeps search scoped', () => {
  const courses = [
    { id: 'public', title: 'Swimming', visibility: 'public' },
    { id: 'legacy', title: 'Legacy public course' },
    { id: 'mine', title: 'Swimming draft', user: true },
    { id: 'internal', title: 'Swimming demo', internal: true },
    { id: 'private', title: 'Private swimming', visibility: 'private' },
    { id: 'unlisted', title: 'Unlisted swimming', visibility: 'unlisted' }
  ];
  const groups = homeGroups(courses, [job()], '', 'community');
  assert.deepEqual(groups.community.map(c => c.id), ['public', 'legacy']);
  assert.deepEqual(groups.mine, []);
  assert.deepEqual(groups.building, []);
  assert.deepEqual(homeGroups(courses, [], 'Swimming', 'community').community.map(c => c.id), ['public']);
  assert.deepEqual(homeGroups(courses, [], '', 'library'), groups);
});
test('public course card is readable without personal delete actions', () => {
  const { document } = parseHTML(homeCourseHTML({ id: 'public', title: 'Shared course', modules: 1, topics: 2 }));
  assert.match(document.querySelector('.home-status').textContent, /Public course/);
  assert.equal(document.querySelector('[data-delete-course]'), null);
  assert.match(document.querySelector('a').getAttribute('href'), /course=public/);
});
test('owned course card does not split images into a separate creation feature', () => {
  const { document } = parseHTML(homeCourseHTML({ id: 'recovered', title: 'Recovered draft', user: true }, true));
  assert.equal(document.querySelector('[data-course-images]'), null);
  assert.ok(document.querySelector('[data-public-preview]'), 'publishing preview remains available');
  assert.ok(document.querySelector('[data-delete-course]'), 'owned-course actions remain available');
});
test('image tools remain absent for unowned and incomplete course cards', () => {
  for (const [course, owned] of [[{ id: 'public' }, false], [{ id: 'other', user: true }, false], [{ id: 'partial', user: true, partial: true }, true]]) {
    const { document } = parseHTML(homeCourseHTML(course, owned));
    assert.equal(document.querySelector('[data-course-images]'), null);
  }
});
test('owned course action escapes course identity', () => {
  const { document } = parseHTML(homeCourseHTML({ id: 'a" onfocus="bad', user: true }, true));
  assert.equal(document.querySelector('[data-public-preview]').getAttribute('data-public-preview'), 'a" onfocus="bad');
  assert.equal(document.querySelector('[onfocus]'), null);
});
test('author names are explicit public metadata, never inferred from account emails', () => {
  const html = homeCourseHTML({ id: 'owned', title: 'Course', createdBy: 'private@example.com', createdByUserId: 'private-id' });
  assert.match(html, /Author not listed/);
  assert.ok(!html.includes('private@example.com') && !html.includes('private-id'));
  assert.equal(normalizePublicAuthor({ displayName: 'private@example.com' }), null);
  assert.equal(normalizePublicAuthor({ name: 'Not the public field' }), null);
  assert.deepEqual(normalizePublicAuthor({ displayName: '  Alex   Chen ', email: 'private@example.com', userId: 'private-id' }), { displayName: 'Alex Chen', avatarUrl: '' });
});
test('author initials handle Unicode and missing photos without adding a fake image', () => {
  assert.equal(publicAuthorInitials('Alex Chen'), 'AC');
  assert.equal(publicAuthorInitials('Élodie'), 'É');
  assert.equal(publicAuthorInitials('李 明'), '李明');
  const { document } = parseHTML(homeAuthorHTML({ displayName: 'Alex Chen' }));
  assert.equal(document.querySelector('.home-author-avatar').textContent, 'AC');
  assert.equal(document.querySelector('.home-author-name').textContent, 'By Alex Chen');
  assert.equal(document.querySelector('img'), null);
});
test('author image is decorative, fixed-size and no-referrer with initials underneath', () => {
  const { document } = parseHTML(homeAuthorHTML({ displayName: 'Alex Chen', avatarUrl: 'https://cdn.example.com/alex.jpg' }));
  const img = document.querySelector('img');
  assert.equal(img.getAttribute('alt'), '');
  assert.equal(img.getAttribute('width'), '32');
  assert.equal(img.getAttribute('height'), '32');
  assert.equal(img.getAttribute('referrerpolicy'), 'no-referrer');
  assert.equal(document.querySelector('.home-author-avatar').getAttribute('aria-hidden'), 'true');
  img.remove();
  assert.equal(document.querySelector('.home-author-avatar').textContent, 'AC');
});
test('unsafe avatar URLs cannot load or run handlers', () => {
  for (const avatarUrl of ['javascript:alert(1)', 'data:image/svg+xml,<svg/>', 'file:///tmp/photo.png', '//third-party.example/avatar.png', '/\\third-party.example/avatar.png', 'https://name:secret@example.com/avatar.png', 'https://example.com/\nphoto.png', 'http://example.com/photo.png']) {
    assert.equal(normalizePublicAuthor({ displayName: 'Alex Chen', avatarUrl }).avatarUrl, '');
  }
  assert.equal(normalizePublicAuthor({ displayName: 'Alex Chen', avatarUrl: '/avatars/alex.png' }).avatarUrl, '/avatars/alex.png');
});
test('author text is escaped and very long names are bounded', () => {
  const { document } = parseHTML(homeAuthorHTML({ displayName: '<img onerror="alert(1)">', avatarUrl: 'javascript:alert(1)' }));
  assert.equal(document.querySelectorAll('img, [onerror]').length, 0);
  assert.ok(document.querySelector('.home-author-name').textContent.includes('<img'));
  assert.equal(Array.from(normalizePublicAuthor({ displayName: '名'.repeat(100) }).displayName).length, 80);
});

const memory = new Map();
globalThis.localStorage = { getItem: key => memory.get(key) ?? null, setItem: (key, value) => memory.set(key, String(value)), removeItem: key => memory.delete(key) };
globalThis.window = { location: { search: HOME_URL } };
memory.set('learnable-user-courses', JSON.stringify({ own: { config: { id: 'own', title: 'Saved course', publicAuthor: { displayName: 'Alex Chen', avatarUrl: '/avatars/alex.png', email: 'private@example.com' } }, curriculum: { modules: [{ topics: [] }] } } }));
const { loadLibrary } = await import('../web/js/course-loader.js?v=4');
globalThis.fetch = async () => { throw new Error('Offline'); };
const offline = await loadLibrary({ allowPartial: true });
assert.equal(offline.courses[0].id, 'own');
assert.deepEqual(offline.courses[0].publicAuthor, { displayName: 'Alex Chen', avatarUrl: '/avatars/alex.png' });
assert.equal(offline.catalogError, 'Public catalog unavailable');
await assert.rejects(loadLibrary(), /Offline/);
globalThis.fetch = async () => ({ ok: false });
const unavailable = await loadLibrary({ allowPartial: true });
assert.equal(unavailable.courses[0].id, 'own');
assert.ok(unavailable.catalogError);
globalThis.fetch = async () => ({ ok: true, json: async () => ({ courses: [{ id: 'public' }, { id: 'own' }] }) });
const combined = await loadLibrary({ allowPartial: true });
assert.deepEqual(combined.courses.map(c => c.id), ['own', 'public']);
assert.equal(combined.catalogError, null);
console.log(`Home experience: ${count} presentation/route tests and 4 catalog recovery scenarios passed.`);
