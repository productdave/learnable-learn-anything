import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const retiredScript = readFileSync(join(root, 'scripts/retired-local-generator.mjs'), 'utf8');
const researchStage = readFileSync(join(root, 'web/js/generator/stages/research.mjs'), 'utf8');
const topicStage = readFileSync(join(root, 'web/js/generator/stages/topic.mjs'), 'utf8');

assert.equal(
  packageJson.scripts.generate,
  'node scripts/retired-local-generator.mjs',
  'npm run generate should not invoke the old local course pipeline.'
);

for (const file of [
  'generator/index.mjs',
  'generator/schema.mjs',
  'generator/stages/intake.mjs',
  'generator/stages/research.mjs',
  'generator/stages/topic.mjs',
  'generator/stages/assemble.mjs',
  'scripts/edit-annotation-brief.mjs'
]) {
  assert.equal(existsSync(join(root, file)), false, `${file} should stay retired.`);
}

assert.ok(retiredScript.includes('generation_jobs pipeline'));
assert.ok(retiredScript.includes('web/api/_lib/gen-runner.mjs'));
assert.ok(retiredScript.includes('web/api/gen/review.js'));
assert.ok(retiredScript.includes('web/api/gen/sweep.js'));
assert.equal(researchStage.includes('runResearchAll'), false, 'shared research stage should not export a local batch pipeline helper.');
assert.equal(topicStage.includes('runAllTopics'), false, 'shared topic stage should not export a local batch pipeline helper.');

console.log('local generator retirement tests passed');
