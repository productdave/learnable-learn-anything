import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { draftContent, draftExport, draftScope, noteCharacters, createDraftStore, DRAFT_RETENTION_MS } from '../web/js/draft-store.js';
import { homeDraftHTML, mountHomeDraft } from '../web/js/home-draft.js';

const notes = '😀'.repeat(12001);
const content = draftContent({ step: 'context', apiKey: 'secret', ownerId: 'wrong', brief: { topic: '  Keep spaces  ', apiKey: 'secret' }, sources: {
  notes: [{ id: 'n1', text: notes, token: 'secret' }], links: [{ id: 'l1', url: 'not yet a URL' }],
  files: [{ id: 'f1', name: 'source.pdf', blob: new Blob(['original file']) }]
} });
assert.equal(content.brief.topic, '  Keep spaces  ');
assert.equal(content.sources.notes[0].text, notes);
assert.equal(noteCharacters(notes), 12001);
assert.equal(content.sources.links[0].url, 'not yet a URL', 'invalid editing input is preserved');
assert.equal(content.sources.files[0].status, 'saved-local');
const exported = JSON.parse(draftExport(content));
assert.equal(exported.sources.files[0].status, 'needs-reattach');
assert.equal(exported.sources.files[0].blob, undefined);
assert.ok(!JSON.stringify(exported).includes('secret'));
assert.match(exported.notice, /Original files are not included/);
assert.equal(draftContent({ sources: { files: [{ id: 'missing', name: 'missing.pdf' }] } }).sources.files[0].status, 'needs-reattach');
assert.throws(() => draftContent({ sources: { files: [{ id: 'too-big', size: 11 * 1024 * 1024 }] } }), e => e.code === 'file-limit');
assert.throws(() => draftContent({ sources: { files: Array.from({ length: 6 }, (_, i) => ({ id: `f${i}` })) } }), e => e.code === 'file-limit');
assert.throws(() => draftContent({ sources: { notes: [{ id: 'a' }, { id: 'a' }] } }), e => e.code === 'invalid');
assert.notEqual(draftScope(), draftScope('guest'));
assert.notEqual(draftScope('alice'), draftScope('bob'));
assert.equal(DRAFT_RETENTION_MS, 604800000);
await assert.rejects(createDraftStore({ indexedDB: null }).list(), e => e.code === 'unavailable');
await assert.rejects(createDraftStore({ indexedDB: { open() { throw new DOMException('Full', 'QuotaExceededError'); } } }).list(), e => e.code === 'quota');

