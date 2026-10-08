import assert from 'node:assert/strict';

const values = new Map();
globalThis.localStorage = {
  getItem(key) { return values.get(key) || null; },
  setItem(key, value) { values.set(key, String(value)); }
};

const { store } = await import('../web/js/store.js?test=practice');
store.setCourse('little-swimmer');
const key = 'little-swimmer/foundations/pool-safety-agreement/s01-safety-agreement';

assert.deepEqual(store.getPracticeProgress(key), { steps: {}, skills: {} });
store.savePracticeStep(key, 0, true);
store.savePracticeSkill(key, 'asks-permission', 'independent_consistently');

assert.equal(store.getPracticeProgress(key).steps[0], true);
assert.equal(store.getPracticeProgress(key).skills['asks-permission'], 'independent_consistently');
assert.ok(store.getPracticeProgress(key).updatedAt);

console.log('practice store tests passed');
