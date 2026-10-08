// Isolated browser + actual local Auth/API/Postgres. The real proposal generator
// receives synthetic provider responses; no paid request or production write.
import assert from 'node:assert/strict';
import { commitCourseRow } from '../web/api/_lib/course-commit.mjs';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { once } from 'node:events';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig, createPreviewServer } from './dev-setup-server.mjs';
import { readBrowserGraph } from './browser-contract.mjs';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';
import { retainComponentChoices } from '../web/js/generator/component-policy.mjs';
import { assembleCourse } from '../web/js/generator/assemble-course.js';
import { generateRefinementProposal } from '../web/api/_lib/refinement-proposal.mjs';

const cli = process.env.PLAYWRIGHT_CLI, session = process.argv[2] || 'ai-editor'; assert.ok(cli);
const config = await loadPreviewConfig(new URL('../.env.preview.local', import.meta.url));
assert.equal(config.mode, 'local'); assert.equal(config.url, 'http://127.0.0.1:54321');
Object.assign(process.env, { SUPABASE_URL: config.url, SUPABASE_ANON_KEY: config.publicKey, SUPABASE_SECRET_KEY: config.secretKey, LEARNABLE_SETUP_GENERATION: '1' });
const graph = readBrowserGraph(), authModule = `/js/auth.js?${graph.imports.get(resolve(graph.web, 'js/auth.js'))[0].query}`;
const admin = createClient(config.url, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const accounts = [], pending = []; let server, calls = 0, release, delay = false, outcome = 'ok', lastManualTitle = '', lastInstructions = '';
const originalTitle = 'AI Editor Photography QA';
async function command(args) {
  return new Promise((resolve, reject) => {
    const child = spawn(cli, ['--session', session, ...args]); let output = '';
    child.stdout.on('data', chunk => { output += chunk; }); child.stderr.on('data', chunk => { output += chunk; });
    child.on('error', reject); child.on('close', code => { const result = output.split('### Ran Playwright code')[0]; code || output.includes('### Error') ? reject(new Error(result)) : resolve(result); });
  });
}
try {
  const components = ['lessons', 'practice', 'checklists', 'quizzes', 'flashcards'], brief = retainComponentChoices(curriculumFixture(), { components });
  for (let i = 0; i < 2; i++) {
    const account = { email: `ai-editor-${randomUUID()}@example.test`, password: `${randomUUID()}Aa9!` };
    const created = await admin.auth.admin.createUser({ ...account, email_confirm: true }); assert.ok(!created.error); account.owner = created.data.user.id; accounts.push(account);
    const course = assembleCourse(brief, brief.modules.flatMap(mod => mod.topics.map(topic => ({ moduleId: mod.id, topicId: topic.id, content: lessonFixture(components, topic) }))));
    course.config.id = 'ai-editor-qa'; course.config.title = originalTitle; Object.assign(course, { _brief: brief, _generationJobId: `ai-editor-${randomUUID()}`, createdByUserId: account.owner });
    assert.ok(!(await admin.from('user_courses').insert({ id: 'ai-editor-qa', owner_id: account.owner, payload: course })).error);
  }
  const { createRefinementProposalHandler } = await import('../web/api/courses/proposal.js');
  const { default: refine } = await import('../web/api/courses/refine.js');
  const { default: getCourse } = await import('../web/api/courses/get.js');
  const { default: setupHandler } = await import('../web/api/setups/store.js');
  const proposal = createRefinementProposalHandler({ enabled: () => true, background: work => pending.push(work), getKey: async () => 'synthetic-key-not-real', generate: args => generateRefinementProposal({ ...args, fetcher: async (url, options) => {
    assert.equal(url, 'https://api.anthropic.com/v1/messages'); calls++;
    const body = JSON.parse(options.body), context = JSON.parse(body.messages[0].content), thisOutcome = outcome;
    lastManualTitle = context.current_lesson.sections[0].title; lastInstructions = context.creator_request;
    if (delay) await new Promise(resolve => { const timer = setTimeout(resolve, 45000); release = () => { clearTimeout(timer); resolve(); }; });
    let replacement = context.target.kind === 'lesson' ? context.current_lesson : context.target.kind === 'section' ? context.current_lesson.sections[context.target.index] : context.current_lesson.flashcards[context.target.index];
    replacement = { ...replacement, ...('title' in replacement ? { title: 'AI revised opening for review' } : { back: 'AI revised flashcard for review' }) };
    return new Response(JSON.stringify({ stop_reason: thisOutcome === 'invalid' ? 'max_tokens' : 'tool_use', content: [{ type: 'tool_use', name: 'submit_refinement_proposal', input: { replacement, explanation: 'Clarifies the selected content while retaining the learning goal.', cautions: ['Review the guidance before teaching it.'] } }], usage: { input_tokens: 80, output_tokens: 40 } }), { headers: { 'Content-Type': 'application/json' } });
  } }) });
  const control = async (req, res) => {
    if (req.method === 'POST') {
      const chunks = []; for await (const chunk of req) chunks.push(chunk); const body = JSON.parse(Buffer.concat(chunks).toString());
      if ('delay' in body) delay = body.delay; if (body.outcome) outcome = body.outcome;
      if (body.release) { release?.(); release = null; }
      if (body.edit) {
        const record = await admin.from('user_courses').select('payload,updated_at').eq('owner_id', accounts[0].owner).eq('id', 'ai-editor-qa').single(); assert.ok(!record.error);
        record.data.payload.modules[1]['lesson-1'].sections[0].title = 'Newer accepted manual opening';
        assert.ok(await commitCourseRow({supabase:admin,ownerId:accounts[0].owner,courseId:'ai-editor-qa',row:record.data,payload:record.data.payload}));
      }
    }
    const record = await admin.from('user_courses').select('payload').eq('owner_id', accounts[0].owner).eq('id', 'ai-editor-qa').single();
    return res.status(200).json({ calls, lastManualTitle, lastInstructions, title: record.data?.payload.modules[1]['lesson-1'].sections[0].title, status: record.data?.payload._refinementProposal?.status });
  };
  server = createPreviewServer({ config, setupHandler, extraHandlers: { '/api/courses/refine': refine, '/api/courses/proposal': proposal, '/api/courses/get': getCourse, '/api/qa/proposal-control': control } });
  server.listen(0, '127.0.0.1'); await once(server, 'listening'); const origin = `http://127.0.0.1:${server.address().port}`;
  await command(['open', origin + '/?experience=workspace&filter=mine']); await command(['snapshot']);
  const script = readFileSync(new URL('./qa-ai-course-editor.browser.js', import.meta.url), 'utf8').replace('__AI_EDITOR_QA__', JSON.stringify({ origin, accounts, authModule, originalTitle }));
  console.log(await command(['run-code', script]));
  assert.ok((await command(['eval', 'window.__aiEditorReport'])).includes('"total"'), 'AI editor must complete browser checks');
  await Promise.all(pending);
  console.log(`Account-backed AI editor completed with ${calls} synthetic provider calls. No paid AI requests.`);
} catch (error) { console.log(JSON.stringify({ calls, lastManualTitle, lastInstructions })); console.log(await command(['snapshot']).catch(() => 'Snapshot unavailable')); throw error; }
finally {
  release?.(); await Promise.allSettled(pending); await command(['close']).catch(() => {});
  if (server) await new Promise(resolve => server.close(resolve));
  for (const account of accounts) {
    assert.ok(!(await admin.from('user_courses').delete().eq('owner_id', account.owner)).error);
    assert.ok(!(await admin.auth.admin.deleteUser(account.owner)).error);
  }
  console.log('Removed only disposable AI-editor QA accounts and their test course rows.');
}
