import assert from 'node:assert/strict';
import test from 'node:test';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';
import { setupDraft } from '../web/js/setup-model.js';

// Real controller/editor with synthetic local persistence and DOM scrolling.
// Browser geometry is verified separately; this catches the missing reveal
// contract and executes against the frozen release when SETUP_SOURCE_FILE is set.
const { createSetupController } = await import(pathToFileURL(resolve(process.env.SETUP_SOURCE_FILE || 'web/js/course-setup.js')));
async function fixture({ kind = 'links', step = 'context' } = {}) {
  const { window, document } = parseHTML('<html><head></head><body><main></main></body></html>');
  Object.assign(globalThis, { window, document });
  const scrolls = [], focuses = [], routes = [], pending = [];
  window.scrollTo = options => scrolls.push({ target: 'window', options });
  window.HTMLElement.prototype.scrollIntoView = function (options) { scrolls.push({ target: this, options }); };
  window.HTMLElement.prototype.focus = function (options) { focuses.push({ target: this, options }); };
  const host = document.querySelector('main');
  // Linkedom does not detach signal-bound listeners when the controller rerenders.
  const listen = host.addEventListener.bind(host);
  host.addEventListener = (type, listener, options) => {
    if (options?.signal?.aborted) return;
    listen(type, listener, options);
    options?.signal?.addEventListener('abort', () => host.removeEventListener(type, listener, options), { once: true });
  };
  let row = { ...setupDraft('Source feedback test'), id: 'source-feedback-qa', revision: 1, step };
  row.brief.audience = 'Beginner product managers';
  row.sources.notes = [{ id: 'note-qa', title: 'Keep this note', text: kind === 'notes' ? 'A'.repeat(12001) : 'Exact original note.' }];
  row.sources.links = [{ id: 'link-qa', url: kind === 'links' ? 'not a url' : 'https://example.com/qa' }];
  if (kind === 'files') row.sources.files = [{ id: 'file-qa', name: 'missing.txt', size: 10, blob: null }];
  const controller = createSetupController({
    getOwner: () => null, getIdentity: () => null,
    store: {
      load: async () => ({ status: 'found', draft: structuredClone(row) }),
      save: async value => { row = { ...structuredClone(value), revision: row.revision + 1 }; return structuredClone(row); }
    },
    navigate: url => {
      routes.push(url);
      pending.push(controller.render(host, row.id, new URLSearchParams(url.slice(1)).get('step')));
    },
    accountClient: { restore: async () => { throw new Error('Unexpected remote access'); } },
    sendLink: async () => { throw new Error('Unexpected sign-in'); },
    createCourse: async () => { throw new Error('Unexpected generation'); }
  });
  await controller.render(host, row.id, step);
  const click = selector => host.querySelector(selector).dispatchEvent(new window.Event('click', { bubbles: true }));
  const settle = async () => { while (pending.length) await pending.shift(); };
  const submit = async () => { host.querySelector('form').dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true })); await settle(); };
  const close = async () => { controller.dispose(); await new Promise(resolve => setTimeout(resolve, 0)); };
  return { host, window, scrolls, focuses, routes, click, submit, settle, close, saved: () => row };
}

for (const kind of ['links', 'notes', 'files']) {
  test(`${kind}: rejected source reveals its feedback row after the step reset`, async () => {
    const f = await fixture({ kind });
    try {
      // Start on a different source tab so validation must restore the right tab.
      f.click(`[data-source-kind="${kind === 'links' ? 'notes' : 'links'}"]`);
      await f.submit();
      const row = f.host.querySelector(`[data-source-id="${kind === 'links' ? 'link' : kind === 'notes' ? 'note' : 'file'}-qa"]`);
      assert.ok(row, 'invalid source tab is shown');
      const target = row.querySelector('textarea') || row.querySelector('input:not([type="file"])') || row.querySelector('button');
      assert.ok(f.focuses.at(-1).target === target, 'the correction control keeps keyboard focus');
      assert.deepEqual(f.focuses.at(-1).options, { preventScroll: true }, 'native focus must not race the explicit feedback reveal');
      assert.ok(f.scrolls.at(-1).target === row, 'reveal the row including its error, not only the input');
      assert.deepEqual(f.scrolls.at(-1).options, { block: 'center', behavior: 'instant' }, 'feedback must not animate after navigation');
      if (kind === 'links') {
        assert.equal(target.value, 'not a url');
        assert.equal(target.getAttribute('aria-invalid'), 'true');
        assert.match(row.querySelector('[data-link-error]').textContent, /Enter a complete link/);
        assert.equal(target.getAttribute('aria-describedby'), row.querySelector('[data-link-error]').id);
      }
      if (kind === 'notes') assert.match(row.querySelector('[data-note-count]').textContent, /Too long/);
      if (kind === 'files') assert.equal(target.textContent, 'Reattach file');
    } finally { await f.close(); }
  });
}

test('correcting a rejected URL advances to Review and preserves the note', async () => {
  const f = await fixture();
  try {
    await f.submit();
    const input = f.host.querySelector('[data-source-field="url"]');
    input.value = 'https://example.com/qa';
    input.dispatchEvent(new f.window.Event('input', { bubbles: true }));
    assert.equal(f.host.querySelector('[data-link-error]').textContent, '');
    assert.equal(input.getAttribute('aria-invalid'), 'false');
    await f.submit();
    assert.match(f.routes.at(-1), /step=review$/);
    assert.match(f.host.textContent, /Your setup is complete/);
    assert.match(f.host.textContent, /1 note · 1 link · 0 files/);
  } finally { await f.close(); }
  assert.equal(f.saved().sources.notes[0].text, 'Exact original note.');
  assert.equal(f.saved().sources.links[0].url, 'https://example.com/qa');
});

test('Review first issue returns to the invalid source with explicit feedback reveal', async () => {
  const f = await fixture({ step: 'review' });
  try {
    f.click('[data-setup-action="fix"]'); await f.settle();
    assert.match(f.routes.at(-1), /step=context$/);
    assert.ok(f.scrolls.at(-1).target === f.host.querySelector('[data-source-id="link-qa"]'), 'Review reveals the invalid link row');
    assert.equal(f.focuses.at(-1).target.id, 'link-url-link-qa');
  } finally { await f.close(); }
});
