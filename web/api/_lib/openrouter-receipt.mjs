import { boundedResult } from './openrouter-client.mjs';
import { refuse } from './openrouter-policy.mjs';

// Receipt indexing can lag the completed response. Retrying these bounded GETs
// never creates another generation. No paid POST is retried here.
export async function readOpenRouterGeneration({ id, apiKey, fetcher = fetch, signal, wait = ms => new Promise(resolve => setTimeout(resolve, ms)) }) {
  if (!/^gen-[A-Za-z0-9_-]{1,180}$/.test(id || '')) refuse('uncertain', 'No reconcilable gateway generation ID was returned.');
  // Image receipts can become visible after the image response has completed.
  // At most seven GETs / 15.75 seconds of backoff; the caller's deadline still wins.
  for (let attempt = 0; attempt < 7; attempt++) {
    signal?.throwIfAborted();
    const response = await fetcher(`https://openrouter.ai/api/v1/generation?id=${encodeURIComponent(id)}`, {
      method: 'GET', redirect: 'error', signal, headers: { authorization: `Bearer ${apiKey}` } });
    if (response.ok) {
      const result = (await boundedResult(response))?.data;
      if (result?.id !== id) refuse('uncertain', 'Gateway receipt identity did not match.');
      return result;
    }
    await response.body?.cancel().catch(() => {});
    if (response.status !== 404 || attempt === 6) break;
    await wait(250 * 2 ** attempt);
  }
  refuse('uncertain', 'The gateway receipt is not available yet. Retain the reservation before retrying work.');
}
