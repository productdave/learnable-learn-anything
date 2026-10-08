// Disposable local accounts only; real Auth/Postgres/RLS, no provider or AI calls.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig } from './dev-setup-server.mjs';
import { createMaterialDefaultsClient, STANDARD_MATERIALS } from '../web/js/material-defaults.js';
import { writeLearningSnapshot } from '../web/js/learning-state.js';
const config = await loadPreviewConfig(new URL('../.env.preview.local', import.meta.url));
assert.equal(config.mode, 'local'); assert.equal(config.url, 'http://127.0.0.1:54321');
const admin = createClient(config.url, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const accounts = []; let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
try {
  for (let i = 0; i < 2; i++) {
    const email = `materials-${randomUUID()}@example.test`, password = `${randomUUID()}Aa9!`;
    const made = await admin.auth.admin.createUser({ email, password, email_confirm: true }); assert.ok(!made.error);
    const owner = made.data.user.id, client = createClient(config.url, config.publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
    accounts.push({ owner, client });
    assert.ok(!(await client.auth.signInWithPassword({ email, password })).error);
  }
  const [a, b] = accounts;
  const defaults = account => createMaterialDefaultsClient({ getClient: async () => account.client, getIdentity: () => ({ id: account.owner }) });
  const left = defaults(a), otherDevice = defaults(a), right = defaults(b);
  check(JSON.stringify((await left.load(a.owner)).components) === JSON.stringify(STANDARD_MATERIALS), 'new account uses standard materials');
  const progress = { courses: { course: { quizAnswers: { quiz: { selected: 'a', updatedAt: '2026-09-16' } } } } };
  await Promise.all([left.save(a.owner, ['lessons', 'practice'], null), writeLearningSnapshot(a.client, a.owner, progress, { providerKeys: { anthropic: 'synthetic-retained-key' } })]);
  let saved = await otherDevice.load(a.owner);
  check(saved.components.join() === 'lessons,practice', 'fresh device reads account defaults after concurrent insert');
  let row = await a.client.from('user_state').select('state').eq('user_id', a.owner).single(); assert.ok(!row.error);
  check(row.data.state._learningV2.courses.course.quizAnswers.quiz.selected === 'a', 'concurrent progress survives');
  check(row.data.state._apiKeys.anthropic === 'synthetic-retained-key', 'provider fields survive');
  const stale = saved.revision;
  saved = await left.save(a.owner, ['lessons', 'checklists'], saved.revision);
  await assert.rejects(otherDevice.save(a.owner, ['lessons'], stale), error => error.code === 'conflict'); checks++;
  check((await otherDevice.load(a.owner)).components.join() === 'lessons,checklists', 'conflict retains latest defaults');
  await right.save(b.owner, ['lessons', 'flashcards'], null);
  check((await left.load(a.owner)).components.join() === 'lessons,checklists', 'other account cannot change A preferences');
  const read = await b.client.from('user_state').select('state').eq('user_id', a.owner);
  check(!read.error && read.data.length === 0, 'RLS hides other account defaults');
  const write = await b.client.from('user_state').update({ state: {} }).eq('user_id', a.owner).select('user_id');
  check(!write.error && write.data.length === 0, 'RLS refuses other account default writes');
  await left.save(a.owner, STANDARD_MATERIALS, saved.revision);
  check((await otherDevice.load(a.owner)).components.join() === STANDARD_MATERIALS.join(), 'reset is durable across clients');
  row = await a.client.from('user_state').select('state').eq('user_id', a.owner).single();
  check(row.data.state._learningV2.courses.course.quizAnswers.quiz.selected === 'a', 'reset retains learning progress');
  console.log(`Local material defaults: ${checks} checks passed with two accounts and real Auth/Postgres/RLS.`);
} finally {
  for (const account of accounts) {
    await admin.from('user_state').delete().eq('user_id', account.owner);
    assert.ok(!(await admin.auth.admin.deleteUser(account.owner)).error);
  }
}
