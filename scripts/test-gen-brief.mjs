import assert from 'node:assert/strict';
import { outlineForBrief, topicCountForBrief } from '../web/api/_lib/gen-brief.mjs';

const brief = {
  title: 'Design Systems',
  subtitle: 'Tokens to components',
  modules: [
    { title: 'Foundations', topics: [{ id: 't1' }, { id: 't2' }] },
    { title: 'Practice', topics: [{ id: 't3' }] }
  ]
};

assert.equal(topicCountForBrief(brief), 3);
assert.equal(topicCountForBrief({ modules: [{ title: 'Empty' }] }), 0);
assert.deepEqual(outlineForBrief(brief), {
  title: 'Design Systems',
  subtitle: 'Tokens to components',
  modules: [
    { title: 'Foundations', topicCount: 2 },
    { title: 'Practice', topicCount: 1 }
  ]
});

console.log('gen brief metadata tests passed');
