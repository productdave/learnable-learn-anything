// Actual browser modules with synthetic auth/API/storage only. No network or
// account/provider writes. Run: node --experimental-vm-modules --test <this file>
// COURSE_CACHE_TEST_WEB_ROOT can point to a fresh package's browser namespace.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createContext, SourceTextModule, SyntheticModule } from 'node:vm';

const root = resolve(process.env.COURSE_CACHE_TEST_WEB_ROOT || fileURLToPath(new URL('../web/js/', import.meta.url)));
const KEY = 'learnable-user-courses';
const owner = { id: 'cache-owner', email: 'owner@example.test' };
const course = (id = 'cache-course', user = owner) => ({
  config: { id, name: 'Synthetic course' }, createdByUserId: user.id, createdBy: user.email,
  _generationJobId: 'job-cache', _generationRunId: 'cache-run',
  curriculum: { title: 'Synthetic course', modules: [{ id: 'module', number: 1, title: 'Module', topics: [{ id: 'lesson', title: 'Lesson' }] }] },
  modules: { 1: { lesson: { id: 'lesson', moduleId: 'module', title: 'Lesson', sections: [{ type: 'concept', content: '<p>Synthetic.</p>' }] } } }
});

async function fixture({ failedWrites = true, initial = {}, errorName = 'QuotaExceededError', orchestration = false } = {}) {
  const storage = new Map([[KEY, JSON.stringify(initial)]]), warnings = [], requests = [], events = [];
  let failing = failedWrites, user = { ...owner };
  const row = { id: 'cache-course', updatedAt: '2026-10-06T00:00:00.000Z', payload: course() };
  const client = {
    auth: { getSession: async () => ({ data: { session: { access_token: 'synthetic-not-a-credential' } } }) },
    from(name) {
      assert.equal(name, 'user_courses');
      return { select: () => ({ eq: async () => ({ data: [{ ...row, updated_at: row.updatedAt }], error: null }) }) };
    }
  };
  const context = createContext({ URL, URLSearchParams, Date, Promise, structuredClone, setTimeout, clearTimeout, setInterval, clearInterval,
    console: { info() {}, log() {}, error() {}, warn: (...args) => warnings.push(args) },
    localStorage: {
      getItem: key => storage.get(key) ?? null,
      removeItem: key => storage.delete(key),
      setItem(key, value) {
        if (key === KEY && failing) { const error = new Error('Do not disclose synthetic private content or credentials'); error.name = errorName; throw error; }
        storage.set(key, String(value));
      }
    },
    window: { dispatchEvent: event => events.push(event.type) },
    CustomEvent: class { constructor(type) { this.type = type; } },
    fetch: async input => {
      const url = String(input); requests.push(url);
      if (url.startsWith('/api/courses/get?')) return { ok: true, json: async () => structuredClone(row) };
      if (url.startsWith('data/courses/')) return { ok: false, status: 404 };
      throw Error('Unexpected synthetic request');
    }
  });
  const cache = new Map();
  const auth = new SyntheticModule(['sb', 'getUser', 'onUserChange'], function () {
    this.setExport('sb', async () => client); this.setExport('getUser', () => user); this.setExport('onUserChange', () => () => {});
  }, { context, identifier: pathToFileURL(resolve(root, 'auth.js')).href });
  function moduleAt(url) {
    if (fileURLToPath(url).endsWith('/auth.js')) return auth;
    if (cache.has(url)) return cache.get(url);
    const module = new SourceTextModule(readFileSync(fileURLToPath(url), 'utf8'), { context, identifier: url });
    cache.set(url, module); return module;
  }
  const entry = moduleAt(pathToFileURL(resolve(root, orchestration ? 'cloud-gen-client.js' : 'user-courses.js')).href);
  await entry.link((specifier, importer) => moduleAt(new URL(specifier, importer.identifier).href));
  await entry.evaluate();
  const namespace = filename => [...cache.values()].find(module => fileURLToPath(module.identifier).endsWith('/' + filename))?.namespace;
  const courses = namespace('user-courses.js');
  courses._setCurrentUserEmailFromAuth(user.email, user.id);
  return { courses, cloud: orchestration ? entry.namespace : null, jobs: namespace('jobs.js'), loader: namespace('course-loader.js'), sync: namespace('course-sync.js'),
    storage, warnings, requests, events, row, persist: value => { failing = !value; },
    identity: next => { user = next; courses._setCurrentUserEmailFromAuth(next?.email || '', next?.id || ''); } };
}

