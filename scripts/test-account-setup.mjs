import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeAccountPayload, prepareAccountPayload, sourcePath } from '../web/js/setup-account-model.js';
import { setupDraft } from '../web/js/setup-model.js';
import { createSetupHandoffs, setupReturnURL, HANDOFF_TTL } from '../web/js/setup-handoff.js';
import { createSetupAccountClient } from '../web/js/setup-account-client.js';
import { createSetupHandler } from '../web/api/setups/store.js';

const checks = [];
const check = (ok, name) => { assert.ok(ok, name); checks.push(name); };
const draft = setupDraft('Teach swimming'); draft.brief.audience = 'Parent and child';
draft.sources.files = [{ id: 'source-1', name: 'notes.txt', blob: new Blob(['original']) }];
const prepared = await prepareAccountPayload(draft);
check(prepared.payload.sources.files[0].sha256.length === 64, 'original bytes hashed');
check(prepared.payload.sources.files[0].size === 8, 'original file size used');
const clean = normalizeAccountPayload({ ...prepared.payload, secret: 'no', owner_id: 'evil', sources: { ...prepared.payload.sources, files: [{ ...prepared.payload.sources.files[0], storage_path: '../victim', apiKey: 'secret' }] } });
check(!JSON.stringify(clean).includes('evil') && !JSON.stringify(clean).includes('secret') && !JSON.stringify(clean).includes('victim'), 'payload allowlist excludes ownership, paths and credentials');
check(sourcePath('owner', 'setup', clean.sources.files[0]).startsWith('owner/setup/source-1/'), 'storage path is derived from verified owner/setup/source/hash');
assert.throws(() => sourcePath('owner', '../setup', clean.sources.files[0])); checks.push('path traversal rejected');
assert.throws(() => normalizeAccountPayload({ ...clean, sources: { ...clean.sources, notes: [{ id: 'n1', title: '', text: 'a'.repeat(12001) }] } }), /12,000/); checks.push('cloud note budget enforced');
assert.throws(() => normalizeAccountPayload({ ...clean, sources: { ...clean.sources, links: [{ id: 'l1', title: '', url: 'http://127.0.0.1' }] } }), /public/); checks.push('local URL rejected again at server boundary');
assert.throws(() => normalizeAccountPayload({ ...clean, sources: { ...clean.sources, files: [{ ...clean.sources.files[0], size: 10485761 }] } })); checks.push('server file size check');
let clock = 100000; const savedMarkers = new Map();
const markers = createSetupHandoffs({ storage: { setItem: (k,v) => savedMarkers.set(k,v), getItem: k => savedMarkers.get(k), removeItem: k => savedMarkers.delete(k) }, now: () => clock });
check(markers.begin('one', true) && markers.read('one').guest, 'explicit selected guest marker');
check(!markers.read('two') && !JSON.stringify([...savedMarkers.values()]).includes('Teach swimming'), 'marker neither selects other drafts nor includes content');
clock += HANDOFF_TTL + 1; check(!markers.read('one'), 'handoff expires independently of draft');
const returning = new URL(setupReturnURL('one', 'https://learnable.example/path?old=private#token'));
check(returning.pathname === '/' && returning.searchParams.get('draft') === 'one' && returning.searchParams.get('step') === 'account' && !returning.hash && !returning.href.includes('private'), 'return route allowlist contains only opaque setup identity');
const denied = createSetupHandoffs({ storage: { setItem() { throw new Error('denied'); }, getItem() { throw new Error('denied'); } } });
check(!denied.begin('one', true) && denied.read('one').guest, 'blocked marker storage is visible but same-tab memory retained');

