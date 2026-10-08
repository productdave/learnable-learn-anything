// One clock shared by HTTP preflight and the runner, including queued requests.
// 30s is reserved for draining checkpoints and writing a recoverable job state.
// The 120s dispatch floor is a conservative scheduling policy, not a promise
// about provider latency. A dispatched request can still have an unknown charge.
export const GENERATION_WORK_WINDOW_MS = 270_000;
export const GENERATION_REQUEST_WINDOW_MS = 120_000;
export const GENERATION_REQUEST_TIMEOUT_MS = 240_000;
export const GENERATION_PAUSE = 'GENERATION_TIME_SLICE_COMPLETE';
export const GENERATION_UNCERTAIN = 'GENERATION_REQUEST_UNCERTAIN';
export const GENERATION_IO_UNCERTAIN = 'GENERATION_IO_UNCERTAIN';
export const GENERATION_MEDIA_TIMEOUT = 'GENERATION_MEDIA_TIMEOUT';
export const GENERATION_FINISH_WINDOW_MS = 295_000;

export function isGenerationPause(error) { return error?.code === GENERATION_PAUSE; }
export function isGenerationBudgetStop(error) {
  return isGenerationPause(error) || [GENERATION_UNCERTAIN, GENERATION_IO_UNCERTAIN].includes(error?.code);
}

export function createGenerationRequestBudget({
  now = () => performance.now(), setTimer = setTimeout, clearTimer = clearTimeout, startedAt, request
} = {}) {
  // Grouped hosting records this server-only Symbol before lazy module loading.
  // Standalone handlers/tests start here. Never read a client timestamp or let
  // invalid/future metadata extend the window. Forks retain the explicit origin.
  if (startedAt === undefined) {
    const current = now(), entered = request?.[Symbol.for('learnable.generation.startedAt')];
    startedAt = Number.isFinite(entered) && entered >= 0 && entered <= current ? entered : current;
  }
  const deadline = startedAt + GENERATION_WORK_WINDOW_MS;
  const finishDeadline = deadline + GENERATION_FINISH_WINDOW_MS - GENERATION_WORK_WINDOW_MS;
  let stopped = null;
  const remainingMs = () => Math.max(0, deadline - now());
  const stop = error => {
    // A later uncertain in-flight result must outrank an earlier safe pause.
    if (!stopped || (isGenerationPause(stopped) && !isGenerationPause(error))) stopped = error;
    return stopped;
  };
  const assertCanStart = () => {
    if (stopped) throw stopped;
    if (remainingMs() < GENERATION_REQUEST_WINDOW_MS) {
      throw stop(Object.assign(new Error('Generation paused before starting another AI request. Completed work is saved; resume from the checkpoint.'), { code: GENERATION_PAUSE }));
    }
  };
  return {
    remainingMs, stop, assertCanStart,
    // A multi-job HTTP invocation has one deadline, but a failed job must not
    // poison another job's stop state. Forks never reset the request clock.
    fork: () => createGenerationRequestBudget({ now, setTimer, clearTimer, startedAt }),
    // Non-provider I/O has an operation limit AND an invocation-wide limit.
    // Persisting checkpoints/final state may use the reserved finishing window.
    // A timed-out remote write is unconfirmed, never an invented success/refund.
    async runOperation(work, { phase = 'work', timeoutMs = 15_000, code = GENERATION_PAUSE, signal: parentSignal } = {}) {
      const remaining = Math.max(0, (phase === 'finish' ? finishDeadline : deadline) - now());
      const error = () => Object.assign(new Error(code === GENERATION_IO_UNCERTAIN
        ? 'A storage operation could not be confirmed in time. Saved checkpoints are retained; check the latest state before resuming.'
        : 'Generation paused at its time boundary. Saved work is retained.'), { code });
      if (!remaining) throw error();
      if (phase !== 'finish' && stopped) throw stopped;
      parentSignal?.throwIfAborted();
      const controller = new AbortController();
      const signal = parentSignal ? AbortSignal.any([parentSignal, controller.signal]) : controller.signal;
      const expires = now() + Math.min(timeoutMs, remaining);
      const timer = setTimer(() => controller.abort(error()), Math.min(timeoutMs, remaining));
      timer?.unref?.();
      let onAbort;
      const aborted = new Promise((_resolve, reject) => {
        onAbort = () => reject(signal.reason);
        signal.addEventListener('abort', onAbort, { once: true });
      });
      try {
        const value = await Promise.race([Promise.resolve().then(() => {
          signal.throwIfAborted(); return work(signal);
        }), aborted]);
        if (now() >= expires && !signal.aborted) controller.abort(error());
        signal.throwIfAborted();
        return value;
      } finally {
        clearTimer(timer); signal.removeEventListener('abort', onAbort);
      }
    },
    beginRequest() {
      assertCanStart();
      const controller = new AbortController();
      const timeoutMs = Math.min(GENERATION_REQUEST_TIMEOUT_MS, remainingMs());
      const expires = now() + timeoutMs;
      const expire = () => {
        const error = Object.assign(new Error('The AI request exceeded its time window. Its result and charge may be uncertain; review before retrying.'), { code: GENERATION_UNCERTAIN });
        stop(error);
        controller.abort(error);
      };
      const timer = setTimer(expire, timeoutMs);
      timer?.unref?.();
      return {
        signal: controller.signal,
        throwIfExpired() {
          if (!controller.signal.aborted && now() >= expires) expire();
          controller.signal.throwIfAborted();
        },
        close() { clearTimer(timer); }
      };
    }
  };
}

