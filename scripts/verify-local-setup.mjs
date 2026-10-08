// Real Auth + API + Storage + PostgreSQL QA. Refuses all non-local backends.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig } from './dev-setup-server.mjs';
import { createSetupAccountClient } from '../web/js/setup-account-client.js';
import { prepareAccountPayload, sourcePath } from '../web/js/setup-account-model.js';
import { setupDraft } from '../web/js/setup-model.js';

const config = await loadPreviewConfig(new URL('../.env.preview.local', import.meta.url));
assert.ok(config.mode === 'local' && config.url === 'http://127.0.0.1:54321', 'QA is restricted to this isolated local stack');
const base = 'http://127.0.0.1:4173';
const publicConfig = await (await fetch(`${base}/js/config.js`)).text();
assert.ok(publicConfig.includes(JSON.stringify(config.url)) && publicConfig.includes(JSON.stringify(config.publicKey)), 'Browser and API preview must use local configuration');
const admin = createClient(config.url, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const run = `qa-${randomUUID()}`, users = [], paths = [];
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; console.log(`PASS ${label}`); };
async function user(label) {
  const email = `${run}-${label}@example.test`, password = randomUUID() + 'aA7!';
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ok(!created.error && created.data.user, 'Create an isolated local QA user'); users.push(created.data.user.id);
  const sdk = createClient(config.url, config.publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await sdk.auth.signInWithPassword({ email, password });
  assert.ok(!signed.error && signed.data.session, 'Real local Auth sign-in succeeds');
  const owner = signed.data.user.id, token = signed.data.session.access_token;
  const client = createSetupAccountClient({ getClient: async () => sdk, getIdentity: () => ({ id: owner }), fetcher: (url, options) => fetch(base + url, options) });
  const request = (url, body, session = token) => fetch(base + url, { method: body ? 'POST' : 'GET', headers: { Authorization: `Bearer ${session}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined });
  return { sdk, owner, token, client, request };
}
try {
  const a = await user('a'), b = await user('b');
  check((await a.client.list(a.owner)).drafts.length === 0, 'sign-in alone creates no setup backup');
  const draft = setupDraft('Local QA course'); draft.brief.audience = 'Local test learner';
  draft.sources.notes = [{ id: 'note-one', title: 'Transcript', text: 'A raw transcript for local persistence verification.' }];
  draft.sources.links = [{ id: 'link-one', title: 'Reference', url: 'https://example.com/reference' }];
  draft.sources.files = [{ id: 'original-one', name: 'transcript.txt', blob: new Blob(['Original local QA bytes'], { type: 'text/plain' }) }];
  const prepared = await prepareAccountPayload(draft), id = run;
  const objectPath = sourcePath(a.owner, id, prepared.payload.sources.files[0]); paths.push(objectPath);
  const ack = await a.client.save(a.owner, id, draft);
  check(ack.revision === 1, 'real original upload and transactional save acknowledged');
  check((await a.client.list(a.owner)).drafts.some(item => item.id === id), 'saved setup appears in account list');
  check((await a.client.save(a.owner, id, draft)).revision === 1, 'same-content retry is idempotent after ambiguous acknowledgement');
  const restored = await a.client.restore(a.owner, id);
  check(restored.missing === 0 && await restored.draft.sources.files[0].blob.text() === 'Original local QA bytes', 'restore downloads and hash-verifies actual original bytes');
  check(restored.draft.sources.notes[0].text === draft.sources.notes[0].text && restored.draft.sources.links[0].url === draft.sources.links[0].url, 'notes and links round-trip through database');
  check((await b.client.list(b.owner)).drafts.length === 0, 'another account cannot list the saved setup');
  const other = await b.request(`/api/setups/store?id=${id}`);
  check(other.status === 404, 'another account gets neutral not-found for private ID');
  const direct = await b.sdk.from('course_setups').select('id').eq('owner_id', a.owner);
  check(!direct.error && direct.data.length === 0, 'database RLS independently blocks cross-owner reads');
  const deniedDownload = await b.sdk.storage.from('setup-sources').download(objectPath);
  check(!!deniedDownload.error, 'storage RLS blocks cross-owner original download');
  const forbiddenPath = `${a.owner}/${id}/other/${'f'.repeat(64)}`; paths.push(forbiddenPath);
  const wrongUpload = await b.sdk.storage.from('setup-sources').upload(forbiddenPath, new Blob(['bad']), { contentType: 'text/plain' });
  check(!!wrongUpload.error, 'storage RLS blocks upload into another account prefix');
  const overwrite = await a.sdk.storage.from('setup-sources').update(objectPath, new Blob(['replacement']), { contentType: 'text/plain' });
  check(!!overwrite.error, 'even the owner cannot overwrite an acknowledged original');
  const privileged = await b.sdk.rpc('commit_course_setup', { p_owner: a.owner, p_id: id, p_expected: 1, p_payload: prepared.payload, p_hash: prepared.hash });
  check(!!privileged.error, 'browser roles cannot execute service-only commit');
  const directWrite = await a.sdk.from('course_setups').insert({ owner_id: a.owner, id: `${id}-direct`, revision: 1, payload: prepared.payload, content_hash: prepared.hash });
  check(!!directWrite.error, 'browser cannot bypass commit using a direct table write');
  const expired = await a.request('/api/setups/store', null, 'invalid-expired-session');
  check(expired.status === 401, 'invalid session receives recoverable auth error');
  const anonymous = await fetch(`${base}/api/setups/store`);
  check(anonymous.status === 401, 'anonymous account access rejected');
  const pending = structuredClone(prepared.payload); pending.sources.files[0].id = 'not-uploaded';
  const pendingResult = await a.request('/api/setups/store', { id: `${id}-pending`, expectedRevision: 0, payload: pending });
  check(pendingResult.status === 409 && (await pendingResult.json()).code === 'files-pending', 'missing uploaded manifest cannot be committed');
  const mismatch = structuredClone(prepared.payload); mismatch.sources.files[0].size += 1;
  const mismatchResult = await a.request('/api/setups/store', { id, expectedRevision: 1, payload: mismatch });
  check(mismatchResult.status === 409 && (await mismatchResult.json()).code === 'files-pending', 'Storage metadata size must match claimed manifest');
  const next = structuredClone(draft); next.brief.goal = 'Concurrent edit';
  check((await a.client.save(a.owner, id, next, 1)).revision === 2, 'changed content creates the next revision');
  const stale = structuredClone(draft); stale.brief.goal = 'Stale browser edit';
  await assert.rejects(a.client.save(a.owner, id, stale, 1), error => error.code === 'conflict'); checks++; console.log('PASS stale client cannot overwrite a newer revision');
  const noFiles = structuredClone(prepared.payload); noFiles.sources.files = [];
  const racingId = `${id}-race`;
  const results = await Promise.all([a.request('/api/setups/store', { id: racingId, expectedRevision: 0, payload: noFiles }), a.request('/api/setups/store', { id: racingId, expectedRevision: 0, payload: { ...noFiles, brief: { ...noFiles.brief, goal: 'Other concurrent first insert' } } })]);
  check(results.filter(result => result.status === 200).length === 1 && results.filter(result => result.status === 409).length === 1, 'concurrent differing first inserts serialize without overwriting');
  const jobs = await a.sdk.from('generation_jobs').select('id');
  check(!jobs.error && jobs.data.length === 0, 'backup operations create no generation job');
  console.log(`Local backend integration: ${checks} checks passed with real Auth, Storage, PostgreSQL and Node API.`);
} finally {
  // Remove only exact objects/accounts created by this test run. Never user data.
  if (paths.length) { const result = await admin.storage.from('setup-sources').remove(paths); if (result.error) throw new Error('Local QA original cleanup failed; inspect the named QA run.'); }
  for (const id of users) { const result = await admin.auth.admin.deleteUser(id); if (result.error) throw new Error('Local QA account cleanup failed; inspect the named QA run.'); }
  console.log('Temporary local API-test accounts and originals removed. Browser-test drafts, if any, are retained.');
}