const { window, document } = parseHTML('<html><body></body></html>');
globalThis.window = window; globalThis.document = document;
const tick = () => new Promise(resolve => setTimeout(resolve, 10));
const record = (topic, id = 'saved', revision = 1) => ({ id, revision, expiresAt: Date.now() + DRAFT_RETENTION_MS, ...draftContent({ step: 'home', brief: { topic } }) });
function fixture({ initial = '', drafts = [], list, save } = {}) {
  const form = document.createElement('form');
  form.innerHTML = `<input id="home-outcome">${homeDraftHTML()}`;
  document.body.append(form); form.querySelector('input').value = initial;
  let owner = null; const writes = []; const continuations = [];
  const store = { list: list || (async () => ({ drafts })),
    save: save || (async (input, options) => { writes.push({ input, options }); return record(input.brief.topic, input.id, options.expectedRevision + 1); }),
    load: async id => ({ status: 'found', draft: drafts.find(item => item.id === id) }),
    remove: async () => true };
  const controller = mountHomeDraft(form, { getOwner: () => owner, store, continueUnsaved: value => continuations.push(value) });
  return { form, controller, writes, continuations, setOwner(value) { owner = value; },
    input: value => { form.querySelector('input').value = value; form.querySelector('input').dispatchEvent(new window.Event('input')); },
    click: selector => form.querySelector(selector).dispatchEvent(new window.Event('click', { bubbles: true })) };
}
{
  const f = fixture({ drafts: [record('Saved idea')] });
  await f.controller.ready;
  assert.equal(f.form.querySelector('input').value, 'Saved idea');
  assert.match(f.form.querySelector('[data-draft-status]').textContent, /Your unfinished idea is here/);
  assert.equal(f.form.querySelector('[data-draft-recovery]').hidden, true, 'routine restore does not show backup controls');
  assert.equal(f.form.querySelector('.home-draft-details').hidden, true);
  f.input('New idea'); await f.controller.flush();
  assert.equal(f.writes.at(-1).input.brief.topic, 'New idea');
  assert.equal(f.writes.at(-1).options.expectedRevision, 1);
  assert.equal(f.form.querySelector('[data-draft-status]').getAttribute('aria-live'), 'off', 'autosave does not announce every keystroke');
  f.controller.dispose();
}
{
  let resolve;
  const loading = new Promise(r => { resolve = r; });
  const f = fixture({ list: () => loading });
  f.input('Already typing'); resolve({ drafts: [record('Older saved idea')] });
  await f.controller.ready;
  assert.equal(f.form.querySelector('input').value, 'Already typing');
  assert.equal(await f.controller.flush(), false);
  f.click('[data-draft-fork]'); await tick();
  assert.equal(f.writes[0].input.brief.topic, 'Already typing');
  assert.notEqual(f.writes[0].input.id, 'saved');
  assert.ok(f.form.querySelector('[data-restore-idea="saved"]'), 'other version remains recoverable');
  f.controller.dispose();
}
{
  const f = fixture({ save: async () => { throw { code: 'quota' }; } });
  await f.controller.ready; f.input('Still here'); await f.controller.flush();
  assert.match(f.form.querySelector('[data-draft-status]').textContent, /couldn’t preserve your latest text/);
  assert.equal(f.form.querySelector('[data-draft-recovery]').hidden, false, 'real failures expose recovery actions');
  assert.equal(f.form.querySelector('input').value, 'Still here');
  f.click('[data-draft-continue]'); await tick();
  assert.deepEqual(f.continuations, ['Still here'], 'storage failure offers explicit non-blocking continuation');
  f.controller.dispose();
}
{
  const f = fixture();
  await f.controller.ready;
  assert.match(f.form.querySelector('[data-draft-status]').textContent, /Next: choose your learning experience/);
  assert.equal(f.form.querySelector('[data-draft-recovery]').hidden, true);
  assert.equal(f.form.querySelector('.home-draft-details').hidden, true);
  f.input('Quietly preserved idea'); await f.controller.flush();
  assert.equal(f.writes.at(-1).input.brief.topic, 'Quietly preserved idea');
  assert.doesNotMatch(f.form.querySelector('[data-draft-status]').textContent, /sav|backup|device/i);
  assert.equal(f.form.querySelector('[data-draft-download]').closest('[data-draft-recovery]').hidden, true);
  f.controller.dispose();
}
{
  let fail = true;
  const f = fixture({ save: async input => { if (fail) throw { code: 'quota' }; return record(input.brief.topic, input.id); } });
  await f.controller.ready; f.input('Retry latest text'); await f.controller.flush();
  assert.equal(f.form.querySelector('[data-draft-status]').getAttribute('aria-live'), 'polite');
  fail = false; f.click('[data-draft-retry]'); await tick();
  assert.equal(f.form.querySelector('[data-draft-recovery]').hidden, true);
  assert.equal(f.form.querySelector('input').value, 'Retry latest text');
  assert.equal(f.form.querySelector('[data-draft-status]').getAttribute('aria-live'), 'off');
  f.controller.dispose();
}
{
  let resolve;
  const f = fixture({ list: () => new Promise(r => { resolve = r; }) });
  f.setOwner('new-account'); resolve({ drafts: [record('Private stale idea')] });
  await f.controller.ready;
  assert.equal(f.form.querySelector('input').value, '');
  assert.equal(await f.controller.flush(), false);
  assert.equal(f.writes.length, 0);
  f.controller.dispose();
}
{
  let resolve;
  const f = fixture({ list: () => new Promise(r => { resolve = r; }) });
  f.input('Typed then navigated'); f.controller.dispose();
  resolve({ drafts: [] }); await tick();
  assert.equal(f.writes.at(-1)?.input.brief.topic, 'Typed then navigated', 'dispose flushes pending input even if the initial read had not completed');
}
console.log('Draft foundation: content/limits/export, unavailable/quota storage, restore, revisions, late load, conflict copy, failure recovery, owner isolation and navigation flush passed.');
