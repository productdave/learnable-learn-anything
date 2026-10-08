import { getAiTaskConfig } from './ai-models.mjs';

const MESSAGES = {
  disabled: 'Generated images are not enabled yet. Your course is unchanged.',
  funding: 'Learnable-funded images are not available yet. No alternative account was charged.',
  configuration: 'The image service is not configured for the supported model.',
  input: 'Add an image description and alt text within the displayed limits.',
  connection: 'Connect your OpenAI API key before generating images.',
  vault: 'Your secure OpenAI connection is unavailable. No image request was sent.',
  credentials: 'OpenAI rejected this API key. Check or replace your connection.',
  access: 'This OpenAI connection cannot access the image model. Check model access, verification and API permissions.',
  quota: 'Your OpenAI API account has insufficient quota. Check its billing and usage limits before trying again.',
  rate_limit: 'OpenAI is rate-limiting image requests. Wait before explicitly trying again.',
  moderation: 'OpenAI could not generate this image under its safety rules. Review the description before trying again.',
  rejected: 'OpenAI could not use this image request. Review the description and settings before trying again.',
  unavailable: 'OpenAI is unavailable. Your existing course is unchanged.',
  timeout: 'The image request timed out. OpenAI may already have processed and charged it. Do not retry automatically.',
  cancelled: 'The image request was cancelled. An already submitted request may still incur an OpenAI charge.',
  response: 'OpenAI did not return a usable image. Your existing course is unchanged.',
};

export class ImageGenerationError extends Error {
  constructor(code, { dispatched = false, requestId = null, usage = null } = {}) {
    super(MESSAGES[code] || MESSAGES.unavailable);
    this.name = 'ImageGenerationError';
    this.code = Object.hasOwn(MESSAGES, code) ? code : 'unavailable';
    this.mayHaveCharged = dispatched;
    this.automaticRetry = false;
    this.requestId = requestId;
    this.usage = usage;
  }
}

// Funding is server-owned, not inferred from a key's presence. A later platform
// mode must add an explicit budget/entitlement resolver here, never a fallback.
export function imagePolicy(env = process.env) {
  const model = getAiTaskConfig('image', env);
  return Object.freeze({
    enabled: env.LEARNABLE_GPT_IMAGES === '1',
    connectionEnabled: env.LEARNABLE_OPENAI_CONNECTION === '1',
    funding: env.LEARNABLE_IMAGE_FUNDING || 'creator',
    provider: model.provider, model: model.model, adapter: model.adapter,
    n: 1, size: '1024x1024', quality: 'medium', output_format: 'png', moderation: 'auto',
    maxPromptCharacters: 4000, maxAltCharacters: 300, timeoutMs: 150000,
    maxImageBytes: 8 * 1024 * 1024, maxResponseBytes: 12 * 1024 * 1024,
  });
}

export function requireImagePolicy(policy) {
  if (!policy.enabled) throw new ImageGenerationError('disabled');
  if (policy.funding !== 'creator') throw new ImageGenerationError('funding');
  if (policy.provider !== 'openai' || policy.adapter !== 'image-generation' ||
      policy.model !== 'gpt-image-2.5-flare-2026-09-08') throw new ImageGenerationError('configuration');
}

// Connecting a credential is a non-generating operation. A separate opt-in
// allows onboarding while the paid image paths remain disabled.
export function requireImageConnectionPolicy(policy) {
  if (!policy.enabled && !policy.connectionEnabled) throw new ImageGenerationError('disabled');
  requireImagePolicy({ ...policy, enabled: true });
}

export function validOpenAIKey(key) {
  return typeof key === 'string' && /^sk-(?!ant-)[A-Za-z0-9_-]{20,500}$/.test(key);
}

export function imageFailureCode(status, errorCode) {
  if (status === 401) return 'credentials';
  if (status === 403 || status === 404) return 'access';
  if (errorCode === 'moderation_blocked' || errorCode === 'content_policy_violation') return 'moderation';
  if (status === 429 && ['insufficient_quota', 'billing_hard_limit_reached'].includes(errorCode)) return 'quota';
  if (status === 429) return 'rate_limit';
  if (status === 400 || status === 422) return 'rejected';
  return 'unavailable';
}
