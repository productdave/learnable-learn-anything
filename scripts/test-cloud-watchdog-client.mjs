import assert from 'node:assert/strict';

const store = new Map();
globalThis.localStorage = {
  getItem(key) {
    return store.has(key) ? store.get(key) : null;
  },
  setItem(key, value) {
    store.set(key, String(value));
  },
  removeItem(key) {
    store.delete(key);
  }
};

const { getJob } = await import('../web/js/jobs.js?v=3');
const { markTimedOutJobsFromWatchdog } = await import('../web/js/cloud-gen-client.js?v=79');

const KEY = 'learnable-gen-jobs';
localStorage.setItem(KEY, JSON.stringify({
  'job-timeout': {
    id: 'job-timeout',
    runner: 'cloud',
    status: 'running',
    message: 'Writing lessons...',
    error: null,
    brief: { topic: 'AI agents' },
    lastUpdatedAt: Date.now(),
    startedAt: Date.now()
  },
  'job-other': {
    id: 'job-other',
    runner: 'cloud',
    status: 'running',
    message: 'Still alive',
    error: null,
    lastUpdatedAt: Date.now(),
    startedAt: Date.now()
  },
  'job-restart': {
    id: 'job-restart',
    runner: 'cloud',
    status: 'running',
    message: 'Curriculum Designer is restarting from your saved request...',
    error: null,
    brief: { topic: 'AI agents' },
    lastUpdatedAt: Date.now(),
    startedAt: Date.now()
  }
}));

assert.deepEqual(markTimedOutJobsFromWatchdog(['job-timeout']), ['job-timeout']);

assert.equal(getJob('job-timeout').status, 'timed_out');
assert.equal(getJob('job-timeout').runner, 'cloud');
assert.match(getJob('job-timeout').message, /timed out/i);
assert.match(getJob('job-timeout').error, /timed out/i);
assert.equal(getJob('job-other').status, 'running');

assert.deepEqual(markTimedOutJobsFromWatchdog(['job-restart']), ['job-restart']);
assert.equal(getJob('job-restart').status, 'timed_out');
assert.equal(getJob('job-restart').pendingRestart, true);
assert.match(getJob('job-restart').message, /timed out while restarting/i);
assert.match(getJob('job-restart').error, /restart timed out/i);

console.log('cloud watchdog client tests passed');
