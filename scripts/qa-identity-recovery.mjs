// Real local email/Auth/API/Postgres/Storage; synthetic AI with a controlled hold.
// Only disposable QA identities may use the ephemeral recovery-control endpoint.
import assert from 'node:assert/strict';
import { randomUUID, createHmac, createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync, spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig, createPreviewServer, previewGenerationRoutes } from './dev-setup-server.mjs';
import { readBrowserGraph } from './browser-contract.mjs';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';

const cli = process.env.PLAYWRIGHT_CLI; assert.ok(cli, 'Set PLAYWRIGHT_CLI.');
const config = await loadPreviewConfig(new URL('../.env.preview.local', import.meta.url));
assert.equal(config.mode, 'local'); assert.equal(config.url, 'http://127.0.0.1:54321');
Object.assign(process.env, { SUPABASE_URL: config.url, SUPABASE_ANON_KEY: config.publicKey, SUPABASE_SECRET_KEY: config.secretKey, LEARNABLE_PROVIDER_VAULT_KEY: config.vaultKey, LEARNABLE_SETUP_GENERATION: '1' });
const options = { auth: { persistSession: false, autoRefreshToken: false } };
const admin = createClient(config.url, config.secretKey, options);
const uploadMode = process.argv.includes('--uploads');
const base = 'http://127.0.0.1:4173', session = uploadMode ? 'source-upload-recovery' : 'identity-recovery', nonce = randomUUID();
const graph = readBrowserGraph(), authModule = `/js/auth.js?${graph.imports.get(resolve(graph.web, 'js/auth.js'))[0].query}`;
const accounts = [], pending = [], calls = [];
let server, proxy = '', release;
const held = new Promise(resolve => { release = resolve; });
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.origin === 'https://api.anthropic.com' && url.pathname === '/v1/messages') {
    const body = JSON.parse(init.body), name = body.tool_choice?.name || body.tools?.find(t => t.name === 'submit_research_bundle')?.name;
    calls.push(name); let value;
    if (uploadMode && name === 'submit_course_brief') {
      const prompt = JSON.stringify(body.messages);
      for (const text of ['Synthetic private note:', 'First original:', 'Second original:']) assert.ok(prompt.includes(text), 'Recovered source text must reach the real intake request');
    }
    if (name === 'submit_course_brief') { await held; value = curriculumFixture(); value.id = 'identity-recovery-qa'; value.title = 'Identity Recovery Photography'; }
    else if (name === 'submit_research_bundle') value = { module_id: 'foundations', key_concepts: ['Window light', 'Simple composition'], examples: ['A simple photograph', 'A second lighting angle'], misconceptions: [], sources: [{ title: 'Synthetic reference', url: 'https://example.com/photography' }], experts: [], images: [] };
    else if (name === 'submit_topic') { const id = body.messages[0].content.match(/Topic id: ([a-z0-9-]+)/)?.[1]; assert.ok(id); value = lessonFixture(['lessons'], { id, title: `Photography ${id}` }); }
    else throw Error('Unexpected synthetic request');
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', name, input: value }], usage: { input_tokens: 10, output_tokens: 10 } }), { headers: { 'Content-Type': 'application/json' } });
  }
  if (![config.url, proxy, base].includes(url.origin)) throw Error('External network denied by identity QA');
  return originalFetch(input, init);
};
async function command(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, ['--session', session, ...args]); let output = '';
    child.stdout.on('data', part => { output += part; }); child.stderr.on('data', part => { output += part; });
    child.on('error', reject); child.on('close', code => {
      const result = output.split('### Ran Playwright code')[0];
      if (code || output.includes('### Error')) reject(Error(result || 'Browser command failed')); else resolve(result);
    });
  });
}
try {
  for (let i = 0; i < 2; i++) {
    const email = `identity-qa-${randomUUID()}@example.test`, password = `${randomUUID()}Aa9!`;
    const result = await admin.auth.admin.createUser({ email, password, email_confirm: true }); assert.ifError(result.error);
    accounts.push({ email, password, owner: result.data.user.id });
  }
  const { sealProviderKey } = await import('../web/api/_lib/provider-vault.mjs');
  assert.ifError((await admin.from('provider_connections').insert({ owner_id: accounts[0].owner, provider: 'anthropic', encrypted_key: sealProviderKey('sk-ant-synthetic-identity-QA', accounts[0].owner) })).error);
  const { createSetupGenerationHandler } = await import('../web/api/setups/generate.js');
  const { createReviewHandler } = await import('../web/api/gen/review.js');
  const { default: setupHandler } = await import('../web/api/setups/store.js');
  const { checkSchema } = await import('../web/api/health/cloud.js');
  const handlers = {};
  for (const route of previewGenerationRoutes) handlers[`/api/${route}`] = (await import(`../web/api/${route}.js`)).default;
  handlers['/api/setups/generate'] = createSetupGenerationHandler({ validate: async () => {}, background: p => pending.push(p) });
  handlers['/api/gen/review'] = createReviewHandler({ background: p => pending.push(p) });
  handlers['/api/health/cloud'] = async (_req, res) => { const schema = await checkSchema(); return res.status(schema.ok ? 200 : 503).json({ ok: schema.ok, schema, missing: schema.missing }); };
  handlers['/api/qa/identity'] = async (req, res) => {
    if (req.headers['x-qa-key'] !== nonce) return res.status(404).json({ error: 'Missing' });
    let raw = ''; for await (const chunk of req) raw += chunk;
    const body = JSON.parse(raw || '{}');
    if (body.action === 'uploads') {
      const owner = accounts[0].owner, bucket = admin.storage.from('setup-sources'), objects = [];
      const setups = await admin.from('course_setups').select('id,revision,payload,content_hash').eq('owner_id', owner); assert.ifError(setups.error);
      const folders = await bucket.list(owner); assert.ifError(folders.error);
      for (const folder of folders.data) {
        const files = await bucket.list(`${owner}/${folder.name}`); assert.ifError(files.error);
        for (const file of files.data) {
          const entries = await bucket.list(`${owner}/${folder.name}/${file.name}`); assert.ifError(entries.error);
          for (const entry of entries.data) {
            const path = `${owner}/${folder.name}/${file.name}/${entry.name}`, download = await bucket.download(path); assert.ifError(download.error);
            const bytes = Buffer.from(await download.data.arrayBuffer());
            objects.push({path,size:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
          }
        }
      }
      return res.status(200).json({setups:setups.data,objects,calls});
    }
    if (body.action === 'expire') {
      const result = await admin.auth.getUser(body.token);
      if (result.error || !accounts.some(a => a.owner === result.data.user.id)) return res.status(403).json({ error: 'Not a fixture session' });
      assert.ifError((await admin.auth.admin.signOut(body.token, 'global')).error);
      return res.status(200).json({ revoked: true });
    }
    if (body.action === 'release') release();
    const rows = await admin.from('generation_jobs').select('id,status,run_id').in('owner_id', accounts.map(a => a.owner)); assert.ifError(rows.error);
    return res.status(200).json({ calls, jobs: rows.data });
  };
  server = createPreviewServer({ config, setupHandler, extraHandlers: handlers }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); proxy = `http://127.0.0.1:${server.address().port}`;

  // Check an actually signed expired JWT, without changing the stack's expiry
  // or waiting an hour. The signer is read only from the named local Auth container.
  const container = JSON.parse(execFileSync('docker', ['inspect', 'supabase_auth_learnable-setup-local'], { encoding: 'utf8' }))[0];
  assert.equal(container.Name, '/supabase_auth_learnable-setup-local');
  const signingSecret = container.Config.Env.find(value => value.startsWith('GOTRUE_JWT_SECRET='))?.slice('GOTRUE_JWT_SECRET='.length); assert.ok(signingSecret);
  const sdk = createClient(config.url, config.publicKey, options);
  const signed = await sdk.auth.signInWithPassword(accounts[0]); assert.ifError(signed.error);
  const payload = JSON.parse(Buffer.from(signed.data.session.access_token.split('.')[1], 'base64url'));
  const jwt = exp => { const value = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url') + '.' + Buffer.from(JSON.stringify({ ...payload, iat: Math.floor(Date.now() / 1000) - 120, exp })).toString('base64url'); return value + '.' + createHmac('sha256', signingSecret).update(value).digest('base64url'); };
  const positive = await admin.auth.getUser(jwt(Math.floor(Date.now() / 1000) + 300)); assert.ifError(positive.error); assert.equal(positive.data.user.id, accounts[0].owner);
  const expired = jwt(Math.floor(Date.now() / 1000) - 60);
  for (const endpoint of ['/api/setups/generate', '/api/gen/review']) {
    const result = await fetch(proxy + endpoint, { method: 'POST', headers: { Authorization: `Bearer ${expired}`, 'Content-Type': 'application/json' }, body: '{}' }); assert.equal(result.status, 401);
  }
  console.log('Actual local Auth rejects expired signed JWTs at creation/review; valid-signature control passed. Tokens were not logged.');

  await command(['open', base + '/?experience=workspace']); await command(['snapshot']);
  const script = readFileSync(new URL(uploadMode ? './qa-source-upload-recovery.browser.js' : './qa-identity-recovery.browser.js', import.meta.url), 'utf8').replace('__IDENTITY_QA__', JSON.stringify({ base, proxy, nonce, accounts, authModule,backend:config.url }));
  console.log(await command(['run-code', script]));
  const report = await command(['eval', 'window.__identityQAReport']); assert.ok(report.includes('"checks"')); console.log(report);
  if (uploadMode) writeFileSync(new URL('../output/playwright/source-upload-recovery-report.txt', import.meta.url), report);
  await Promise.all(pending);
  const jobs = await admin.from('generation_jobs').select('id,status,saved_course_id,user_brief').eq('owner_id', accounts[0].owner); assert.ifError(jobs.error);
  assert.equal(jobs.data.length, 1); assert.equal(jobs.data[0].status, 'completed');
  if (uploadMode) {
    assert.equal(jobs.data[0].user_brief.setup_reference.revision, 1);
    assert.equal(jobs.data[0].user_brief.source_manifest.files.length, 2);
    for (const text of ['Synthetic private note:', 'First original:', 'Second original:']) assert.ok(jobs.data[0].user_brief.source_text.includes(text), 'Durable job must retain all recovered sources');
    console.log('Recovered sources verified in the durable job and actual intake request; original setup revision 1 retained.');
  }
  const courses = await admin.from('user_courses').select('id,payload').eq('owner_id', accounts[0].owner); assert.ifError(courses.error);
  assert.equal(courses.data.length, 1); assert.equal(courses.data[0].id, jobs.data[0].saved_course_id);
  assert.equal(calls.filter(name => name === 'submit_course_brief').length, 1); assert.equal(calls.filter(name => name === 'submit_research_bundle').length, 1); assert.equal(calls.filter(name => name === 'submit_topic').length, 3);
  console.log('Durable result: one job, one course, one curriculum call, one research call, three lesson calls; all synthetic.');
} catch (error) {
  console.log(await command(['eval', 'window.__identityQADiagnostic']).catch(() => 'Diagnostics unavailable'));
  console.log(await command(['snapshot']).catch(() => 'Snapshot unavailable')); throw error;
} finally {
  release(); await Promise.allSettled(pending);
  await command(['close']).catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
  for (const account of accounts) {
    // Resolve paths from Storage's actual owner prefix; this fixture uploads only TXT.
    const folders = await admin.storage.from('setup-sources').list(account.owner); assert.ifError(folders.error);
    const owned = [];
    for (const folder of folders.data) { const files = await admin.storage.from('setup-sources').list(`${account.owner}/${folder.name}`); assert.ifError(files.error); for (const file of files.data) { const objects = await admin.storage.from('setup-sources').list(`${account.owner}/${folder.name}/${file.name}`); assert.ifError(objects.error); for (const object of objects.data) owned.push(`${account.owner}/${folder.name}/${file.name}/${object.name}`); } }
    if (owned.length) assert.ifError((await admin.storage.from('setup-sources').remove(owned)).error);
    assert.ifError((await admin.from('generation_jobs').delete().eq('owner_id', account.owner)).error);
    assert.ifError((await admin.from('user_courses').delete().eq('owner_id', account.owner)).error);
    assert.ifError((await admin.auth.admin.deleteUser(account.owner)).error);
  }
  globalThis.fetch = originalFetch;
  console.log('Removed only disposable identity-QA accounts/jobs/courses/source files. Existing work unchanged.');
}
