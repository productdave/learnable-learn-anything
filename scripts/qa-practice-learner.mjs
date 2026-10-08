// Isolated real browser/local Auth + progress sync; synthetic course content.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig } from './dev-setup-server.mjs';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';
import { retainComponentChoices } from '../web/js/generator/component-policy.mjs';
import { assembleCourse } from '../web/js/generator/assemble-course.js';
import { readBrowserGraph } from './browser-contract.mjs';
import { resolve } from 'node:path';
const cli = process.env.PLAYWRIGHT_CLI;
assert.ok(cli, 'Set PLAYWRIGHT_CLI to the installed Playwright skill wrapper.');
const config = await loadPreviewConfig(new URL('../.env.preview.local', import.meta.url));
assert.equal(config.mode, 'local'); assert.equal(config.url, 'http://127.0.0.1:54321');
const fixtures = {}, accounts = [], session = process.argv[2] || 'practice-learner';
const sets = [['lessons', 'practice'], ['lessons', 'checklists'], ['lessons', 'practice', 'checklists'], ['lessons', 'practice', 'checklists', 'quizzes', 'flashcards'], ['lessons', 'practice', 'checklists', 'quizzes', 'flashcards']];
for (const [index, components] of sets.entries()) {
  const id = `qa-practice-${index}`, brief = retainComponentChoices(curriculumFixture(), { components }); brief.id = id;
  for (const mod of brief.modules) for (const topic of mod.topics) topic.title = `${id} · ${topic.title}`;
  const course = assembleCourse(brief, brief.modules.flatMap(mod => mod.topics.map(topic => ({ moduleId: mod.id, topicId: topic.id, content: lessonFixture(components, topic) }))));
  for (const topics of Object.values(course.modules)) for (const topic of Object.values(topics)) topic.sections.push({ type: 'exercise', id: 'same-exercise', title: 'Describe the difference', prompt: 'Record what changed.', template: '', hints: ['Notice the direction.'] });
  // Deliberately DO NOT uniquify the quiz/module/topic IDs: collisions are tested.
  course.config.documentTitle = `${id} | Learnable`; fixtures[id] = course;
}
const graph = readBrowserGraph(), modules = {};
for (const name of ['auth', 'store', 'sync']) modules[name] = `/js/${name}.js?${graph.imports.get(resolve(graph.web, `js/${name}.js`))[0].query}`;
const admin = createClient(config.url, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
function command(args) {
  const result = spawnSync(cli, [`-s=${session}`, ...args], { encoding: 'utf8', timeout: 180000 });
  const out = result.stdout?.split('### Ran Playwright code')[0] || '';
  if (result.status || result.error || result.stdout?.includes('### Error')) throw new Error(out + (result.stderr || '') + (result.error?.message || ''));
  return out;
}
try {
  for (let i = 0; i < 2; i++) {
    const email = `learner-browser-${randomUUID()}@example.test`, password = `${randomUUID()}Aa9!`;
    const result = await admin.auth.admin.createUser({ email, password, email_confirm: true }); assert.ok(!result.error);
    accounts.push({ email, password, owner: result.data.user.id });
  }
  console.log(command(['open', 'http://127.0.0.1:4173/?experience=workspace']));
  command(['snapshot']);
  const script = readFileSync(new URL('./qa-practice-learner.browser.js', import.meta.url), 'utf8').replace('__PRACTICE_QA__', JSON.stringify({ fixtures, accounts, modules }));
  console.log(command(['run-code', script]));
} finally {
  // Only disposable accounts created above; never touch an existing user.
  try { command(['close']); } catch {}
  for (const account of accounts) {
    for (const table of ['learning_events', 'user_state']) await admin.from(table).delete().eq('user_id', account.owner);
    assert.ok(!(await admin.auth.admin.deleteUser(account.owner)).error);
  }
}
