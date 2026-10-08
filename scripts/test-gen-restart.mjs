import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  appendRestartFeedback,
  collectRestartHumanFeedback,
  dedupeFeedbackAlreadyInSource,
  latestRestartFeedback,
  markRestartWaitingForApiKey,
  mergeRestartBrief,
  restartCheckpointForBriefs,
  shouldReuseExtractedUrls
} from '../web/api/gen/restart.js';

const restartEndpoint = readFileSync(join(process.cwd(), 'web/api/gen/restart.js'), 'utf8');

const brief = {
  topic: 'AI agents',
  source_text: 'Original notes',
  source_urls: ['https://example.com/a'],
  pdfRefs: [
    { file_index: 0, name: 'brief.pdf', storage_path: 'user/job/0-brief.pdf' }
  ],
  depth: 'Solid foundation'
};

const unchanged = appendRestartFeedback(brief, '');
assert.equal(unchanged, brief);

const revised = appendRestartFeedback(brief, 'Use more product-management examples.');
assert.notEqual(revised, brief);
assert.equal(revised.topic, brief.topic);
assert.equal(revised.depth, brief.depth);
assert.equal(revised.source_urls, brief.source_urls);
assert.equal(revised.pdfRefs, brief.pdfRefs);
assert.equal(revised.source_text, 'Original notes\n\nRestart feedback:\nUse more product-management examples.');

const fromEmptySource = appendRestartFeedback({ topic: 'Design systems' }, 'Start with primitives.');
assert.equal(fromEmptySource.source_text, 'Restart feedback:\nStart with primitives.');

const withPriorFeedback = appendRestartFeedback(brief, 'Try again with fewer modules.', [
  'Approved curriculum with feedback: Make it more applied.',
  'Requested research revision: Use primary sources.'
].join('\n'));
assert.equal(
  withPriorFeedback.source_text,
  [
    'Original notes',
    'Prior human review feedback:\nApproved curriculum with feedback: Make it more applied.\nRequested research revision: Use primary sources.',
    'Restart feedback:\nTry again with fewer modules.'
  ].join('\n\n')
);

const repeatedRestart = appendRestartFeedback(
  withPriorFeedback,
  'Try again with fewer modules.',
  [
    'Approved curriculum with feedback: Make it more applied.',
    'Requested research revision: Use primary sources.'
  ].join('\n')
);
assert.equal(repeatedRestart, withPriorFeedback);

assert.equal(
  dedupeFeedbackAlreadyInSource(
    [
      'Original notes',
      'Prior human review feedback:',
      'Approved curriculum with feedback: Make it more applied.',
      'Restart feedback:',
      'Try again with fewer modules.'
    ].join('\n'),
    [
      'Approved curriculum with feedback: Make it more applied.',
      'Restart feedback: Try again with fewer modules.',
      'Requested research revision: Use primary sources.'
    ].join('\n')
  ),
  'Requested research revision: Use primary sources.'
);

const repeatedDurableRestart = appendRestartFeedback(
  {
    ...brief,
    source_text: 'Original notes\n\nRestart feedback:\nTry again with fewer modules.'
  },
  '',
  'Restart feedback: Try again with fewer modules.'
);
assert.equal(
  repeatedDurableRestart.source_text,
  'Original notes\n\nRestart feedback:\nTry again with fewer modules.'
);

assert.equal(
  latestRestartFeedback([
    { action: 'approve_curriculum', feedback: 'Make it more applied.' },
    { action: 'restart_generation', feedback: 'Try again with fewer modules.' },
    { action: 'restart_generation', feedback: '' }
  ]),
  'Try again with fewer modules.'
);
assert.equal(latestRestartFeedback([{ action: 'restart_generation', feedback: '   ' }]), '');

assert.equal(
  collectRestartHumanFeedback({
    reviewHistory: [
      { action: 'approve_curriculum', feedback: 'Make it more applied.' },
      { action: 'rerun_research', feedback: 'Use primary sources.' },
      { action: 'restart_generation', feedback: 'Try again with fewer modules.' },
      { action: 'approve_research', feedback: 'Use primary sources.' },
      { action: 'approve_research', feedback: 'Keep it practical.' },
      { action: 'approve_research', feedback: '' }
    ],
    checkpointBrief: {
      human_feedback: 'Make it more applied.\n\nAdd a final capstone.'
    }
  }),
  [
    'Approved curriculum with feedback: Make it more applied.',
    'Requested research revision: Use primary sources.',
    'Restart feedback: Try again with fewer modules.',
    'Approved research with feedback: Keep it practical.',
    'Add a final capstone.'
  ].join('\n')
);

