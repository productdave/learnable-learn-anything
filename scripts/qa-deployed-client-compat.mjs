// Recovered production UI/store/sync + current UI against disposable local Auth/DB.
// Only the public Supabase config and synthetic course responses are substituted.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig, createPreviewServer } from './dev-setup-server.mjs';
import { readTree, digest } from './plan-workspace-release.mjs';
import { readBrowserGraph } from './browser-contract.mjs';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';
import { assembleCourse } from '../web/js/generator/assemble-course.js';

const cli = process.env.PLAYWRIGHT_CLI; assert.ok(cli, 'Set PLAYWRIGHT_CLI');
const baselineRoot = process.argv[2]; assert.ok(baselineRoot, 'Pass the recovered production release directory');
const baseline = JSON.parse(readFileSync(new URL('../docs/upgrade/production-baseline-2026-09-17.json', import.meta.url)));
const files = readTree(baselineRoot);
assert.deepEqual([...files.keys()].sort(), Object.keys(baseline.files).sort());
for (const [path, sha1] of Object.entries(baseline.files)) assert.equal(digest(files.get(path), 'sha1'), sha1, `Recovered production source changed: ${path}`);
const config = await loadPreviewConfig(new URL('../.env.preview.local', import.meta.url));
assert.equal(config.mode, 'local'); assert.equal(config.url, 'http://127.0.0.1:54321');
Object.assign(config, { creationImages: false, images: false, generation: false, publishing: false, moderation: false });
const admin = createClient(config.url, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const accounts = [], servers = [], session = 'deployed-client-compat';
const courseId = 'qa-mixed-version-photography', components = ['lessons','practice','checklists','quizzes','flashcards'];
const brief = curriculumFixture(); brief.id = courseId; brief.components = components;
const course = assembleCourse(brief, brief.modules.flatMap(mod => mod.topics.map(topic => ({ moduleId: mod.id, topicId: topic.id, content: lessonFixture(components, topic) }))));
for (const lessons of Object.values(course.modules)) for (const lesson of Object.values(lessons)) lesson.sections.push({ type:'exercise',id:'compat-response',title:'Compare the light',prompt:'Describe what changed.',template:'',hints:[] });
course.config.components = components;
const graph = readBrowserGraph(), modules = {};
for (const name of ['auth','store','sync','material-defaults']) modules[name] = `/js/${name}.js?${graph.imports.get(resolve(graph.web, `js/${name}.js`))[0].query}`;
const legacyModules = Object.fromEntries(['auth','store','sync'].map(name => [name, `/js-matching-release/${name}.js?v=dinner-release-2`]));
async function command(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, ['--session', session, ...args]); let output = '';
    child.stdout.on('data', part => { output += part; }); child.stderr.on('data', part => { output += part; });
    child.on('error', reject); child.on('close', code => { const result = output.split('### Ran Playwright code')[0]; if (code || output.includes('### Error')) reject(Error(result || 'Browser command failed')); else resolve(result); });
  });
}
try {
  for (let i = 0; i < 2; i++) {
    const account = { email:`deployed-compat-${randomUUID()}@example.test`,password:`${randomUUID()}Aa9!` };
    const created = await admin.auth.admin.createUser({ ...account, email_confirm:true }); assert.ifError(created.error);
    accounts.push({ ...account, owner:created.data.user.id });
  }
  const handlers = {};
  for (const [file, data] of [['course.json',course.config],['curriculum.json',course.curriculum],...Object.entries(course.modules).map(([number, data])=>[`modules/module-${number}.json`,data])]) {
    handlers[`/data/courses/${courseId}/${file}`] = async (_req,res) => res.status(200).json(data);
  }
  const localConfig = async (_req,res) => {
    res.setHeader('Content-Type','text/javascript');
    res.end(`export const SUPABASE_URL=${JSON.stringify(config.url)}; export const SUPABASE_ANON_KEY=${JSON.stringify(config.publicKey)};`);
  };
  const legacy = createPreviewServer({ config, directory:resolve(baselineRoot), extraHandlers:{...handlers,'/js-matching-release/config.js':localConfig} });
  const modern = createPreviewServer({ config, extraHandlers:handlers });
  for (const server of [legacy,modern]) { servers.push(server); server.listen(0,'127.0.0.1'); await once(server,'listening'); }
  const urls = { legacy:`http://127.0.0.1:${legacy.address().port}`, modern:`http://127.0.0.1:${modern.address().port}` };
  console.log(`Verified ${files.size} production source files. Testing both apps on loopback; generation endpoints disabled.`);
  await command(['open',urls.modern + '/?experience=workspace']); await command(['snapshot']);
  const code = readFileSync(new URL('./qa-deployed-client-compat.browser.js',import.meta.url),'utf8').replace('__DEPLOYED_COMPAT_QA__',JSON.stringify({urls,accounts,modules,legacyModules,courseId,backend:config.url}));
  console.log(await command(['run-code',code]));
  await command(['run-code','async page => { await page.waitForFunction(() => !!window.__deployedCompatReport, null, { timeout: 30000 }); }']);
  const report = await command(['eval','window.__deployedCompatReport']); console.log(report);
  assert.ok(report.includes('"passed"')&&!report.includes('"error"'),'Browser journey must complete all assertions');
  const a = await admin.from('user_state').select('state').eq('user_id',accounts[0].owner).single(); assert.ifError(a.error);
  assert.ok(a.data.state._learningV2.courses[courseId]);
  assert.ok(a.data.state._courseMaterialDefaults.revision);
  const b = await admin.from('user_state').select('state').eq('user_id',accounts[1].owner).single(); assert.ifError(b.error);
  assert.ok(!JSON.stringify(b.data.state).includes('Account A private response'));
  console.log('Durable account A progress/defaults and account B separation verified with real local Auth/Postgres/RLS. No model calls.');
} finally {
  try { await command(['close']); } catch {}
  for (const server of servers) { server.closeAllConnections(); await new Promise(done=>server.close(done)); }
  for (const account of accounts) {
    for (const table of ['learning_events','user_state']) assert.ifError((await admin.from(table).delete().eq('user_id',account.owner)).error);
    assert.ifError((await admin.auth.admin.deleteUser(account.owner)).error);
  }
  console.log('Removed only this run’s disposable local account/state/event fixtures; existing data unchanged.');
}
