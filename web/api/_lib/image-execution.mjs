// One invocation budget, shared by the HTTP action and its waitUntil worker.
// Leave 30 seconds before Hobby's hard 300-second stop. An abort does not prove
// the provider or a remote write was cancelled; immutable receipts remain truth.
export const IMAGE_EXECUTION_MS = 270000;
export const IMAGE_FOREGROUND_MS = 25000;
export const IMAGE_IO_MS = 30000;
export const IMAGE_SAVE_RESERVE_MS = 60000;

export class ImageExecutionTimeout extends Error {
  constructor() { super('Image execution deadline reached. Check the same attempt.'); this.name = 'ImageExecutionTimeout'; }
}

export function createImageExecution({ limitMs = IMAGE_EXECUTION_MS, ioMs = IMAGE_IO_MS,
  clock = () => performance.now(), fetcher = globalThis.fetch, schedule = setTimeout, unschedule = clearTimeout } = {}) {
  const started = clock(), controller = new AbortController();
  const expire = () => controller.abort(new ImageExecutionTimeout());
  const timer = schedule(expire, limitMs);
  const remainingMs = () => Math.max(0, limitMs - (clock() - started));
  const foregroundMs = () => Math.max(0, Math.min(remainingMs(), IMAGE_FOREGROUND_MS - (clock() - started)));
  const check = () => { if (remainingMs() <= 0) expire(); controller.signal.throwIfAborted(); };
  return {
    signal: controller.signal, remainingMs, foregroundMs,
    async wait(operation, { timeoutMs = remainingMs() } = {}) {
      check();
      if (timeoutMs <= 0) { expire(); controller.signal.throwIfAborted(); }
      let cancel, stop;
      const aborted = new Promise((_, reject) => {
        stop = () => reject(controller.signal.reason);
        controller.signal.addEventListener('abort', stop, { once: true });
        cancel = schedule(expire, Math.min(timeoutMs, remainingMs()));
      });
      try {
        // Check again in the microtask: a cancelled invocation must not start
        // a provider call or write that was merely queued before the deadline.
        return await Promise.race([Promise.resolve().then(() => { check(); return operation(); }), aborted]);
      } finally { unschedule(cancel); controller.signal.removeEventListener('abort', stop); }
    },
    fetch(input, init = {}) {
      check();
      const inherited = init.signal || (typeof Request !== 'undefined' && input instanceof Request ? input.signal : null);
      const signal = AbortSignal.any([controller.signal, AbortSignal.timeout(Math.max(1, Math.ceil(Math.min(ioMs, remainingMs())))), ...(inherited ? [inherited] : [])]);
      signal.throwIfAborted();
      // The timeout stays attached through response-body consumption, not just
      // until headers arrive. Supabase Auth/REST/Storage all use this fetch.
      return fetcher(input, { ...init, signal });
    },
    close() { unschedule(timer); if (!controller.signal.aborted) controller.abort(new ImageExecutionTimeout()); },
  };
}