const replacement = mergeRestartBrief(brief, {
  source_text: 'Replacement notes',
  source_urls: ['https://example.com/a'],
  pdfRefs: [
    { file_index: 0, name: 'fresh.pdf', storage_path: 'user/job/0-fresh.pdf' }
  ]
});
assert.equal(replacement.topic, brief.topic);
assert.equal(replacement.depth, brief.depth);
assert.equal(replacement.source_text, 'Replacement notes');
assert.deepEqual(replacement.source_urls, ['https://example.com/a']);
assert.deepEqual(replacement.pdfRefs, [
  { file_index: 0, name: 'fresh.pdf', storage_path: 'user/job/0-fresh.pdf' }
]);

const sparseReplacement = mergeRestartBrief(brief, {
  source_text: '',
  source_urls: [],
  pdfRefs: []
});
assert.equal(sparseReplacement.source_text, 'Original notes');
assert.deepEqual(sparseReplacement.source_urls, ['https://example.com/a']);
assert.deepEqual(sparseReplacement.pdfRefs, []);

assert.equal(
  shouldReuseExtractedUrls(
    { source_urls: ['https://example.com/b', ' https://example.com/a '] },
    { source_urls: ['https://example.com/a', 'https://example.com/b'] }
  ),
  true
);
assert.equal(
  shouldReuseExtractedUrls(
    { source_urls: ['https://example.com/a'] },
    { source_urls: ['https://example.com/new'] }
  ),
  false
);

const extractedUrls = [{ url: 'https://example.com/a', text: 'Existing extracted article' }];
assert.deepEqual(
  restartCheckpointForBriefs(
    { source_urls: ['https://example.com/a'] },
    { source_urls: ['https://example.com/a'] },
    extractedUrls
  ),
  { extracted_urls: extractedUrls }
);
assert.deepEqual(
  restartCheckpointForBriefs(
    { source_urls: ['https://example.com/a'] },
    { source_urls: ['https://example.com/new'] },
    extractedUrls
  ),
  { extracted_urls: [] }
);

assert.ok(
  restartEndpoint.indexOf('if (!RECOVERABLE_STATUSES.includes(job.status))') < restartEndpoint.indexOf('apiKey = await readApiKey'),
  'restart should reject non-recoverable jobs before reading the API key.'
);
assert.ok(
  restartEndpoint.indexOf('userBrief = appendRestartFeedback') < restartEndpoint.indexOf('apiKey = await readApiKey'),
  'restart should build the restart intent before reading the API key so missing-key feedback can be saved.'
);
assert.ok(
  restartEndpoint.indexOf('apiKey = await readApiKey') < restartEndpoint.indexOf("status: 'running'"),
  'restart should verify API key availability before claiming a running lease.'
);
assert.ok(
  restartEndpoint.includes(".eq('status', job.status)") &&
  restartEndpoint.includes('sameRunFilter(transitionQuery, job.run_id)') &&
  !restartEndpoint.includes(".in('status', RECOVERABLE_STATUSES)") &&
  restartEndpoint.includes("if (!transition) return res.status(409)"),
  'restart should only claim the exact recoverable status and run it inspected.'
);
assert.ok(
  restartEndpoint.includes('await markRestartWaitingForApiKey(supabase, jobId, user.id, job.status, job.run_id') &&
  restartEndpoint.includes('userBrief,') &&
  restartEndpoint.includes('extractedUrls: checkpoint.extracted_urls') &&
  restartEndpoint.includes('reviewHistory') &&
  restartEndpoint.includes('Generation is waiting for an Anthropic API key. Add one to your account, then restart from the saved request.') &&
  restartEndpoint.includes(".eq('status', expectedStatus)") &&
  restartEndpoint.includes('sameRunFilter(query, expectedRunId)') &&
  restartEndpoint.includes(".select('id')") &&
  restartEndpoint.includes('.maybeSingle()') &&
  restartEndpoint.includes('if (!marked) return res.status(409)'),
  'restart should persist a pending restart intent when the API key is missing.'
);
assert.ok(
  restartEndpoint.indexOf('checkpoint = restartCheckpointForBriefs') < restartEndpoint.indexOf("extracted_urls: checkpoint.extracted_urls"),
  'restart should preserve/recompute source extraction before writing the claim.'
);
assert.ok(
  restartEndpoint.includes('collectRestartHumanFeedback') && restartEndpoint.includes('job.review_history'),
  'restart should carry prior durable human checkpoint feedback into the restarted request.'
);
assert.ok(
  restartEndpoint.includes('appendReviewHistory') &&
  restartEndpoint.includes("action: 'restart_generation'") &&
  restartEndpoint.includes('feedback: restartFeedback') &&
  restartEndpoint.includes('fromStatus: job.status'),
  'restart should persist the human restart action in durable review history.'
);
assert.ok(
  restartEndpoint.includes('const restartFeedback = feedback || latestRestartFeedback(job.review_history)') &&
  restartEndpoint.includes('appendRestartFeedback(mergedBrief, restartFeedback, priorHumanFeedback)'),
  'restart should carry a saved pending restart feedback into the actual restarted run.'
);

