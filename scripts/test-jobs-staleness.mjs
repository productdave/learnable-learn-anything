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
  },
  clear() {
    store.clear();
  }
};

const { createJobId, getJob, listActiveJobs, markInterruptedIfStale } = await import('../web/js/jobs.js');

const KEY = 'learnable-gen-jobs';
const old = Date.now() - 10 * 60 * 1000;

localStorage.setItem(KEY, JSON.stringify({
  cloudRunning: {
    id: 'cloudRunning',
    runner: 'cloud',
    status: 'running',
    lastUpdatedAt: old,
    startedAt: old
  },
  cloudCancelling: {
    id: 'cloudCancelling',
    runner: 'cloud',
    status: 'cancelling',
    lastUpdatedAt: old,
    startedAt: old
  },
  legacyRunning: {
    id: 'legacyRunning',
    status: 'running',
    lastUpdatedAt: old,
    startedAt: old
  },
  legacyCancelling: {
    id: 'legacyCancelling',
    status: 'cancelling',
    lastUpdatedAt: old,
    startedAt: old
  },
  completedCloudWaitingForCourse: {
    id: 'completedCloudWaitingForCourse',
    runner: 'cloud',
    status: 'completed',
    savedCourseId: 'course-waiting',
    courseInstalled: false,
    lastUpdatedAt: old,
    startedAt: old
  },
  completedCloudInstalled: {
    id: 'completedCloudInstalled',
    runner: 'cloud',
    status: 'completed',
    savedCourseId: 'course-installed',
    courseInstalled: true,
    lastUpdatedAt: old,
    startedAt: old
  }
}));

markInterruptedIfStale();

assert.equal(getJob('cloudRunning').status, 'running');
assert.equal(getJob('cloudCancelling').status, 'cancelling');
assert.equal(getJob('legacyRunning').status, 'interrupted');
assert.equal(getJob('legacyCancelling').status, 'failed');
assert.match(getJob('legacyCancelling').error, /Cancel timed out/);
assert.match(createJobId(), /^job-[0-9a-f-]{36}$/);
assert.ok(listActiveJobs().some(job => job.id === 'completedCloudWaitingForCourse'));
assert.equal(listActiveJobs().some(job => job.id === 'completedCloudInstalled'), false);

console.log('job staleness policy tests passed');
