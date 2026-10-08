import assert from 'node:assert/strict';
import { canonicalMaterials, readMaterialDefaults, createMaterialDefaultsClient, STANDARD_MATERIALS } from '../web/js/material-defaults.js';
import { writeLearningSnapshot } from '../web/js/learning-state.js';
import { createSetupSessions } from '../web/js/setup-session.js';
import { richComponentCombinations } from './fixtures/component-course.mjs';
import { parseHTML } from 'linkedom';
import { createSetupController } from '../web/js/course-setup.js';

let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const equal = (a, b, label) => { assert.deepEqual(a, b, label); checks++; };
for (const components of [...richComponentCombinations,...richComponentCombinations.map(items=>[...items,'images'])]) {
  const expected = [...components.filter(value => !['practice', 'images'].includes(value)), 'images'];
  equal(canonicalMaterials([...components].reverse()), expected, 'legacy selections adapt to required images and retired Practice');
  equal(readMaterialDefaults({ _courseMaterialDefaults: { version: 1, revision: 'r', components } }).components, expected, 'all optional selections survive roundtrip');
}
for (const components of [[], ['quizzes'], ['lessons', 'unknown'], null]) { assert.throws(() => canonicalMaterials(components)); checks++; }
equal(readMaterialDefaults({}).components, STANDARD_MATERIALS, 'no record uses standard defaults');
for (const value of [{ version: 2, revision: 'next', components: ['lessons'] }, { version: 1, components: ['lessons'] }, { version: 1, revision: 'next', components: ['lessons', 'unknown'] }]) { assert.throws(() => readMaterialDefaults({ _courseMaterialDefaults: value }), error => error.code === 'unsupported'); checks++; }

const rows = new Map(), listeners = [];
let user = { id: 'a' }, fail = false, pause = null, writes = 0, loseReply = false;
const db = { from(table) {
  assert.equal(table, 'user_state'); let owner, expected, operation = 'read', payload;
  const q = {
    select() { return q; }, abortSignal() { return q; },
    eq(k, v) { if (k === 'user_id') owner = v; if (k === 'updated_at') expected = v; return q; },
    update(value) { operation = 'update'; payload = value; return q; },
    insert(value) { operation = 'insert'; payload = value; owner = value.user_id; return q; },
    async maybeSingle() {
      if (fail) return { error: { code: 'offline' } };
      if (operation === 'read') {
        const result = { data: structuredClone(rows.get(owner) || null) };
        if (pause) { const paused = pause; pause = null; await paused; }
        return result;
      }
      if (operation === 'insert' && rows.has(owner)) return { error: { code: '23505' } };
      if (operation === 'update' && rows.get(owner)?.updated_at !== expected) return { data: null };
      rows.set(owner, structuredClone(payload)); writes++;
      if (loseReply) { loseReply = false; return { error: { code: 'offline' } }; }
      return { data: { state: payload.state } };
    }
  }; return q;
} };
const client = createMaterialDefaultsClient({ getClient: async () => db, getIdentity: () => user, subscribeIdentity: fn => listeners.push(fn) });
const signIn = id => { user = id ? { id } : null; for (const fn of listeners) fn(); };
equal((await client.load('a')).components, STANDARD_MATERIALS, 'empty account defaults');
let saved = await client.save('a', ['lessons', 'practice'], null);
equal((await client.load('a')).components, ['lessons', 'images'], 'explicit save belongs to account with current required materials');
await assert.rejects(client.save('a', ['lessons'], null), error => error.code === 'conflict'); checks++;
equal((await client.load('a')).components, ['lessons', 'images'], 'stale save cannot clobber newer defaults');

