// Minimal fetch-based Anthropic client. Drop-in for the parts of the SDK our
// stages use (`client.messages.create({...})`), but works in any context —
// page or Node, anywhere fetch exists. No `window` checks, no esm.sh
// dependency.

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

export function createClient({ apiKey, requestBudget = null, beforeDispatch = null, fetcher = fetch }) {
  if (!apiKey) throw new Error('Anthropic API key required');
  return {
    messages: {
      async create(opts) {
        await beforeDispatch?.();
        const request = requestBudget?.beginRequest();
        try {
          const r = await fetcher(ENDPOINT, {
            method: 'POST',
            headers: {
              'content-type': 'application/json',
              'x-api-key': apiKey,
              'anthropic-version': '2023-06-01',
              // Required for direct-from-browser calls. Harmless from a worker.
              'anthropic-dangerous-direct-browser-access': 'true'
            },
            body: JSON.stringify(opts),
            ...(request ? { signal: request.signal } : {})
          });
          if (!r.ok) {
            const text = await r.text().catch(() => '');
            let detail = text;
            let type = null;
            try {
              const parsed = JSON.parse(text);
              detail = parsed?.error?.message || text;
              type   = parsed?.error?.type || null;
            } catch { /* leave as text */ }
            const err = new Error(`Anthropic API ${r.status}${type ? ` ${type}` : ''}: ${detail}`);
            err.status = r.status;
            err.type = type;
            err.body = text;
            throw err;
          }
          const result = await r.json();
          request?.throwIfExpired?.();
          return result;
        } catch (error) {
          if (request?.signal.aborted) throw request.signal.reason;
          throw error;
        } finally { request?.close(); }
      }
    }
  };
}
