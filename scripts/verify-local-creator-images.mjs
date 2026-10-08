// Real isolated-local Auth/HTTP/Postgres/vault/RLS. OpenAI is always synthetic.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig, createPreviewServer } from './dev-setup-server.mjs';
import { syntheticImageResponse } from './fixtures/generated-image.mjs';

const config = await loadPreviewConfig(new URL('../.env.preview.local', import.meta.url));
assert.ok(config.mode === 'local' && config.url === 'http://127.0.0.1:54321' && config.vaultKey);
Object.assign(process.env, { SUPABASE_URL: config.url, SUPABASE_ANON_KEY: config.publicKey,
  SUPABASE_SECRET_KEY: config.secretKey, LEARNABLE_PROVIDER_VAULT_KEY: config.vaultKey });
const { createOpenAIConnectionHandler } = await import('../web/api/providers/openai.js');
const { generateCreatorImage } = await import('../web/api/_lib/openai-image.mjs');
const { imagePolicy, ImageGenerationError } = await import('../web/api/_lib/image-policy.mjs');
const { sealProviderKey, openProviderKey } = await import('../web/api/_lib/provider-vault.mjs');
const admin = createClient(config.url, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const env = { LEARNABLE_GPT_IMAGES: '1', LEARNABLE_IMAGE_FUNDING: 'creator', OPENAI_API_KEY: 'never-use-platform-fallback' };
const users = [], keyA = 'sk-proj-synthetic-creator-a-never-real-1234567', keyB = 'sk-proj-synthetic-creator-b-never-real-1234567';
let checks = 0, metadataChecks = 0, imageCalls = 0, reject = false;
const check = (value, label) => { assert.ok(value, label); checks++; };
const handler = createOpenAIConnectionHandler({ getPolicy: () => imagePolicy(env), validate: async (key, model) => {
  metadataChecks++; check([keyA, keyB].includes(key) && model === imagePolicy(env).model, 'only synthetic key/model passed to injected metadata check');
  if (reject) throw new ImageGenerationError('access');
} });
const server = createPreviewServer({ config, setupHandler: () => {}, extraHandlers: { '/api/providers/openai': handler } });
await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
const base = `http://127.0.0.1:${server.address().port}`;
async function account() {
  const email = `${randomUUID()}@example.test`, password = `${randomUUID()}aA9!`;
  const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
  assert.ok(!error && data.user); users.push(data.user.id);
  const sdk = createClient(config.url, config.publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await sdk.auth.signInWithPassword({ email, password }); assert.ok(!signed.error);
  return { sdk, owner: data.user.id, request: async (method = 'GET', body) => {
    const res = await fetch(base + '/api/providers/openai', { method,
      headers: { Authorization: `Bearer ${signed.data.session.access_token}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body) });
    check(res.headers.get('cache-control') === 'no-store', 'real HTTP response no-store');
    return { status: res.status, body: await res.json() };
  } };
}
try {
  const a = await account(), b = await account();
  check((await fetch(base + '/api/providers/openai')).status === 401, 'actual auth rejects missing token');
  check(!(await a.request()).body.connected && !(await b.request()).body.connected && metadataChecks === 0, 'status checks are owner scoped and free');
  check((await a.request('POST', { key: keyA, owner_id: b.owner })).status === 400 && metadataChecks === 0, 'body cannot choose owner');
  let response = await a.request('POST', { key: keyA });
  check(response.status === 200 && response.body.connected && response.body.funding === 'creator' && response.body.generationChecked === false, 'real authenticated connection persisted without generation');
  const stored = await admin.from('provider_connections').select('encrypted_key').eq('owner_id', a.owner).eq('provider', 'openai').single();
  check(!stored.error && !stored.data.encrypted_key.includes(keyA) && openProviderKey(stored.data.encrypted_key, a.owner, 'openai') === keyA, 'actual row encrypted and decryptable only in server vault');
  assert.throws(() => openProviderKey(stored.data.encrypted_key, b.owner, 'openai')); checks++;
  assert.throws(() => openProviderKey(stored.data.encrypted_key, a.owner, 'anthropic')); checks++;
  check((await a.request()).body.connected && !(await b.request()).body.connected, 'other account does not inherit connection');
  check(!!(await a.sdk.from('provider_connections').select('*')).error, 'even owner cannot read vault directly');
  check(!!(await b.sdk.from('provider_connections').select('*')).error, 'other browser cannot read vault');
  check(!!(await a.sdk.from('provider_connections').insert({ owner_id: a.owner, provider: 'openai', encrypted_key: 'bad' })).error, 'browser cannot write vault');
  check(!!(await a.sdk.from('provider_connections').update({ encrypted_key: 'bad' }).eq('owner_id', a.owner)).error, 'browser cannot replace vault');
  check(!!(await a.sdk.from('provider_connections').delete().eq('owner_id', a.owner)).error, 'browser cannot delete vault directly');
  const anon = createClient(config.url, config.publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  check(!!(await anon.from('provider_connections').select('*')).error, 'anonymous cannot read vault');
  const unsupported = await admin.from('provider_connections').insert({ owner_id: a.owner, provider: 'not-supported', encrypted_key: 'bad' });
  check(unsupported.error?.code === '23514', 'real database provider allowlist enforced');
  const claude = sealProviderKey('synthetic-existing-claude', a.owner);
  check(!(await admin.from('provider_connections').insert({ owner_id: a.owner, provider: 'anthropic', encrypted_key: claude })).error, 'Claude and OpenAI rows coexist');
  reject = true;
  check((await a.request('POST', { key: keyB })).status === 503, 'failed provider check cannot replace connection'); reject = false;
  check((await admin.from('provider_connections').select('encrypted_key').eq('owner_id', a.owner).eq('provider', 'openai').single()).data.encrypted_key === stored.data.encrypted_key, 'failed replacement retains exact encrypted row');
  await b.request('POST', { key: keyB });
  const input = { client: admin, funding: 'creator', prompt: 'A synthetic coffee dripper diagram for API QA.', alt: 'A coffee dripper.' };
  for (const [ownerId, expectedKey] of [[a.owner, keyA], [b.owner, keyB]]) {
    const generated = await generateCreatorImage({ ...input, ownerId }, { env, fetcher: async (url, options) => {
      imageCalls++; check(options.headers.Authorization === `Bearer ${expectedKey}`, 'server adapter reads only actual creator vault key');
      check(url === 'https://api.openai.com/v1/images/generations' && JSON.parse(options.body).n === 1, 'one bounded synthetic image request');
      return new Response(JSON.stringify(syntheticImageResponse()), { headers: { 'x-request-id': 'req_local_qa' } });
    } });
    check(generated.provenance.funding === 'creator' && generated.provenance.usage.total_tokens === 42 && generated.asset.bytes.length > 0, 'creator-tagged actual binary result, synthetic content');
  }
  response = await a.request('DELETE');
  check(response.status === 200 && !response.body.connected && (await b.request()).body.connected, 'disconnect affects only current owner');
  check((await admin.from('provider_connections').select('encrypted_key').eq('owner_id', a.owner).eq('provider', 'anthropic').single()).data.encrypted_key === claude, 'disconnect preserves Claude connection');
  await assert.rejects(generateCreatorImage({ ...input, ownerId: a.owner }, { env, fetcher: async () => { throw new Error('Must not dispatch'); } }), e => e.code === 'connection' && !e.mayHaveCharged); checks++;
  check(imageCalls === 2, 'disconnect cannot fall back to other owner, Claude or platform key');
  check((await fetch(base + '/api/images/generate', { method: 'POST' })).status === 503, 'no paid image HTTP endpoint exposed');
  console.log(`Local creator-image integration: ${checks} checks passed. Real Auth/HTTP/Postgres/RLS, ${imageCalls} synthetic image calls; no paid OpenAI calls or UI enablement.`);
} finally {
  await new Promise(resolve => server.close(resolve));
  for (const owner of users) {
    const removed = await admin.auth.admin.deleteUser(owner);
    if (removed.error) throw new Error('Temporary image QA account cleanup failed.');
  }
  console.log('Removed only this run’s two temporary local accounts and their synthetic provider rows. Existing user work was not changed.');
}
