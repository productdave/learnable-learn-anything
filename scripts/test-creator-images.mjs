import assert from 'node:assert/strict';
import { randomBytes, randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { imagePolicy, requireImagePolicy, ImageGenerationError } from '../web/api/_lib/image-policy.mjs';
import { generateCreatorImage, checkOpenAIKey, imageUsage, decodeImagePNG } from '../web/api/_lib/openai-image.mjs';
import { sealProviderKey, openProviderKey } from '../web/api/_lib/provider-vault.mjs';
import { createOpenAIConnectionHandler } from '../web/api/providers/openai.js';
import { syntheticPNG, syntheticImageResponse } from './fixtures/generated-image.mjs';

let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const owner = randomUUID(), other = randomUUID(), key = 'sk-proj-synthetic-not-a-real-key-123456789';
const env = { LEARNABLE_GPT_IMAGES: '1', LEARNABLE_IMAGE_FUNDING: 'creator', OPENAI_API_KEY: 'sk-DO-NOT-USE-PLATFORM-KEY' };
const request = { client: {}, ownerId: owner, funding: 'creator', prompt: 'An instructional diagram of a coffee filter.', alt: 'A filter seated in a coffee dripper.' };
const fixture = syntheticImageResponse();
const http = (data = fixture, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', 'x-request-id': 'req_synthetic_123', ...headers } });
let calls = 0, reads = 0;
const deps = { env, readKey: async (db, id, provider) => { reads++; check(db === request.client && id === owner && provider === 'openai', 'exact owner and provider vault lookup'); return key; },
  fetcher: async (url, options) => {
    calls++;
    const body = JSON.parse(options.body);
    check(url === 'https://api.openai.com/v1/images/generations' && options.method === 'POST' && options.redirect === 'error', 'fixed endpoint; no redirects');
    check(options.headers.Authorization === `Bearer ${key}` && !JSON.stringify(body).includes(owner), 'creator credential only, no account ID in provider body');
    check(body.n === 1 && body.size === '1024x1024' && body.quality === 'medium' && body.output_format === 'png' && body.moderation === 'auto' && body.background === 'opaque', 'bounded one-image standard-moderation contract');
    check(body.model === imagePolicy(env).model && body.prompt === request.prompt && !('response_format' in body), 'documented GPT model and API fields');
    return http();
  } };
async function fails(args, overrides, code, dispatched = false) {
  const before = calls;
  await assert.rejects(generateCreatorImage({ ...request, ...args }, { ...deps, ...overrides }), e => {
    check(e instanceof ImageGenerationError && e.code === code && e.mayHaveCharged === dispatched && e.automaticRetry === false, `${code}: safe classified failure and no automatic retry`);
    check(!JSON.stringify(e).includes(key) && !e.message.includes(key), 'no credential in error');
    return true;
  }); checks++;
  check(calls - before <= 1, 'at most one dispatch per invocation');
}

check(!imagePolicy({}).enabled && imagePolicy({}).funding === 'creator', 'off by default, creator funding');
assert.throws(() => requireImagePolicy(imagePolicy({})), e => e.code === 'disabled'); checks++;
for (const args of [{ funding: 'learnable' }, { funding: undefined }]) await fails(args, {}, 'funding');
await fails({}, { env: {} }, 'disabled');
await fails({}, { env: { ...env, LEARNABLE_IMAGE_FUNDING: 'learnable' } }, 'funding');
for (const override of [{ LEARNABLE_AI_IMAGE_MODEL: 'unknown' }, { LEARNABLE_AI_IMAGE_PROVIDER: 'other' }, { LEARNABLE_AI_IMAGE_ADAPTER: 'messages' }]) await fails({}, { env: { ...env, ...override } }, 'configuration');
for (const args of [{ ownerId: '' }, { ownerId: 'owner' }, { prompt: '' }, { prompt: 'a'.repeat(4001) }, { prompt: 10 }, { alt: '' }, { alt: 'x'.repeat(301) }]) await fails(args, {}, 'input');
check(calls === 0 && reads === 0, 'configuration/funding/input refusal before vault or provider');
await fails({}, { readKey: async () => null }, 'connection');
await fails({}, { readKey: async () => 'sk-ant-other-provider-123456789123' }, 'connection');
await fails({}, { readKey: async () => { throw new Error('private db details ' + key); } }, 'vault');
check(calls === 0, 'missing key never uses platform env key');
const preCancel = new AbortController(); preCancel.abort();
await fails({ signal: preCancel.signal }, {}, 'cancelled');
const duringRead = new AbortController();
await fails({ signal: duringRead.signal }, { readKey: async () => { duringRead.abort(); return key; } }, 'cancelled');
check(calls === 0, 'cancellation before dispatch incurs no provider request');
const result = await generateCreatorImage(request, deps);
check(calls === 1 && result.asset.bytes.equals(syntheticPNG()) && result.asset.contentType === 'image/png' && result.asset.alt === request.alt && /^[a-f0-9]{64}$/.test(result.asset.sha256), 'binary PNG, alt and digest returned');
check(result.provenance.funding === 'creator' && result.provenance.usage.total_tokens === 42 && result.provenance.requestId === 'req_synthetic_123', 'payer and actual usage recorded');
check(!JSON.stringify(result.provenance).includes(key) && !JSON.stringify(result.provenance).includes(request.prompt), 'no key or prompt in provenance');
const unicode = await generateCreatorImage({ ...request, prompt: '泳'.repeat(4000), alt: '🏊'.repeat(300) }, { ...deps, fetcher: async () => http() });
check([...unicode.asset.alt].length === 300, 'Unicode limits count characters, not UTF-16 units');
const withoutUsage = await generateCreatorImage(request, { ...deps, fetcher: async () => http({ ...fixture, usage: undefined }, 200, { 'x-request-id': key }) });
check(withoutUsage.provenance.usage === null && withoutUsage.provenance.requestId === null, 'unknown usage not zero; untrusted request header excluded');
check(imageUsage({ ...fixture.usage, secret: key }).secret === undefined && imageUsage({ ...fixture.usage, total_tokens: 99 }) === null, 'usage allowlist and sum validation');
check(imageUsage({ ...fixture.usage, input_tokens: -1 }) === null && imageUsage(null) === null, 'invalid/missing usage unknown');
check(!imageUsage({ ...fixture.usage, input_tokens_details: { text_tokens: 99, image_tokens: 0 } }).input_tokens_details, 'bad token breakdown omitted');
for (const [status, providerCode, expected] of [[401, '', 'credentials'], [403, '', 'access'], [404, '', 'access'], [429, 'insufficient_quota', 'quota'], [429, 'rate_limit_exceeded', 'rate_limit'], [400, 'moderation_blocked', 'moderation'], [400, 'content_policy_violation', 'moderation'], [400, 'other', 'rejected'], [422, '', 'rejected'], [500, '', 'unavailable'], [503, '', 'unavailable']]) {
  let dispatches = 0;
  await fails({}, { fetcher: async () => { dispatches++; return http({ error: { code: providerCode, message: key + ' private prompt' } }, status); } }, expected, true);
  check(dispatches === 1, 'HTTP failure never retries provider');
}
await fails({}, { fetcher: async () => { throw new Error('private socket ' + key); } }, 'response', true);
await fails({}, { fetcher: async () => { const e = new Error(key); e.name = 'TimeoutError'; throw e; } }, 'timeout', true);
const afterSend = new AbortController();
await fails({ signal: afterSend.signal }, { fetcher: async () => { afterSend.abort(); return http(); } }, 'cancelled', true);
for (const data of [{ ...fixture, data: [] }, { ...fixture, data: [...fixture.data, ...fixture.data] }, { ...fixture, data: { 0: fixture.data[0], length: 1 } }, { ...fixture, data: [{ url: 'https://example.test/expired.png' }] }, { ...fixture, size: '2048x2048' }, { ...fixture, output_format: 'svg' }, { ...fixture, quality: 'high' }, { ...fixture, data: [{ b64_json: 'HTML' }] }]) {
  await fails({}, { fetcher: async () => http(data) }, 'response', true);
}
await fails({}, { fetcher: async () => new Response('not JSON') }, 'response', true);
await fails({}, { fetcher: async () => http(fixture, 200, { 'content-length': String(13 * 1024 * 1024) }) }, 'response', true);
let cancelledBody = false;
await fails({}, { fetcher: async () => new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(12 * 1024 * 1024 + 1)); }, cancel() { cancelledBody = true; } })) }, 'response', true);
check(cancelledBody, 'oversized streamed body cancelled');
await assert.rejects(generateCreatorImage(request, { ...deps, fetcher: async () => http({ ...fixture, data: [] }) }), e => e.usage.total_tokens === 42 && e.requestId === 'req_synthetic_123'); checks++;