let identity = { id: 'owner' }, remote = null, uploadFailure = false, loseResponse = false;
const objects = new Map(), requests = [], uploads = [];
const sdk = { auth: { getSession: async () => ({ data: { session: { user: identity, access_token: 'test-jwt' } } }) }, storage: { from(bucket) { assert.equal(bucket, 'setup-sources'); return {
  async upload(path, blob, options) { uploads.push(path); check(options.upsert === false, 'upload is immutable'); if (uploadFailure) return { error: { message: 'offline', statusCode: 500 } }; if (objects.has(path)) return { error: { message: 'already exists', statusCode: 409 } }; objects.set(path, blob); return { error: null }; },
  async download(path) { return { data: objects.get(path), error: null }; }
}; } } };
const client = createSetupAccountClient({ getClient: async () => sdk, getIdentity: () => identity, fetcher: async (url, options) => {
  requests.push({ url, options });
  check(options.headers.Authorization === 'Bearer test-jwt', 'authenticated setup request');
  if (options.method === 'GET') return { ok: !!remote, json: async () => remote || { code: 'missing', error: 'missing' } };
  const body = JSON.parse(options.body); check(body.owner_id === undefined, 'client cannot select server owner');
  remote = { id: body.id, revision: (remote?.revision || 0) + 1, payload: body.payload, content_hash: prepared.hash, updated_at: '2026-09-10T00:00:00Z' };
  if (loseResponse) { loseResponse = false; throw new Error('lost after commit'); }
  return { ok: true, json: async () => ({ id: body.id, revision: remote.revision, contentHash: remote.content_hash, updatedAt: remote.updated_at }) };
} });
uploadFailure = true;
await assert.rejects(client.save('owner', 'setup', draft), error => error.code === 'upload');
check(remote === null, 'upload failure does not commit a false complete backup');
uploadFailure = false; loseResponse = true;
await assert.rejects(client.save('owner', 'setup', draft), error => error.code === 'network');
const beforeRetry = uploads.length; const ack = await client.save('owner', 'setup', draft);
check(ack.revision === 1 && uploads.length === beforeRetry, 'lost response retry recognizes same committed revision without reupload');
const restored = await client.restore('owner', 'setup');
check(await restored.draft.sources.files[0].blob.text() === 'original', 'cloud restore verifies and restores file bytes');
objects.set(uploads.at(-1), new Blob(['tampered']));
check((await client.restore('owner', 'setup')).missing === 1, 'tampered source preserves metadata as missing instead of false restore');
remote.content_hash = 'f'.repeat(64); remote.revision = 7;
await assert.rejects(client.save('owner', 'setup', draft, 1), error => error.code === 'conflict'); checks.push('remote revision conflict stops upload/overwrite');
identity = { id: 'other' }; const beforeWrong = requests.length;
await assert.rejects(client.save('owner', 'setup', draft), error => error.code === 'auth');
check(requests.length === beforeWrong, 'account switch prevents old-owner request from starting');

const trace = []; let rpcCalls = 0, rpcResult = { id: 'setup', revision: 1, contentHash: prepared.hash };
const builder = { select(value) { trace.push(['select', value]); return this; }, eq(k,v) { trace.push(['eq',k,v]); return this; }, maybeSingle: async () => ({ data: null, error: null }), order() { return this; }, limit: async () => ({ data: [], error: null }) };
const handler = createSetupHandler({ authenticate: async () => ({ user: { id: 'verified-owner' }, client: { from: () => builder } }), admin: () => ({ rpc: async (name, args) => { rpcCalls++; trace.push(['rpc', args]); return { data: rpcResult, error: null }; } }) });
const response = () => ({ code: 0, body: null, headers: {}, setHeader(k,v) { this.headers[k]=v; }, status(code) { this.code=code; return this; }, json(body) { this.body=body; return this; } });
let res = response(); await handler({ method: 'POST', url: '/api/setups/store', body: { id: 'setup', expectedRevision: 0, owner_id: 'attacker', payload: clean } }, res);
check(res.code === 200 && trace.at(-1)[1].p_owner === 'verified-owner', 'server owner always comes from verified JWT');
check(trace.at(-1)[1].p_hash === prepared.hash, 'server recomputes canonical content hash');
res = response(); await handler({ method: 'GET', url: '/api/setups/store?id=private-id' }, res);
check(res.code === 404 && trace.some(x=>x[0]==='eq'&&x[1]==='owner_id'&&x[2]==='verified-owner'), 'private read uses owner predicate and neutral missing');
res = response(); await handler({ method: 'POST', body: { id: '../bad', expectedRevision: 0, payload: clean } }, res);
check(res.code === 400 && rpcCalls === 1, 'invalid ID cannot reach service-role commit');
rpcResult = { error: 'conflict' }; res = response(); await handler({ method: 'POST', body: { id: 'setup', expectedRevision: 0, payload: clean } }, res);
check(res.code === 409 && res.body.code === 'conflict', 'RPC conflicts are recoverable HTTP conflicts');
res = response(); await createSetupHandler({ authenticate: async () => { throw new Error('bad JWT'); } })({ method: 'POST' }, res);
check(res.code === 401 && res.headers['Cache-Control'] === 'no-store', 'unauthenticated request rejected and never cached');
const sql = readFileSync('db/06-course-setups.sql', 'utf8');
const intake = readFileSync('web/js/intake.js', 'utf8');
const authListener = intake.slice(intake.indexOf('onUserChange((user) => {'), intake.indexOf('// Watch the rendered job'));
check(authListener.indexOf('if (inSetup()) return;') < authListener.indexOf('readPendingCourseCreation()') && authListener.includes('getUser()?.id !== user.id'), 'legacy auth return cannot hijack the selected setup or another owner');
check(sql.includes('enable row level security') && sql.includes('auth.uid() = owner_id'), 'migration owner read policy');
check(sql.includes('pg_advisory_xact_lock') && sql.includes('coalesce(current_row.revision, 0) <> p_expected'), 'migration serializes create and checks exact revisions');
check(sql.includes("metadata->>'size'") && sql.includes("'files-pending'"), 'commit requires durable source manifest');
check(sql.includes('from public, anon, authenticated') && sql.includes('to service_role'), 'privileged commit unavailable to browser roles');
console.log(`Account setup: ${checks.length} model/client/API contract checks passed. SQL inspected, not executed.`);