test('actual saved-course orchestration opens the fetched course after quota rejects persistence', async () => {
  const f = await fixture({ orchestration: true });
  f.jobs.ensureJob('job-cache', { topic: 'Synthetic' }, { status: 'completed', savedCourseId: 'cache-course', runId: 'cache-run', ownerId: owner.id, runner: 'cloud' });
  assert.equal(await f.cloud.pullSavedCloudCourseForJob('job-cache', 'cache-course'), true);
  assert.ok(f.courses.getUserCourse('cache-course'), 'successful cloud fetch must remain readable in this page');
  assert.equal((await f.loader.loadCourse('cache-course')).config.name, 'Synthetic course');
  assert.equal((await f.loader.loadModule('module', 'cache-course')).lesson.sections.length, 1);
  assert.equal(f.requests.filter(url => url.startsWith('data/courses/')).length, 0);
  assert.equal(f.storage.get(KEY), '{}', 'no persistent user data was overwritten');
});

test('actual account bulk pull keeps cloud courses readable when the device cache is full', async () => {
  const f = await fixture({ orchestration: true });
  f.sync.initCourseSync(); await f.sync.syncCoursesNow();
  assert.equal(f.sync.getStatus().lastPullCloudCount, 1);
  assert.equal(f.sync.getStatus().lastPullError, null);
  assert.equal(f.courses.listUserCourses().length, 1);
  assert.equal((await f.loader.loadModule('module', 'cache-course')).lesson.title, 'Lesson');
  assert.equal(f.requests.length, 0, 'a fetched private payload never falls through to static-course fetches');
  assert.equal(f.warnings.length, 1);
  assert.equal(f.storage.get(KEY), '{}');
});

test('failed remote cache install remains false but get/list/export/read maps stay readable', async () => {
  const f = await fixture();
  assert.equal(f.courses._installCourseFromRemote('cache-course', course()), false);
  assert.equal(f.courses.getUserCourse('cache-course').config.id, 'cache-course');
  assert.equal(f.courses.listUserCourses().length, 1);
  assert.ok(JSON.parse(f.courses.exportCoursesJson())['cache-course']);
  const read = f.courses._readAllCourses(); read['cache-course'].config.name = 'Unsaved mutation'; delete read['cache-course'];
  const selected = f.courses.getUserCourse('cache-course'); selected.modules[1].lesson.sections = [];
  assert.equal(f.courses.getUserCourse('cache-course').config.name, 'Synthetic course');
  assert.equal(f.courses.getUserCourse('cache-course').modules[1].lesson.sections.length, 1, 'every read returns a fresh snapshot');
  assert.equal(f.storage.get(KEY), '{}');
});

for (const change of ['owner-id', 'email', 'sign-out']) {
  test(`temporary cache clears on ${change} change without deleting persistent data`, async () => {
    const persisted = { persisted: course('persisted') }, f = await fixture({ initial: persisted });
    f.courses._installCourseFromRemote('cache-course', course());
    const prior = f.storage.get(KEY);
    f.identity(change === 'owner-id' ? { ...owner, id: 'other-owner' } : change === 'email' ? { ...owner, email: 'other@example.test' } : null);
    assert.equal(f.courses._readAllCourses()['cache-course'], undefined);
    assert.equal(f.storage.get(KEY), prior);
    f.identity(owner);
    assert.equal(f.courses.getUserCourse('cache-course'), null, 'switching back cannot resurrect an old temporary cache');
    assert.ok(f.courses.getUserCourse('persisted'));
  });
}

test('same normalized authenticated identity retains the temporary cache', async () => {
  const f = await fixture(); f.courses._installCourseFromRemote('cache-course', course());
  f.identity({ ...owner, email: ' OWNER@EXAMPLE.TEST ' });
  assert.ok(f.courses.getUserCourse('cache-course'));
});

test('temporary reads retain existing owner visibility checks', async () => {
  const f = await fixture();
  f.courses._installCourseFromRemote('owned', course('owned'));
  f.courses._installCourseFromRemote('other', course('other', { id: 'other-owner', email: 'other@example.test' }));
  assert.ok(f.courses.getUserCourse('owned')); assert.equal(f.courses.getUserCourse('other'), null);
  assert.equal(f.courses.listUserCourses().length, 1);
});

