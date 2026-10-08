// Central AI model registry for Learnable's backend.
//
// This is task-based instead of stage-file-based. It lets us route
// curriculum, research, lessons, image generation, and search to different
// providers over time without rewriting the course pipeline.

const DEFAULT_TEXT_PROVIDER = 'anthropic';
const DEFAULT_WRITING_MODEL = 'claude-sonnet-4-5-20250929';

const TASK_DEFAULTS = {
  curriculum: {
    provider: DEFAULT_TEXT_PROVIDER,
    model: DEFAULT_WRITING_MODEL,
    adapter: 'messages',
    modality: 'text',
    purpose: 'Course outline, module structure, topic planning'
  },
  research: {
    provider: DEFAULT_TEXT_PROVIDER,
    model: DEFAULT_WRITING_MODEL,
    adapter: 'messages',
    modality: 'text',
    purpose: 'Grounded module research and source synthesis'
  },
  lesson: {
    provider: DEFAULT_TEXT_PROVIDER,
    model: DEFAULT_WRITING_MODEL,
    adapter: 'messages',
    modality: 'text',
    purpose: 'Lesson writing, quizzes, exercises, flashcards'
  },
  tutor: {
    provider: DEFAULT_TEXT_PROVIDER,
    model: 'claude-haiku-4-5-20251001',
    adapter: 'messages',
    modality: 'text',
    purpose: 'Low-latency tutor chat'
  },
  image: {
    provider: 'openai',
    model: 'gpt-image-2.5-flare-2026-09-08',
    adapter: 'image-generation',
    modality: 'image',
    purpose: 'Creator-funded course imagery; separate feature gate and acceptance required'
  },
  search: {
    provider: DEFAULT_TEXT_PROVIDER,
    model: 'web_search_20250305',
    adapter: 'anthropic-web-search',
    modality: 'search',
    maxUses: 6,
    purpose: 'Live web grounding during research'
  }
};

const TEXT_TASKS = new Set(['curriculum', 'research', 'lesson']);
const CLOUD_GENERATION_TEXT_TASKS = ['curriculum', 'research', 'lesson'];

export function getAiTaskConfig(task, env = readEnv()) {
  const defaults = TASK_DEFAULTS[task];
  if (!defaults) throw new Error(`Unknown AI task: ${task}`);

  const prefix = `LEARNABLE_AI_${task.toUpperCase()}`;
  const provider = normaliseProvider(
    env[`${prefix}_PROVIDER`] ||
    (TEXT_TASKS.has(task) ? env.LEARNABLE_AI_TEXT_PROVIDER : '') ||
    defaults.provider
  );
  const model =
    env[`${prefix}_MODEL`] ||
    (TEXT_TASKS.has(task) ? env.LEARNABLE_AI_TEXT_MODEL : '') ||
    defaults.model;

  const config = {
    task,
    provider,
    model,
    adapter: env[`${prefix}_ADAPTER`] || defaults.adapter,
    modality: defaults.modality,
    purpose: defaults.purpose
  };

  if (task === 'search') {
    config.maxUses = readPositiveInt(env.LEARNABLE_AI_SEARCH_MAX_USES, defaults.maxUses);
  }

  return config;
}

export function getAiModelRegistry(env = readEnv()) {
  return Object.fromEntries(
    Object.keys(TASK_DEFAULTS).map(task => [task, getAiTaskConfig(task, env)])
  );
}

export function publicAiModelRegistry(env = readEnv()) {
  const registry = getAiModelRegistry(env);
  return Object.fromEntries(
    Object.entries(registry).map(([task, config]) => [task, {
      provider: config.provider,
      model: config.model || null,
      adapter: config.adapter,
      modality: config.modality,
      purpose: config.purpose,
      ...(config.maxUses ? { maxUses: config.maxUses } : {})
    }])
  );
}

export function modelForTask(task, env = readEnv()) {
  return getAiTaskConfig(task, env).model;
}

export function anthropicWebSearchTool(env = readEnv()) {
  const search = getAiTaskConfig('search', env);
  if (search.provider !== 'anthropic' || search.adapter !== 'anthropic-web-search') {
    throw new Error(`Search task is configured for ${search.provider}/${search.adapter}, but the current research runner supports Anthropic web_search only.`);
  }
  return { type: search.model, name: 'web_search', max_uses: search.maxUses };
}

export function assertCloudGenerationModelSupport(registry = getAiModelRegistry()) {
  for (const task of CLOUD_GENERATION_TEXT_TASKS) {
    const config = registry[task];
    if (config.provider !== 'anthropic' || config.adapter !== 'messages') {
      throw new Error(`${task} is configured for ${config.provider}/${config.adapter}, but cloud course generation currently supports the Anthropic messages adapter for text stages.`);
    }
    if (!config.model) {
      throw new Error(`${task} model is empty. Set LEARNABLE_AI_${task.toUpperCase()}_MODEL or LEARNABLE_AI_TEXT_MODEL.`);
    }
  }

  const search = registry.search;
  if (search.provider !== 'anthropic' || search.adapter !== 'anthropic-web-search') {
    throw new Error(`search is configured for ${search.provider}/${search.adapter}, but the current research runner supports Anthropic web_search only.`);
  }
  if (!search.model) throw new Error('search model/tool is empty. Set LEARNABLE_AI_SEARCH_MODEL.');
  return true;
}

function readEnv() {
  return globalThis.process?.env || {};
}

function normaliseProvider(value) {
  return String(value || '').trim().toLowerCase();
}

function readPositiveInt(value, fallback) {
  const n = Number.parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
}
