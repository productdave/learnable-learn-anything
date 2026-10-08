// Copied into each private function bundle, never into the static website.
// Vercel's Node launcher still supplies body/query/response helpers and waitUntil.
export function createGroupedHandler(loaders, { now = () => performance.now() } = {}) {
  const routes = new Map(Object.entries(loaders));
  const loaded = new Map();
  return async function groupedHandler(req, res) {
    // Capture each invocation before waiting for a shared module import. A Symbol
    // cannot be supplied by HTTP headers, query parameters or parsed JSON. This
    // is process-local timing only; no account/request content is cached here.
    Object.defineProperty(req, Symbol.for('learnable.generation.startedAt'), {
      value: now(), configurable: true
    });
    // Match the original path, not a caller-controlled query/header selector.
    // Do not normalize encoded slashes, dot segments or arbitrary module names.
    const path = typeof req.url === 'string' ? req.url.split('?')[0] : '';
    const canonical = path.replace(/\/$/, '').replace(/\.js$/, '');
    const load = routes.get(canonical);
    if (!load) {
      res.setHeader('Cache-Control', 'no-store');
      return res.status(404).json({ error: 'API route not found.' });
    }
    if (!loaded.has(canonical)) {
      // Failed imports must be retryable on a later request. Never cache users,
      // bodies, response objects or handler return values between requests.
      loaded.set(canonical, Promise.resolve().then(load).then(module => {
        if (typeof module.default !== 'function') throw new TypeError('Invalid API handler export.');
        return module.default;
      }).catch(error => { loaded.delete(canonical); throw error; }));
    }
    const handler = await loaded.get(canonical);
    return handler(req, res);
  };
}
