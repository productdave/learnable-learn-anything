import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildReviewTransition, latestReviewFeedback, updateJobFromStatus } from '../web/api/gen/review.js';

const lease = {
  heartbeat_at: '2026-06-27T00:00:00.000Z',
  lease_expires_at: '2026-06-27T00:06:00.000Z',
  updated_at: '2026-06-27T00:00:00.000Z',
  completed_at: null
};

const brief = {
  id: 'ai-agents',
  title: 'AI Agents',
  subtitle: 'Build useful agentic workflows',
  modules: [
    {
      id: 'm1',
      title: 'Foundations',
      topics: [
        { id: 't1', title: 'What agents are' },
        { id: 't2', title: 'Tool use' }
      ]
    },
    {
      id: 'm2',
      title: 'Practice',
      topics: [{ id: 't3', title: 'Design a workflow' }]
    }
  ]
};

const reviewHistory = [{ action: 'previous', from_status: 'review_curriculum' }];
const sourceUrls = [{ url: 'https://example.com', text: 'source text' }];
const userBrief = {
  topic: 'AI agents',
  source_text: 'Original notes',
  source_urls: ['https://example.com'],
  pdfRefs: [{ storage_path: 'owner/job/file.pdf' }]
};

{
  const transition = buildReviewTransition({
    action: 'approve_curriculum',
    job: {
      status: 'review_curriculum',
      brief,
      user_brief: userBrief,
      review_history: reviewHistory,
      extracted_urls: sourceUrls
    },
    feedback: 'Make it more applied.',
    runId: 'run-approve-curriculum',
    lease
  });

  assert.equal(transition.expectedStatus, 'review_curriculum');
  assert.equal(transition.runnerMode, 'research');
  assert.equal(transition.patch.status, 'running');
  assert.equal(transition.patch.stage, 'research');
  assert.equal(transition.patch.run_id, 'run-approve-curriculum');
  assert.equal(transition.patch.brief.human_feedback, 'Make it more applied.');
  assert.deepEqual(transition.patch.research, {});
  assert.deepEqual(transition.patch.topics_by_key, {});
  assert.deepEqual(transition.patch.failures, []);
  assert.equal(transition.patch.topics_total, 3);
  assert.equal(transition.patch.completed_at, null);
  assert.deepEqual(transition.checkpoint.extracted_urls, sourceUrls);
  assert.equal(transition.checkpoint.brief.human_feedback, 'Make it more applied.');
  assert.equal(transition.patch.review_history.at(-1).action, 'approve_curriculum');
  assert.equal(transition.patch.review_history.at(-1).run_id, 'run-approve-curriculum');
}

{
  const transition = buildReviewTransition({
    action: 'revise_curriculum',
    job: {
      status: 'review_curriculum',
      brief,
      user_brief: userBrief,
      review_history: reviewHistory,
      research: { stale: true },
      topics_by_key: { stale: true },
      failures: [{ error: 'stale' }],
      extracted_urls: sourceUrls
    },
    feedback: 'Avoid vague theory.',
    runId: 'run-revise-curriculum',
    lease
  });

  assert.equal(transition.expectedStatus, 'review_curriculum');
  assert.equal(transition.runnerMode, 'curriculum');
  assert.equal(transition.patch.stage, 'intake');
  assert.equal(transition.patch.brief, null);
  assert.equal(transition.patch.outline, null);
  assert.deepEqual(transition.patch.research, {});
  assert.deepEqual(transition.patch.topics_by_key, {});
  assert.deepEqual(transition.patch.failures, []);
  assert.equal(transition.patch.topics_total, 0);
  assert.ok(transition.patch.user_brief.source_text.includes('Avoid vague theory.'));
  assert.equal(transition.runnerRow.user_brief, transition.patch.user_brief);
  assert.deepEqual(transition.checkpoint, { extracted_urls: sourceUrls });
  assert.equal(transition.patch.review_history.at(-1).action, 'revise_curriculum');
}

