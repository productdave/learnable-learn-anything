import assert from 'node:assert/strict';
import {
  clearResearchFailure,
  clearTopicFailure,
  failureKey,
  pruneResolvedFailures,
  replaceResearchFailure,
  replaceTopicFailure,
  researchFailureKey,
  topicFailureKey
} from '../web/api/_lib/gen-failures.mjs';

const oldFailure = { moduleId: 'm1', topicId: 't1', error: 'first fail' };
const otherFailure = { moduleId: 'm1', topicId: 't2', error: 'still failing' };
const researchFailure = { moduleId: 'm2', stage: 'research', error: 'research failed' };

assert.equal(topicFailureKey('m1', 't1'), 'm1/t1');
assert.equal(researchFailureKey('m2'), 'm2/__research__');
assert.equal(failureKey(oldFailure), 'm1/t1');
assert.equal(failureKey(researchFailure), 'm2/__research__');

assert.deepEqual(
  pruneResolvedFailures([oldFailure, otherFailure, researchFailure], { 'm1/t1': { title: 'Recovered' } }),
  [otherFailure, researchFailure]
);

assert.deepEqual(
  pruneResolvedFailures(
    [oldFailure, otherFailure, researchFailure],
    { 'm1/t1': { title: 'Recovered' } },
    { m2: { key_concepts: ['Recovered research'] } }
  ),
  [otherFailure]
);

assert.deepEqual(
  clearTopicFailure([oldFailure, otherFailure], 'm1', 't1'),
  [otherFailure]
);

assert.deepEqual(
  replaceTopicFailure([oldFailure, otherFailure], { moduleId: 'm1', topicId: 't1', error: 'latest fail' }),
  [otherFailure, { moduleId: 'm1', topicId: 't1', error: 'latest fail' }]
);

assert.deepEqual(
  clearResearchFailure([oldFailure, researchFailure], 'm2'),
  [oldFailure]
);

assert.deepEqual(
  replaceResearchFailure([oldFailure, researchFailure], { moduleId: 'm2', moduleTitle: 'Research module', error: 'latest research fail' }),
  [oldFailure, { moduleId: 'm2', moduleTitle: 'Research module', error: 'latest research fail', stage: 'research', kind: 'research' }]
);

console.log('gen failure checkpoint tests passed');
