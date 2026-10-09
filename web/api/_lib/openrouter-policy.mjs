// Server-only candidate policy. Nothing in this module enables hosted generation.
// Prices/capabilities must be rechecked before an operator activates a pilot.
import { createHash } from 'node:crypto';

export const OPENROUTER_POLICY_VERSION = 'openrouter-draft-v1';
const MODELS = {
  'anthropic/claude-sonnet-5.5': { provider: 'Anthropic', input: 2, output: 10, context: 1048576, reasoning: { effort: 'low' } },
  'deepseek/deepseek-v4.1-flash': { provider: 'Parasail', input: 0.3, output: 1.2, context: 1048576, reasoning: { enabled: false } },
  'qwen/qwen3.6-35b-a3b': { provider: 'Parasail', input: 0.15, output: 1, context: 262144, reasoning: { enabled: false } }
};
const FRONTIER = 'anthropic/claude-sonnet-5.5';
const DEFAULT_LESSON = 'deepseek/deepseek-v4.1-flash';
export const OPENROUTER_TASK_TOOLS = Object.freeze({
  curriculum: 'submit_course_brief', research: 'submit_research_bundle', lesson: 'submit_topic',
  visual_review: 'submit_course_visual_review', visual_refinement: 'submit_lesson_visual_design'
});

export class OpenRouterError extends Error {
  constructor(code, message) { super(message); this.name = 'OpenRouterError'; this.code = code; }
}
export function refuse(code, message) { throw new OpenRouterError(code, message); }
function freeze(value) {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export const policyFingerprint = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

export function createOpenRouterPolicy({ lessonModel = DEFAULT_LESSON, reviewedAt, validUntil, now = Date.now() } = {}) {
  if (![DEFAULT_LESSON, 'qwen/qwen3.6-35b-a3b', FRONTIER].includes(lessonModel)) refuse('configuration', 'Unreviewed lesson model.');
  const start = Date.parse(reviewedAt), end = Date.parse(validUntil);
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > now || end <= now || end <= start || end - start > 86400000)
    refuse('configuration', 'A current, explicitly reviewed price window of at most 24 hours is required.');
  const routes = Object.fromEntries(Object.keys(OPENROUTER_TASK_TOOLS).map(task => {
    const model = task === 'lesson' ? lessonModel : FRONTIER, definition = MODELS[model];
    return [task, { model, provider: definition.provider, adapter: 'chat-json-schema',
      tool: OPENROUTER_TASK_TOOLS[task], maxOutputTokens: 16384, maxInputBytes: 400000,
      // Reserve the full model context; a byte/token heuristic is not a price guarantee.
      inputTokenBound: definition.context, inputDollarsPerMillion: definition.input,
      outputDollarsPerMillion: definition.output, reasoning: definition.reasoning }];
  }));
  const body = { version: OPENROUTER_POLICY_VERSION, gateway: 'openrouter', funding: 'platform',
    reviewedAt: new Date(start).toISOString(), validUntil: new Date(end).toISOString(),
    routes, maxLessonAttempts: 2, nativeResearchAccepted: false, imagesAccepted: false };
  return freeze({ ...body, fingerprint: policyFingerprint(body) });
}

export function validateOpenRouterPolicy(snapshot, { now = Date.now(), allowExpired = false } = {}) {
  let copy;
  try { copy = JSON.parse(JSON.stringify(snapshot)); } catch { refuse('configuration', 'Invalid saved AI policy.'); }
  if (!copy || copy.version !== OPENROUTER_POLICY_VERSION || copy.gateway !== 'openrouter' || copy.funding !== 'platform')
    refuse('configuration', 'Unsupported saved AI policy.');
  const { fingerprint, ...body } = copy;
  if (fingerprint !== policyFingerprint(body)) refuse('configuration', 'Saved AI policy fingerprint does not match.');
  const expected = createOpenRouterPolicy({ lessonModel: copy.routes?.lesson?.model, reviewedAt: copy.reviewedAt,
    validUntil: copy.validUntil, now: allowExpired ? Date.parse(copy.reviewedAt) : now });
  if (fingerprint !== expected.fingerprint) refuse('configuration', 'Saved AI policy contains unreviewed capabilities or prices.');
  return freeze(copy);
}

export function openRouterRoute(snapshot, task, options) {
  const route = validateOpenRouterPolicy(snapshot, options).routes[task];
  if (!route) refuse('unsupported', 'This task has no accepted OpenRouter route.');
  return route;
}

export function quoteOpenRouterText(route, maxTokens) {
  if (!Number.isSafeInteger(maxTokens) || maxTokens < 1 || maxTokens > route.maxOutputTokens)
    refuse('unsupported', 'Output limit is outside the reviewed route.');
  // USD per million tokens equals microdollars per token. Round upward once.
  return Math.ceil(route.inputTokenBound * route.inputDollarsPerMillion + maxTokens * route.outputDollarsPerMillion);
}
