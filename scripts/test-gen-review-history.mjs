import assert from 'node:assert/strict';
import { appendReviewHistory } from '../web/api/_lib/gen-review-history.mjs';

const one = appendReviewHistory([], {
  action: 'revise_curriculum',
  feedback: 'More practical examples.',
  fromStatus: 'review_curriculum',
  runId: 'run-1',
  at: '2026-06-26T00:00:00.000Z'
});

assert.deepEqual(one, [{
  action: 'revise_curriculum',
  from_status: 'review_curriculum',
  feedback: 'More practical examples.',
  run_id: 'run-1',
  at: '2026-06-26T00:00:00.000Z'
}]);

const many = Array.from({ length: 55 }, (_, i) => ({ action: `a-${i}` }));
const capped = appendReviewHistory(many, { action: 'approve_research' });
assert.equal(capped.length, 50);
assert.equal(capped[0].action, 'a-6');
assert.equal(capped.at(-1).action, 'approve_research');

const deduped = appendReviewHistory([
  { action: 'previous', from_status: 'review_curriculum', feedback: 'Earlier', run_id: 'run-old' },
  {
    action: 'approve_curriculum',
    from_status: 'review_curriculum',
    feedback: 'Same direction',
    run_id: 'run-duplicate-old',
    at: '2026-06-26T00:00:00.000Z'
  }
], {
  action: 'approve_curriculum',
  feedback: '  Same direction  ',
  fromStatus: 'review_curriculum',
  runId: 'run-duplicate-new',
  at: '2026-06-26T00:01:00.000Z'
});

assert.equal(deduped.length, 2);
assert.equal(deduped.at(-1).run_id, 'run-duplicate-new');
assert.equal(deduped.at(-1).feedback, 'Same direction');

const restartDeduped = appendReviewHistory([
  {
    action: 'restart_generation',
    from_status: 'timed_out',
    feedback: 'Try again with fewer modules.',
    run_id: 'pending-run',
    at: '2026-06-26T00:00:00.000Z'
  }
], {
  action: 'restart_generation',
  feedback: 'Try again with fewer modules.',
  fromStatus: 'timed_out',
  runId: 'actual-run',
  at: '2026-06-26T00:02:00.000Z'
});
assert.equal(restartDeduped.length, 1);
assert.equal(restartDeduped[0].run_id, 'actual-run');

console.log('gen review history tests passed');
