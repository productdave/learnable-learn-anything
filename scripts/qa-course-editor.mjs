// Isolated real browser + editor controller; service doubles, no account/provider writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readBrowserGraph } from './browser-contract.mjs';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';
import { retainComponentChoices } from '../web/js/generator/component-policy.mjs';
import { assembleCourse } from '../web/js/generator/assemble-course.js';
const cli = process.env.PLAYWRIGHT_CLI, session = process.argv[2] || 'course-editor-edges'; assert.ok(cli);
const components = ['lessons', 'practice', 'checklists', 'quizzes', 'flashcards'], brief = retainComponentChoices(curriculumFixture(), { components });
const course = assembleCourse(brief, brief.modules.flatMap(mod => mod.topics.map(topic => ({ moduleId: mod.id, topicId: topic.id, content: lessonFixture(components, topic) }))));
const graph = readBrowserGraph(), modulePath = `/js/course-editor.js?${graph.imports.get(resolve(graph.web, 'js/course-editor.js'))[0].query}`;
function command(args) {
  const result = spawnSync(cli, [`-s=${session}`, ...args], { encoding: 'utf8', timeout: 180000 });
  const out = result.stdout?.split('### Ran Playwright code')[0] || '';
  if (result.status || result.error || result.stdout?.includes('### Error')) throw new Error(out + (result.stderr || '') + (result.error?.message || ''));
  return out;
}
try {
  command(['open', 'http://127.0.0.1:4173/?experience=workspace']); command(['snapshot']);
  const script = readFileSync(new URL('./qa-course-editor.browser.js', import.meta.url), 'utf8').replace('__EDITOR_QA__', JSON.stringify({ course, modulePath }));
  console.log(command(['run-code', script]));
  assert.ok(command(['eval', 'window.__editorQAReport']).includes('"total"'), 'Editor browser run must reach completion.');
} catch (error) { console.log(command(['snapshot'])); throw error; }
finally { command(['close']); }
