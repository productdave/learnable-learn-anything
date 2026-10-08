// Actual browser + local Auth/API/database/runner. Model responses are synthetic.
// All API requests in the isolated browser are proxied to this fresh QA server;
// no requests reach the user's running server's generation handlers.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { readBrowserGraph } from './browser-contract.mjs';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig, createPreviewServer, previewGenerationRoutes } from './dev-setup-server.mjs';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';
import { syntheticImageResponse } from './fixtures/generated-image.mjs';
import { imageAssetPath,IMAGE_BUCKET } from '../web/api/_lib/image-request-store.mjs';

const cli = process.env.PLAYWRIGHT_CLI;
assert.ok(cli, 'Set PLAYWRIGHT_CLI to the installed wrapper.');
const session = process.argv[2] || 'learnable-handoff';
const partial = process.argv.includes('--partial');
const refinement = process.argv.includes('--refinement');
const curriculumRecovery = process.argv.includes('--curriculum-recovery');
const nonce = randomUUID();
const graph = readBrowserGraph();
const storeModule = `/js/store.js?${graph.imports.get(resolve(graph.web, 'js/store.js'))[0].query}`;
const materials = process.argv.find(arg => arg.startsWith('--materials='))?.split('=')[1] || 'legacy';
const componentSets = { legacy: ['lessons', 'quizzes', 'flashcards'], practice: ['lessons', 'practice'], checklists: ['lessons', 'checklists'], both: ['lessons', 'practice', 'checklists'], all: ['lessons', 'practice', 'checklists', 'quizzes', 'flashcards'], images:['lessons','practice','checklists','images'] };
assert.ok(componentSets[materials], 'Unknown connected course material set');
const components = componentSets[materials], artifactPrefix = curriculumRecovery ? 'curriculum-recovery' : materials === 'legacy' ? 'connected' : `rich-${materials}${partial ? '-partial' : ''}`;
let syntheticLessonFailures = partial ? 2 : 0;
let syntheticCurriculumFailures = curriculumRecovery ? 2 : 0;
assert.ok(!curriculumRecovery || (!partial && !refinement && materials !== 'images'), 'Run curriculum recovery as a separate bounded scenario');
const config = await loadPreviewConfig(new URL('../.env.preview.local', import.meta.url));
assert.equal(config.mode, 'local'); assert.equal(config.url, 'http://127.0.0.1:54321');
Object.assign(process.env, { SUPABASE_URL: config.url, SUPABASE_ANON_KEY: config.publicKey, SUPABASE_SECRET_KEY: config.secretKey, LEARNABLE_PROVIDER_VAULT_KEY: config.vaultKey, LEARNABLE_SETUP_GENERATION: '1' });
if(components.includes('images')){Object.assign(process.env,{LEARNABLE_GPT_IMAGES:'1',LEARNABLE_IMAGE_REQUESTS:'1',LEARNABLE_CREATION_IMAGES:'1'});config.creationImages=true;}
const originalFetch = globalThis.fetch, pending = [], users = [], modelCalls = [], base = 'http://127.0.0.1:4173';
let qaOrigin = '', server, imageCalls=0;
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.origin === 'https://api.anthropic.com' && url.pathname === '/v1/messages') {
    const body = JSON.parse(options.body), name = body.tool_choice?.name || body.tools?.find(tool => tool.name === 'submit_research_bundle')?.name;
    modelCalls.push(name);
    let value;
    if (name === 'submit_course_brief') {
      value = curriculumFixture(); value.id = 'connected-course-qa'; value.title = 'Connected Photography QA';
      if (syntheticCurriculumFailures > 0) { syntheticCurriculumFailures--; value.modules = []; }
      if (curriculumRecovery) assert.ok(JSON.stringify(body.messages).includes('Private workshop notes: compare soft window light from two angles.'), 'Every curriculum attempt retains original source notes');
    }
    else if (name === 'submit_research_bundle') value = { module_id: 'foundations', key_concepts: ['Natural light', 'Clear composition'], examples: ['Window portrait', 'A single subject'], misconceptions: [], sources: [{ title: 'Synthetic reference', url: 'https://example.com/photography' }], experts: [], images: [] };
    else if (name === 'submit_topic') {
      const id = body.messages[0].content.match(/Topic id: ([a-z0-9-]+)/)?.[1];
      if (id === 'lesson-2' && syntheticLessonFailures > 0) {
        syntheticLessonFailures--;
        if (components.includes('checklists')) {
          value = lessonFixture(components, { id, title: `Photography ${id}` });
          value.sections = value.sections.filter(section => section.type !== 'checklist');
        } else return new Response(JSON.stringify({ error: { type: 'invalid_request_error', message: 'Synthetic QA lesson failure' } }), { status: 400 });
      }
      assert.ok(id); value ||= lessonFixture(components, { id, title: `Photography ${id}` });
    } else throw new Error('Unexpected synthetic model request.');
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', name, input: value }], usage: { input_tokens: 10, output_tokens: 10 } }), { headers: { 'Content-Type': 'application/json' } });
  }
  if (![config.url, base, qaOrigin].includes(url.origin)) throw new Error('External network blocked by connected QA.');
  return originalFetch(input, options);
};
const admin = createClient(config.url, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
async function command(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, ['--session', session, ...args], { cwd: process.cwd() });
    let output = ''; child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject); child.on('close', code => {
      const result = output.split('### Ran Playwright code')[0];
      if (code || output.includes('### Error')) reject(new Error(result || 'Browser CLI failed'));
      else resolve(result);
    });
  });
}
try {
  const email = `connected-${randomUUID()}@example.test`;
  const made = await admin.auth.admin.createUser({ email, email_confirm: true }); assert.ok(!made.error); users.push(made.data.user.id);
  const { sealProviderKey } = await import('../web/api/_lib/provider-vault.mjs');
  assert.ok(!(await admin.from('provider_connections').insert({ owner_id: users[0], provider: 'anthropic', encrypted_key: sealProviderKey('sk-ant-synthetic-connected-QA', users[0]) })).error);
  const { createSetupGenerationHandler } = await import('../web/api/setups/generate.js');
  const { createReviewHandler } = await import('../web/api/gen/review.js');
  const { default: setupHandler } = await import('../web/api/setups/store.js');
  const { checkSchema } = await import('../web/api/health/cloud.js');
  const extraHandlers = {};
  for (const route of previewGenerationRoutes) extraHandlers[`/api/${route}`] = (await import(`../web/api/${route}.js`)).default;
  extraHandlers['/api/setups/generate'] = createSetupGenerationHandler({ validate: async () => {}, background: promise => pending.push(promise) });
  extraHandlers['/api/gen/review'] = createReviewHandler({ background: promise => pending.push(promise) });
  if (curriculumRecovery) extraHandlers['/api/qa/curriculum'] = async (req, res) => {
    if (req.headers['x-qa-key'] !== nonce) return res.status(404).json({ error: 'Missing' });
    if (req.method === 'POST') {
      let raw = ''; for await (const chunk of req) raw += chunk;
      const action = JSON.parse(raw || '{}').action;
      assert.ok(['disconnect', 'reconnect'].includes(action));
      if (action === 'disconnect') assert.ifError((await admin.from('provider_connections').delete().eq('owner_id', users[0]).eq('provider', 'anthropic')).error);
      else assert.ifError((await admin.from('provider_connections').insert({ owner_id: users[0], provider: 'anthropic', encrypted_key: sealProviderKey('sk-ant-synthetic-connected-QA', users[0]) })).error);
    }
    const jobs = await admin.from('generation_jobs').select('id,status,stage,run_id,brief,user_brief,error,review_history').eq('owner_id', users[0]); assert.ifError(jobs.error);
    const courses = await admin.from('user_courses').select('id').eq('owner_id', users[0]); assert.ifError(courses.error);
    return res.status(200).json({ jobs: jobs.data, courses: courses.data, calls: modelCalls });
  };
  if(components.includes('images')){
    const {createCourseImageHandler}=await import('../web/api/courses/images.js');
    const {generateCreatorImage}=await import('../web/api/_lib/openai-image.mjs');
    assert.ok(!(await admin.from('provider_connections').insert({owner_id:users[0],provider:'openai',encrypted_key:sealProviderKey('sk-proj-synthetic-image-creation-QA-123456',users[0],'openai')})).error);
    extraHandlers['/api/courses/images']=createCourseImageHandler({enabled:()=>true,background:promise=>pending.push(promise),generate:args=>{imageCalls++;return generateCreatorImage(args,{fetcher:async()=>new Response(JSON.stringify(syntheticImageResponse()),{headers:{'x-request-id':'req_creation_synthetic'}})});}});
  }
  extraHandlers['/api/health/cloud'] = async (req, res) => { const schema = await checkSchema(); return res.status(schema.ok ? 200 : 503).json({ ok: schema.ok, schema, missing: schema.missing, local: true }); };
  server = createPreviewServer({ config, setupHandler, extraHandlers });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); qaOrigin = `http://127.0.0.1:${server.address().port}`;
  await command(['open', base + '/?experience=workspace']);
  await command(['snapshot']);
  const script = readFileSync(new URL('./qa-connected-course.browser.js', import.meta.url), 'utf8').replace('__CONNECTED_QA__', JSON.stringify({ base, proxy: qaOrigin, email, owner: users[0], partial, components, artifactPrefix, refinement, storeModule, curriculumRecovery, nonce }));
  console.log(await command(['run-code', script]));
  const browserReport = await command(['eval', 'window.__connectedQAReport']);
  assert.ok(browserReport.includes('"checks"'), 'Browser run must reach its final report.');
  console.log(browserReport);
  if (curriculumRecovery) writeFileSync(new URL('../output/playwright/curriculum-recovery-report.txt', import.meta.url), browserReport);
  await Promise.all(pending);
  const rows = await admin.from('generation_jobs').select('id,status,saved_course_id').eq('owner_id', users[0]); assert.ok(!rows.error);
  assert.equal(rows.data.length, 1, 'one job for the whole journey'); assert.equal(rows.data[0].status, 'completed');
  const courses = await admin.from('user_courses').select('id,payload').eq('owner_id', users[0]); assert.ok(!courses.error);
  assert.equal(courses.data.length, 1); assert.equal(courses.data[0].id, rows.data[0].saved_course_id);
  assert.equal(courses.data[0].payload._generationJobId, rows.data[0].id);
  assert.deepEqual(courses.data[0].payload.config.components, components, 'saved account course retains exact selected materials');
  for (const topics of Object.values(courses.data[0].payload.modules)) for (const topic of Object.values(topics)) {
    for (const [section, choice] of [['practice', 'practice'], ['checklist', 'checklists'], ['quiz', 'quizzes']]) assert.equal(topic.sections.some(s => s.type === section), components.includes(choice));
    assert.equal(!!topic.flashcards.length, components.includes('flashcards'));
  }
  assert.equal(modelCalls.length, curriculumRecovery ? 8 : partial ? 7 : 5, 'only required stages and explicit recovery attempts run');
  if(components.includes('images')){assert.equal(imageCalls,3,'one explicit image per lesson, no automatic paid work');assert.ok(Object.values(courses.data[0].payload.modules[1]).every(lesson=>lesson.sections.some(section=>section.asset_id)),'all three accepted images are saved');}
  const otherEmail = `other-connected-${randomUUID()}@example.test`, password = `${randomUUID()}Aa9!`;
  const other = await admin.auth.admin.createUser({ email: otherEmail, password, email_confirm: true }); assert.ok(!other.error); users.push(other.data.user.id);
  const otherClient = createClient(config.url, config.publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
  const signed = await otherClient.auth.signInWithPassword({ email: otherEmail, password }); assert.ok(!signed.error);
  const denied = await fetch(`${qaOrigin}/api/courses/get?id=${courses.data[0].id}`, { headers: { authorization: `Bearer ${signed.data.session.access_token}` } });
  assert.equal(denied.status, 404, 'other account cannot read completed private course');
  const hidden = await otherClient.from('generation_jobs').select('id').eq('id', rows.data[0].id); assert.ok(!hidden.error); assert.equal(hidden.data.length, 0);
  console.log(`Durable handoff: one completed job, one account course, matching ownership/provenance, ${modelCalls.length} synthetic model calls; second account denied private course and job.`);
} catch (error) {
  console.log(await command(['snapshot']).catch(() => 'Snapshot unavailable'));
  const diagnostic = await admin.from('generation_jobs').select('status,stage,message,error').in('owner_id', users);
  console.log(JSON.stringify({ modelCalls, jobs: diagnostic.data }));
  throw error;
} finally {
  await Promise.allSettled(pending);
  for(const owner of users){const rows=await admin.from('course_image_requests').select('*').eq('owner_id',owner);assert.ok(!rows.error);const paths=rows.data.filter(row=>row.payload.asset).map(imageAssetPath);if(paths.length)assert.ok(!(await admin.storage.from(IMAGE_BUCKET).remove(paths)).error);}
  await command(['close']).catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
  for (const owner of users) {
    for (const table of ['generation_jobs', 'user_courses']) { const result = await admin.from(table).delete().eq('owner_id', owner); assert.ok(!result.error); }
    const result = await admin.auth.admin.deleteUser(owner); assert.ok(!result.error);
  }
  globalThis.fetch = originalFetch;
  console.log('Removed only this run’s temporary local account, setup, job and synthetic course; user work unchanged.');
}
