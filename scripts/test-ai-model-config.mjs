import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import {
  anthropicWebSearchTool,
  assertCloudGenerationModelSupport,
  getAiModelRegistry,
  getAiTaskConfig,
  publicAiModelRegistry
} from '../web/api/_lib/ai-models.mjs';

const root = process.cwd();
const runner = readFileSync(join(root, 'web/api/_lib/gen-runner.mjs'), 'utf8');
const health = readFileSync(join(root, 'web/api/health/cloud.js'), 'utf8');
const intakeStage = readFileSync(join(root, 'web/js/generator/stages/intake.mjs'), 'utf8');
const researchStage = readFileSync(join(root, 'web/js/generator/stages/research.mjs'), 'utf8');
const topicStage = readFileSync(join(root, 'web/js/generator/stages/topic.mjs'), 'utf8');

{
  const registry = getAiModelRegistry({});
  assert.equal(registry.curriculum.provider, 'anthropic');
  assert.equal(registry.curriculum.model, 'claude-sonnet-4-5-20250929');
  assert.equal(registry.research.model, 'claude-sonnet-4-5-20250929');
  assert.equal(registry.lesson.model, 'claude-sonnet-4-5-20250929');
  assert.equal(registry.search.model, 'web_search_20250305');
  assert.equal(registry.search.maxUses, 6);
  assert.equal(registry.image.provider, 'openai');
  assert.equal(registry.image.model, 'gpt-image-2.5-flare-2026-09-08');
  assertCloudGenerationModelSupport(registry);
}

{
  const env = {
    LEARNABLE_AI_TEXT_PROVIDER: 'anthropic',
    LEARNABLE_AI_TEXT_MODEL: 'claude-custom-writing',
    LEARNABLE_AI_RESEARCH_MODEL: 'claude-custom-research',
    LEARNABLE_AI_SEARCH_MAX_USES: '9',
    LEARNABLE_AI_IMAGE_PROVIDER: 'openai',
    LEARNABLE_AI_IMAGE_MODEL: 'future-image-model'
  };
  assert.equal(getAiTaskConfig('curriculum', env).model, 'claude-custom-writing');
  assert.equal(getAiTaskConfig('research', env).model, 'claude-custom-research');
  assert.equal(getAiTaskConfig('lesson', env).model, 'claude-custom-writing');
  assert.equal(getAiTaskConfig('image', env).provider, 'openai');
  assert.equal(getAiTaskConfig('image', env).model, 'future-image-model');
  assert.equal(anthropicWebSearchTool(env).max_uses, 9);
}

{
  assert.throws(() => assertCloudGenerationModelSupport(getAiModelRegistry({
    LEARNABLE_AI_LESSON_PROVIDER: 'openai',
    LEARNABLE_AI_LESSON_MODEL: 'gpt-future'
  })), /lesson is configured for openai/);
  assert.throws(() => anthropicWebSearchTool({
    LEARNABLE_AI_SEARCH_PROVIDER: 'gemini',
    LEARNABLE_AI_SEARCH_MODEL: 'gemini-search-future'
  }), /current research runner supports Anthropic web_search only/);
}

{
  const publicRegistry = publicAiModelRegistry({});
  assert.deepEqual(Object.keys(publicRegistry).sort(), ['curriculum', 'image', 'lesson', 'research', 'search', 'tutor']);
  assert.equal(publicRegistry.curriculum.model, 'claude-sonnet-4-5-20250929');
  assert.equal(publicRegistry.curriculum.provider, 'anthropic');
  assert.equal(publicRegistry.search.maxUses, 6);
}

assert.ok(runner.includes('getAiModelRegistry()'));
assert.ok(runner.includes('assertCloudGenerationModelSupport(aiModels)'));
assert.ok(runner.includes('model: aiModels.curriculum.model'));
assert.ok(runner.includes('model: aiModels.research.model'));
assert.ok(runner.includes('model: aiModels.lesson.model'));
assert.ok(health.includes('publicAiModelRegistry()'));
assert.ok(intakeStage.includes("modelForTask('curriculum')"));
assert.ok(researchStage.includes("modelForTask('research')"));
assert.ok(topicStage.includes("modelForTask('lesson')"));

console.log('AI model config tests passed');
