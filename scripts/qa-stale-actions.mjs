// Disposable local Auth/HTTP/DB and actual UI. Synthetic review dispatch only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig, createPreviewServer, previewGenerationRoutes } from './dev-setup-server.mjs';
import { readBrowserGraph } from './browser-contract.mjs';
import { curriculumFixture } from './fixtures/component-course.mjs';

const cli = process.env.PLAYWRIGHT_CLI; assert.ok(cli, 'Set PLAYWRIGHT_CLI.');
const config = await loadPreviewConfig(new URL('../.env.preview.local', import.meta.url));
assert.equal(config.mode, 'local'); assert.equal(config.url, 'http://127.0.0.1:54321');
Object.assign(process.env, { SUPABASE_URL: config.url, SUPABASE_ANON_KEY: config.publicKey, SUPABASE_SECRET_KEY: config.secretKey, LEARNABLE_PROVIDER_VAULT_KEY: config.vaultKey });
const admin = createClient(config.url, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const base = 'http://127.0.0.1:4173', session = 'stale-actions', nonce = randomUUID();
const graph = readBrowserGraph(), authModule = `/js/auth.js?${graph.imports.get(resolve(graph.web, 'js/auth.js'))[0].query}`;
const jobs = ['review', 'delete'].map(kind => ({ kind, id: `qa-stale-browser-${randomUUID()}`, runId: randomUUID(), nextRunId: randomUUID() }));
let owner, server, proxy = '', dispatches = 0;
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (![config.url, base, proxy].includes(url.origin)) throw Error('External network denied by stale-action QA');
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
  const account = { email: `stale-browser-${randomUUID()}@example.test`, password: `${randomUUID()}Aa9!` };
  const created = await admin.auth.admin.createUser({ ...account, email_confirm: true }); assert.ifError(created.error); owner = created.data.user.id;
  const { sealProviderKey } = await import('../web/api/_lib/provider-vault.mjs');
  assert.ifError((await admin.from('provider_connections').insert({ owner_id: owner, provider: 'anthropic', encrypted_key: sealProviderKey('sk-ant-synthetic-stale-browser-QA', owner) })).error);
  for (const job of jobs) assert.ifError((await admin.from('generation_jobs').insert({ id: job.id, owner_id: owner, run_id: job.runId, status: job.kind === 'review' ? 'review_curriculum' : 'failed', stage: 'intake', user_brief: { topic: `Stale ${job.kind} original` }, brief: { ...curriculumFixture(), title: `Stale ${job.kind} original` }, ...(job.kind === 'delete' ? { completed_at: new Date().toISOString(), error: 'Synthetic failure' } : {}) })).error);
  const { createReviewHandler } = await import('../web/api/gen/review.js');
  const { default: deleteHandler } = await import('../web/api/gen/delete.js');
  const { checkSchema } = await import('../web/api/health/cloud.js');
  const { default: setupHandler } = await import('../web/api/setups/store.js');
  const handlers = {
    '/api/gen/review': createReviewHandler({ runGeneration: async () => { dispatches++; }, background: p => p }),
    '/api/gen/delete': deleteHandler,
    '/api/health/cloud': async (_req, res) => { const schema = await checkSchema(); return res.status(schema.ok ? 200 : 503).json({ ok: schema.ok, schema, missing: schema.missing }); },
    '/api/qa/stale': async (req, res) => {
      if (req.headers['x-qa-key'] !== nonce) return res.status(404).json({ error: 'Missing' });
      let raw = ''; for await (const chunk of req) raw += chunk; const body = JSON.parse(raw || '{}');
      if (body.action === 'advance') {
        const job = jobs.find(j => j.id === body.jobId); if (!job) return res.status(403).json({ error: 'Not a fixture' });
        assert.ifError((await admin.from('generation_jobs').update({ run_id: job.nextRunId, brief: { ...curriculumFixture(), title: `Stale ${job.kind} newer version` } }).eq('id', job.id).eq('owner_id', owner)).error);
      }
      const rows = await admin.from('generation_jobs').select('id,status,run_id,review_history').eq('owner_id', owner); assert.ifError(rows.error);
      return res.status(200).json({ jobs: rows.data, dispatches });
    },
  };
  for (const route of previewGenerationRoutes) if (!handlers[`/api/${route}`]) handlers[`/api/${route}`] = (await import(`../web/api/${route}.js`)).default;
  server = createPreviewServer({ config, setupHandler, extraHandlers: handlers }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); proxy = `http://127.0.0.1:${server.address().port}`;
  await command(['open', base + '/?experience=workspace']); await command(['snapshot']);
  const script = readFileSync(new URL('./qa-stale-actions.browser.js', import.meta.url), 'utf8').replace('__STALE_QA__', JSON.stringify({ base, proxy, nonce, account, authModule, jobs }));
  console.log(await command(['run-code', script]));
  await command(['run-code', 'async page => { await page.waitForFunction(() => !!window.__staleQAReport, { timeout: 15000 }); }']);
  const report = await command(['eval', 'window.__staleQAReport']); assert.ok(report.includes('"checks"')); console.log(report);
  assert.equal(dispatches, 1, 'Only explicit approval of the new version may dispatch');
  const remaining = await admin.from('generation_jobs').select('id').eq('owner_id', owner); assert.ifError(remaining.error); assert.equal(remaining.data.length, 1); assert.equal(remaining.data[0].id, jobs[0].id);
} catch (error) {
  console.log(await command(['snapshot']).catch(() => 'Snapshot unavailable')); throw error;
} finally {
  await command(['close']).catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
  if (owner) { assert.ifError((await admin.from('generation_jobs').delete().eq('owner_id', owner)).error); assert.ifError((await admin.auth.admin.deleteUser(owner)).error); }
  globalThis.fetch = originalFetch;
  console.log('Removed only disposable stale-action QA identity/jobs; no paid provider calls or existing-user changes.');
}
