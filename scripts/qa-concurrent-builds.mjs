// Real local creation/reviews/runner/database, synthetic model responses only.
// Controlled barriers force overlapping jobs, slug collision and both cancel/save outcomes.
import assert from 'node:assert/strict';
import { AsyncLocalStorage } from 'node:async_hooks';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig, createPreviewServer, previewGenerationRoutes } from './dev-setup-server.mjs';
import { readBrowserGraph } from './browser-contract.mjs';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';

const cli = process.env.PLAYWRIGHT_CLI; assert.ok(cli, 'Set PLAYWRIGHT_CLI.');
const config = await loadPreviewConfig(new URL('../.env.preview.local', import.meta.url));
assert.equal(config.mode, 'local'); assert.equal(config.url, 'http://127.0.0.1:54321');
// Match the local app's publication-status UI without registering publish writes.
Object.assign(config, { publishing: true, moderation: true });
Object.assign(process.env, { SUPABASE_URL: config.url, SUPABASE_ANON_KEY: config.publicKey, SUPABASE_SECRET_KEY: config.secretKey, LEARNABLE_PROVIDER_VAULT_KEY: config.vaultKey, LEARNABLE_SETUP_GENERATION: '1' });
Object.assign(process.env, { LEARNABLE_SELF_PUBLISH: config.publishing ? '1' : '0', LEARNABLE_MODERATION: config.moderation ? '1' : '0' });
const options = { auth: { persistSession: false, autoRefreshToken: false } }, admin = createClient(config.url, config.secretKey, options);
const base = 'http://127.0.0.1:4173', session = 'concurrent-builds', nonce = randomUUID(), context = new AsyncLocalStorage();
const graph = readBrowserGraph(), modulePath = name => `/js/${name}.js?${graph.imports.get(resolve(graph.web, `js/${name}.js`))[0].query}`;
const authModule = modulePath('auth'), coursesModule = modulePath('user-courses');
const fixtures = [
  { label: 'Amber', components: ['lessons', 'checklists'], inputTokens: 11 },
  { label: 'Indigo', components: ['lessons', 'quizzes'], inputTokens: 23 },
  { label: 'Gold', components: ['lessons'], inputTokens: 37 },
];
const gates = new Map(), pending = [], calls = [], insertArrivals = new Set();
function gate(key) { if (!gates.has(key)) { let release; const promise = new Promise(resolve => { release = resolve; }); gates.set(key, { promise, release }); } return gates.get(key); }
for (const fixture of fixtures) gate(`curriculum:${fixture.label}`);
gate('parallel-save'); gate('gold-inserted');
let owner, server, proxy = '', collisions = 0, goldInserted = false;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  const run = context.getStore();
  if (url.origin === 'https://api.anthropic.com' && url.pathname === '/v1/messages') {
    assert.ok(run && fixtures.some(f => f.label === run.label), 'Only fixture runner requests are allowed');
    const body = JSON.parse(init.body), name = body.tool_choice?.name || body.tools?.find(t => t.name === 'submit_research_bundle')?.name;
    const prompt = JSON.stringify(body.messages); calls.push({ label: run.label, name });
    for (const other of fixtures.filter(f => f.label !== run.label)) assert.ok(!prompt.includes(`${other.label}-PRIVATE-NOTE`), 'Other build source leaked into prompt');
    let value;
    if (name === 'submit_course_brief') {
      assert.ok(prompt.includes(`${run.label}-PRIVATE-NOTE`));
      await gate(`curriculum:${run.label}`).promise;
      value = curriculumFixture(); value.id = 'concurrent-photography'; value.title = `${run.label} Photography`;
    } else if (name === 'submit_research_bundle') {
      value = { module_id: 'foundations', key_concepts: [`${run.label} natural light`, 'Clear composition'], examples: ['A window portrait', 'A simple subject'], misconceptions: [], sources: [{ title: `${run.label} synthetic reference`, url: `https://example.com/${run.label.toLowerCase()}` }], experts: [], images: [] };
    } else if (name === 'submit_topic') {
      const id = body.messages[0].content.match(/Topic id: ([a-z0-9-]+)/)?.[1]; assert.ok(id);
      value = lessonFixture(run.components, { id, title: `${run.label} ${id}` });
      value.sections[0].content = `<p>${run.label} course example: compare window light from two angles.</p>`;
    } else throw Error('Unexpected synthetic stage');
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', name, input: value }], usage: { input_tokens: run.inputTokens, output_tokens: 10 } }), { headers: { 'Content-Type': 'application/json' } });
  }
  if (![config.url, base, proxy].includes(url.origin)) throw Error('External network denied by concurrent QA');
  if (run && url.origin === config.url && url.pathname === '/rest/v1/rpc/commit_user_course' && init?.method === 'POST' && JSON.parse(init.body).p_updated_at === null && JSON.parse(init.body).p_action === 'save') {
    const row = JSON.parse(init.body); assert.equal(row.p_owner, owner); assert.equal(row.p_payload._generationJobId, run.jobId);
    if (run.label !== 'Gold') {
      insertArrivals.add(run.label); await gate('parallel-save').promise;
      const response = await originalFetch(input, init); if (response.ok && (await response.clone().json()).error === 'conflict') collisions++; return response;
    }
    const response = await originalFetch(input, init);
    if (response.ok) { goldInserted = true; await gate('gold-inserted').promise; }
    return response;
  }
  return originalFetch(input, init);
};
async function command(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, ['--session', session, ...args]); let output = '';
    child.stdout.on('data', part => { output += part; }); child.stderr.on('data', part => { output += part; });
    child.on('error', reject); child.on('close', code => { const result = output.split('### Ran Playwright code')[0]; if (code || output.includes('### Error')) reject(Error(result || 'Browser command failed')); else resolve(result); });
  });
}
try {
  const account = { email: `concurrent-${randomUUID()}@example.test`, password: `${randomUUID()}Aa9!` };
  const created = await admin.auth.admin.createUser({ ...account, email_confirm: true }); assert.ifError(created.error); owner = created.data.user.id;
  const { sealProviderKey } = await import('../web/api/_lib/provider-vault.mjs');
  assert.ifError((await admin.from('provider_connections').insert({ owner_id: owner, provider: 'anthropic', encrypted_key: sealProviderKey('sk-ant-synthetic-concurrency-QA', owner) })).error);
  const { runGeneration } = await import('../web/api/_lib/gen-runner.mjs');
  const run = args => {
    try {
      assert.equal(args.ownerId, owner);
      const fixture = fixtures.find(f => args.userBrief.topic === `${f.label} Photography`); assert.ok(fixture, 'Unknown fixture title');
      assert.deepEqual([...args.userBrief.components].sort(), [...fixture.components].sort());
      return context.run({ ...fixture, jobId: args.jobId }, () => runGeneration(args));
    } catch (error) { console.error('Synthetic runner setup failed:', error.message, { topic: args.userBrief?.topic, components: args.userBrief?.components }); throw error; }
  };
  const { createSetupGenerationHandler } = await import('../web/api/setups/generate.js');
  const { createReviewHandler } = await import('../web/api/gen/review.js');
  const { default: setupHandler } = await import('../web/api/setups/store.js');
  const { checkSchema } = await import('../web/api/health/cloud.js');
  const handlers = {};
  for (const route of previewGenerationRoutes) handlers[`/api/${route}`] = (await import(`../web/api/${route}.js`)).default;
  for (const route of ['courses/community', 'courses/publication-status', 'courses/moderation']) handlers[`/api/${route}`] = (await import(`../web/api/${route}.js`)).default;
  handlers['/api/setups/generate'] = createSetupGenerationHandler({ validate: async () => {}, run, background: p => pending.push(p) });
  handlers['/api/gen/review'] = createReviewHandler({ runGeneration: run, background: p => pending.push(p) });
  handlers['/api/health/cloud'] = async (_req, res) => { const schema = await checkSchema(); return res.status(schema.ok ? 200 : 503).json({ ok: schema.ok, schema, missing: schema.missing }); };
  handlers['/api/qa/concurrency'] = async (req, res) => {
    if (req.headers['x-qa-key'] !== nonce) return res.status(404).json({ error: 'Missing' });
    let raw = ''; for await (const chunk of req) raw += chunk; const body = JSON.parse(raw || '{}');
    if (body.release) { assert.ok(gates.has(body.release)); gate(body.release).release(); }
    const jobs = await admin.from('generation_jobs').select('id,status,stage,run_id,user_brief,saved_course_id').eq('owner_id', owner); assert.ifError(jobs.error);
    const courses = await admin.from('user_courses').select('id,payload').eq('owner_id', owner); assert.ifError(courses.error);
    return res.status(200).json({ jobs: jobs.data, courses: courses.data.map(row => ({ id: row.id, jobId: row.payload._generationJobId, title: row.payload.config.title })), calls, insertArrivals: [...insertArrivals], collisions, goldInserted });
  };
  server = createPreviewServer({ config, setupHandler, extraHandlers: handlers }); server.listen(0, '127.0.0.1'); await once(server, 'listening'); proxy = `http://127.0.0.1:${server.address().port}`;
  await command(['open', base + '/?experience=workspace']); await command(['snapshot']);
  const script = readFileSync(new URL('./qa-concurrent-builds.browser.js', import.meta.url), 'utf8').replace('__CONCURRENT_QA__', JSON.stringify({ base, proxy, nonce, account, authModule, coursesModule, fixtures }));
  console.log(await command(['run-code', script]));
  await command(['run-code', 'async page => { await page.waitForFunction(() => !!window.__concurrentQAReport, null, { timeout: 20000 }); }']);
  const report = await command(['eval', 'window.__concurrentQAReport']); console.log(report); assert.ok(report.includes('"passed"') && !report.includes('"error"'), 'Browser must finish all assertions');
  await Promise.all(pending);
  const jobs = await admin.from('generation_jobs').select('*').eq('owner_id', owner); assert.ifError(jobs.error);
  const courses = await admin.from('user_courses').select('id,payload').eq('owner_id', owner); assert.ifError(courses.error);
  assert.equal(jobs.data.length, 3); assert.equal(courses.data.length, 2); assert.equal(new Set(courses.data.map(c => c.id)).size, 2); assert.equal(collisions, 1);
  for (const f of fixtures) {
    const job = jobs.data.find(j => j.user_brief.topic === `${f.label} Photography`); assert.ok(job);
    assert.equal(job.status, f.label === 'Gold' ? 'cancelled' : 'completed');
    assert.equal(calls.filter(c => c.label === f.label).length, 5);
    assert.ok(job.user_brief.source_text.includes(`${f.label}-PRIVATE-NOTE`));
    const course = courses.data.find(c => c.payload._generationJobId === job.id);
    if (f.label === 'Gold') { assert.equal(course, undefined); assert.equal(job.saved_course_id, null); continue; }
    assert.equal(course.id, job.saved_course_id); assert.equal(course.payload._generationRunId, job.run_id);
    assert.deepEqual([...course.payload.config.components].sort(), [...f.components].sort());
    assert.equal(course.payload.config.storageKeyPrefix, course.id);
    assert.equal(course.payload._tokenUsage.total.calls, 3, 'saved ledger covers the final lesson runner only, not whole-course billing');
    assert.equal(course.payload._tokenUsage.total.inputTokens, 3 * f.inputTokens, 'synthetic lesson usage cannot leak between builds');
    for (const lessons of Object.values(course.payload.modules)) for (const lesson of Object.values(lessons)) {
      assert.ok(lesson.title.startsWith(f.label));
      assert.equal(lesson.sections.some(s => s.type === 'checklist'), f.components.includes('checklists'));
      assert.equal(lesson.sections.some(s => s.type === 'quiz'), f.components.includes('quizzes'));
    }
  }
  console.log('Durable result: two independent completed courses, one handled insert collision, one cancelled provisional save rolled back; 15 synthetic model calls, zero paid calls.');
} catch (error) {
  console.log(await command(['snapshot']).catch(() => 'Snapshot unavailable'));
  const rows = owner ? await admin.from('generation_jobs').select('status,stage,message,error').eq('owner_id', owner) : {};
  console.log(JSON.stringify({ jobs: rows.data, calls, insertArrivals: [...insertArrivals], collisions, goldInserted })); throw error;
} finally {
  for (const item of gates.values()) item.release(); await Promise.allSettled(pending);
  await command(['close']).catch(() => {}); if (server) await new Promise(resolve => server.close(resolve));
  if (owner) { for (const table of ['generation_jobs', 'user_courses']) assert.ifError((await admin.from(table).delete().eq('owner_id', owner)).error); assert.ifError((await admin.auth.admin.deleteUser(owner)).error); }
  globalThis.fetch = originalFetch;
  console.log('Removed only this run’s disposable QA account, setups, jobs and synthetic courses; existing user data unchanged.');
}