for (const value of ['', 'a', 'AAAA===', Buffer.from('<svg/>').toString('base64'), syntheticPNG({ width: 1 }).toString('base64'), syntheticPNG({ filter: 5 }).toString('base64'), syntheticPNG({ extraRaster: 2 }).toString('base64'), syntheticPNG({ trailing: true }).toString('base64'), syntheticPNG({ animation: true }).toString('base64'), syntheticPNG().subarray(0, -12).toString('base64')]) {
  assert.throws(() => decodeImagePNG(value), e => e.code === 'response'); checks++;
}
const corrupt = syntheticPNG(); corrupt[50] ^= 1;
assert.throws(() => decodeImagePNG(corrupt.toString('base64')), e => e.code === 'response'); checks++;
assert.throws(() => decodeImagePNG(syntheticPNG().toString('base64'), 10), e => e.code === 'response'); checks++;
let metadataCalls = 0;
await checkOpenAIKey(key, imagePolicy(env).model, async (url, options) => {
  metadataCalls++;
  check(url.startsWith('https://api.openai.com/v1/models/') && options.method === 'GET' && !options.body && options.redirect === 'error' && options.headers.Authorization === `Bearer ${key}`, 'metadata-only connection check');
  return new Response('{}');
});
check(metadataCalls === 1, 'connection check no generation request');
await assert.rejects(checkOpenAIKey(key, 'model', async () => http({}, 401)), e => e.code === 'credentials'); checks++;
await assert.rejects(checkOpenAIKey(key, 'model', async () => { throw new Error(key); }), e => e.code === 'unavailable' && !e.message.includes(key)); checks++;