function supabaseUpdateMock() {
  const calls = [];
  const chain = {
    update(patch) {
      calls.push({ type: 'update', patch });
      return chain;
    },
    eq(field, value) {
      calls.push({ type: 'eq', field, value });
      return chain;
    },
    is(field, value) {
      calls.push({ type: 'is', field, value });
      return chain;
    },
    select(columns) {
      calls.push({ type: 'select', columns });
      return chain;
    },
    maybeSingle() {
      calls.push({ type: 'maybeSingle' });
      return Promise.resolve({ data: { id: 'job-1' }, error: null });
    }
  };
  return {
    calls,
    client: {
      from(table) {
        calls.push({ type: 'from', table });
        return chain;
      }
    }
  };
}

{
  const { client, calls } = supabaseUpdateMock();
  const pendingUserBrief = {
    ...brief,
    source_text: 'Original notes\n\nRestart feedback:\nTry again with fewer modules.'
  };
  const pendingExtractedUrls = [{ url: 'https://example.com/a', text: 'Existing extracted article' }];
  const pendingReviewHistory = [{
    action: 'restart_generation',
    from_status: 'timed_out',
    feedback: 'Try again with fewer modules.',
    run_id: 'run-pending-restart'
  }];
  const marked = await markRestartWaitingForApiKey(client, 'job-1', 'owner-1', 'timed_out', 'run-pending-restart', 'Missing API key', {
    userBrief: pendingUserBrief,
    extractedUrls: pendingExtractedUrls,
    reviewHistory: pendingReviewHistory
  });
  assert.equal(marked, true);
  const update = calls.find(call => call.type === 'update');
  assert.equal(update.patch.error, 'Missing API key');
  assert.equal(update.patch.message, 'Generation is waiting for an Anthropic API key. Add one to your account, then restart from the saved request.');
  assert.deepEqual(update.patch.user_brief, pendingUserBrief);
  assert.deepEqual(update.patch.extracted_urls, pendingExtractedUrls);
  assert.deepEqual(update.patch.review_history, pendingReviewHistory);
  assert.equal(Object.hasOwn(update.patch, 'status'), false);
  assert.deepEqual(calls.filter(call => call.type === 'eq'), [
    { type: 'eq', field: 'id', value: 'job-1' },
    { type: 'eq', field: 'owner_id', value: 'owner-1' },
    { type: 'eq', field: 'status', value: 'timed_out' },
    { type: 'eq', field: 'run_id', value: 'run-pending-restart' }
  ]);
  assert.deepEqual(calls.filter(call => call.type === 'select'), [{ type: 'select', columns: 'id' }]);
  assert.equal(calls.some(call => call.type === 'maybeSingle'), true);
}

{
  const { client, calls } = supabaseUpdateMock();
  await markRestartWaitingForApiKey(client, 'job-1', 'owner-1', 'failed', null, 'Missing API key');
  assert.deepEqual(calls.filter(call => call.type === 'is'), [
    { type: 'is', field: 'run_id', value: null }
  ]);
}

console.log('gen restart policy tests passed');
