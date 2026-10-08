import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sealProviderKey, openProviderKey, checkAnthropicKey } from '../web/api/_lib/provider-vault.mjs';
import { setupGenerationIssues, setupToGenerationBrief, setupJobId } from '../web/api/_lib/setup-generation.mjs';
import { createSetupGenerationHandler } from '../web/api/setups/generate.js';
import { createConnectionHandler } from '../web/api/providers/connection.js';
import { createSetupGenerationClient } from '../web/js/setup-generation-client.js';
import { setupDraft } from '../web/js/setup-model.js';
import { prepareAccountPayload } from '../web/js/setup-account-model.js';
import { runIntake } from '../web/js/generator/stages/intake.mjs';

let checks = 0;
const check = (condition, name) => { assert.ok(condition, name); checks++; };
const previous = process.env.LEARNABLE_PROVIDER_VAULT_KEY;
// Capability flags only; every provider/runner is an injected double.
process.env.LEARNABLE_CREATION_IMAGES = process.env.LEARNABLE_GPT_IMAGES = process.env.LEARNABLE_IMAGE_REQUESTS = '1';
process.env.LEARNABLE_PROVIDER_VAULT_KEY = randomBytes(32).toString('hex');
const key = 'sk-ant-qa-synthetic-not-a-real-key-123456789';
try {
  const encrypted = sealProviderKey(key, 'owner');
  check(!encrypted.includes(key) && openProviderKey(encrypted, 'owner') === key, 'encrypted round trip');
  check(sealProviderKey(key, 'owner') !== encrypted, 'fresh IV per save');
  assert.throws(() => openProviderKey(encrypted, 'other')); checks++;
  assert.throws(() => openProviderKey(encrypted, 'owner', 'other')); checks++;
  const parts = encrypted.split('.'); parts[2] = Buffer.alloc(16).toString('base64');
  assert.throws(() => openProviderKey(parts.join('.'), 'owner')); checks++;
  await checkAnthropicKey(key, 'model', async (url, options) => {
    check(url === 'https://api.anthropic.com/v1/models/model' && !options.body && options.redirect === 'error', 'connection check uses model metadata, not paid generation');
    return { ok: true };
  });
  await assert.rejects(checkAnthropicKey(key, 'model', async () => ({ ok: false, status: 401 })), /rejected/); checks++;

  const draft = setupDraft('A useful course');
  Object.assign(draft.brief, { audience: 'New learners', context: 'Short sessions', goal: 'Apply a skill', starting_point: 'Beginner', experience: 'guided_practice' });
  draft.sources.notes = [{ id: 'n1', title: 'Transcript', text: 'Source text 🏊' }];
  draft.sources.links = [{ id: 'l1', title: '', url: 'https://example.com/source' }];
  const prepared = await prepareAccountPayload(draft);
  const row = { id: 'setup-qa', owner_id: 'owner', revision: 1, deleted: false, content_hash: prepared.hash, payload: prepared.payload };
  check(setupGenerationIssues(row.payload).length === 0, 'default components supported');
  check(setupGenerationIssues(row.payload, { imagesEnabled: false }).some(i => i.step === 'create'), 'disabled image capability fails visibly without an opt-out');
  check(setupGenerationIssues({ ...row.payload, sources: { ...row.payload.sources, notes: [{ text: 'x'.repeat(48001) }] } }).length === 1, 'aggregate text bounded without truncation');
  check(setupGenerationIssues({ ...row.payload, sources: { ...row.payload.sources, links: Array(11).fill({ url: 'https://example.com' }) } }).length === 1, 'URL count bounded');
  const brief = await setupToGenerationBrief(row, 'owner', {});
  check(brief.audience === draft.brief.audience && brief.context === draft.brief.context && brief.learning_approach === 'guided_practice' && brief.source_text.includes('🏊') && brief.source_urls.length === 1, 'canonical audience, context, approach, notes and links preserved');
  check(brief.setup_reference.hash === prepared.hash && brief.setup_reference.revision === 1, 'job records input provenance');
  const planned = await runIntake({ messages: { create: async request => {
    const prompt = request.messages[0].content.at(-1).text;
    check(prompt.includes('Audience: New learners') && prompt.includes('Real-world constraints: Short sessions'), 'intake prompt contains exact audience and context');
    return { content: [{ type: 'tool_use', name: 'submit_course_brief', input: {
      id: 'qa-course', title: 'QA course', subtitle: 'A synthetic outline for testing', scope: 'single_module',
      learner_persona: 'A new learner with short sessions available', learning_objectives: ['Learn one', 'Learn two'],
      modules: [{ id: 'basics', number: 1, title: 'The basics', description: 'A sufficient description of this module.', icon: 'book', color: '#4338CA', topics: [1,2,3].map(n => ({ id: `topic-${n}`, title: `Topic ${n}` })) }]
    } }] };
  } } }, brief);
  check(planned.setup_context.context === 'Short sessions' && planned.setup_context.audience === 'New learners' && planned.source_text === brief.source_text, 'original constraints and sources survive model schema parsing for later stages');
  check(setupJobId('owner', row.id, row.content_hash) !== setupJobId('other', row.id, row.content_hash), 'job identity owner scoped');
  draft.sources.files = [{ id: 'f1', name: 'transcript.txt', blob: new Blob(['file text']) }];
  const withFile = await prepareAccountPayload(draft);
  let downloaded = new Blob(['file text']);
  const storageClient = { storage: { from: bucket => { assert.equal(bucket, 'setup-sources'); return { download: async path => { assert.match(path, /^owner\/setup-qa\/f1\/\w{64}$/); return { data: downloaded }; } }; } } };
  check((await setupToGenerationBrief({ ...row, payload: withFile.payload }, 'owner', storageClient)).source_text.includes('file text'), 'TXT originals read from owner-derived path');
  downloaded = new Blob(['tampered!']);
  await assert.rejects(setupToGenerationBrief({ ...row, payload: withFile.payload }, 'owner', storageClient), /verify/); checks++;
  draft.sources.files[0].blob = new Blob([new Uint8Array([255])]);
  downloaded = draft.sources.files[0].blob;
  await assert.rejects(setupToGenerationBrief({ ...row, payload: (await prepareAccountPayload(draft)).payload }, 'owner', storageClient), /UTF-8/); checks++;
  check(!setupGenerationIssues({ ...withFile.payload, sources: { ...withFile.payload.sources, files: [{ name: 'guide.pdf' }] } }).some(i => i.step === 'context'), 'PDF documents now proceed to real extraction checks');

  const tables = { course_setups: [structuredClone(row)], provider_connections: [], generation_jobs: [] };
  const db = { from(table) {
    let filters = [], operation = 'select', input;
    const execute = () => {
      const matched = tables[table].filter(item => filters.every(([k, v]) => item[k] === v));
      if (operation === 'delete') { tables[table] = tables[table].filter(item => !matched.includes(item)); return { error: null }; }
      if (operation === 'insert') {
        if (tables[table].some(item => item.id === input.id)) return { error: { code: '23505' } };
        tables[table].push(structuredClone(input)); return { error: null };
      }
      if (operation === 'upsert') { tables[table] = tables[table].filter(item => !(item.owner_id === input.owner_id && item.provider === input.provider)); tables[table].push(structuredClone(input)); return { error: null }; }
      return { data: matched[0] || null, error: null };
    };
    const query = { select() { return this; }, eq(k, v) { filters.push([k, v]); return this; }, maybeSingle: async () => execute(), insert(value) { operation = 'insert'; input = value; return this; }, upsert(value) { operation = 'upsert'; input = value; return this; }, delete() { operation = 'delete'; return this; }, then(resolve, reject) { return Promise.resolve(execute()).then(resolve, reject); } };
    return query;
  } };
  let owner = 'owner', validateFailure = false, enabled = true, runs = 0, validations = 0;
  const authenticate = async () => { if (!owner) throw new Error('no session'); return { user: { id: owner, email: 'qa@example.test' } }; };
  const validate = async () => { validations++; if (validateFailure) throw new Error('Claude rejected this API key.'); };
  const handler = createSetupGenerationHandler({ authenticate, admin: () => db, validate, enabled: () => enabled, run: async args => { runs++; assert.equal(args.userBrief.topic, row.payload.brief.topic); assert.equal(args.mode, 'curriculum'); }, background: promise => void promise });
  const connection = createConnectionHandler({ authenticate, admin: () => db, validate });
  async function call(fn, body, method = 'POST') {
    const res = { code: null, body: null, headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await fn({ method, body }, res); return res;
  }
  const request = { id: row.id, revision: 1, action: 'check' };
  owner = null; check((await call(handler, request)).code === 401, 'generation requires authenticated account');
  owner = 'other'; check((await call(handler, request)).code === 404, 'other account cannot read or launch setup');
  owner = 'owner';tables.course_setups[0].deleted=true;check((await call(handler,request)).code===404,'deleted setup cannot start generation');tables.course_setups[0].deleted=false;
  owner = 'owner'; check((await call(handler, { ...request, revision: 2 })).code === 409, 'stale revision refused');
  let res = await call(handler, request);
  check(res.body.connected === false && !res.body.ready && runs === 0 && validations === 0, 'preflight is free and missing connection blocks start');
  check((await call(handler, { ...request, action: 'start' })).code === 409 && runs === 0, 'missing connection never launches');
  check((await call(connection, { key: 'short' })).code === 400, 'malformed key rejected before validation');
  res = await call(connection, { key });
  check(res.code === 200 && !JSON.stringify(tables.provider_connections).includes(key), 'connection stored only encrypted');
  check(!JSON.stringify((await call(connection, null, 'GET')).body).includes(key), 'status exposes no key');
  res = await call(handler, request);
  check(res.body.connected && !res.body.imageConnected && !res.body.ready, 'Claude alone cannot begin an integrated course');
  check((await call(handler, { ...request, action: 'start' })).code === 409 && runs === 0, 'missing image connection blocks before any paid text');
  tables.provider_connections.push({ owner_id: 'owner', provider: 'openai', encrypted_key: sealProviderKey('sk-synthetic-images-not-a-real-key', 'owner', 'openai') });
  check((await call(handler, request)).body.imageConnected, 'both provider connections are checked on Create');
  validateFailure = true;
  check((await call(connection, { key: key + '-new' })).code === 503 && openProviderKey(tables.provider_connections[0].encrypted_key, 'owner') === key, 'failed replacement retains previous connection');
  check((await call(handler, { ...request, action: 'start' })).code === 503 && runs === 0 && !tables.generation_jobs.length, 'rejected provider key creates no paid job');
  validateFailure = false; enabled = false;
  check(!(await call(handler, request)).body.ready && (await call(handler, { ...request, action: 'start' })).code === 409, 'deployment feature flag enforced server side');
  enabled = true; tables.course_setups[0].payload.components.push('unsupported');
  check((await call(handler, { ...request, action: 'start' })).code === 409 && runs === 0, 'unsupported requests cannot bypass preflight');
  tables.course_setups[0] = structuredClone(row);
  const results = await Promise.all([call(handler, { ...request, action: 'start', userBrief: { topic: 'attacker' } }), call(handler, { ...request, action: 'start' })]);
  check(results.every(r => r.code === 200) && results[0].body.jobId === results[1].body.jobId && runs === 1 && tables.generation_jobs.length === 1, 'concurrent requests launch one canonical job');
  await call(connection, null, 'DELETE');
  res = await call(handler, { ...request, action: 'start' });
  check(res.body.existing && runs === 1, 'lost response retry reattaches without a key or another charge');
  owner = 'other'; await call(connection, { key }); owner = 'owner'; await call(connection, null, 'DELETE');
  check(tables.provider_connections.filter(row => row.provider === 'anthropic').length === 1 && tables.provider_connections.find(row => row.provider === 'anthropic').owner_id === 'other', 'disconnect is owner scoped');
  check(tables.provider_connections.some(row => row.owner_id === 'owner' && row.provider === 'openai'), 'disconnecting Claude preserves OpenAI');

  let identity = { id: 'owner' }, clientCalls = 0;
  const client = createSetupGenerationClient({ getIdentity: () => identity, getClient: async () => ({ auth: { getSession: async () => ({ data: { session: { user: identity, access_token: 'synthetic' } } }) } }), fetcher: async () => { clientCalls++; identity = { id: 'other' }; return { ok: true, json: async () => ({ jobId: 'ignored' }) }; } });
  await assert.rejects(client.start('owner', row.id, 1), /account changed/); checks++;
  await assert.rejects(client.start('owner', row.id, 1), /account changed/); checks++;
  check(clientCalls === 1, 'client checks account before and after network requests');
  const sql = readFileSync('db/07-provider-connections.sql', 'utf8');
  check(sql.includes('enable row level security') && sql.includes('from public, anon, authenticated') && sql.includes('to service_role'), 'vault table denies browser role reads and writes');
  console.log(`Setup generation: ${checks} checks passed. Provider and runner are injected doubles; no paid AI calls.`);
} finally { if (previous === undefined) delete process.env.LEARNABLE_PROVIDER_VAULT_KEY; else process.env.LEARNABLE_PROVIDER_VAULT_KEY = previous; }