{
  const transition = buildReviewTransition({
    action: 'approve_research',
    job: {
      status: 'review_research',
      brief,
      user_brief: userBrief,
      review_history: [],
      research: {
        m1: { key_concepts: ['agents'] },
        m2: { key_concepts: ['workflow'] }
      },
      topics_by_key: { 'm1/t1': { body: 'done' } },
      failures: [{ topicId: 't2', error: 'retry later' }],
      extracted_urls: sourceUrls
    },
    feedback: 'Keep the lessons hands-on.',
    runId: 'run-approve-research',
    lease
  });

  assert.equal(transition.expectedStatus, 'review_research');
  assert.equal(transition.runnerMode, 'complete');
  assert.equal(transition.patch.stage, 'topics');
  assert.equal(transition.patch.topics_done, 1);
  assert.equal(transition.patch.topics_total, 3);
  assert.equal(transition.patch.brief.human_feedback, 'Keep the lessons hands-on.');
  assert.deepEqual(transition.checkpoint.research, {
    m1: { key_concepts: ['agents'] },
    m2: { key_concepts: ['workflow'] }
  });
  assert.deepEqual(transition.checkpoint.topics_by_key, { 'm1/t1': { body: 'done' } });
  assert.equal(transition.patch.review_history.at(-1).action, 'approve_research');
}

{
  const transition = buildReviewTransition({
    action: 'rerun_research',
    job: {
      status: 'review_research',
      brief,
      user_brief: userBrief,
      review_history: [],
      research: { stale: true },
      topics_by_key: { stale: true },
      failures: [{ error: 'stale' }],
      extracted_urls: sourceUrls
    },
    feedback: 'Use more primary sources.',
    runId: 'run-rerun-research',
    lease
  });

  assert.equal(transition.expectedStatus, 'review_research');
  assert.equal(transition.runnerMode, 'research');
  assert.equal(transition.patch.stage, 'research');
  assert.deepEqual(transition.patch.research, {});
  assert.deepEqual(transition.patch.topics_by_key, {});
  assert.deepEqual(transition.patch.failures, []);
  assert.equal(transition.patch.topics_done, 0);
  assert.equal(transition.patch.topics_total, 3);
  assert.equal(transition.checkpoint.brief.human_feedback, 'Use more primary sources.');
  assert.deepEqual(transition.checkpoint.extracted_urls, sourceUrls);
}

{
  assert.equal(latestReviewFeedback([
    { action: 'approve_curriculum', from_status: 'review_curriculum', feedback: 'Use concrete examples.' },
    { action: 'approve_curriculum', from_status: 'review_curriculum', feedback: '' }
  ], 'approve_curriculum', 'review_curriculum'), 'Use concrete examples.');
  assert.equal(latestReviewFeedback([
    { action: 'approve_curriculum', from_status: 'review_curriculum', feedback: 'Wrong checkpoint.' },
    { action: 'approve_research', from_status: 'review_research', feedback: 'Keep citations close.' }
  ], 'approve_research', 'review_research'), 'Keep citations close.');
  assert.equal(latestReviewFeedback([
    { action: 'approve_curriculum', from_status: 'review_curriculum', feedback: 'Do not reuse this.' }
  ], 'approve_curriculum', 'review_research'), '');
}

{
  const transition = buildReviewTransition({
    action: 'approve_curriculum',
    job: {
      status: 'review_curriculum',
      brief,
      user_brief: userBrief,
      review_history: [
        {
          action: 'approve_curriculum',
          from_status: 'review_curriculum',
          feedback: 'Saved pending review feedback.',
          run_id: 'pending-review'
        }
      ],
      extracted_urls: sourceUrls
    },
    feedback: '',
    runId: 'actual-review-run',
    lease
  });

  assert.equal(transition.patch.brief.human_feedback, 'Saved pending review feedback.');
  assert.equal(transition.checkpoint.brief.human_feedback, 'Saved pending review feedback.');
  assert.equal(transition.patch.review_history.length, 1);
  assert.equal(transition.patch.review_history.at(-1).feedback, 'Saved pending review feedback.');
  assert.equal(transition.patch.review_history.at(-1).run_id, 'actual-review-run');
}