const current = rows.get('a');
current.state = { ...current.state, unknown: { keep: true }, _apiKeys: { anthropic: 'synthetic-key' }, quizAnswers: { old: 'retained' } };
const progress = { courses: { first: { quizAnswers: { answer: { selected: 'A', updatedAt: '2026-09-16' } } } } };
await Promise.all([client.save('a', ['lessons', 'checklists'], saved.revision), writeLearningSnapshot(db, 'a', progress)]);
let state = rows.get('a').state;
equal(state._courseMaterialDefaults.components, ['lessons', 'checklists', 'images'], 'concurrent progress preserves defaults');
check(state._learningV2.courses.first.quizAnswers.answer.selected === 'A', 'preference CAS preserves concurrent progress');
check(state.unknown.keep && state._apiKeys.anthropic === 'synthetic-key' && state.quizAnswers.old === 'retained', 'unknown/key/legacy fields preserved');
signIn('b'); equal((await client.load('b')).components, STANDARD_MATERIALS, 'second account never inherits A defaults');
await client.save('b', ['lessons', 'flashcards'], null);
equal((await client.load('b')).components, ['lessons', 'flashcards', 'images'], 'B has independent defaults');
await assert.rejects(client.load('a'), error => error.code === 'auth'); checks++;
signIn(null); await assert.rejects(client.load(null), error => error.code === 'auth'); checks++;
signIn('a');
let release; pause = new Promise(resolve => { release = resolve; });
const lateRead = client.load('a'); await new Promise(resolve => setImmediate(resolve));
signIn('b'); signIn('a'); release();
await assert.rejects(lateRead, error => error.code === 'auth'); checks++;
saved = await client.load('a'); const beforeWrites = writes;
pause = new Promise(resolve => { release = resolve; });
const lateSave = client.save('a', ['lessons'], saved.revision); await new Promise(resolve => setImmediate(resolve));
signIn('b'); release(); await assert.rejects(lateSave, error => error.code === 'auth'); checks++;
check(writes === beforeWrites, 'stale owner save aborts before mutation');
signIn('a'); fail = true;
await assert.rejects(client.load('a'), error => error.code === 'unavailable'); checks++;
await assert.rejects(client.save('a', ['lessons'], saved.revision), error => error.code === 'unavailable'); checks++;
fail = false; saved = await client.load('a');
saved = await client.save('a', STANDARD_MATERIALS, saved.revision);
equal(saved.components, STANDARD_MATERIALS, 'explicit reset saves standard future choices');
loseReply = true;
await assert.rejects(client.save('a', ['lessons', 'practice'], saved.revision), error => error.code === 'unavailable'); checks++;
saved = await client.load('a');
equal(saved.components, ['lessons', 'images'], 'reload resolves a lost response after an accepted save');
saved = await client.save('a', STANDARD_MATERIALS, saved.revision);
const future = { version: 2, revision: 'future', components: ['lessons', 'images'] };
rows.get('b').state._courseMaterialDefaults = future; signIn('b');
await assert.rejects(client.save('b', ['lessons'], 'future'), error => error.code === 'unsupported'); checks++;
equal(rows.get('b').state._courseMaterialDefaults, future, 'older client never overwrites future-format defaults');
signIn('a');

// Optional defaults apply at start only. Required images/retired Practice also
// apply to unfinished, claimed and copied setups without touching their context.
const draftRows = new Map();
const draftStore = {
  async save(input, options) { const next = { ...structuredClone(input), revision: (options.expectedRevision || 0) + 1 }; draftRows.set(input.id, next); return next; },
  async load(id) { return draftRows.has(id) ? { status: 'found', draft: structuredClone(draftRows.get(id)) } : { status: 'missing' }; }
};
const sessions = createSetupSessions({ store: draftStore, getOwner: () => user?.id });
const first = await sessions.start({ topic: 'First', audience: 'A' }, { components: ['lessons', 'practice'] }); await sessions.flush(first);
const second = await sessions.start({ topic: 'Second' }, { components: ['lessons', 'checklists'] }); await sessions.flush(second);
first.draft.components = ['lessons']; sessions.edit(first); await sessions.flush(first);
equal((await sessions.open(second.id)).session.draft.components, ['lessons', 'checklists', 'images'], 'editing one draft cannot change another');
equal((await sessions.open(first.id)).session.draft.components, ['lessons', 'images'], 'reopening preserves optional choices and required images');
equal((await client.load('a')).components, STANDARD_MATERIALS, 'editing drafts never changes account defaults');
equal(first.draft.brief.audience, 'A', 'material choice preserves other setup details');
const dom = parseHTML('<html><body></body></html>'); globalThis.window = dom.window; globalThis.document = dom.document;
let starts = 0, delayed; const navigations = [];
const controller = createSetupController({
  getOwner: () => user?.id, getIdentity: () => user, store: draftStore, navigate: url => navigations.push(url),
  defaultsClient: { async load() { starts++; if (starts === 1) return new Promise(resolve => { delayed = resolve; }); return { components: ['lessons', 'checklists'] }; } }
});
const slowStart = controller.start({ topic: 'Slow start' });
await controller.start({ topic: 'Duplicate click' }); check(starts === 1, 'duplicate start does not duplicate defaults load');
controller.dispose(); signIn('b');
await controller.start({ topic: 'Next account' });
check(navigations.length === 1, 'leaving a pending start does not block the new account');
delayed({ components: ['lessons', 'practice'] }); await slowStart;
check(navigations.length === 1, 'late start result cannot navigate or create another draft');
const newId = new URL(navigations[0], 'https://example.test').searchParams.get('draft');
equal(draftRows.get(newId).components, ['lessons', 'checklists', 'images'], 'new account receives its defaults plus required images');
await controller.start({ topic: 'Explicit copied request', components: ['lessons'] });
check(starts === 2, 'explicit reused materials bypass defaults');
const copyId = new URL(navigations[1], 'https://example.test').searchParams.get('draft');
equal(draftRows.get(copyId).components, ['lessons', 'images'], 'explicit reused request retains optional choices plus required images');
controller.dispose();
console.log(`Material defaults: ${checks} model/client/session checks passed.`);
