import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { resolve } from 'node:path';

const base = process.env.CONNECTION_API_ROOT || resolve('web/api');
const { imagePolicy, requireImagePolicy, requireImageConnectionPolicy } = await import(pathToFileURL(base + '/_lib/image-policy.mjs'));
const { createOpenAIConnectionHandler } = await import(pathToFileURL(base + '/providers/openai.js'));
const { openProviderKey } = await import(pathToFileURL(base + '/_lib/provider-vault.mjs'));
const owner = randomUUID(), key = 'sk-proj-synthetic-connection-only-not-a-real-key';
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const env = { LEARNABLE_OPENAI_CONNECTION: '1', LEARNABLE_GPT_IMAGES: '0' };
const policy = imagePolicy(env);
check(policy.connectionEnabled && !policy.enabled, 'independent non-generating connection flag');
requireImageConnectionPolicy(policy); checks++;
assert.throws(() => requireImagePolicy(policy), e => e.code === 'disabled'); checks++;
for (const change of [{ LEARNABLE_IMAGE_FUNDING: 'learnable' }, { LEARNABLE_AI_IMAGE_MODEL: 'unsupported' }]) {
  assert.throws(() => requireImageConnectionPolicy(imagePolicy({ ...env, ...change }))); checks++;
}
assert.throws(() => requireImageConnectionPolicy(imagePolicy({})), e => e.code === 'disabled'); checks++;
let authenticated = true, saved = null, validated = 0;
const db = { from(table) {
  assert.equal(table, 'provider_connections');
  const filters = [];
  return {
    select() { return this; }, eq(k, v) { filters.push([k, v]); return this; },
    async maybeSingle() { assert.deepEqual(filters, [['owner_id', owner], ['provider', 'openai']]); return { data: saved, error: null }; },
    async upsert(row) { assert.equal(row.owner_id, owner); assert.equal(row.provider, 'openai'); saved = row; return { error: null }; },
  };
} };
const handler = createOpenAIConnectionHandler({ authenticate: async () => ({ user: authenticated ? { id: owner } : null }), admin: () => db, getPolicy: () => policy,
  validate: async (value, model) => { assert.equal(value, key); assert.equal(model, policy.model); validated++; } });
async function call(method = 'GET', body) {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
  await handler({ method, body }, res); assert.equal(res.headers['Cache-Control'], 'no-store'); return res;
}
const oldVault = process.env.LEARNABLE_PROVIDER_VAULT_KEY;
try {
  process.env.LEARNABLE_PROVIDER_VAULT_KEY = randomBytes(32).toString('hex');
  authenticated = false; check((await call('POST', { key })).code === 401 && validated === 0, 'signed-out key submission denied'); authenticated = true;
  check((await call()).body.connected === false && validated === 0, 'read does not validate remotely');
  check((await call('POST', { key, owner_id: randomUUID() })).code === 400 && validated === 0, 'owner override refused');
  const result = await call('POST', { key });
  check(result.code === 200 && validated === 1 && result.body.connected, 'connection can be saved with generation disabled');
  check(result.body.generationEnabled === false && result.body.generationChecked === false, 'no misleading generation success');
  check(!JSON.stringify(result).includes(key) && !JSON.stringify(saved).includes(key), 'no secret in response or stored plaintext');
  check(openProviderKey(saved.encrypted_key, owner, 'openai') === key, 'encrypted owner-bound key round trip');
  check((await call()).body.connected === true && validated === 1, 'saved status read is non-generating');
  assert.throws(() => requireImagePolicy(policy), e => e.code === 'disabled'); checks++;
} finally { if (oldVault === undefined) delete process.env.LEARNABLE_PROVIDER_VAULT_KEY; else process.env.LEARNABLE_PROVIDER_VAULT_KEY = oldVault; }
console.log(`Connection-only contract: ${checks} checks passed. Synthetic credentials/database; zero provider calls.`);
