import assert from 'node:assert/strict';
import { _installCourseFromRemote, _setCurrentUserEmailFromAuth } from '../web/js/user-courses.js?v=2';
import {
  isBrokenSourceError,
  isMissingApiKeyError,
  isSavedCourseInstalledForCurrentUser,
  jobPatchFromRow,
  needsApiKeyForRow,
  needsSourceReattachForRow,
  pendingRestartForRow,
  shouldInstallSavedCourseForJobStatus
} from '../web/js/cloud-gen-client.js';

const store = new Map();
globalThis.localStorage = {
  getItem(key) { return store.has(key) ? store.get(key) : null; },
  setItem(key, value) { store.set(key, String(value)); },
  removeItem(key) { store.delete(key); }
};

globalThis.learnableCurrentUser = { id: 'user-owner', email: 'owner@example.com' };
_setCurrentUserEmailFromAuth('owner@example.com', 'user-owner');

const baseRow = {
  id: 'job-1',
  owner_id: 'user-owner',
  status: 'running',
  stage: 'research',
  message: '',
  topics_done: 0,
  topics_total: 0,
  user_brief: { topic: 'Code for designers' },
  brief: null,
  outline: null,
  failures: null,
  saved_course_id: null,
  error: null,
  research: null,
  topics_by_key: null,
  extracted_urls: null,
  review_history: null
};

const cleared = jobPatchFromRow(baseRow);
assert.equal(cleared.runner, 'cloud');
assert.equal(cleared.ownerId, 'user-owner');
assert.equal(typeof cleared.cloudSeenAt, 'number');
assert.equal(cleared.status, 'running');
assert.equal(cleared.title, 'Code for designers');
assert.deepEqual(cleared.brief, { topic: 'Code for designers' });
assert.equal(cleared.outline, null);
assert.deepEqual(cleared.failures, []);
assert.equal(cleared.failedCount, 0);
assert.equal(cleared.totalTopics, 0);
assert.equal(cleared.savedCourseId, null);
assert.equal(cleared.error, null);
assert.deepEqual(cleared.reviewHistory, []);
assert.equal(cleared.review, null);
assert.deepEqual(cleared.checkpoint, {
  brief: null,
  researchByModule: null,
  topicsByKey: null,
  imageProgress: null,
  designProgress: null,
  extractedUrls: null
});

const curriculumBrief = {
  title: 'Designing With Code',
  modules: [{ id: 'm1', title: 'HTML' }]
};
const revisedUserBrief = {
  topic: 'Code for designers',
  source_text: 'Human feedback: focus on visual examples.',
  pdfRefs: [{ storage_path: 'user-owner/job-1/0-source.pdf' }]
};
const curriculumPatch = jobPatchFromRow({
  ...baseRow,
  status: 'review_curriculum',
  stage: 'curriculum',
  user_brief: revisedUserBrief,
  brief: curriculumBrief,
  outline: [{ id: 'm1' }],
  failures: [{ moduleId: 'm1', topicId: 't1', error: 'retry me' }],
  error: 'needs a look',
  review_history: [{ action: 'revise_curriculum', feedback: 'Make it visual.' }]
});
assert.equal(curriculumPatch.status, 'review_curriculum');
assert.equal(curriculumPatch.title, 'Designing With Code');
assert.deepEqual(curriculumPatch.brief, revisedUserBrief);
assert.deepEqual(curriculumPatch.outline, [{ id: 'm1' }]);
assert.deepEqual(curriculumPatch.failures, [{ moduleId: 'm1', topicId: 't1', error: 'retry me' }]);
assert.equal(curriculumPatch.failedCount, 1);
assert.equal(curriculumPatch.error, 'needs a look');
assert.deepEqual(curriculumPatch.reviewHistory, [{ action: 'revise_curriculum', feedback: 'Make it visual.' }]);
assert.deepEqual(curriculumPatch.review, { kind: 'curriculum', brief: curriculumBrief });

const partialPatch = jobPatchFromRow({
  ...baseRow,
  status: 'partial',
  topics_done: 8,
  topics_total: 10,
  failures: [
    { moduleId: 'm1', topicId: 't1', error: 'schema failed' },
    { moduleId: 'm1', topicId: 't2', error: 'api failed' }
  ],
  saved_course_id: 'generated-course'
});
assert.equal(partialPatch.status, 'partial');
assert.equal(partialPatch.topicsDone, 8);
assert.equal(partialPatch.topicsTotal, 10);
assert.equal(partialPatch.totalTopics, 10);
assert.equal(partialPatch.failedCount, 2);
assert.equal(partialPatch.savedCourseId, 'generated-course');
assert.equal(partialPatch.courseInstalled, false);

_installCourseFromRemote('generated-course', {
  config: { id: 'generated-course', title: 'Generated Course' },
  curriculum: { modules: [] },
  createdByUserId: 'user-owner',
  createdBy: 'owner@example.com',
  createdAt: Date.now(),
  updatedAt: Date.now()
});
const installedPartialPatch = jobPatchFromRow({
  ...baseRow,
  status: 'partial',
  topics_done: 8,
  topics_total: 10,
  failures: [{ moduleId: 'm1', topicId: 't1', error: 'schema failed' }],
  saved_course_id: 'generated-course'
});
assert.equal(installedPartialPatch.courseInstalled, false);
assert.equal(isSavedCourseInstalledForCurrentUser('generated-course'), false);

