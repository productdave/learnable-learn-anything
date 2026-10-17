import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

const root = resolve(process.env.IMAGE_JS_ROOT || 'web/js');
const strip = source => source.replace(/^import .*;\n/gm, '').replace(/^export /gm, '');
function fixture() {
  const { document } = parseHTML('<main></main>'), pending = [], revoked = [];
  let identity = { id: 'owner' }, watcher, created = 0;
  const context = vm.createContext({ document, getUser: () => identity, onUserChange: fn => { watcher = fn; return () => {}; },
    createCourseImageClient: () => ({ asset: () => new Promise((resolve, reject) => pending.push({ resolve, reject })) }),
    URL: { createObjectURL: () => `blob:test-${++created}`, revokeObjectURL: url => revoked.push(url) } });
  vm.runInContext(strip(readFileSync(resolve(root, 'private-course-images.js'), 'utf8')), context);
  const topic = readFileSync(resolve(root, 'components/topic-view.js'), 'utf8');
  vm.runInContext(topic.slice(topic.indexOf('function escapeAttr('), topic.indexOf('\nfunction renderConcept(')), context);
  const container = document.querySelector('main');
  container.innerHTML = context.renderImageSection({ asset_id: 'asset', alt: 'An example diagram', caption: 'Example' }, 0);
  const figure = container.querySelector('figure'), img = figure.querySelector('img'), button = figure.querySelector('button');
  const dispose = context.mountPrivateCourseImages(container, 'course');
  return { figure, img, button, pending, revoked, dispose, changeAccount: () => { identity = null; watcher(); } };
}
const tick = () => new Promise(resolve => setImmediate(resolve));

test('loading has a reserved frame and remains visible until the image decodes', async () => {
  const h = fixture();
  assert.equal(h.figure.querySelector('.private-image-frame')?.getAttribute('aria-busy'), 'true');
  assert.match(h.figure.querySelector('[role="status"]').textContent, /Loading image/);
  assert.equal(h.img.hidden, true);
  h.pending[0].resolve({}); await tick();
  assert.equal(h.figure.querySelector('[data-private-image-placeholder]').hidden, false);
  h.img.onload();
  assert.equal(h.figure.querySelector('.private-image-frame').getAttribute('aria-busy'), 'false');
  assert.equal(h.figure.querySelector('[data-private-image-placeholder]').hidden, true);
  assert.equal(h.img.hidden, false); h.dispose();
});
test('failed fetch offers one retry of the saved asset, then clears the error on success', async () => {
  const h = fixture(); h.pending[0].reject(new Error('Saved file unavailable')); await tick();
  assert.equal(h.figure.dataset.imageState, 'error'); assert.equal(h.button.hidden, false);
  h.button.onclick(); h.button.onclick(); assert.equal(h.pending.length, 2);
  assert.equal(h.button.hidden, true); assert.equal(h.figure.dataset.imageState, 'loading');
  h.pending[1].resolve({}); await tick(); h.img.onload();
  assert.equal(h.figure.dataset.imageState, 'ready'); h.dispose();
});
test('failed image decoding shows a retry and releases the failed blob', async () => {
  const h = fixture(); h.pending[0].resolve({}); await tick(); h.img.onerror();
  assert.equal(h.img.hidden, true); assert.equal(h.button.hidden, false);
  assert.match(h.figure.querySelector('[role="status"]').textContent, /does not generate a new image/);
  assert.deepEqual(h.revoked, ['blob:test-1']); h.dispose();
});
test('account change hides a loaded private image and does not permit a stale retry', async () => {
  const h = fixture(); h.pending[0].resolve({}); await tick(); h.img.onload(); h.changeAccount();
  assert.equal(h.img.hidden, true); assert.equal(h.img.getAttribute('src'), null);
  assert.equal(h.figure.querySelector('[data-private-image-placeholder]').hidden, false);
  assert.match(h.figure.querySelector('[role="status"]').textContent, /owning account/);
  assert.equal(h.button.hidden, true); assert.deepEqual(h.revoked, ['blob:test-1']);
});
test('leaving a lesson before its asset returns does not attach a late image', async () => {
  const h = fixture(); h.dispose(); h.pending[0].resolve({}); await tick();
  assert.equal(h.img.getAttribute('src'), null); assert.equal(h.img.hidden, true);
});
