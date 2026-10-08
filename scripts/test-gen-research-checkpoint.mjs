import assert from 'node:assert/strict';
import {
  hasCompleteResearchCheckpoint,
  isUsableResearchBundle,
  missingResearchModules
} from '../web/api/_lib/gen-research-checkpoint.mjs';

const brief = {
  modules: [
    { id: 'm1', title: 'Foundations' },
    { id: 'm2', title: 'Practice' }
  ]
};

assert.equal(isUsableResearchBundle({ key_concepts: ['state'] }), true);
assert.equal(isUsableResearchBundle({}), false);
assert.equal(isUsableResearchBundle(null), false);
assert.equal(isUsableResearchBundle([]), false);
assert.equal(isUsableResearchBundle(['malformed']), false);

assert.deepEqual(missingResearchModules(brief, {
  m1: { key_concepts: ['state'] },
  m2: { examples: ['demo'] }
}), []);

assert.deepEqual(missingResearchModules(brief, {
  m1: { key_concepts: ['state'] }
}).map(mod => mod.id), ['m2']);

assert.equal(hasCompleteResearchCheckpoint(brief, {
  m1: { key_concepts: ['state'] },
  m2: { examples: ['demo'] }
}), true);

assert.equal(hasCompleteResearchCheckpoint(brief, {
  m1: { key_concepts: ['state'] },
  m2: {}
}), false);

assert.equal(hasCompleteResearchCheckpoint({ modules: [] }, {}), false);

console.log('gen research checkpoint tests passed');
