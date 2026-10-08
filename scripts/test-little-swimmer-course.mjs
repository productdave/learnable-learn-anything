import assert from 'node:assert/strict';
import { readFile, access } from 'node:fs/promises';
import { TopicContentSchema } from '../web/js/generator/schema.mjs';

const root = new URL('../web/data/courses/little-swimmer/', import.meta.url);
const course = JSON.parse(await readFile(new URL('course.json', root), 'utf8'));
const curriculum = JSON.parse(await readFile(new URL('curriculum.json', root), 'utf8'));

assert.equal(course.id, 'little-swimmer');
assert.equal(curriculum.modules.length, 4);
assert.equal(curriculum.modules.reduce((total, mod) => total + mod.topics.length, 0), 12);

const practiceIds = new Set();
const imageSources = [];
for (const mod of curriculum.modules) {
  const topics = JSON.parse(await readFile(new URL(`modules/module-${mod.number}.json`, root), 'utf8'));
  assert.deepEqual(Object.keys(topics), mod.topics.map(topic => topic.id));

  for (const topicMeta of mod.topics) {
    const topic = topics[topicMeta.id];
    const parsed = TopicContentSchema.safeParse(topic);
    assert.equal(parsed.success, true, parsed.error?.issues?.map(issue => `${issue.path.join('.')}: ${issue.message}`).join('\n'));

    const practice = topic.sections.find(section => section.type === 'practice');
    assert.ok(practice, `${topic.id} is missing a practice section`);
    assert.equal(practiceIds.has(practice.id), false, `duplicate practice id: ${practice.id}`);
    practiceIds.add(practice.id);
    assert.ok(practice.safetyStops.length > 0, `${practice.id} needs stop rules`);

    for (const section of topic.sections.filter(section => section.type === 'image')) {
      imageSources.push(section.src);
    }
  }
}

assert.equal(practiceIds.size, 12);
assert.equal(imageSources.length, 10);
for (const src of imageSources) {
  const relative = src.replace('data/courses/little-swimmer/', '');
  await access(new URL(relative, root));
}

console.log('little swimmer course tests passed');
