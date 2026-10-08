import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createLearningStore } from '../web/js/learning-store.js';
import { writeLearningSnapshot, boundedLearningQuery } from '../web/js/learning-state.js';

let checks = 0, currentUser = null, keys = {}, releaseA, fail = false, reads = 0, writes = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const changes = [], timers = new Map(), rows = new Map(); let timerId = 0;
rows.set('a', { state: { _apiKey: 'private-a', _learningV2: { courses: { course: { quizAnswers: { key: { selected: 'a', updatedAt: '2026-01-01' } } } } } }, updated_at: '2026-01-01' });
rows.set('b', { state: { _apiKey: 'private-b', _learningV2: { courses: { course: { quizAnswers: { key: { selected: 'b', updatedAt: '2026-01-01' } } } } } }, updated_at: '2026-01-01' });
const store = createLearningStore({ storage: { getItem: () => null, setItem() {} } }); store.setCourse('course');
const client = { from() {
  let owner, operation = 'read', payload;
  const q = { select() { return q; }, eq(k, v) { if (k === 'user_id') owner = v; return q; }, update(value) { operation = 'write'; payload = value; return q; }, insert(value) { operation = 'write'; payload = value; owner = value.user_id; return q; }, async maybeSingle() {
    if (fail) throw new Error('offline');
    if (operation === 'read') {
      reads++;
      if (owner === 'a' && !releaseA) return new Promise(resolve => { releaseA = () => resolve({ data: structuredClone(rows.get(owner)) }); });
      return { data: structuredClone(rows.get(owner) || null) };
    }
    writes++; rows.set(owner, payload); return { data: { state: payload.state } };
  } }; return q;
} };
globalThis.__learningSyncTest = {
  sb: async () => client, getUser: () => currentUser, onUserChange: fn => { changes.push(fn); },
  clearAllProviderKeys: () => { keys = {}; }, getAllProviderKeys: () => keys, setAllProviderKeys: value => { keys = value; },
  store, writeLearningSnapshot, boundedLearningQuery, setTimeout: fn => { timers.set(++timerId, fn); return timerId; }, clearTimeout: id => timers.delete(id)
};
const source = readFileSync('web/js/sync.js', 'utf8').replace(/^import .*;\n/gm, '');
const names = Object.keys(globalThis.__learningSyncTest).join(',');
const module = await import('data:text/javascript;base64,' + Buffer.from(`const {${names}}=globalThis.__learningSyncTest;\n${source}`).toString('base64'));
const settle = () => new Promise(resolve => setImmediate(resolve));
const signIn = id => { currentUser = id ? { id } : null; for (const fn of changes) fn(currentUser); };
module.initSync(); store.saveQuizAnswer('key', { selected: 'guest' });
signIn('a'); await settle();
check(!store.getQuizAnswer('key'), 'initial account cannot inherit guest progress');
store.saveQuizAnswer('local-a', { selected: 'private' });
check(timers.size === 1, 'local account edit schedules one bounded push');
signIn('b'); await settle();
check(store.getQuizAnswer('key').selected === 'b' && !store.getQuizAnswer('local-a'), 'switch loads only account B course state');
releaseA(); await settle();
check(keys.anthropic === 'private-b' && store.getQuizAnswer('key').selected === 'b', 'late A pull cannot replace B progress or provider keys');
keys.anthropic = 'new-b-key'; store.savePracticeStep('list', 'item', true);
await module.flushSync();
check(rows.get('b').state._apiKey === 'new-b-key', 'flush persists newly entered provider key');
check(rows.get('b').state._learningV2.courses.course.practiceProgress.list.steps.item === true, 'flush includes practice progress');
check(!rows.get('a').state._learningV2.courses.course.practiceProgress, 'B flush never writes A');
check(store.getSaveStatus().sync === 'saved', 'successful current-owner write reports synced');
fail = true; store.savePracticeStep('list', 'item', false);
await assert.rejects(module.flushSync(), /offline/); checks++;
check(store.getSaveStatus().sync === 'error' && store.getPracticeProgress('list').steps.item === false, 'offline sync retains undo and reports recovery state');
fail = false; await module.flushSync();
check(rows.get('b').state._learningV2.courses.course.practiceProgress.list.steps.item === false, 'retry uploads retained undo');
store.saveQuizAnswer('pending', { selected: 'b' }); signIn(null);
check(timers.size === 0 && !store.getQuizAnswer('pending') && !Object.keys(keys).length, 'sign-out clears scheduled writes, keys and account view');
const before = { reads, writes }; await module.flushSync(); await module.pullSyncNow();
check(reads === before.reads && writes === before.writes, 'signed-out sync performs no account IO');
signIn('b'); await settle();
check(store.getQuizAnswer('pending').selected === 'b', 'signing back in preserves own pending device work');
delete globalThis.__learningSyncTest;
console.log(`Learning sync: ${checks} behavioral account-boundary/pull/push/recovery checks passed.`);