{
  const transition = buildReviewTransition({
    action: 'revise_curriculum',
    job: {
      status: 'review_curriculum',
      brief,
      user_brief: userBrief,
      review_history: [
        {
          action: 'revise_curriculum',
          from_status: 'review_curriculum',
          feedback: 'Saved pending revision feedback.',
          run_id: 'pending-review'
        }
      ],
      extracted_urls: sourceUrls
    },
    feedback: '',
    runId: 'actual-revision-run',
    lease
  });

  assert.ok(transition.patch.user_brief.source_text.includes('Saved pending revision feedback.'));
  assert.equal(transition.patch.review_history.length, 1);
  assert.equal(transition.patch.review_history.at(-1).feedback, 'Saved pending revision feedback.');
  assert.equal(transition.patch.review_history.at(-1).run_id, 'actual-revision-run');
}

assert.throws(
  () => buildReviewTransition({ action: 'approve_research', job: { status: 'review_research', brief, research: { m1: {} } } }),
  /Research is incomplete/
);
assert.throws(
  () => buildReviewTransition({ action: 'approve_curriculum', job: { status: 'running', brief } }),
  /Curriculum is not waiting/
);
assert.throws(
  () => buildReviewTransition({ action: 'made_up', job: { status: 'review_curriculum', brief } }),
  /Unknown action/
);

{
  const reviewSource = readFileSync(join(process.cwd(), 'web/api/gen/review.js'), 'utf8');
  const transitionIndex = reviewSource.indexOf('transition = buildReviewTransition');
  const apiKeyIndex = reviewSource.indexOf('apiKey = await readApiKey');
  const claimIndex = reviewSource.indexOf('updateJobFromStatus');
  assert.ok(transitionIndex > -1, 'review handler should build/validate the transition.');
  assert.ok(apiKeyIndex > -1, 'review handler should read the API key.');
  assert.ok(claimIndex > -1, 'review handler should status-claim the job.');
  assert.ok(
    transitionIndex < apiKeyIndex,
    'review handler should reject stale/invalid review actions before reading the API key.'
  );
  assert.ok(
    apiKeyIndex < claimIndex,
    'review handler should verify the API key before mutating generation_jobs.'
  );
}

function supabaseUpdateMock({ data = { id: 'job-1' }, error = null } = {}) {
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
      return Promise.resolve({ data, error });
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
  const result = await updateJobFromStatus(
    client,
    'job-1',
    'owner-1',
    'review_curriculum',
    'checkpoint-run',
    { status: 'running', run_id: 'run-1' }
  );
  assert.deepEqual(result, { ok: true });
  assert.deepEqual(calls.filter(call => call.type === 'eq'), [
    { type: 'eq', field: 'id', value: 'job-1' },
    { type: 'eq', field: 'owner_id', value: 'owner-1' },
    { type: 'eq', field: 'status', value: 'review_curriculum' },
    { type: 'eq', field: 'run_id', value: 'checkpoint-run' }
  ]);
}

{
  const { client, calls } = supabaseUpdateMock({ data: null });
  const result = await updateJobFromStatus(
    client,
    'job-1',
    'owner-1',
    'review_curriculum',
    'checkpoint-run',
    { status: 'running', run_id: 'run-1' }
  );
  assert.deepEqual(result, { ok: false, error: 'Job state changed. Refresh and try again.' });
  assert.ok(calls.some(call => call.type === 'eq' && call.field === 'status' && call.value === 'review_curriculum'));
}

{
  const { client, calls } = supabaseUpdateMock();
  await updateJobFromStatus(
    client,
    'job-1',
    'owner-1',
    'review_research',
    null,
    { status: 'running', run_id: 'run-2' }
  );
  assert.deepEqual(calls.filter(call => call.type === 'is'), [
    { type: 'is', field: 'run_id', value: null }
  ]);
}

console.log('gen review transition tests passed');
