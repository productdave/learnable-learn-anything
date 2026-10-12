import { createHash } from 'node:crypto';
import { openRouterRoute, refuse } from './openrouter-policy.mjs';
import { decodeImagePNG, readImageResponse } from './openai-image.mjs';
import { ImageGenerationError } from './image-policy.mjs';
import { readOpenRouterGeneration } from './openrouter-receipt.mjs';

// This policy is passed only by the owned generation-job resolver. Browser
// funding flags and mere presence of a gateway key cannot select it.
export function openRouterImagePolicy(snapshot, options) {
  const route = openRouterRoute(snapshot, 'image', options);
  if (!snapshot.imagesAccepted || route.adapter !== 'images') refuse('unsupported', 'No reviewed illustration route.');
  return { enabled: true, funding: 'platform', provider: 'openrouter', model: route.model,
    n: route.n, size: route.size, quality: 'default', output_format: route.outputFormat, moderation: 'provider-default',
    maxPromptCharacters: 4000, maxAltCharacters: 300, timeoutMs: 150000,
    maxImageBytes: 8 * 1024 * 1024, maxResponseBytes: 12 * 1024 * 1024 };
}

export function createOpenRouterImageGenerator({ apiKey, policy, ledger, beforeDispatch = null, fetcher = fetch, now = Date.now }) {
  if (typeof window !== 'undefined' || !apiKey || !ledger?.reserve || !ledger?.settle || !ledger?.hold)
    refuse('configuration', 'Illustrations require the server connection and durable spending authorization.');
  let stopped;
  return async function generate({ prompt, alt, operationId, funding, signal }) {
    if (stopped) throw stopped;
    const imagePolicy = openRouterImagePolicy(policy, { now: now() }), route = policy.routes.image;
    if (funding !== 'platform' || !/^[0-9a-f-]{36}$/i.test(operationId || '') || typeof prompt !== 'string'
        || !prompt.trim() || [...prompt].length > imagePolicy.maxPromptCharacters || typeof alt !== 'string'
        || !alt.trim() || [...alt].length > imagePolicy.maxAltCharacters) throw new ImageGenerationError('input');
    const body = { model: route.model, prompt: prompt.trim(), n: 1, size: route.size, output_format: 'png', stream: false,
      provider: { only: [route.providerTag], allow_fallbacks: false } };
    const json = JSON.stringify(body), fingerprint = createHash('sha256').update(json).digest('hex');
    const combined = signal ? AbortSignal.any([signal, AbortSignal.timeout(imagePolicy.timeoutMs)]) : AbortSignal.timeout(imagePolicy.timeoutMs);
    let hold, settled = false, dispatched = false, requestId = null;
    try {
      await beforeDispatch?.(); combined.throwIfAborted();
      hold = await ledger.reserve({ operationKey: `image:${operationId}`, fingerprint, reservedMicrousd: route.reservedMicrousd, model: route.model, task: 'image' });
      await beforeDispatch?.(); combined.throwIfAborted();
      openRouterImagePolicy(policy, { now: now() });
      if (stopped) throw stopped;
      dispatched = true;
      const response = await fetcher('https://openrouter.ai/api/v1/images', { method: 'POST', redirect: 'error', signal: combined,
        headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' }, body: json });
      if (!response.ok) throw new ImageGenerationError('unavailable', { dispatched });
      requestId = response.headers.get('x-generation-id');
      const result = await readImageResponse(response, imagePolicy.maxResponseBytes, combined);
      if (!/^gen-[A-Za-z0-9_-]{1,180}$/.test(requestId || ''))
        throw new ImageGenerationError('response', { dispatched });
      // The Images envelope omits model/provider. Resolve its generation receipt
      // without issuing another paid request before accepting the accounting.
      const receipt = await readOpenRouterGeneration({ id: requestId, apiKey, fetcher, signal: combined });
      const cost = result.usage?.cost ?? receipt?.total_cost, actualMicrousd = Math.ceil(cost * 1e6);
      if (receipt?.id !== requestId || receipt.model !== route.model || receipt.provider_name !== route.provider
          || receipt.is_byok === true || !Number.isFinite(cost) || cost < 0 || !Number.isFinite(receipt.total_cost) || Math.abs(receipt.total_cost - cost) > 0.0000001
          || !Number.isSafeInteger(actualMicrousd) || actualMicrousd > route.reservedMicrousd)
        throw new ImageGenerationError('response', { dispatched, requestId });
      const usage = { gateway: 'openrouter', provider: route.provider, model: route.model, cost, images: result.data?.length || 0 };
      const u = result.usage || {};
      if ([u.prompt_tokens, u.completion_tokens, u.total_tokens].every(n => Number.isSafeInteger(n) && n >= 0)
          && u.total_tokens === u.prompt_tokens + u.completion_tokens)
        Object.assign(usage, { input_tokens: u.prompt_tokens, output_tokens: u.completion_tokens, total_tokens: u.total_tokens });
      await ledger.settle(hold, { actualMicrousd, providerRequestId: requestId, usage }); settled = true;
      if (result.data?.length !== 1 || result.data[0].media_type && result.data[0].media_type !== 'image/png')
        throw new ImageGenerationError('response', { dispatched, requestId });
      const asset = decodeImagePNG(result.data[0].b64_json, imagePolicy.maxImageBytes);
      return { asset: { ...asset, alt: alt.trim() }, provenance: { funding: 'platform', provider: 'openrouter', model: route.model,
        n: 1, size: route.size, quality: imagePolicy.quality, outputFormat: 'png', requestId, usage } };
    } catch (error) {
      if (!settled && hold) await ledger.hold(hold);
      const failure = new ImageGenerationError(error instanceof ImageGenerationError ? error.code : 'unavailable', { dispatched: dispatched || error.mayHaveCharged, requestId: requestId || error.requestId });
      // Unknown outcomes stop this generator and remain held across new leases.
      if (!settled) stopped = failure;
      throw failure;
    }
  };
}