test('local edit retains the temporary course, earlier courses and verified edit marker', async () => {
  const f = await fixture({ initial: { persisted: course('persisted') } });
  f.courses._installCourseFromRemote('cache-course', course());
  const edited = f.courses.getUserCourse('cache-course'); edited.config.name = 'Edited in this page';
  assert.equal(f.courses.saveUserCourse(edited), 'cache-course');
  const saved = f.courses.getUserCourse('cache-course');
  assert.equal(saved.config.name, 'Edited in this page'); assert.equal(f.courses.hasVerifiedLocalCourseEdit(saved), true);
  assert.ok(f.courses.getUserCourse('persisted')); assert.equal(JSON.parse(f.storage.get(KEY))['cache-course'], undefined);
});

for (const remove of ['_removeCourseLocalSilent', 'removeUserCourse']) {
  test(`${remove} updates the temporary snapshot without resurrecting persistent rows`, async () => {
    const f = await fixture({ initial: { persisted: course('persisted'), keep: course('keep') } });
    f.courses._installCourseFromRemote('cache-course', course());
    f.courses[remove]('persisted'); f.courses[remove]('cache-course');
    assert.equal(f.courses.getUserCourse('persisted'), null); assert.equal(f.courses.getUserCourse('cache-course'), null);
    assert.ok(f.courses.getUserCourse('keep')); assert.ok(JSON.parse(f.storage.get(KEY)).persisted, 'failed persistence does not erase stored data');
  });
}

test('successful persistence clears fallback and restores fresh persistent reads', async () => {
  const f = await fixture(); f.courses._installCourseFromRemote('cache-course', course());
  f.persist(true); assert.equal(f.courses._installCourseFromRemote('second', course('second')), true);
  assert.ok(JSON.parse(f.storage.get(KEY))['cache-course']); assert.ok(JSON.parse(f.storage.get(KEY)).second);
  f.storage.set(KEY, JSON.stringify({ external: course('external') }));
  assert.equal(f.courses.getUserCourse('cache-course'), null); assert.ok(f.courses.getUserCourse('external'));
});

test('fallback retry never overwrites another tab\'s changed persistent snapshot', async () => {
  const f = await fixture({ initial: { persisted: course('persisted') } });
  f.courses._installCourseFromRemote('cache-course', course());
  const original = f.storage.get(KEY), changed = course('persisted'); changed.config.name = 'Another tab changed this';
  const external = JSON.stringify({ persisted: changed, external: course('external') });
  f.storage.set(KEY, external); f.persist(true);
  assert.equal(f.courses._installCourseFromRemote('second', course('second')), false, 'a stale fallback cannot become a successful full-map write');
  assert.equal(f.storage.get(KEY), external, 'the other tab\'s content and added course remain untouched');
  assert.ok(f.courses.getUserCourse('cache-course')); assert.ok(f.courses.getUserCourse('second'));
  f.courses._removeCourseLocalSilent('persisted');
  assert.equal(f.courses.getUserCourse('persisted'), null); assert.equal(f.storage.get(KEY), external);
  assert.equal(f.warnings.length, 1, 'a persistence conflict does not repeat or expand the private warning');
  f.identity(null); f.identity(owner);
  assert.equal(f.courses.getUserCourse('cache-course'), null); assert.ok(f.courses.getUserCourse('external'));
  assert.equal(f.courses._installCourseFromRemote('fresh', course('fresh')), true, 'an identity reset clears the stale baseline');
  assert.ok(JSON.parse(f.storage.get(KEY)).external);
  assert.notEqual(original, external);
});

test('cache failure warning is bounded, excludes raw errors and logs once per episode', async () => {
  const f = await fixture();
  f.courses._installCourseFromRemote('first', course('first')); f.courses._installCourseFromRemote('second', course('second'));
  assert.deepEqual(f.warnings, [['COURSE_CACHE_WRITE_FAILED', 'QuotaExceededError']]);
  f.persist(true); f.courses._installCourseFromRemote('third', course('third')); assert.equal(f.warnings.length, 1);
  f.persist(false); f.courses._installCourseFromRemote('fourth', course('fourth')); assert.equal(f.warnings.length, 2);
  const hostile = await fixture({ errorName: 'Private arbitrary name must not appear' });
  hostile.courses._installCourseFromRemote('cache-course', course());
  assert.deepEqual(hostile.warnings, [['COURSE_CACHE_WRITE_FAILED', 'Error']]);
});

test('successful cache writes do not warn or opt into temporary persistence', async () => {
  const f = await fixture({ failedWrites: false });
  assert.equal(f.courses._installCourseFromRemote('cache-course', course()), true); assert.equal(f.warnings.length, 0);
  assert.ok(JSON.parse(f.storage.get(KEY))['cache-course']);
});
