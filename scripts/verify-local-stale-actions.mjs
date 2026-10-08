// Real local Auth/HTTP/Postgres. Stale actions must not affect a newer run.
// No real provider requests: review dispatch is counted, other endpoints have no key.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig, createPreviewServer } from './dev-setup-server.mjs';
import { curriculumFixture } from './fixtures/component-course.mjs';

const config = await loadPreviewConfig(new URL('../.env.preview.local', import.meta.url));
assert.equal(config.mode, 'local'); assert.equal(config.url, 'http://127.0.0.1:54321');
Object.assign(process.env, { SUPABASE_URL: config.url, SUPABASE_ANON_KEY: config.publicKey, SUPABASE_SECRET_KEY: config.secretKey, LEARNABLE_PROVIDER_VAULT_KEY: config.vaultKey });
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(config.url, config.secretKey, options);
let owner, server, base = '', dispatches = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (![config.url, base].includes(url.origin)) throw Error('External network denied by stale-action QA');
  return originalFetch(input, init);
};
try {
  const email = `stale-action-${randomUUID()}@example.test`, password = `${randomUUID()}Aa9!`;
  const created = await admin.auth.admin.createUser({ email, password, email_confirm: true }); assert.ifError(created.error); owner = created.data.user.id;
  const sdk = createClient(config.url, config.publicKey, options), signed = await sdk.auth.signInWithPassword({ email, password }); assert.ifError(signed.error);
  const { sealProviderKey } = await import('../web/api/_lib/provider-vault.mjs');
  assert.ifError((await admin.from('provider_connections').insert({ owner_id: owner, provider: 'anthropic', encrypted_key: sealProviderKey('sk-ant-synthetic-stale-action-QA', owner) })).error);
  const { createReviewHandler } = await import('../web/api/gen/review.js');
  const handlers = { '/api/gen/review': createReviewHandler({ runGeneration: async () => { dispatches++; }, background: p => p }) };
  for (const action of ['cancel', 'resume', 'restart', 'delete']) handlers[`/api/gen/${action}`] = (await import(`../web/api/gen/${action}.js`)).default;
  server = createPreviewServer({ config, extraHandlers: handlers }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); base = `http://127.0.0.1:${server.address().port}`;
  const results = [];
  for (const action of ['review', 'cancel', 'resume', 'restart', 'delete']) {
    if (action === 'cancel') assert.ifError((await admin.from('provider_connections').delete().eq('owner_id', owner)).error);
    const id = `qa-stale-${randomUUID()}`, oldRun = randomUUID(), newRun = randomUUID();
    const status = ['resume', 'restart'].includes(action) ? 'failed' : 'review_curriculum';
    const old = { id, owner_id: owner, run_id: oldRun, status, stage: 'intake', user_brief: { topic: 'Original QA request' }, brief: curriculumFixture(), ...(status === 'failed' ? { completed_at: new Date().toISOString() } : {}) };
    assert.ifError((await admin.from('generation_jobs').insert(old)).error);
    // Another tab finishes a new run before the old screen submits its action.
    assert.ifError((await admin.from('generation_jobs').update({ run_id: newRun, brief: { ...curriculumFixture(), title: 'Newer curriculum never seen by old tab' } }).eq('id', id).eq('owner_id', owner)).error);
    const before = await admin.from('generation_jobs').select('*').eq('id', id).single(); assert.ifError(before.error);
    const post = expected => fetch(`${base}/api/gen/${action}`, {
      method: 'POST', headers: { Authorization: `Bearer ${signed.data.session.access_token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ jobId: id, ...(action === 'review' ? { action: 'approve_curriculum' } : {}), expected })
    });
    for (const [scenario, expected] of Object.entries({ oldRun: { status, runId: oldRun }, oldStatus: { status: 'queued', runId: newRun }, missing: undefined, malformed: { status, runId: 'bad' }, legacyRunAgainstNewRun: { status, runId: null } })) {
      const response = await post(expected), body = await response.json();
      const after = await admin.from('generation_jobs').select('*').eq('id', id).maybeSingle(); assert.ifError(after.error);
      const unchanged = JSON.stringify(before.data) === JSON.stringify(after.data);
      assert.equal(response.status, 409, action + ' ' + scenario); assert.equal(body.code, 'GENERATION_CHANGED'); assert.ok(unchanged);
      results.push({ action, scenario, status: response.status, newerJobUnchanged: unchanged });
    }
    const current = await post({ status, runId: newRun });
    assert.equal(current.status, ['resume', 'restart'].includes(action) ? 400 : 200, action + ': current checkpoint still reaches normal behavior');
    results.push({ action, scenario: 'currentCheckpoint', status: current.status });
    if (action === 'delete') assert.equal((await admin.from('generation_jobs').select('id').eq('id', id)).data.length, 0);
  }
  // Explicit null is compatible with a genuinely legacy row, not a wildcard.
  const legacyId = `qa-stale-${randomUUID()}`;
  assert.ifError((await admin.from('generation_jobs').insert({ id: legacyId, owner_id: owner, status: 'failed', run_id: null, completed_at: new Date().toISOString() })).error);
  const rpcArgs = { p_job_id: legacyId, p_owner_id: owner, p_expected_status: 'failed', p_expected_run_id: null };
  const denied = await sdk.rpc('delete_generation_job_at_checkpoint', rpcArgs); assert.ok(denied.error, 'Authenticated browsers cannot bypass server authorization');
  const hidden = await admin.rpc('delete_generation_job_at_checkpoint', { ...rpcArgs, p_owner_id: randomUUID() }); assert.ifError(hidden.error); assert.equal(hidden.data.length, 0);
  const legacy = await fetch(`${base}/api/gen/delete`, { method: 'POST', headers: { Authorization: `Bearer ${signed.data.session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId: legacyId, expected: { status: 'failed', runId: null } }) });
  assert.equal(legacy.status, 200);
  results.push({ scenario: 'legacyNullRunDeletion', status: legacy.status }, { scenario: 'browserRpcDenied', passed: true }, { scenario: 'otherOwnerHidden', passed: true });
  console.log(JSON.stringify({ results, syntheticReviewDispatches: dispatches }, null, 2));
  assert.equal(dispatches, 1, 'Only the positive-control current review may dispatch; stale requests dispatch nothing.');
} finally {
  if (server) await new Promise(resolve => server.close(resolve));
  if (owner) {
    assert.ifError((await admin.from('generation_jobs').delete().eq('owner_id', owner)).error);
    assert.ifError((await admin.auth.admin.deleteUser(owner)).error);
  }
  globalThis.fetch = originalFetch;
  console.log('Removed only this run’s disposable local account and QA jobs; no provider calls or existing-user changes.');
}
