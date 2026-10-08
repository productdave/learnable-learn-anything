import assert from 'node:assert/strict';
import { createLearningStore, learningStorageKey, LEGACY_STORAGE_KEY } from '../web/js/learning-store.js';
import { mergeCourses, writeLearningSnapshot } from '../web/js/learning-state.js';
let checks = 0;
const check = (v, label) => { assert.ok(v, label); checks++; };
const values = new Map(), original = JSON.stringify({ version: 1, theme: 'dark', quizAnswers: { collision: { selected: 'legacy' } } });
values.set(LEGACY_STORAGE_KEY, original);
let failStorage = false, time = Date.now();
const storage = { getItem: key => values.get(key) || null, setItem(key, value) { if (failStorage) throw new Error('Full'); values.set(key, value); } };
const create = () => createLearningStore({ storage, now: () => ++time });
const store = create();
check(store.getTheme() === 'dark', 'legacy theme retained without assigning old progress');
store.setCourse('course-a'); store.setLesson('module', 'topic');
check(!store.getQuizAnswer('collision'), 'unscoped legacy answers not guessed into a course');
store.saveQuizAnswer('collision', { selected: 'guest' });
store.setOwner('account-a');
check(!store.getQuizAnswer('collision'), 'guest progress is not silently claimed by an account');
store.saveQuizAnswer('collision', { selected: 'course-a' });
store.completeTopic('module', 'topic');
store.saveExerciseDraft('exercise', 'Account A notes');
store.saveFlashcardState('card', { interval: 3 });
store.savePracticeStep('practice', 0, true); store.savePracticeSkill('practice', 'skill', 'with_help');
const bound = store.bind();
store.setCourse('course-b'); store.setLesson('module', 'topic');
check(!store.getQuizAnswer('collision') && !store.isTopicCompleted('module', 'topic'), 'same item IDs in course B are independent');
check(!store.getExerciseDraft('exercise') && !store.getFlashcardState('card') && !store.getPracticeProgress('practice').steps[0], 'drafts, cards and practice are course-scoped');
bound.saveExerciseDraft('exercise', 'Late save stays in A');
check(!store.getExerciseDraft('exercise'), 'delayed originating-course write never touches B');
store.saveQuizAnswer('collision', { selected: 'course-b' });
store.setCourse('course-a'); store.setLesson('module', 'topic');
check(store.getQuizAnswer('collision').selected === 'course-a' && store.getExerciseDraft('exercise').text === 'Late save stays in A', 'return restores course A');
store.setLesson('module', 'different-topic');
check(!store.getQuizAnswer('collision') && !store.getExerciseDraft('exercise'), 'same IDs in another lesson are independent');
store.setLesson('module', 'topic');
store.setOwner('account-b');
check(!store.getQuizAnswer('collision') && !store.isTopicCompleted('module', 'topic'), 'account B cannot see A progress');
check(bound.saveExerciseDraft('exercise', 'wrong owner').stale, 'deferred account A save rejected after switch');
store.setOwner('account-a');
check(bound.saveQuizAnswer('collision', { selected: 'old epoch' }).stale, 'A-B-A switch rejects an old callback even when owner matches again');
check(store.getQuizAnswer('collision').selected === 'course-a', 'signing back in restores correct account data');
const reloaded = create(); reloaded.setOwner('account-a'); reloaded.setCourse('course-a'); reloaded.setLesson('module', 'topic');
check(reloaded.getQuizAnswer('collision').selected === 'course-a' && reloaded.getPracticeProgress('practice').skills.skill === 'with_help', 'reload restores owned progress and practice');
check(values.get(LEGACY_STORAGE_KEY) === original, 'legacy original is byte-for-byte untouched');
check(values.has(learningStorageKey(null)) && values.has(learningStorageKey('account-a')), 'guest/account snapshots remain separate');
const remoteLegacy = { quizAnswers: { old: { selected: 'original' } } };
store.applyRemote(remoteLegacy);
check(store.retainedLegacy().quizAnswers.old.selected === 'original' && !store.getQuizAnswer('old'), 'cloud legacy retained without course attribution');
const stale = store.scope(); store.setOwner('account-b');
check(!store.applyRemote({ _learningV2: { courses: { 'course-a': store.exportSnapshot() } } }, stale), 'stale remote owner cannot apply');
store.setOwner('account-a');
failStorage = true;
check(!store.savePracticeStep('practice', 1, true).ok && !store.getSaveStatus().persisted, 'quota failure is not reported saved');
check(store.getPracticeProgress('practice').steps[1] === true, 'failed durable save retains current work in memory');
store.setOwner('account-b'); store.setOwner('account-a');
check(!store.getSaveStatus().persisted, 'account roundtrip does not hide an unsaved snapshot');
failStorage = false;
check(store.retryLocalSave().ok, 'local save can retry without reentering work');
const repaired = create(); repaired.setOwner('account-a'); repaired.setCourse('course-a');
check(repaired.getPracticeProgress('practice').steps[1] === true, 'retry persists retained edit');
values.set(learningStorageKey('corrupt'), '{bad json'); store.setOwner('corrupt');
check(!store.savePracticeStep('key', 0, true).ok && values.get(learningStorageKey('corrupt')) === '{bad json', 'unreadable snapshots are not overwritten');