// Account endpoint contract with injected database/provider. Real RLS separately.
const originalVault = process.env.LEARNABLE_PROVIDER_VAULT_KEY;
process.env.LEARNABLE_PROVIDER_VAULT_KEY = randomBytes(32).toString('hex');
try {
  let rows = [], currentOwner = owner, invalid = false, available = true, validates = 0;
  const db = { from(table) {
    assert.equal(table, 'provider_connections');
    const filters = []; let operation = 'select', input;
    const execute = () => {
      const matched = rows.filter(r => filters.every(([k,v]) => r[k] === v));
      if (operation === 'upsert') { rows = rows.filter(r => !(r.owner_id === input.owner_id && r.provider === input.provider)); rows.push(input); return { error: null }; }
      if (operation === 'delete') { rows = rows.filter(r => !matched.includes(r)); return { error: null }; }
      return { data: matched[0] || null, error: null };
    };
    return { select() { return this; }, eq(k,v) { filters.push([k,v]); return this; }, maybeSingle: async () => execute(), upsert(value) { operation = 'upsert'; input = value; return this; }, delete() { operation = 'delete'; return this; }, then(resolve) { return Promise.resolve(execute()).then(resolve); } };
  } };
  rows.push({ owner_id: owner, provider: 'anthropic', encrypted_key: sealProviderKey('unchanged-claude', owner) });
  const handler = createOpenAIConnectionHandler({ admin: () => db, authenticate: async () => { if (!currentOwner) throw new Error(); return { user: { id: currentOwner } }; },
    getPolicy: () => imagePolicy({ ...env, LEARNABLE_GPT_IMAGES: available ? '1' : '0' }),
    validate: async () => { validates++; if (invalid) throw new ImageGenerationError('access'); } });
  async function call(method = 'GET', body) {
    const res = { code: 0, headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; } };
    await handler({ method, body }, res); check(res.headers['Cache-Control'] === 'no-store', 'connection response no-store'); return res;
  }
  currentOwner = null; check((await call()).code === 401, 'auth required'); currentOwner = owner;
  check((await call('PATCH')).code === 405, 'method allowlist');
  available = false; check((await call('POST', { key })).code === 409 && validates === 0, 'disabled connect does not send key'); available = true;
  for (const body of [null, [], { key: 'bad' }, { key: 'sk-ant-not-an-openai-key-123456' }, { key, owner_id: other }, { key, funding: 'learnable' }, '{bad', { key: 'x'.repeat(3000) }]) check((await call('POST', body)).code === 400, 'invalid/extra/oversize input rejected');
  check(validates === 0, 'bad input does not validate remotely');
  check(!(await call()).body.connected, 'Claude key not mistaken for OpenAI key');
  let response = await call('POST', { key });
  check(response.code === 200 && response.body.connected && response.body.funding === 'creator' && response.body.generationChecked === false, 'connect reports creator, not paid generation success');
  const encrypted = rows.find(r => r.provider === 'openai').encrypted_key;
  check(!encrypted.includes(key) && openProviderKey(encrypted, owner, 'openai') === key, 'encrypted with OpenAI AAD');
  assert.throws(() => openProviderKey(encrypted, other, 'openai')); checks++;
  assert.throws(() => openProviderKey(encrypted, owner, 'anthropic')); checks++;
  response = await call(); check(!JSON.stringify(response.body).includes(key) && !JSON.stringify(response.body).includes(encrypted), 'status never returns secrets');
  invalid = true; check((await call('POST', { key: key + '-replacement' })).code === 503 && rows.find(r => r.provider === 'openai').encrypted_key === encrypted, 'failed replacement keeps working connection'); invalid = false;
  delete process.env.LEARNABLE_PROVIDER_VAULT_KEY;
  const prior = validates; check((await call('POST', { key })).code === 503 && validates === prior, 'missing vault blocks before provider');
  process.env.LEARNABLE_PROVIDER_VAULT_KEY = randomBytes(32).toString('hex');
  check((await call()).code === 503, 'unreadable existing key not reported as connected');
  currentOwner = other; await call('POST', { key });
  currentOwner = owner; available = false; check((await call('DELETE')).code === 200, 'disconnect permitted while disabled');
  check(rows.some(r => r.owner_id === other && r.provider === 'openai') && rows.some(r => r.provider === 'anthropic') && !rows.some(r => r.owner_id === owner && r.provider === 'openai'), 'disconnect preserves other owners and Claude');
} finally { if (originalVault === undefined) delete process.env.LEARNABLE_PROVIDER_VAULT_KEY; else process.env.LEARNABLE_PROVIDER_VAULT_KEY = originalVault; }

const sql = readFileSync('db/08-openai-provider-connection.sql', 'utf8');
check(sql.includes("check (provider in ('anthropic', 'openai'))") && !/grant|delete\s+from|drop\s+table/i.test(sql.replace(/^--.*$/gm, '')), 'forward migration expands constraint only, no access or data deletion');
check(readFileSync('web/js/config.js', 'utf8').includes('CREATION_IMAGES_ENABLED = true'), 'approved production creation includes integrated images; backend dispatch still requires its policy and creator key');
console.log(`Creator-funded image contract: ${checks} checks passed. Synthetic image/API responses only; no provider calls, UI enablement or paid generation.`);
