// Server-owned pinned routes. Constructing a policy does not authorize dispatch.
// Capped QA uses a 24-hour window. Explicit owner funding has no testing expiry;
// per-request limits, provider receipts and operator pause controls still apply.
import { createHash } from 'node:crypto';

export const OPENROUTER_POLICY_VERSION = 'openrouter-draft-v1';
export const OPENROUTER_NATIVE_POLICY_VERSION = 'openrouter-native-v2';
export const OPENROUTER_OWNER_POLICY_VERSION = 'openrouter-owner-v3';
const MODELS = {
  'anthropic/claude-sonnet-5.5': { provider: 'Anthropic', tag: 'anthropic', input: 2, output: 10, context: 1048576, reasoning: { effort: 'low' } },
  'deepseek/deepseek-v4.1-flash': { provider: 'Parasail', tag: 'parasail/fp8', input: 0.3, output: 1.2, context: 1048576, reasoning: { enabled: false } },
  'qwen/qwen3.6-35b-a3b': { provider: 'Parasail', tag: 'parasail/fp8', input: 0.15, output: 1, context: 262144, reasoning: { enabled: false } }
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

export function createOpenRouterPolicy({ lessonModel = DEFAULT_LESSON, reviewedAt, validUntil, now = Date.now(), version = OPENROUTER_POLICY_VERSION } = {}) {
  if (![OPENROUTER_POLICY_VERSION, OPENROUTER_NATIVE_POLICY_VERSION, OPENROUTER_OWNER_POLICY_VERSION].includes(version)) refuse('configuration', 'Unsupported policy version.');
  const ownerFunded = version === OPENROUTER_OWNER_POLICY_VERSION;
  const native = version !== OPENROUTER_POLICY_VERSION;
  if (![DEFAULT_LESSON, 'qwen/qwen3.6-35b-a3b', FRONTIER].includes(lessonModel)) refuse('configuration', 'Unreviewed lesson model.');
  const start = Date.parse(reviewedAt), end = Date.parse(validUntil);
  if (!Number.isFinite(start) || start > now || (ownerFunded ? validUntil != null : (!Number.isFinite(end) || end <= now || end <= start || end - start > 86400000)))
    refuse('configuration', ownerFunded ? 'Owner-funded routes require a valid review date and no testing expiry.' : 'A current, explicitly reviewed price window of at most 24 hours is required.');
  const routes = Object.fromEntries(Object.keys(OPENROUTER_TASK_TOOLS).map(task => {
    const model = task === 'lesson' ? lessonModel : FRONTIER, definition = MODELS[model];
    return [task, { model, provider: definition.provider, adapter: 'chat-json-schema',
      tool: OPENROUTER_TASK_TOOLS[task], maxOutputTokens: 16384, maxInputBytes: 400000,
      // Reserve the full model context; a byte/token heuristic is not a price guarantee.
      inputTokenBound: definition.context, inputDollarsPerMillion: definition.input,
      outputDollarsPerMillion: definition.output, reasoning: definition.reasoning }];
  }));
  if (native) {
    routes.image = { model: 'black-forest-labs/flux.2-klein-4b', provider: 'Black Forest Labs', providerTag: 'black-forest-labs', adapter: 'images',
      n: 1, size: '1024x1024', outputFormat: 'png', reservedMicrousd: 56000, dollarsPerMegapixel: 0.014, maxMegapixels: 4 };
    routes.curriculum = { ...routes.curriculum, adapter: 'native-messages-schema', maxInputBytes: 20 * 1024 * 1024, maxSearches: 0 };
    routes.research = { ...routes.research, adapter: 'native-messages-schema', maxInputBytes: 20 * 1024 * 1024, maxSearches: 1, searchDollarsPerUse: 0.01, maxModelTurns: 2 };
  }
  const body = { version, gateway: 'openrouter', funding: 'platform',
    reviewedAt: new Date(start).toISOString(), validUntil: ownerFunded ? null : new Date(end).toISOString(),
    routes, maxLessonAttempts: 2, nativeResearchAccepted: native, imagesAccepted: native };
  return freeze({ ...body, fingerprint: policyFingerprint(body) });
}

export function validateOpenRouterPolicy(snapshot, { now = Date.now(), allowExpired = false } = {}) {
  let copy;
  try { copy = JSON.parse(JSON.stringify(snapshot)); } catch { refuse('configuration', 'Invalid saved AI policy.'); }
  if (!copy || ![OPENROUTER_POLICY_VERSION, OPENROUTER_NATIVE_POLICY_VERSION, OPENROUTER_OWNER_POLICY_VERSION].includes(copy.version) || copy.gateway !== 'openrouter' || copy.funding !== 'platform')
    refuse('configuration', 'Unsupported saved AI policy.');
  const { fingerprint, ...body } = copy;
  if (fingerprint !== policyFingerprint(body)) refuse('configuration', 'Saved AI policy fingerprint does not match.');
  const expected = createOpenRouterPolicy({ version: copy.version, lessonModel: copy.routes?.lesson?.model, reviewedAt: copy.reviewedAt,
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

// Requests use catalog endpoint tags; receipts report the display name.
export function openRouterProviderTag(route) {
  const definition = MODELS[route.model];
  if (!definition || definition.provider !== route.provider) refuse('configuration', 'Unreviewed provider identity.');
  return definition.tag;
}
