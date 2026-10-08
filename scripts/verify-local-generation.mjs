// Real local Auth/API/Storage/PostgreSQL, with provider calls and generation
// replaced explicitly. This script cannot incur AI charges or touch production.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig } from './dev-setup-server.mjs';
import { createSetupAccountClient } from '../web/js/setup-account-client.js';
import { prepareAccountPayload, sourcePath } from '../web/js/setup-account-model.js';
import { setupDraft } from '../web/js/setup-model.js';
import { pdfFixture, docxFixture } from './fixtures/source-documents.mjs';

const config = await loadPreviewConfig(new URL('../.env.preview.local', import.meta.url));
assert.ok(config.mode === 'local' && config.url === 'http://127.0.0.1:54321' && config.generation);
Object.assign(process.env, { SUPABASE_URL: config.url, SUPABASE_ANON_KEY: config.publicKey, SUPABASE_SECRET_KEY: config.secretKey, LEARNABLE_PROVIDER_VAULT_KEY: config.vaultKey });
const { createSetupGenerationHandler } = await import('../web/api/setups/generate.js');
const { sealProviderKey } = await import('../web/api/_lib/provider-vault.mjs');
const admin = createClient(config.url, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const base = 'http://127.0.0.1:4173', users = [], paths = [], jobs = [], pending = [];
const id = `qa-generation-${randomUUID()}`;
let checks = 0, runs = 0;
const check = (value, name) => { assert.ok(value, name); checks++; };
async function user() {
  const email = `${randomUUID()}@example.test`, password = `${randomUUID()}aA9!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ok(!error && data.user); users.push(data.user.id);
  const sdk = createClient(config.url, config.publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await sdk.auth.signInWithPassword({ email, password }); assert.ok(!signed.error);
  const token = signed.data.session.access_token, owner = signed.data.user.id;
  const client = createSetupAccountClient({ getClient: async () => sdk, getIdentity: () => ({ id: owner }), fetcher: (url, options) => fetch(base + url, options) });
  const request = (path, body, method = body ? 'POST' : 'GET') => fetch(base + path, { method, headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
  return { sdk, token, owner, client, request };
}
try {
  const a = await user(), b = await user();
  const draft = setupDraft('Local generation QA'); draft.brief.audience = 'Synthetic learner'; draft.brief.context = 'Short sessions';
  draft.sources.notes = [{ id: 'n1', title: 'Notes', text: 'Synthetic source' }];
  draft.sources.files = [{ id: 'f1', name: 'transcript.txt', blob: new Blob(['Original UTF-8 transcript 🏊']) }, { id: 'f2', name: 'lesson.pdf', blob: new Blob([pdfFixture(['PDF source lesson'])]) }, { id: 'f3', name: 'lesson.docx', blob: new Blob([docxFixture(['Word source lesson 中文'])]) }];
  const prepared = await prepareAccountPayload(draft);
  paths.push(...prepared.payload.sources.files.map(file => sourcePath(a.owner, id, file)));
  const saved = await a.client.save(a.owner, id, draft);
  const body = { id, revision: saved.revision, action: 'check' };
  let response = await a.request('/api/setups/generate', body), result = await response.json();
  check(response.status === 200 && result.enabled && !result.connected && !result.ready && !result.issues.length, 'real preflight reads committed setup and private TXT, without generation');
  check(result.sources.files.length === 3 && result.sources.files.every(f => f.status === 'ready') && result.sources.requiresReview, 'real API extracts saved PDF/DOCX/TXT originals before provider connection');
  check((await b.request('/api/setups/generate', body)).status === 404, 'API rejects cross-account setup access');
  check((await a.request('/api/setups/generate', { ...body, revision: 999 })).status === 409, 'API rejects stale revision');
  const inserted = await admin.from('provider_connections').insert({ owner_id: a.owner, provider: 'anthropic', encrypted_key: sealProviderKey('sk-ant-synthetic-never-sent-to-provider', a.owner) });
  assert.ok(!inserted.error);
  check(!!(await a.sdk.from('provider_connections').select('*')).error, 'database denies even owner browser reads of vault');
  check(!!(await b.sdk.from('provider_connections').insert({ owner_id: b.owner, provider: 'anthropic', encrypted_key: 'bad' })).error, 'database denies browser writes of vault');
  const anonymous = createClient(config.url, config.publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  check(!!(await anonymous.from('provider_connections').select('*')).error, 'database denies anonymous vault reads');
  result = await (await a.request('/api/providers/connection')).json();
  check(result.connected && !JSON.stringify(result).includes('sk-ant-'), 'real status reports presence without revealing credential');
  result = await (await a.request('/api/setups/generate', body)).json();
  check(result.ready, 'real preflight decrypts account connection and marks supported setup ready');
  const sourceReview = result.sources.digest;
  check((await a.sdk.from('generation_jobs').select('id')).data.length === 0, 'readiness never creates a job');
  const handler = createSetupGenerationHandler({
    enabled: () => true, validate: async () => {}, background: promise => pending.push(promise),
    run: async args => {
      runs++;
      assert.ok(args.userBrief.source_text.includes('Original UTF-8 transcript 🏊'));
      assert.ok(args.userBrief.source_text.includes('PDF source lesson') && args.userBrief.source_text.includes('Word source lesson 中文'));
      assert.equal(args.userBrief.context, 'Short sessions');
      const update = await admin.from('generation_jobs').update({ status: 'review_curriculum', stage: 'intake', message: 'Synthetic QA plan ready for review', brief: { title: 'Local QA', modules: [] }, outline: { title: 'Local QA', modules: [] } }).eq('id', args.jobId).eq('owner_id', args.ownerId).eq('run_id', args.runId);
      assert.ok(!update.error);
    }
  });
  async function start(review = sourceReview) {
    const res = { code: 0, body: null, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: 'POST', headers: { authorization: `Bearer ${a.token}` }, body: { ...body, action: 'start', sourceReview: review } }, res);
    if (res.body.jobId) jobs.push(res.body.jobId);
    return res;
  }
  check((await start(null)).code === 409 && runs === 0, 'server rejects missing source-text acknowledgement without paid work');
  check((await start('old-review')).code === 409 && runs === 0, 'server rejects stale source-text acknowledgement without paid work');
  const attempts = await Promise.all([start(), start()]); await Promise.all(pending);
  check(attempts.every(r => r.code === 200) && attempts[0].body.jobId === attempts[1].body.jobId && runs === 1, 'real unique constraint permits one job and one launch during race');
  const row = await a.sdk.from('generation_jobs').select('id,status,user_brief').eq('id', jobs[0]).single();
  check(!row.error && row.data.status === 'review_curriculum' && row.data.user_brief.setup_reference.hash === prepared.hash, 'owner can reopen durable review checkpoint with input provenance');
  const deniedJob = await b.sdk.from('generation_jobs').select('id').eq('id', jobs[0]);
  check(!deniedJob.error && deniedJob.data.length === 0, 'job RLS blocks other account');
  response = await a.request('/api/providers/connection', null, 'DELETE');
  check(response.status === 200 && !(await response.json()).connected, 'real disconnect removes protected credential');
  result = await (await a.request('/api/setups/generate', body)).json();
  check(result.existing && result.jobId === jobs[0] && runs === 1, 'real API reattaches existing checkpoint after disconnect');
  check((await fetch(base + '/api/health/cloud')).status === 200, 'existing workspace health preflight is ready locally');
  console.log(`Local creation integration: ${checks} checks passed. Real Auth/API/Storage/PostgreSQL; synthetic provider and plan runner. No paid AI calls.`);
} finally {
  await Promise.allSettled(pending);
  for (const job of new Set(jobs)) { const removed = await admin.from('generation_jobs').delete().eq('id', job).in('owner_id', users); if (removed.error) throw new Error('QA job cleanup failed.'); }
  if (paths.length) { const removed = await admin.storage.from('setup-sources').remove(paths); if (removed.error) throw new Error('QA original cleanup failed.'); }
  for (const owner of users) { const removed = await admin.auth.admin.deleteUser(owner); if (removed.error) throw new Error('QA account cleanup failed.'); }
  console.log('Only this run’s temporary local accounts, job and source originals were removed. No user work was changed.');
}