_installCourseFromRemote('other-account-course', {
  config: { id: 'other-account-course', title: 'Other Account Course' },
  curriculum: { modules: [] },
  createdByUserId: 'user-other',
  createdBy: 'other@example.com',
  createdAt: Date.now(),
  updatedAt: Date.now()
});
const otherAccountPatch = jobPatchFromRow({
  ...baseRow,
  status: 'completed',
  saved_course_id: 'other-account-course'
});
assert.equal(otherAccountPatch.courseInstalled, false);
assert.equal(isSavedCourseInstalledForCurrentUser('other-account-course'), false);

const researchPatch = jobPatchFromRow({
  ...baseRow,
  status: 'review_research',
  brief: {
    ...curriculumBrief,
    modules: [
      ...curriculumBrief.modules,
      { id: 'm2', title: 'CSS' }
    ]
  },
  research: { m1: { sources: [{ title: 'HTML reference' }] } }
});
assert.equal(researchPatch.review.kind, 'research');
assert.deepEqual(researchPatch.review.researchResults, [
  { mod: curriculumBrief.modules[0], bundle: { sources: [{ title: 'HTML reference' }] } },
  { mod: { id: 'm2', title: 'CSS' }, bundle: null }
]);

const brokenSourcePatch = jobPatchFromRow({
  ...baseRow,
  status: 'failed',
  error: 'Could not download PDF source.pdf: HTTP 404'
});
assert.equal(brokenSourcePatch.needsSourceReattach, true);
assert.equal(needsSourceReattachForRow({ status: 'failed', error: 'PDF "x" is not attached to this generation job.' }), true);
assert.equal(needsSourceReattachForRow({ status: 'timed_out', error: 'Could not download PDF x' }), false);
assert.equal(isBrokenSourceError('schema failed'), false);
assert.equal(isBrokenSourceError('Could not download PDF x'), true);

const missingKeyPatch = jobPatchFromRow({
  ...baseRow,
  status: 'timed_out',
  message: 'Automatic recovery is waiting for an Anthropic API key. Add one, then resume from the saved checkpoint.',
  error: 'No Anthropic API key on file. Set it in the account modal first.'
});
assert.equal(missingKeyPatch.status, 'timed_out');
assert.equal(missingKeyPatch.needsApiKey, true);
assert.equal(needsApiKeyForRow({ status: 'timed_out', error: 'Anthropic API key required' }), true);
assert.equal(needsApiKeyForRow({ status: 'partial', message: 'Generation is waiting for an Anthropic API key. Add one to your account, then resume from the saved checkpoint.' }), true);
assert.equal(needsApiKeyForRow({ status: 'review_curriculum', message: 'Review is waiting for an Anthropic API key. Add one to your account, then continue from this checkpoint.' }), true);
assert.equal(needsApiKeyForRow({ status: 'review_research', error: 'No Anthropic API key on file.' }), true);
assert.equal(needsApiKeyForRow({ status: 'timed_out', error: 'Missing API key' }), true);
assert.equal(needsApiKeyForRow({ status: 'timed_out', message: 'Generation is waiting for an Anthropic API key. Add one to your account, then restart from the saved request.' }), true);
assert.equal(needsApiKeyForRow({
  status: 'timed_out',
  error: 'Request failed before recovery could start.',
  message: 'Generation is waiting for an Anthropic API key. Add one to your account, then restart from the saved request.'
}), true);
assert.equal(needsApiKeyForRow({ status: 'running', error: 'Anthropic API key required' }), false);
assert.equal(isMissingApiKeyError('Automatic recovery is waiting for an Anthropic API key'), true);
assert.equal(isMissingApiKeyError('Review is waiting for an Anthropic API key. Add one to your account, then continue from this checkpoint.'), true);
assert.equal(isMissingApiKeyError('Generation is waiting for an Anthropic API key. Add one to your account, then restart from the saved request.'), true);
assert.equal(isMissingApiKeyError('Cloud generation timed out before checkpoint'), false);

const pendingRestartPatch = jobPatchFromRow({
  ...baseRow,
  status: 'timed_out',
  message: 'Generation is waiting for an Anthropic API key. Add one to your account, then restart from the saved request.',
  error: null
});
assert.equal(pendingRestartPatch.status, 'timed_out');
assert.equal(pendingRestartPatch.needsApiKey, true);
assert.equal(pendingRestartPatch.pendingRestart, true);
assert.equal(pendingRestartForRow({ status: 'failed', message: 'API key saved. Restart from the saved request.' }), true);
assert.equal(pendingRestartForRow({ status: 'timed_out', error: 'Generation is waiting for an Anthropic API key. Add one to your account, then restart from the saved request.' }), true);
assert.equal(pendingRestartForRow({ status: 'timed_out', message: 'Curriculum Designer is restarting from your saved request...' }), true);
assert.equal(pendingRestartForRow({ status: 'running', message: 'Restart from the saved request.' }), false);
assert.equal(pendingRestartForRow({ status: 'timed_out', message: 'API key saved. Resume from the saved checkpoint.' }), false);

assert.equal(shouldInstallSavedCourseForJobStatus('completed'), true);
assert.equal(shouldInstallSavedCourseForJobStatus('partial'), true);
assert.equal(shouldInstallSavedCourseForJobStatus('failed'), false);
assert.equal(shouldInstallSavedCourseForJobStatus('timed_out'), false);
assert.equal(shouldInstallSavedCourseForJobStatus('cancelled'), false);

console.log('cloud job row patch mapping verified');
