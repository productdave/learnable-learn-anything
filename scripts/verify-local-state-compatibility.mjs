// Mixed-generation clients against real, isolated Auth/Postgres/RLS. No providers.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig } from './dev-setup-server.mjs';
import { writeLearningSnapshot } from '../web/js/learning-state.js';
import { createMaterialDefaultsClient } from '../web/js/material-defaults.js';

const config = await loadPreviewConfig(new URL('../.env.preview.local', import.meta.url));
assert.equal(config.mode, 'local'); assert.equal(config.url, 'http://127.0.0.1:54321');
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(config.url, config.secretKey, options);
const accounts = []; let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; };
const read = async account => {
  const result = await account.client.from('user_state').select('state,updated_at').eq('user_id', account.id).single();
  assert.ifError(result.error); return result.data;
};
// Shape emitted by the old sync module: a whole-blob upsert, without modern fields.
const legacy = answer => ({ progress: { legacyModule: { legacyTopic: { completed: true } } }, quizAnswers: { legacyQuiz: { selected: answer } }, exerciseDrafts: {}, flashcardState: {} });
const upsert = async (account, state, updated_at = '2020-01-01T00:00:00Z') => {
  const result = await account.client.from('user_state').upsert({ user_id: account.id, state, updated_at });
  assert.ifError(result.error);
};
try {
  for (let index = 0; index < 2; index++) {
    const email = `state-compat-${randomUUID()}@example.test`, password = `${randomUUID()}Aa9!`;
    const made = await admin.auth.admin.createUser({ email, password, email_confirm: true }); assert.ifError(made.error);
    const account = { id: made.data.user.id, client: createClient(config.url, config.publicKey, options) }; accounts.push(account);
    assert.ifError((await account.client.auth.signInWithPassword({ email, password })).error);
  }
  const [a, b] = accounts;
  const first = { courses: { photography: { progress: { basics: { light: { completed: true, updatedAt: '2026-01-01T00:00:00Z' } } } } } };
  await writeLearningSnapshot(a.client, a.id, first);
  const defaults = createMaterialDefaultsClient({ getClient: async () => a.client, getIdentity: () => ({ id: a.id }) });
  const savedDefaults = await defaults.save(a.id, ['lessons', 'practice', 'checklists'], null);
  let before = await read(a);
  await upsert(a, legacy('old-tab'));
  let after = await read(a);
  check(JSON.stringify(after.state._learningV2) === JSON.stringify(before.state._learningV2), 'old whole-state upsert must preserve modern progress');
  check(JSON.stringify(after.state._courseMaterialDefaults) === JSON.stringify(before.state._courseMaterialDefaults), 'old whole-state upsert must preserve material defaults');
  check(after.state.quizAnswers.legacyQuiz.selected === 'old-tab', 'legacy answer still saves');
  check(after.updated_at > before.updated_at, 'stale client clock cannot move account revision backwards');

  const stale = await a.client.from('user_state').update({ state: before.state, updated_at: before.updated_at }).eq('user_id', a.id).eq('updated_at', before.updated_at).select('user_id');
  assert.ifError(stale.error); check(stale.data.length === 0, 'modern compare-and-swap rejects a snapshot from before the old-tab save');
  await writeLearningSnapshot(a.client, a.id, { courses: { other: { quizAnswers: { quiz: { selected: 2, updatedAt: '2026-01-02T00:00:00Z' } } } } });
  after = await read(a);
  check(!!after.state._learningV2.courses.photography && !!after.state._learningV2.courses.other, 'modern save after legacy upsert retains both courses');
  check(after.state.quizAnswers.legacyQuiz.selected === 'old-tab', 'modern save retains unscoped history without assigning it');
  const reset = await defaults.save(a.id, ['lessons', 'quizzes', 'flashcards'], savedDefaults.revision);
  check(reset.components.join(',') === 'lessons,quizzes,flashcards,images', 'explicit defaults reset removes optional checklists while retaining integrated images');

  before = await read(a);
  const update = await a.client.from('user_state').update({ state: legacy('direct-update'), updated_at: before.updated_at }).eq('user_id', a.id);
  assert.ifError(update.error); after = await read(a);
  check(after.state._learningV2.courses.other.quizAnswers.quiz.selected === 2, 'direct UPDATE is protected as well as UPSERT');
  check(after.updated_at > before.updated_at, 'same-timestamp write receives a distinct revision');
  await upsert(a, {}); after = await read(a);
  check(!!after.state._learningV2 && !!after.state._courseMaterialDefaults, 'empty legacy snapshot cannot erase modern fields');

  before = await read(a);
  for (const state of [[], 'invalid-state', null]) {
    const invalid = await a.client.from('user_state').update({ state }).eq('user_id', a.id);
    check(!!invalid.error, 'non-object replacement is refused when protected data exists');
  }
  after = await read(a);
  check(JSON.stringify(after) === JSON.stringify(before), 'rejected replacements leave state and revision unchanged');

  const second = { courses: { photography: { quizAnswers: { independent: { selected: 'B', updatedAt: '2026-02-01T00:00:00Z' } } } } };
  await upsert(b, legacy('B-before-upgrade'));
  check(!(await read(b)).state._learningV2, 'legacy-only account gets no fabricated course ownership');
  await writeLearningSnapshot(b.client, b.id, second);
  const forbidden = await b.client.from('user_state').update({ state: {} }).eq('user_id', a.id).select('user_id');
  assert.ifError(forbidden.error); check(forbidden.data.length === 0, 'trigger does not bypass cross-account RLS');
  check(JSON.stringify(await read(a)) === JSON.stringify(after), 'other account leaves original state unchanged');

  // Both orders are valid: guarded omission and optimistic modern merge must coexist.
  await Promise.all([
    upsert(a, legacy('concurrent')),
    writeLearningSnapshot(a.client, a.id, { courses: { third: { exerciseDrafts: { response: { text: 'Synthetic response', updatedAt: '2026-03-01T00:00:00Z' } } } } })
  ]);
  after = await read(a);
  check(['photography', 'other', 'third'].every(id => after.state._learningV2.courses[id]), 'concurrent legacy/current writes retain all modern courses');
  check(after.state.quizAnswers.legacyQuiz.selected === 'concurrent', 'concurrent write retains the new legacy answer');
  check(after.state._courseMaterialDefaults.revision === reset.revision, 'concurrent writes retain latest explicit defaults');
  check((await read(b)).state._learningV2.courses.photography.quizAnswers.independent.selected === 'B', 'separate account progress remains independent');
  console.log(`Local mixed-version state: ${checks} checks passed with actual Auth/Postgres/RLS; no providers or hosted changes.`);
} finally {
  for (const account of accounts) {
    assert.ifError((await admin.from('user_state').delete().eq('user_id', account.id)).error);
    assert.ifError((await admin.auth.admin.deleteUser(account.id)).error);
  }
  console.log('Removed only this run’s disposable local accounts/state; existing work unchanged.');
}
