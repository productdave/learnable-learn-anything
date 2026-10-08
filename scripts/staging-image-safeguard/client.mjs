// Only copied into the isolated staging derivative, never the production source.
import { ImageGenerationError } from './image-policy.mjs';
export const IMAGE_SPEND_PROFILE = 'gpt-image-2.5-flare-2026-09-08-medium1024-20260930';
const uuid = v => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(v || '');
const token = v => Number.isSafeInteger(v) && v >= 0;

// Direct Images API: no cache discount. Count ALL input at the higher image
// input rate ($8/M), output at $30/M. This is conservative accounting, not an
// invoice claim or an undocumented per-image maximum. Unexpected usage halts.
export function imageAccountedMicrousd(u) {
  if (!u || typeof u !== 'object' || Array.isArray(u) ||
      Object.keys(u).some(k => !['input_tokens','output_tokens','total_tokens','input_tokens_details','output_tokens_details'].includes(k)) ||
      !['input_tokens','output_tokens','total_tokens'].every(k => token(u[k])) ||
      u.total_tokens !== u.input_tokens + u.output_tokens || u.output_tokens === 0) throw new ImageGenerationError('response');
  for (const [key,total] of [['input_tokens_details',u.input_tokens],['output_tokens_details',u.output_tokens]]) {
    if (u[key] !== undefined && (!u[key] || typeof u[key] !== 'object' || Array.isArray(u[key]) ||
        Object.keys(u[key]).some(k => !['text_tokens','image_tokens'].includes(k)) ||
        !token(u[key].text_tokens) || !token(u[key].image_tokens) ||
        u[key].text_tokens + u[key].image_tokens !== total)) throw new ImageGenerationError('response');
  }
  const amount = u.input_tokens * 8 + u.output_tokens * 30;
  if (!Number.isSafeInteger(amount) || amount <= 0) throw new ImageGenerationError('response');
  return amount;
}

export async function beginStagingImageSpend({client,ownerId,courseId,operationId,requestHash,policy,env}) {
  if (env.LEARNABLE_STAGING_IMAGE_SPEND !== '1' || env.SUPABASE_URL !== 'https://dmnwkrybgggbpqpetuub.supabase.co' ||
      Date.now() >= Date.parse('2026-10-07T00:00:00Z') || !uuid(ownerId) || !uuid(operationId) ||
      !/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(courseId || '') || !/^[a-f0-9]{64}$/.test(requestHash || '') ||
      policy.provider !== 'openai' || policy.funding !== 'creator' || policy.model !== 'gpt-image-2.5-flare-2026-09-08' ||
      policy.n !== 1 || policy.size !== '1024x1024' || policy.quality !== 'medium' || policy.output_format !== 'png' ||
      policy.moderation !== 'auto' || policy.maxPromptCharacters !== 4000) throw new ImageGenerationError('configuration');
  const scope = {p_owner_id:ownerId,p_course_id:courseId,p_operation_id:operationId,p_fingerprint:requestHash};
  const rpc = async (name,args) => {
    let r; try { r = await client.rpc(name,args); } catch { throw new ImageGenerationError('unavailable'); }
    if (r?.error || r?.data?.ok !== true) throw new ImageGenerationError('funding');
    return r.data;
  };
  // An ambiguous reserve reply never dispatches. Its persisted hold, if any,
  // independently blocks the next request, even if a halt RPC cannot finish.
  const held = await rpc('reserve_learnable_staging_image_spend',{...scope,p_profile:IMAGE_SPEND_PROFILE});
  if (!Number.isSafeInteger(held.reserved_microusd) || held.reserved_microusd < 1000000 || held.reserved_microusd > 3000000) throw new ImageGenerationError('funding');
  return {
    async settle(usage,requestId) {
      const amount = imageAccountedMicrousd(usage);
      if (amount > held.reserved_microusd || !/^req_[A-Za-z0-9_-]{1,100}$/.test(requestId || '')) throw new ImageGenerationError('response');
      await rpc('settle_learnable_staging_image_spend',{...scope,p_accounted_microusd:amount,p_provider_request_id:requestId});
    },
    async halt() {
      try { await rpc('halt_learnable_staging_image_spend',scope); } catch { /* Never release an uncertain hold. */ }
    },
  };
}
