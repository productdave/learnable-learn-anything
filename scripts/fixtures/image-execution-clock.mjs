import { createImageExecution } from '../../web/api/_lib/image-execution.mjs';

// Advance long deadlines deterministically; never spend minutes waiting in QA.
export function executionClock(options = {}) {
  let time = 0, id = 0;
  const timers = new Map();
  const budget = createImageExecution({ ...options, clock: () => time,
    schedule: (callback, ms) => { const key = ++id; timers.set(key, { at: time + ms, callback }); return key; },
    unschedule: key => timers.delete(key),
  });
  return { budget, timers,
    advance(ms) {
      time += ms;
      for (const [key, timer] of [...timers]) if (timer.at <= time && timers.delete(key)) timer.callback();
    },
  };
}
export const flush = () => new Promise(resolve => setImmediate(resolve));
export function deferred() { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
