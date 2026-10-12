// Server-owned provider selection. A saved job, never a request-body switch,
// determines its credential and policy throughout review and recovery.
import { readApiKey } from './supabase-server.mjs';
import { validateOpenRouterPolicy, OpenRouterError } from './openrouter-policy.mjs';
import { missingResearchModules } from './gen-research-checkpoint.mjs';
import { usesIntegratedVisuals } from './integrated-course-images.mjs';
import { getAiModelRegistry } from './ai-models.mjs';

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function stop(code, message) {
  throw Object.assign(new OpenRouterError(code, message), { statusCode: 409 });
}

export function hasGenerationBinding(job) {
  return job?.ai_policy != null || job?.ai_budget_ids != null;
}

export function generationProvider(job, ownerId, { env = process.env, now = Date.now() } = {}) {
  if (!hasGenerationBinding(job)) return { gateway: 'anthropic' };
  if (job.owner_id !== ownerId || !job.id) stop('configuration', 'The saved AI authorization does not belong to this course owner.');
  const ids = job.ai_budget_ids;
  if (!Array.isArray(ids) || ids.length !== 3 || ids.some(id => !uuid.test(id)) || new Set(ids).size !== 3)
    stop('configuration', 'The saved AI spending authorization is incomplete.');
  let policy;
  try { policy = validateOpenRouterPolicy(job.ai_policy, { now }); }
  catch { stop('approval', 'This course needs a current reviewed OpenRouter authorization. Its saved work is retained.'); }
  if (env.LEARNABLE_OPENROUTER_ENABLED !== '1') stop('disabled', 'OpenRouter generation is paused. Its saved work is retained.');
  const key = env.OPENROUTER_API_KEY;
  if (typeof key !== 'string' || !key.trim()) stop('configuration', 'The Learnable OpenRouter connection is unavailable. Contact the operator; no personal provider key is needed.');
  return { gateway: 'openrouter', policy, apiKey: key.trim() };
}

// These gates are intentionally explicit. A text-only integration must never
// quietly use an owner's OpenAI key for images or remove PDFs/search to succeed.
export function requireGenerationCapabilities(provider, { mode = 'complete', userBrief = {}, checkpoint = null, pdfRefs = [] } = {}) {
  if (provider.gateway !== 'openrouter') return;
  if (pdfRefs.length || userBrief.pdfRefs?.length)
    stop('unsupported', 'OpenRouter PDF support is not ready yet. Your uploaded sources are retained.');
  if (mode !== 'curriculum' && (!checkpoint?.brief || missingResearchModules(checkpoint.brief, checkpoint.research || {}).length))
    stop('unsupported', 'OpenRouter research and citations are not ready yet. Your review checkpoint is retained.');
  if (mode === 'complete' && usesIntegratedVisuals(userBrief))
    stop('unsupported', 'OpenRouter illustration support is not ready yet. Your course is retained; no separate OpenAI key is requested.');
}

export async function readGenerationApiKey(supabase, ownerId, job, { skipLegacyKey = false, ...options } = {}) {
  const provider = generationProvider(job, ownerId, options);
  requireGenerationCapabilities(provider, { userBrief: job?.user_brief || {}, ...options });
  if (provider.gateway === 'openrouter') return provider.apiKey;
  return skipLegacyKey ? null : readApiKey(supabase, ownerId);
}

export function generationModels(provider) {
  if (provider.gateway !== 'openrouter') return getAiModelRegistry();
  return Object.fromEntries(Object.entries(provider.policy.routes).map(([task, route]) => [task, {
    task, gateway: 'openrouter', provider: route.provider, model: route.model, adapter: route.adapter
  }]));
}

// Public starts stay off until research + images and operator admission pass QA.
// Selecting OpenRouter must not silently fall through to the two-key path.
export function requireNewGenerationProvider({ env = process.env } = {}) {
  const provider = env.LEARNABLE_GENERATION_PROVIDER || 'anthropic';
  if (provider === 'anthropic') return;
  if (provider !== 'openrouter') stop('configuration', 'Course generation has an unsupported provider configuration.');
  stop('unsupported', 'OpenRouter course creation is being connected. Research, illustrations and pilot authorization must pass QA before new courses can start.');
}
