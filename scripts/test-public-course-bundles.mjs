import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import { normalizePublicAuthor } from '../web/js/public-author.js';

const courseRoot = new URL('../web/data/courses/', import.meta.url);
const webRoot = new URL('../web/', import.meta.url);
const publicCourseIds = [
  'multi-agent-workflow-systems',
  'ai-product-evals-rubrics',
  'little-swimmer'
];

const catalog = JSON.parse(await fs.readFile(new URL('index.json', courseRoot), 'utf8'));
for (const course of catalog.courses) {
  if (course.publicAuthor) {
    assert.ok(normalizePublicAuthor(course.publicAuthor), `${course.id}: public attribution must have a display name`);
    assert.deepEqual(course.publicAuthor, normalizePublicAuthor(course.publicAuthor), `${course.id}: public attribution uses only safe public fields`);
  }
}

for (const courseId of publicCourseIds) {
  assert.equal(catalog.courses.filter(course => course.id === courseId).length, 1, `${courseId} should appear once in the catalog`);

  const courseDir = new URL(`${courseId}/`, courseRoot);
  const config = JSON.parse(await fs.readFile(new URL('course.json', courseDir), 'utf8'));
  const curriculum = JSON.parse(await fs.readFile(new URL('curriculum.json', courseDir), 'utf8'));

  assert.equal(config.id, courseId);
  assert.ok(config.title);
  assert.ok(Array.isArray(curriculum.modules) && curriculum.modules.length > 0);

  for (const module of curriculum.modules) {
    const modulePath = new URL(`modules/module-${module.number}.json`, courseDir);
    const topics = JSON.parse(await fs.readFile(modulePath, 'utf8'));
    assert.deepEqual(
      module.topics.map(topic => topic.id).sort(),
      Object.keys(topics).sort(),
      `${courseId} module ${module.number} should contain every curriculum topic`
    );
  }

  const serialized = await readCourseBundle(courseDir, curriculum.modules);
  const assetRefs = [...serialized.matchAll(/"src"\s*:\s*"(data\/courses\/[^"?#]+)"/g)].map(match => match[1]);
  for (const assetRef of assetRefs) {
    assert.ok(assetRef.startsWith(`data/courses/${courseId}/`), `${courseId} should not reference another course's local assets`);
    await fs.access(new URL(assetRef, webRoot));
  }
  for (const privateKey of ['createdBy', 'createdByUserId', '_brief', '_research', '_generationJobId', '_generationRunId', '_tokenUsage', '_syncedAt']) {
    assert.equal(serialized.includes(`"${privateKey}"`), false, `${courseId} should not publish ${privateKey}`);
  }
  assert.equal(/(?:sk-ant-|sk-proj-|AIza)[A-Za-z0-9_-]{8,}/.test(serialized), false, `${courseId} should not contain a secret-like value`);
}

console.log('public course bundles are complete and sanitized');

async function readCourseBundle(courseDir, modules) {
  const paths = [
    new URL('course.json', courseDir),
    new URL('curriculum.json', courseDir),
    ...modules.map(module => new URL(`modules/module-${module.number}.json`, courseDir))
  ];
  return (await Promise.all(paths.map(file => fs.readFile(file, 'utf8')))).join('\n');
}
