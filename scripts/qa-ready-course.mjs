// Real browser/UI, isolated controller service doubles; no account/provider writes.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { readBrowserGraph } from './browser-contract.mjs';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';
import { retainComponentChoices } from '../web/js/generator/component-policy.mjs';
import { assembleCourse } from '../web/js/generator/assemble-course.js';
const cli = process.env.PLAYWRIGHT_CLI, session = process.argv[2] || 'ready-review'; assert.ok(cli);
const components = ['lessons', 'practice', 'checklists', 'quizzes', 'flashcards'], brief = retainComponentChoices(curriculumFixture(), { components });
const course = assembleCourse(brief, brief.modules.flatMap(mod => mod.topics.map(topic => ({ moduleId: mod.id, topicId: topic.id, content: lessonFixture(components, topic) }))));
Object.assign(course, { _brief: brief, _generationJobId: 'readiness-qa', _research: { foundations: { key_concepts: ['Light', 'Composition'], sources: [{ title: 'Synthetic photography reference', url: 'https://example.com/photography' }] } } });
const graph = readBrowserGraph(), modulePath = `/js/home.js?${graph.imports.get(resolve(graph.web, 'js/home.js'))[0].query}`;
function command(args) {
  const result = spawnSync(cli, [`-s=${session}`, ...args], { encoding: 'utf8', timeout: 180000 });
  const out = result.stdout?.split('### Ran Playwright code')[0] || '';
  if (result.status || result.error || result.stdout?.includes('### Error')) throw new Error(out + (result.stderr || '') + (result.error?.message || ''));
  return out;
}
try {
  console.log(command(['open', 'http://127.0.0.1:4173/?experience=workspace'])); command(['snapshot']);
  const script = readFileSync(new URL('./qa-ready-course.browser.js', import.meta.url), 'utf8').replace('__READY_QA__', JSON.stringify({ course, modulePath }));
  console.log(command(['run-code', script]));
  assert.ok(command(['eval', '() => window.__readyQAReport']).includes('"total"'), 'Browser run must reach completion.');
} finally { command(['close']); }
