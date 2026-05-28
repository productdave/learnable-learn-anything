// Minimal fetch-based Anthropic client. Drop-in for the parts of the SDK our
// stages use (`client.messages.create({...})`), but works in any context —
// page, service worker, anywhere fetch exists. No `window` checks, no
// `dangerouslyAllowBrowser` complaints, no esm.sh dependency.

const ENDPOINT = 'https://api.anthropic.com/v1/messages';

export function createClient({ apiKey }) {
  if (!apiKey) throw new Error('Anthropic API key required');
  return {
    messages: {
      async create(opts) {
        const r = await fetch(ENDPOINT, {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-api-key': apiKey,
            'anthropic-version': '2023-06-01',
            // Required for direct-from-browser calls. Harmless from a worker.
            'anthropic-dangerous-direct-browser-access': 'true'
          },
          body: JSON.stringify(opts)
        });
        if (!r.ok) {
          const text = await r.text().catch(() => '');
          let detail = text;
          try { detail = JSON.parse(text)?.error?.message || text; } catch { /* leave as text */ }
          const err = new Error(`Anthropic API ${r.status}: ${detail}`);
          err.status = r.status;
          throw err;
        }
        return r.json();
      }
    }
  };
}
