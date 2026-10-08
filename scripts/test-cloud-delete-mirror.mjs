import assert from 'node:assert/strict';
import { removeCloudJobMirror } from '../web/js/cloud-gen-client.js';
import { createJob, getJob, updateJob } from '../web/js/jobs.js';
import { _installCourseFromRemote, _readAllCourses } from '../web/js/user-courses.js';

const store = new Map();
globalThis.localStorage = {
  getItem(key) { return store.has(key) ? store.get(key) : null; },
  setItem(key, value) { store.set(key, String(value)); },
  removeItem(key) { store.delete(key); }
};

const job = createJob({ topic: 'Durable workflows' });
updateJob(job.id, { savedCourseId: 'durable-workflows' });
_installCourseFromRemote('durable-workflows', {
  config: { id: 'durable-workflows', title: 'Durable Workflows' },
  _generationJobId: job.id,
  createdAt: Date.now(),
  updatedAt: Date.now()
});
assert.ok(getJob(job.id));
assert.ok(_readAllCourses()['durable-workflows']);

removeCloudJobMirror(job.id);
assert.equal(getJob(job.id), null);
assert.equal(_readAllCourses()['durable-workflows'], undefined);

const unrelatedSameIdJob = createJob({ topic: 'Stale saved course id' });
updateJob(unrelatedSameIdJob.id, { savedCourseId: 'shared-course' });
_installCourseFromRemote('shared-course', {
  config: { id: 'shared-course', title: 'Shared Account Course' },
  _generationJobId: 'different-job',
  createdAt: Date.now(),
  updatedAt: Date.now()
});
assert.ok(getJob(unrelatedSameIdJob.id));
assert.ok(_readAllCourses()['shared-course']);

removeCloudJobMirror(unrelatedSameIdJob.id);
assert.equal(getJob(unrelatedSameIdJob.id), null);
assert.ok(_readAllCourses()['shared-course']);

const otherJob = createJob({ topic: 'Other account cleanup' });
updateJob(otherJob.id, { savedCourseId: 'other-account-course' });
_installCourseFromRemote('other-account-course', {
  config: { id: 'other-account-course', title: 'Other Account Course' },
  createdByUserId: 'user-other',
  createdBy: 'other@example.com',
  createdAt: Date.now(),
  updatedAt: Date.now()
});
assert.ok(getJob(otherJob.id));
assert.ok(_readAllCourses()['other-account-course']);

removeCloudJobMirror(otherJob.id);
assert.equal(getJob(otherJob.id), null);
assert.ok(_readAllCourses()['other-account-course']);

const orphanJob = createJob({ topic: 'Orphan local course' });
_installCourseFromRemote('orphan-local-course', {
  config: { id: 'orphan-local-course', title: 'Orphan Local Course' },
  _generationJobId: orphanJob.id,
  createdAt: Date.now(),
  updatedAt: Date.now()
});
assert.ok(getJob(orphanJob.id));
assert.ok(_readAllCourses()['orphan-local-course']);

removeCloudJobMirror(orphanJob.id);
assert.equal(getJob(orphanJob.id), null);
assert.equal(_readAllCourses()['orphan-local-course'], undefined);

const otherOrphanJob = createJob({ topic: 'Other account orphan' });
_installCourseFromRemote('other-account-orphan-course', {
  config: { id: 'other-account-orphan-course', title: 'Other Account Orphan Course' },
  _generationJobId: otherOrphanJob.id,
  createdByUserId: 'user-other',
  createdBy: 'other@example.com',
  createdAt: Date.now(),
  updatedAt: Date.now()
});
assert.ok(getJob(otherOrphanJob.id));
assert.ok(_readAllCourses()['other-account-orphan-course']);

removeCloudJobMirror(otherOrphanJob.id);
assert.equal(getJob(otherOrphanJob.id), null);
assert.ok(_readAllCourses()['other-account-orphan-course']);

removeCloudJobMirror('');
removeCloudJobMirror(null);

console.log('cloud delete mirror tests passed');
