// Actual local Auth/Postgres/RLS and concurrent progress writes. No AI or remote DB.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig } from './dev-setup-server.mjs';
import { createLearningStore } from '../web/js/learning-store.js';
import { writeLearningSnapshot } from '../web/js/learning-state.js';

const config = await loadPreviewConfig(new URL('../.env.preview.local', import.meta.url));
assert.equal(config.mode, 'local'); assert.equal(config.url, 'http://127.0.0.1:54321');
const admin = createClient(config.url, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const accounts = []; let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; };
const device = owner => {
  const values = new Map();
  const store = createLearningStore({ storage: { getItem: key => values.get(key) || null, setItem: (key, value) => values.set(key, value) } });
  store.setOwner(owner); store.setCourse('course-one'); store.setLesson('module', 'topic'); return store;
};
try {
  for (let i = 0; i < 2; i++) {
    const email = `learning-sync-${randomUUID()}@example.test`, password = `${randomUUID()}Aa9!`;
    const made = await admin.auth.admin.createUser({ email, password, email_confirm: true }); assert.ok(!made.error);
    const account = { owner: made.data.user.id }; accounts.push(account);
    account.client = createClient(config.url, config.publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
    assert.ok(!(await account.client.auth.signInWithPassword({ email, password })).error);
  }
  const [a, b] = accounts, left = device(a.owner), right = device(a.owner);
  const read = async account => { const result = await account.client.from('user_state').select('state').eq('user_id', account.owner).single(); assert.ok(!result.error, result.error?.message); return result.data.state; };
  left.saveQuizAnswer('same', { selected: 'left' }); left.completeTopic('module', 'topic');
  right.setCourse('course-two'); right.setLesson('module', 'topic'); right.saveQuizAnswer('same', { selected: 'right' });
  // Both clients can see no row and race to insert: duplicate-key recovery rereads.
  await Promise.all([writeLearningSnapshot(a.client, a.owner, left.exportSnapshot()), writeLearningSnapshot(a.client, a.owner, right.exportSnapshot())]);
  let saved = await read(a);
  check(Object.keys(saved._learningV2.courses).length === 2, 'concurrent first-device inserts retain both courses');
  right.applyRemote(saved); left.applyRemote(saved);
  check(left.getQuizAnswer('same').selected === 'left' && right.getQuizAnswer('same').selected === 'right', 'same quiz ID remains course-specific after account roundtrip');
  right.setCourse('course-one'); right.setLesson('module', 'topic');
  left.savePracticeStep('checklist', 'first', true);
  right.savePracticeStep('checklist', 'second', true);
  right.saveExerciseDraft('same', 'Private account A response');
  left.saveFlashcardState('same', { interval: 3 });
  await Promise.all([writeLearningSnapshot(a.client, a.owner, left.exportSnapshot()), writeLearningSnapshot(a.client, a.owner, right.exportSnapshot())]);
  saved = await read(a); left.applyRemote(saved); right.applyRemote(saved);
  check(left.getPracticeProgress('checklist').steps.first && left.getPracticeProgress('checklist').steps.second, 'concurrent different checklist items survive conditional update');
  check(left.getExerciseDraft('same').text === 'Private account A response' && right.getFlashcardState('same').interval === 3, 'exercise and flashcard state sync together');
  right.uncompleteTopic('module', 'topic'); right.savePracticeStep('checklist', 'first', false);
  left.savePracticeSkill('checklist', 'skill', 'with_help');
  await Promise.all([writeLearningSnapshot(a.client, a.owner, left.exportSnapshot()), writeLearningSnapshot(a.client, a.owner, right.exportSnapshot())]);
  saved = await read(a); const fresh = device(a.owner); fresh.applyRemote(saved);
  check(!fresh.isTopicCompleted('module', 'topic'), 'newer uncompletion survives stale device snapshot');
  check(fresh.getPracticeProgress('checklist').steps.first === false && fresh.getPracticeProgress('checklist').steps.second === true, 'explicit uncheck is retained with other checked items');
  check(fresh.getPracticeProgress('checklist').skills.skill === 'with_help', 'self-assessment survives independent item changes');
  check(fresh.getQuizAnswer('same').selected === 'left', 'new-device account load restores correct course quiz');
  fresh.setLesson('module', 'topic-two'); check(!fresh.getQuizAnswer('same') && !fresh.getExerciseDraft('same'), 'identical IDs in a new lesson are blank');
  const foreignRead = await b.client.from('user_state').select('state').eq('user_id', a.owner);
  check(!foreignRead.error && foreignRead.data.length === 0, 'RLS hides account A from account B');
  const foreignWrite = await b.client.from('user_state').update({ state: {} }).eq('user_id', a.owner).select('user_id');
  check(!foreignWrite.error && foreignWrite.data.length === 0, 'RLS refuses cross-account updates');
  const other = device(b.owner); other.saveQuizAnswer('same', { selected: 'account-b' });
  await writeLearningSnapshot(b.client, b.owner, other.exportSnapshot());
  check((await read(a))._learningV2.courses['course-one'].quizAnswers['["module","topic","same"]'].selected === 'left', 'account B never modifies account A answer');
  check((await read(b))._learningV2.courses['course-one'].quizAnswers['["module","topic","same"]'].selected === 'account-b', 'same course and lesson have independent account B answer');
  const legacy = { quizAnswers: { legacy: { selected: 'retained' } }, theme: 'dark', unknown: { keep: true }, _apiKeys: { anthropic: 'synthetic-retained-key' } };
  assert.ok(!(await a.client.from('user_state').update({ state: { ...saved, ...legacy } }).eq('user_id', a.owner)).error);
  saved = await writeLearningSnapshot(a.client, a.owner, left.exportSnapshot());
  check(saved.quizAnswers.legacy.selected === 'retained' && saved.unknown.keep && saved.theme === 'dark', 'unscoped and unknown existing fields preserved');
  check(saved._apiKeys.anthropic === 'synthetic-retained-key', 'progress writes preserve provider credential contract');
  fresh.setLesson('module', 'topic'); fresh.applyRemote(saved);
  check(!fresh.getQuizAnswer('legacy') && fresh.retainedLegacy().quizAnswers.legacy.selected === 'retained', 'legacy retained without guessed course ownership');
  console.log(`Local learning progress: ${checks} checks passed with actual Auth/Postgres/RLS and two accounts; no paid providers.`);
} finally {
  for (const account of accounts) {
    await admin.from('user_state').delete().eq('user_id', account.owner);
    assert.ok(!(await admin.auth.admin.deleteUser(account.owner)).error);
  }
}
