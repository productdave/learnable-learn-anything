// Only the specifically provisioned, isolated staging project; never production.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID, createHash } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { pathToFileURL } from 'node:url';
import { join } from 'node:path';

const directory = new URL('../output/staging/2026-09-18/', import.meta.url);
const state = JSON.parse(readFileSync(new URL('state.json', directory)));
const secret = JSON.parse(readFileSync(new URL('secrets.json', directory)));
assert.equal(state.ref, 'dmnwkrybgggbpqpetuub');
assert.equal(state.supabaseUrl, 'https://dmnwkrybgggbpqpetuub.supabase.co');
const inventory = JSON.parse(readFileSync(new URL('../docs/upgrade/staging-migrations-2026-09-18.json', import.meta.url)));
assert.equal(inventory.stagingRef,state.ref);
assert.deepEqual(state.migrations.map(row=>({path:row.name,sha256:row.sha256})),inventory.migrations);
assert.equal(inventory.migrations.length,21);
assert.ok(state.hostedConflictMigration && state.legacyHardening);
// Guard all SDK traffic, including cleanup, to this staging project only.
const originalFetch = globalThis.fetch;
const confinedFetch = (url, ...args) => {
  assert.equal(new URL(typeof url === 'string' ? url : url.url || url.href).origin, state.supabaseUrl);
  const init = args[0] || {};
  const timeout = AbortSignal.timeout(15000);
  return originalFetch(url, { ...init, signal: init.signal ? AbortSignal.any([init.signal, timeout]) : timeout });
};
const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: confinedFetch } };
const admin = createClient(state.supabaseUrl, secret.secretKey, options);
const anonymous = createClient(state.supabaseUrl, secret.publicKey, options);
const { commitCourseRow } = await import(pathToFileURL(join(state.candidate, 'api/_lib/course-commit.mjs')));
const accounts = [], checks = [], objects = [];
const check = (ok, name) => { assert.ok(ok, name); checks.push(name); console.log(`Passed: ${name}`); };
try {
  const before = await admin.auth.admin.listUsers();
  check(!before.error && before.data.users.length === 0, 'fresh staging has no real accounts');
  for (let i = 0; i < 2; i++) {
    const email = `staging-qa-${randomUUID()}@example.test`, password = randomUUID() + 'Aa9!';
    const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    assert.ok(!created.error, created.error?.message);
    const client = createClient(state.supabaseUrl, secret.publicKey, options);
    accounts.push({ owner: created.data.user.id, client });
    const login = await client.auth.signInWithPassword({ email, password });
    check(!login.error, `staging account ${i + 1} can authenticate`);
  }
  const [a, b] = accounts, courseId = 'staging-revision-qa';
  const payload = { config: { id: courseId, title: 'Disposable staging QA' }, lesson: 'Original', _courseRevision: randomUUID() };
  check(!(await a.client.from('user_courses').insert({ id: courseId, owner_id: a.owner, payload })).error, 'legacy creation remains supported');
  const read = async () => {
    const result = await a.client.from('user_courses').select('id,payload,updated_at,write_revision').eq('owner_id', a.owner).eq('id', courseId).single();
    assert.ok(!result.error, result.error?.message); return result.data;
  };
  const legacy = await read();
  check(!legacy.write_revision && !legacy.payload._courseRevision, 'legacy insert cannot forge a revision');
  const committed = await commitCourseRow({ supabase: a.client, ownerId: a.owner, courseId, row: legacy, payload: { ...legacy.payload, lesson: 'Accepted' } });
  check(!!committed?.payload._courseRevision, 'revision-aware commit works on hosted Postgres');
  const started = Date.now();
  const oldWrite = await a.client.from('user_courses').update({ payload }).eq('owner_id', a.owner).eq('id', courseId);
  check(oldWrite.error?.code === 'PT409' && oldWrite.status === 409, 'old browser overwrite returns conflict');
  check(Date.now() - started < 10000, 'conflict returns promptly without hosted retry loop');
  check((await admin.from('user_courses').update({ payload, write_revision: null }).eq('owner_id', a.owner).eq('id', courseId)).error?.code === 'PT409', 'old service overwrite rejected');
  check(await commitCourseRow({ supabase: a.client, ownerId: a.owner, courseId, row: legacy, payload }) === null, 'stale modern write conflicts');
  check((await read()).payload.lesson === 'Accepted', 'accepted course survives rejected writes');
  const cross = await b.client.from('user_courses').select('id').eq('owner_id', a.owner);
  check(!cross.error && cross.data.length === 0, 'other account cannot read private course');
  const anon = await anonymous.from('user_courses').select('id').eq('owner_id', a.owner);
  check(!!anon.error || anon.data.length === 0, 'anonymous cannot read private course');
  await assert.rejects(commitCourseRow({ supabase: b.client, ownerId: a.owner, courseId, row: committed, payload }), error => error.code === '42501');
  checks.push('other account cannot invoke commit as owner');
  for (const table of ['provider_connections', 'course_image_requests', 'course_publications', 'course_moderators', 'course_moderation_audit', 'generation_jobs_legacy_phase22']) {
    const result = await a.client.from(table).select('*').limit(1);
    check(!!result.error, `browser cannot directly access ${table}`);
  }
  const file = Buffer.from('Disposable hosted staging source. No personal data.');
  const hash = createHash('sha256').update(file).digest('hex');
  const path = `${a.owner}/staging-qa/source-qa/${hash}`;
  const uploaded = await a.client.storage.from('setup-sources').upload(path, file, { contentType: 'text/plain', upsert: false });
  assert.ok(!uploaded.error, uploaded.error?.message); objects.push(path);
  checks.push('owner can upload source to private staging bucket');
  const downloaded = await a.client.storage.from('setup-sources').download(path);
  check(!downloaded.error && await downloaded.data.text() === file.toString(), 'owner can read exact source bytes');
  check(!!(await b.client.storage.from('setup-sources').download(path)).error, 'other account cannot read source');
  check(!!(await anonymous.storage.from('setup-sources').download(path)).error, 'anonymous cannot read source');
  check(!!(await a.client.storage.from('setup-sources').upload(path, file, { contentType: 'text/plain', upsert: true })).error, 'browser cannot overwrite original source');
  const setup = { sources: { files: [{ id: 'source-qa', sha256: hash, size: file.length }] } };
  const saved = await admin.rpc('commit_course_setup', { p_owner: a.owner, p_id: 'staging-qa', p_expected: 0, p_payload: setup, p_hash: hash });
  check(!saved.error && saved.data.revision === 1, 'setup commit verifies hosted Storage metadata');
  const hidden = await b.client.from('course_setups').select('id').eq('owner_id', a.owner);
  check(!hidden.error && hidden.data.length === 0, 'other account cannot read setup');
  const bucketList = await admin.storage.listBuckets();
  check(!bucketList.error && ['course-uploads','setup-sources','course-images','publication-images'].every(id => bucketList.data.some(bucket => bucket.id === id && !bucket.public)), 'all four staging storage buckets remain private');
} finally {
  if (objects.length) assert.ok(!(await admin.storage.from('setup-sources').remove(objects)).error);
  for (const account of accounts) {
    assert.ok(!(await admin.auth.admin.deleteUser(account.owner)).error);
  }
  console.log('Removed only the disposable staging QA accounts and source object.');
}
const report = { ref: state.ref, checkedAt: new Date().toISOString(), checks, count: checks.length,
  limitations: ['Direct hosted Auth/REST/Storage and frozen candidate commit helper, not deployed Vercel APIs or browser flow.', 'Email callbacks, cron, hosted document readers and paid providers not tested.'], cleanedUp: true };
const reportURL = new URL(`database-qa-${Date.now()}.json`, directory);
writeFileSync(reportURL, JSON.stringify(report, null, 2), { flag:'wx' });
console.log(JSON.stringify({ checks: checks.length, passed: true, report: reportURL.pathname }));
