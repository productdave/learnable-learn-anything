// Exercise the actual app subscriber after cache invalidation, without a browser.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../web/js/app.js', import.meta.url), 'utf8');
const start = source.indexOf('  store.subscribe(async (_, event) => {');
const end = source.indexOf("\n\n  document.addEventListener('keydown'", start);
assert.ok(start > 0 && end > start);
let subscriber, cached = false, sidebar = 0, errors = 0, resolveLoad;
const state = { mode: 'course', slug: 'test', version: 1, epoch: 1 };
const scope = new Proxy({
  store: { subscribe: fn => { subscriber = fn; }, scope: () => ({ epoch: state.epoch }) },
  getCurrentCourseId: () => state.slug,
  loadCourse: async () => { if (resolveLoad === 'defer') await new Promise(resolve => { resolveLoad = resolve; }); cached = true; },
  document: { getElementById: () => ({}) },
  renderSidebar: () => { assert.ok(cached, 'sidebar may not read an invalid cache'); sidebar++; },
  renderCourseRouteError: () => { errors++; },
  refreshLearningControls() {}, renderLearningStatus() {},
}, { has: () => true, get(target, key) {
  return key === 'currentMode' ? state.mode : key === 'currentCourseSlug' ? state.slug
    : key === 'navigationVersion' ? state.version : target[key];
} });
new Function('scope', 'with (scope) {' + source.slice(start,end) + '}')(scope);
await subscriber(null, { reason: 'status' });
assert.equal(sidebar, 1); assert.equal(errors, 0);
cached = false; resolveLoad = 'defer';
const pending = subscriber(null, { reason: 'remote' });
state.slug = 'other'; state.version++; state.epoch++;
resolveLoad(); await pending;
assert.equal(sidebar, 1, 'old course completion cannot repaint after navigation/account scope change');
assert.equal(errors, 0);

// A cold reader can render its unavailable state before the account pull
// finishes. That sets currentMode to library without changing the requested
// course URL. Exercise the actual cloud-pull listener against that race.
const pullStart = source.indexOf("  window.addEventListener('learnable-cloud-pulled', () => {");
const pullEnd = source.indexOf("  window.addEventListener('learnable-provider-connection-changed'", pullStart);
assert.ok(pullStart > 0 && pullEnd > pullStart);
let pulled, requestedCourse = 'test', routeRenders = 0, catalogRefreshes = 0;
const pullScope = {
  window: { addEventListener: (name, callback) => {
    assert.equal(name, 'learnable-cloud-pulled'); pulled = callback;
  } },
  currentMode: 'library',
  getCurrentCourseId: () => requestedCourse,
  renderForCurrentURL: () => { routeRenders++; },
  refreshLibraryCatalog: () => { catalogRefreshes++; },
  document: { getElementById: () => ({}) },
};
new Function('scope', 'with (scope) {' + source.slice(pullStart, pullEnd) + '}')(pullScope);
pulled();
assert.equal(routeRenders, 1, 'late account pull must retry the course URL after an initial unavailable render');
assert.equal(catalogRefreshes, 0, 'a requested course is not a library navigation');
requestedCourse = null;
pulled();
assert.equal(catalogRefreshes, 1, 'an actual library URL refreshes only its catalog');
assert.equal(routeRenders, 1);
requestedCourse = 'test'; pullScope.currentMode = 'course';
pulled();
assert.equal(routeRenders, 2, 'an open course refreshes after account pull');
pullScope.currentMode = null;
pulled();
assert.equal(routeRenders, 3, 'a pending reader boot retains its requested course route');
console.log('course store refresh race tests passed');
