import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

// Exercise the existing publisher in an isolated temporary output directory.
const fixtureRoot = await mkdtemp(path.join(tmpdir(), 'learnable-author-test-'));
try {
  const output = path.join(fixtureRoot, 'courses');
  const input = path.join(fixtureRoot, 'input.json');
  const ids = ['multi-agent-workflow-systems', 'ai-product-evals-rubrics'];
  const fixture = Object.fromEntries(ids.map(id => [id, {
    config: { id, title: 'QA publishing fixture', publicAuthor: { displayName: 'Alex Chen', avatarUrl: '/avatars/alex.png', email: 'do-not-publish@example.com', userId: 'private-user-id' } },
    curriculum: { modules: [{ number: 1, topics: [{ id: 'one' }] }] },
    modules: { 1: { one: { title: 'QA lesson' } } }
  }]));
  fixture[ids[1]].publicAuthor = { displayName: 'private@example.com', avatarUrl: 'javascript:alert(1)' };
  await mkdir(output);
  await writeFile(path.join(output, 'index.json'), JSON.stringify({ courses: [{ id: 'unrelated', title: 'Keep this course' }] }));
  await writeFile(input, JSON.stringify(fixture));
  const result = spawnSync(process.execPath, [fileURLToPath(new URL('./publish-static-courses.mjs', import.meta.url)), input, output], { encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  const catalog = JSON.parse(await readFile(path.join(output, 'index.json'), 'utf8'));
  const config = JSON.parse(await readFile(path.join(output, ids[0], 'course.json'), 'utf8'));
  const expected = { displayName: 'Alex Chen', avatarUrl: '/avatars/alex.png' };
  assert.deepEqual(config.publicAuthor, expected);
  assert.deepEqual(catalog.courses.find(c => c.id === ids[0]).publicAuthor, expected);
  assert.equal(catalog.courses.find(c => c.id === ids[1]).publicAuthor, undefined);
  const secondConfig = JSON.parse(await readFile(path.join(output, ids[1], 'course.json'), 'utf8'));
  assert.equal(secondConfig.publicAuthor, undefined, 'unsafe explicit author must not fall back to another identity');
  assert.ok(catalog.courses.some(c => c.id === 'unrelated'));
  assert.ok(!JSON.stringify([catalog, config, secondConfig]).includes('private@example.com'));
  assert.ok(!JSON.stringify([catalog, config, secondConfig]).includes('private-user-id'));
  assert.ok(!JSON.stringify([catalog, config, secondConfig]).includes('do-not-publish@example.com'));
  for (const privateField of ['_refinementProposal', '_lastRefinement']) {
    await writeFile(input, JSON.stringify({ ...fixture, [ids[0]]: { ...fixture[ids[0]], [privateField]: { instructions: 'private creator feedback' } } }));
    const denied = spawnSync(process.execPath, [fileURLToPath(new URL('./publish-static-courses.mjs', import.meta.url)), input, output], { encoding: 'utf8' });
    assert.notEqual(denied.status, 0, 'publisher rejects internal refinement metadata: ' + privateField);
    assert.match(denied.stderr, /private metadata key/);
    assert.deepEqual(JSON.parse(await readFile(path.join(output, 'index.json'), 'utf8')), catalog, 'rejected metadata does not change catalog');
  }
  console.log('Public author publishing: allowlisted bylines preserved, private fields excluded, unrelated catalog preserved.');
} finally {
  await rm(fixtureRoot, { recursive: true, force: true });
}
