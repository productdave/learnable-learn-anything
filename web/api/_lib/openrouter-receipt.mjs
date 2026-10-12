import { boundedResult } from './openrouter-client.mjs';
import { refuse } from './openrouter-policy.mjs';

// Receipt indexing can lag the completed response. Retrying these bounded GETs
// never creates another generation. No paid POST is retried here.
export async function readOpenRouterGeneration({ id, apiKey, fetcher = fetch, signal }) {
  if (!/^gen-[A-Za-z0-9_-]{1,180}$/.test(id || '')) refuse('uncertain', 'No reconcilable gateway generation ID was returned.');
  for (let attempt = 0; attempt < 3; attempt++) {
    signal?.throwIfAborted();
    const response = await fetcher(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`, {
      method: 'GET', redirect: 'error', signal, headers: { authorization: `Bearer ${apiKey}` } });
    if (response.ok) {
      const result = (await boundedResult(response))?.data;
      if (result?.id !== id) refuse('uncertain', 'Gateway receipt identity did not match.');
      return result;
    }
    await response.body?.cancel().catch(() => {});
    if (response.status !== 404 || attempt === 2) break;
    await new Promise(resolve => setTimeout(resolve, 250 * (attempt + 1)));
  }
  refuse('uncertain', 'The gateway receipt is not available yet. Retain the reservation before retrying work.');
}