// Per-invocation facade: retain the actual Supabase query builders, filters,
// headers and CAS operations. Never mutate the shared service client or replace
// scoped operations with a broad fetch/retry. Supabase's public abortSignal API
// receives the combined deadline; Promise.race bounds non-cancellable storage
// reads too. Remote commit outcome can remain unknown after an abort.
export function bindGenerationClient(client, budget, { phase = 'finish' } = {}) {
  const options = { phase, timeoutMs: 10_000, code: GENERATION_IO_UNCERTAIN };
  function wrap(query, signals = []) {
    return new Proxy(query, { get(target, property) {
      if (property === 'abortSignal') return signal => wrap(target, [...signals, signal]);
      if (property === 'then' && typeof target.then === 'function') {
        return (resolve, reject) => budget.runOperation(signal => {
          const combined = signals.length ? AbortSignal.any([signal, ...signals]) : signal;
          combined.throwIfAborted();
          return typeof target.abortSignal === 'function' ? target.abortSignal(combined) : target;
        }, { ...options, ...(signals.length ? { signal: AbortSignal.any(signals) } : {}) }).then(resolve, reject);
      }
      const value = Reflect.get(target, property, target);
      if (typeof value !== 'function') return value;
      return (...args) => {
        const result = Reflect.apply(value, target, args);
        return result && (typeof result.then === 'function' || typeof result.select === 'function') ? wrap(result, signals) : result;
      };
    } });
  }
  const scoped = Object.create(client);
  scoped.from = (...args) => wrap(client.from(...args));
  scoped.rpc = (...args) => wrap(client.rpc(...args));
  if (client.storage) {
    scoped.storage = Object.create(client.storage);
    scoped.storage.from = (...args) => {
      const bucket = client.storage.from(...args);
      return new Proxy(bucket, { get(target, property) {
        const value = Reflect.get(target, property, target);
        return typeof value === 'function'
          ? (...parameters) => budget.runOperation(() => Reflect.apply(value, target, parameters), options)
          : value;
      } });
    };
  }
  return scoped;
}

// Authentication uses Supabase's fetch injection, so its request/body read can
// be aborted as well as locally bounded. Preserve any SDK/caller abort signal.
export function withGenerationSignal(signal, fetcher = (...args) => globalThis.fetch(...args)) {
  return (url, options = {}) => {
    const combined = options.signal ? AbortSignal.any([signal, options.signal]) : signal;
    combined.throwIfAborted();
    return fetcher(url, { ...options, signal: combined });
  };
}
