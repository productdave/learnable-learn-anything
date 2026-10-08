// Offline rollout boundary checks. Imports never invoke a remote CLI/action.
import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { closedFlags, staging, validateEnvironment, assertClosedState, buildMigrationSql } from './rollout-continuation-staging.mjs';

const env = () => [
  ...closedFlags.map(key => ({ key, value: '0', target: ['production', 'preview'] })),
  { key: 'SUPABASE_URL', value: `https://${staging.ref}.supabase.co` },
  { key: 'LEARNABLE_OPENAI_CONNECTION', value: '1' },
  { key: 'LEARNABLE_IMAGE_FUNDING', value: 'creator' }
];
const state = () => ({ live_jobs: '0', open_text_grants: '0', open_image_grants: '0',
  text_requests: '6', image_requests: '3', accounted_text_microusd: '1951170', accounted_image_microusd: '45142' });

test('closed isolated staging remains eligible without exposing values', () => {
  assert.deepEqual(validateEnvironment(env()), { paidPublicOff: closedFlags, continuationOff: true, creatorFunding: true, connectionOnly: true });
  assertClosedState(state());
});
for (const flag of closedFlags) test('reject enabled path: ' + flag, () => {
  const rows = env(); rows.find(r => r.key === flag).value = '1';
  assert.throws(() => validateEnvironment(rows), /must remain off/);
});
for (const [name, mutate] of [
  ['missing flag', rows => rows.shift()],
  ['duplicate flag', rows => rows.push({ ...rows[0] })],
  ['incomplete target coverage', rows => { rows[0].target = ['preview']; }],
  ['wrong database', rows => { rows.find(r => r.key === 'SUPABASE_URL').value = 'https://other.invalid'; }],
  ['platform funding', rows => { rows.find(r => r.key === 'LEARNABLE_IMAGE_FUNDING').value = 'learnable'; }],
  ['connection removed', rows => { rows.find(r => r.key === 'LEARNABLE_OPENAI_CONNECTION').value = '0'; }],
  ['refinement enabled', rows => rows.push({ key: 'LEARNABLE_AI_REFINEMENT', value: '1' })],
  ['continuation already enabled', rows => rows.push({ key: 'LEARNABLE_GENERATION_CONTINUATION', value: '1' })]
]) test('reject changed environment: ' + name, () => {
  const rows = env(); mutate(rows); assert.throws(() => validateEnvironment(rows));
});
for (const key of Object.keys(state())) test('reject changed ledger/work state: ' + key, () => {
  const row = state(); row[key] = Number(row[key]) + 1; assert.throws(() => assertClosedState(row));
});
test('only the pinned additive SQL can be wrapped for rollout', () => {
  const bytes = readFileSync(new URL('../db/22-generation-continuation.sql', import.meta.url));
  const sql = buildMigrationSql(bytes);
  assert.equal((sql.match(/^begin;$/gm) || []).length, 1);
  assert.equal((sql.match(/^commit;$/gm) || []).length, 1);
  assert.match(sql, /lock_timeout = '3s'/); assert.match(sql, /statement_timeout = '30s'/);
  assert.match(sql, /temporary table continuation_before on commit drop/);
  assert.match(sql, /before_state is distinct from after_state/);
  assert.match(sql, /learnable_staging\.applied_migrations/);
  assert.ok(!/delete\s+from|truncate|drop\s+table|grant\s+/i.test(sql));
  assert.throws(() => buildMigrationSql(Buffer.concat([bytes, Buffer.from('\n-- unreviewed')])), /Unreviewed migration/);
});
