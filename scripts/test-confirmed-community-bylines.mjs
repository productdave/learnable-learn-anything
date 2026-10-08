import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { test } from 'node:test';

const root = resolve(process.env.PUBLIC_BYLINE_WEB_ROOT || new URL('../web/', import.meta.url).pathname);
const catalogFile = process.env.PUBLIC_BYLINE_CATALOG || 'data/courses/index.json';
const json = path => JSON.parse(readFileSync(join(root, path), 'utf8'));
const catalog = json(catalogFile).courses;
const author = { displayName: 'David Wang', avatarUrl: '' };
const approved = ['multi-agent-workflow-systems', 'ai-product-evals-rubrics', 'little-swimmer',
  'code-for-designers', 'ai-annotation-platform-pm', 'pour-over-coffee', 'game-theory'];

for (const id of approved) test(`confirmed public byline agrees in catalog and course: ${id}`, () => {
  const entries = catalog.filter(course => course.id === id);
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0].publicAuthor, author);
  assert.deepEqual(json(`data/courses/${id}/course.json`).publicAuthor, author);
  assert.deepEqual(Object.keys(entries[0].publicAuthor).sort(), ['avatarUrl', 'displayName']);
});

test('existing confirmed public author remains unchanged', () => {
  assert.deepEqual(catalog.find(course => course.id === 'agentic-ai-dinner').publicAuthor, author);
});

test('internal demo and private courses receive no inferred credit or publication', () => {
  assert.equal(catalog.find(course => course.id === 'quiz-demo').internal, true);
  assert.equal(catalog.find(course => course.id === 'quiz-demo').publicAuthor, undefined);
  for (const id of ['recursive-self-improvement-ai-pm', 'recursive-self-improvement-ai-pm-review-draft', 'product-experiment-loop']) {
    assert.equal(catalog.some(course => course.id === id), false);
  }
});