// Two independent device snapshots, including explicit undo and different checks.
const device = () => createLearningStore({ storage: { getItem: () => null, setItem() {} }, now: () => ++time });
const a = device(), b = device();
for (const s of [a, b]) { s.setOwner('owner'); s.setCourse('same'); }
a.completeTopic('m', 't'); a.savePracticeStep('list', 'one', true); a.savePracticeSkill('list', 'skill', 'with_help');
b.applyRemote({ _learningV2: a.exportSnapshot() });
b.uncompleteTopic('m', 't'); b.savePracticeStep('list', 'one', false); b.savePracticeStep('list', 'two', true);
a.savePracticeSkill('list', 'skill', 'independent_once');
const merged = mergeCourses(a.exportSnapshot().courses, b.exportSnapshot().courses);
check(merged.same.progress.m.t.completed === false, 'newer uncompletion survives merge');
check(merged.same.practiceProgress.list.steps.one === false && merged.same.practiceProgress.list.steps.two === true && merged.same.practiceProgress.list.skills.skill === 'independent_once', 'merge is per practice item and retains undo');
assert.deepEqual(mergeCourses(b.exportSnapshot().courses, a.exportSnapshot().courses), merged); checks++;
const future = new Date(time + 1000000).toISOString();
a.applyRemote({ _learningV2: { courses: { same: { progress: { m: { t: { completed: true, updatedAt: future } } } } } } });
a.uncompleteTopic('m', 't');
check(!a.isTopicCompleted('m', 't'), 'local edits advance past observed remote clocks');

let row = { state: { untouched: 'retained', ...remoteLegacy }, updated_at: new Date(time).toISOString() }, conflicts = 1, writes = 0;
const client = { from(name) {
  assert.equal(name, 'user_state');
  let operation = 'read', payload, conditions = {};
  const q = {
    select() { return q; }, eq(k, v) { conditions[k] = v; return q; },
    update(value) { operation = 'update'; payload = value; return q; }, insert(value) { operation = 'insert'; payload = value; return q; },
    async maybeSingle() {
      if (operation === 'read') return { data: structuredClone(row) };
      writes++;
      if (conflicts-- > 0) {
        row.state._learningV2 = { courses: { other: { quizAnswers: { key: { selected: 'remote', updatedAt: future } } } } };
        row.updated_at = new Date(Date.parse(row.updated_at) + 1).toISOString(); return { data: null };
      }
      assert.equal(conditions.user_id, 'owner'); assert.equal(conditions.updated_at, row.updated_at);
      row = payload; return { data: { state: row.state } };
    }
  }; return q;
} };
const saved = await writeLearningSnapshot(client, 'owner', a.exportSnapshot(), { providerKeys: { anthropic: 'synthetic-key' } });
check(writes === 2 && saved._learningV2.courses.other.quizAnswers.key.selected === 'remote' && saved._learningV2.courses.same, 'CAS conflict re-reads and retains concurrent other-course edits');
check(saved.untouched === 'retained' && saved.quizAnswers.old.selected === 'original' && saved._apiKey === 'synthetic-key', 'cloud write preserves unrelated/legacy fields and provider-key contract');
check(await writeLearningSnapshot(client, 'owner', {}, { isCurrent: () => false }) === null, 'stale owner never reads or writes');
await assert.rejects(writeLearningSnapshot({ from() { throw new Error('offline'); } }, 'owner', a.exportSnapshot()), /offline/); checks++;
const originalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
try {
  Object.defineProperty(globalThis, 'localStorage', { configurable: true, get() { throw new Error('Storage blocked'); } });
  const blocked = createLearningStore(); blocked.setCourse('course');
  check(!blocked.saveExerciseDraft('note', 'Retained here').ok && blocked.getExerciseDraft('note').text === 'Retained here', 'blocked browser storage getter cannot crash the learner or discard active input');
} finally {
  if (originalStorage) Object.defineProperty(globalThis, 'localStorage', originalStorage);
  else delete globalThis.localStorage;
}
console.log(`Learning isolation: ${checks} checks passed (course/account/lesson, retention, merge, failures and conditional writes).`);
