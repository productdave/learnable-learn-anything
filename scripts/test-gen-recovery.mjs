import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  autoRecoveryFailurePatch,
  autoRecoveryExhaustedPatch,
  AUTO_RECOVERY_EXHAUSTED_ERROR,
  checkpointForJob,
  canAutoRecover,
  hasPendingRestartIntent,
  isRecoverableStatus,
  isReviewStatus,
  MAX_AUTO_RECOVERY_ATTEMPTS,
  RECOVERABLE_STATUSES,
  recoveryCheckpointForJob,
  recoveryAttemptsFor,
  recoveryModeFor,
  recoveryStageFor,
  resumeModeFor,
  resumeStageFor,
  timeoutPatch
} from '../web/api/_lib/gen-recovery.mjs';
import { markRecoverableWaitingForApiKey } from '../web/api/gen/resume.js';
import { claimTimedOutJob, markRecoveryExhausted, markRecoveryWaitingForApiKey } from '../web/api/gen/sweep.js';

const root = process.cwd();
const resumeEndpoint = readFileSync(join(root, 'web/api/gen/resume.js'), 'utf8');
const sweepEndpoint = readFileSync(join(root, 'web/api/gen/sweep.js'), 'utf8');
const runnerEndpoint = readFileSync(join(root, 'web/api/_lib/gen-runner.mjs'), 'utf8');
const stageOne = runnerEndpoint.indexOf('// Stage 1 — brief.');
const stageTwo = runnerEndpoint.indexOf('// Stage 2 — research per module.');
assert.ok(stageOne >= 0 && stageTwo > stageOne,
  'Recovery source contract needs valid ordered Stage 1/2 anchors; update the extractor if stages move.');
const runnerBriefRecoveryBlock = runnerEndpoint.slice(stageOne, stageTwo);

const noCheckpoint = {
  status: 'timed_out',
  stage: 'intake',
  user_brief: { topic: 'Design systems' },
  extracted_urls: [{ url: 'https://example.com' }]
};

const curriculumCheckpoint = {
  status: 'failed',
  stage: 'intake',
  brief: { title: 'Design systems', modules: [] }
};

const researchCheckpoint = {
  status: 'timed_out',
  stage: 'research',
  brief: { title: 'Design systems', modules: [{ id: 'm1' }] },
  research: { m1: { key_concepts: ['tokens'] } }
};

const topicCheckpoint = {
  status: 'partial',
  stage: 'topics',
  brief: { title: 'Design systems', modules: [{ id: 'm1' }] },
  research: { m1: { key_concepts: ['tokens'] } },
  topics_by_key: { 'm1/t1': { id: 't1', title: 'Tokens' } },
  failures: [{ moduleId: 'm1', topicId: 't2' }],
  extracted_urls: [{ url: 'https://example.com' }]
};

assert.equal(resumeModeFor(noCheckpoint), 'curriculum');
assert.equal(resumeStageFor(noCheckpoint), 'intake');

assert.equal(resumeModeFor(curriculumCheckpoint), 'curriculum');
assert.equal(resumeStageFor(curriculumCheckpoint), 'intake');

assert.equal(resumeModeFor(researchCheckpoint), 'research');
assert.equal(resumeStageFor(researchCheckpoint), 'research');

assert.equal(resumeModeFor(topicCheckpoint), 'complete');
assert.equal(resumeStageFor(topicCheckpoint), 'topics');
assert.equal(hasPendingRestartIntent(topicCheckpoint), false);

const pendingRestartCheckpoint = {
  ...topicCheckpoint,
  status: 'timed_out',
  stage: 'topics',
  error: 'Missing API key',
  message: 'Generation is waiting for an Anthropic API key. Add one to your account, then restart from the saved request.'
};

assert.equal(hasPendingRestartIntent(pendingRestartCheckpoint), true);
assert.equal(hasPendingRestartIntent({
  ...pendingRestartCheckpoint,
  message: 'Curriculum Designer is restarting from your saved request...'
}), true);
assert.equal(recoveryModeFor(pendingRestartCheckpoint), 'curriculum');
assert.equal(recoveryStageFor(pendingRestartCheckpoint), 'intake');
assert.deepEqual(recoveryCheckpointForJob(pendingRestartCheckpoint), {
  extracted_urls: pendingRestartCheckpoint.extracted_urls
});
assert.equal(recoveryModeFor(topicCheckpoint), 'complete');
assert.equal(recoveryStageFor(topicCheckpoint), 'topics');

assert.deepEqual(checkpointForJob(topicCheckpoint), {
  stage: topicCheckpoint.stage,
  brief: topicCheckpoint.brief,
  research: topicCheckpoint.research,
  topics_by_key: topicCheckpoint.topics_by_key,
  failures: topicCheckpoint.failures,
  extracted_urls: topicCheckpoint.extracted_urls,
  saved_course_id: null,
  image_progress: null,
  design_progress: null
});

const imageCheckpoint = { ...topicCheckpoint, stage: 'images', saved_course_id: 'saved-draft',
  image_progress: { version: 1, planned: 2, completed: 1, omitted: 1,
    items: { 'm1/t1': { status: 'saved', operationId: 'same-immutable-attempt' } } } };
assert.equal(resumeStageFor(imageCheckpoint), 'images');
assert.equal(resumeModeFor(imageCheckpoint), 'complete');
assert.equal(checkpointForJob(imageCheckpoint).saved_course_id, 'saved-draft');
assert.deepEqual(checkpointForJob(imageCheckpoint).image_progress, imageCheckpoint.image_progress);

assert.deepEqual(RECOVERABLE_STATUSES, ['failed', 'timed_out', 'partial']);
assert.equal(isRecoverableStatus('timed_out'), true);
assert.equal(isRecoverableStatus('review_curriculum'), false);
assert.equal(isReviewStatus('review_curriculum'), true);
assert.equal(isReviewStatus('review_research'), true);
assert.equal(isReviewStatus('failed'), false);

assert.equal(MAX_AUTO_RECOVERY_ATTEMPTS, 2);
assert.equal(recoveryAttemptsFor({ recovery_attempts: 0 }), 0);
assert.equal(recoveryAttemptsFor({ recovery_attempts: '2' }), 2);
assert.equal(canAutoRecover({ status: 'timed_out', recovery_attempts: 0 }), true);
assert.equal(canAutoRecover({ status: 'timed_out', recovery_attempts: 1 }), true);
assert.equal(canAutoRecover({ status: 'timed_out', recovery_attempts: 2 }), false);
assert.equal(canAutoRecover({ status: 'failed', recovery_attempts: 0 }), false);
assert.deepEqual(
  autoRecoveryFailurePatch(
    { status: 'timed_out', recovery_attempts: 0 },
    new Error('Function exited before completion.'),
    '2026-06-28T00:01:00.000Z'
  ),
  {
    status: 'timed_out',
    recovery_attempts: 1,
    error: 'Function exited before completion.',
    message: 'Automatic recovery attempt failed. Learnable will retry from the saved checkpoint.',
    heartbeat_at: '2026-06-28T00:01:00.000Z',
    updated_at: '2026-06-28T00:01:00.000Z',
    completed_at: '2026-06-28T00:01:00.000Z'
  }
);
assert.deepEqual(
  autoRecoveryFailurePatch(
    { status: 'timed_out', recovery_attempts: 1 },
    new Error('Still timing out.'),
    '2026-06-28T00:02:00.000Z'
  ),
  {
    status: 'timed_out',
    recovery_attempts: 2,
    error: 'Still timing out.',
    message: 'Automatic recovery paused after repeated recovery attempts. You can manually resume from the saved checkpoint.',
    heartbeat_at: '2026-06-28T00:02:00.000Z',
    updated_at: '2026-06-28T00:02:00.000Z',
    completed_at: '2026-06-28T00:02:00.000Z'
  }
);
assert.deepEqual(
  autoRecoveryFailurePatch(
    {
      ...pendingRestartCheckpoint,
      recovery_attempts: 0
    },
    new Error('Restart still timing out.'),
    '2026-06-28T00:03:00.000Z'
  ),
  {
    status: 'timed_out',
    recovery_attempts: 1,
    error: 'Restart still timing out.',
    message: 'Automatic recovery attempt failed. Learnable will retry from the saved request.',
    heartbeat_at: '2026-06-28T00:03:00.000Z',
    updated_at: '2026-06-28T00:03:00.000Z',
    completed_at: '2026-06-28T00:03:00.000Z'
  }
);
assert.deepEqual(
  autoRecoveryExhaustedPatch(
    pendingRestartCheckpoint,
    '2026-06-28T00:04:00.000Z'
  ),
  {
    message: 'Automatic recovery paused after repeated recovery attempts. You can manually restart from the saved request.',
    error: 'Automatic cloud recovery reached its retry limit.',
    updated_at: '2026-06-28T00:04:00.000Z'
  }
);
assert.deepEqual(timeoutPatch('2026-06-28T00:00:00.000Z'), {
  status: 'timed_out',
  message: 'Generation timed out. You can resume from the latest checkpoint.',
  error: 'Cloud generation timed out before the next checkpoint.',
  updated_at: '2026-06-28T00:00:00.000Z',
  completed_at: '2026-06-28T00:00:00.000Z'
});
assert.deepEqual(timeoutPatch(
  {
    message: 'Curriculum Designer is restarting from your saved request...'
  },
  '2026-06-28T00:05:00.000Z'
), {
  status: 'timed_out',
  message: 'Generation timed out while restarting. You can restart from the saved request.',
  error: 'Cloud restart timed out before the next checkpoint.',
  updated_at: '2026-06-28T00:05:00.000Z',
  completed_at: '2026-06-28T00:05:00.000Z'
});

assert.ok(resumeEndpoint.includes('stage: resumeStageFor(job)'));
assert.ok(resumeEndpoint.indexOf('stage: resumeStageFor(job)') < resumeEndpoint.indexOf("message: agentMessage(resumeStageFor(job)"));
assert.ok(
  resumeEndpoint.indexOf('if (isReviewStatus(job.status))') < resumeEndpoint.indexOf('apiKey = await readApiKey'),
  'manual resume should reject human-review jobs before reading the API key.'
);
assert.ok(
  resumeEndpoint.indexOf('if (!isRecoverableStatus(job.status))') < resumeEndpoint.indexOf('apiKey = await readApiKey'),
  'manual resume should reject non-recoverable jobs before reading the API key.'
);
assert.ok(
  resumeEndpoint.indexOf('apiKey = await readApiKey') < resumeEndpoint.indexOf(".from('generation_jobs').update"),
  'manual resume should verify API key availability before mutating generation_jobs.'
);
assert.ok(
  resumeEndpoint.includes('await markRecoverableWaitingForApiKey(supabase, jobId, user.id, job.status, job.run_id') &&
  resumeEndpoint.includes('export async function markRecoverableWaitingForApiKey') &&
  resumeEndpoint.includes('Generation is waiting for an Anthropic API key. Add one to your account, then resume from the saved checkpoint.') &&
  resumeEndpoint.includes(".eq('status', expectedStatus)") &&
  resumeEndpoint.includes('sameRunFilter(query, expectedRunId)') &&
  resumeEndpoint.includes(".select('id')") &&
  resumeEndpoint.includes('.maybeSingle()') &&
  resumeEndpoint.includes('if (!marked) return res.status(409)'),
  'manual resume should persist missing-key recovery context while keeping the job recoverable.'
);
assert.ok(
  resumeEndpoint.includes(".eq('status', job.status)") &&
  resumeEndpoint.includes('sameRunFilter(transitionQuery, job.run_id)') &&
  !resumeEndpoint.includes(".in('status', RECOVERABLE_STATUSES)") &&
  resumeEndpoint.includes("if (!transition) return res.status(409)"),
  'manual resume should only claim the exact recoverable status and run it inspected.'
);
assert.ok(sweepEndpoint.includes('const stage = recoveryStageFor(job);'));
assert.ok(sweepEndpoint.indexOf('const stage = recoveryStageFor(job);') < sweepEndpoint.indexOf('message: pendingRestart'));
assert.ok(
  runnerBriefRecoveryBlock.includes("if (mode === 'curriculum') {") &&
  runnerBriefRecoveryBlock.includes("status: 'review_curriculum'") &&
  runnerBriefRecoveryBlock.includes('Review the curriculum direction before research starts.') &&
  runnerBriefRecoveryBlock.indexOf("if (mode === 'curriculum') {") <
    runnerBriefRecoveryBlock.indexOf('await patch({ stage: \'research\', message:'),
  'runner should recover an existing curriculum checkpoint back to human review instead of continuing into research.'
);
assert.ok(sweepEndpoint.includes('timeoutPatch(row, now)'));
assert.ok(
  sweepEndpoint.includes('async function preflightRecoveryCredentials') &&
  sweepEndpoint.includes('await preflightRecoveryCredentials(supabase, job, requestBudget)') &&
  sweepEndpoint.indexOf('await preflightRecoveryCredentials(supabase, job, requestBudget)') < sweepEndpoint.indexOf('await claimTimedOutJob(supabase, job)') &&
  sweepEndpoint.includes('requestBudget.assertCanStart();\n      const claim') &&
  sweepEndpoint.includes('requestBudget: requestBudget.fork(), runGeneration'),
  'cron sweep should bound credential checks before exact-run claims and give jobs independent stop states on the same request clock.'
);
assert.ok(
  sweepEndpoint.includes('markRecoveryWaitingForApiKey') &&
  sweepEndpoint.includes('Automatic recovery is waiting for an Anthropic API key') &&
  sweepEndpoint.includes(".eq('status', 'timed_out')") &&
  sweepEndpoint.includes('sameRunFilter(query, job.run_id)') &&
  sweepEndpoint.includes('const marked = await markRecoveryWaitingForApiKey') &&
  sweepEndpoint.includes("console.warn(`[/api/gen/sweep] skipped missing-key marker for changed job ${job.id}`)") &&
  sweepEndpoint.includes(".select('id')") &&
  sweepEndpoint.includes('.maybeSingle()'),
  'cron sweep should keep no-key jobs timed_out and manually resumable.'
);
assert.ok(
  sweepEndpoint.includes('export async function claimTimedOutJob') &&
  sweepEndpoint.includes('export async function markRecoveryWaitingForApiKey') &&
  sweepEndpoint.includes('sameRunFilter(query, job.run_id)') &&
  sweepEndpoint.includes('hasPendingRestartIntent(job)') &&
  sweepEndpoint.includes('recoveryCheckpointForJob(job)') &&
  sweepEndpoint.includes('recoveryModeFor(job)'),
  'cron sweep should status-and-run guard timed-out recovery claims and preserve pending restart intent.'
);
assert.ok(
    sweepEndpoint.includes('autoRecoveryFailurePatch(job, err)') &&
    sweepEndpoint.includes('autoRecoveryExhaustedPatch(row, now)') &&
    sweepEndpoint.includes("const RECOVERY_WRITABLE_STATUSES = ['running', 'failed'];") &&
  sweepEndpoint.includes(".eq('run_id', runId)") &&
  sweepEndpoint.includes(".in('status', RECOVERY_WRITABLE_STATUSES)") &&
  !sweepEndpoint.includes("message: 'Cloud recovery failed. You can retry from the saved checkpoint.'"),
  'cron sweep should keep failed automatic recovery attempts timed_out for retry/manual resume.'
);

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

function supabaseSweepMock({ data = { id: 'job-1' }, error = null } = {}) {
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

function supabaseExhaustedMock(rows = []) {
  const calls = [];
  const updates = [];
  let mode = 'select';
  const filters = {};
  const chain = {
    select(columns) {
      calls.push({ type: 'select', columns });
      return chain;
    },
    update(patch) {
      calls.push({ type: 'update', patch });
      updates.push(patch);
      mode = 'update';
      return chain;
    },
    eq(field, value) {
      calls.push({ type: 'eq', field, value });
      filters[field] = value;
      return chain;
    },
    is(field, value) {
      calls.push({ type: 'is', field, value });
      filters[field] = value;
      return chain;
    },
    gte(field, value) {
      calls.push({ type: 'gte', field, value });
      filters[field] = { op: 'gte', value };
      return chain;
    },
    neq(field, value) {
      calls.push({ type: 'neq', field, value });
      filters[field] = { op: 'neq', value };
      return chain;
    },
    maybeSingle() {
      calls.push({ type: 'maybeSingle' });
      const row = rows.find(candidate => matchesFilters(candidate, filters));
      return Promise.resolve({ data: row ? { id: row.id } : null, error: null });
    },
    then(resolve, reject) {
      if (mode === 'select') return Promise.resolve({ data: rows.filter(row => matchesFilters(row, filters)), error: null }).then(resolve, reject);
      return Promise.resolve({ data: null, error: null }).then(resolve, reject);
    }
  };
  function matchesFilters(candidate, filters) {
    for (const [field, value] of Object.entries(filters)) {
      if (value && typeof value === 'object') {
        if (value.op === 'neq') {
          if (candidate[field] === value.value) return false;
          continue;
        }
        if (value.op === 'gte') {
          if (!(candidate[field] >= value.value)) return false;
          continue;
        }
      }
      if (candidate[field] !== value) return false;
    }
    return true;
  }
  return {
    calls,
    updates,
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
  const marked = await markRecoverableWaitingForApiKey(
    client,
    'job-1',
    'owner-1',
    'timed_out',
    'run-original',
    'Missing API key'
  );
  assert.equal(marked, true);
  assert.deepEqual(calls.filter(call => call.type === 'eq'), [
    { type: 'eq', field: 'id', value: 'job-1' },
    { type: 'eq', field: 'owner_id', value: 'owner-1' },
    { type: 'eq', field: 'status', value: 'timed_out' },
    { type: 'eq', field: 'run_id', value: 'run-original' }
  ]);
}

{
  const { client } = supabaseUpdateMock({ data: null });
  const marked = await markRecoverableWaitingForApiKey(
    client,
    'job-1',
    'owner-1',
    'timed_out',
    'run-original',
    'Missing API key'
  );
  assert.equal(marked, false);
}

{
  const { client, calls } = supabaseUpdateMock();
  await markRecoverableWaitingForApiKey(
    client,
    'job-1',
    'owner-1',
    'failed',
    null,
    'Missing API key'
  );
  assert.deepEqual(calls.filter(call => call.type === 'is'), [
    { type: 'is', field: 'run_id', value: null }
  ]);
}

{
  const { client, calls } = supabaseSweepMock();
  const claim = await claimTimedOutJob(client, {
    id: 'job-1',
    owner_id: 'owner-1',
    run_id: 'run-timed-out',
    stage: 'research',
    status: 'timed_out',
    recovery_attempts: 0,
    brief: { modules: [] }
  });
  assert.equal(typeof claim.runId, 'string');
  assert.ok(calls.some(call => call.type === 'eq' && call.field === 'run_id' && call.value === 'run-timed-out'));
}

{
  const { client, calls } = supabaseSweepMock();
  const claim = await claimTimedOutJob(client, {
    id: 'job-1',
    owner_id: 'owner-1',
    run_id: 'run-pending-restart',
    stage: 'topics',
    status: 'timed_out',
    recovery_attempts: 0,
    user_brief: { topic: 'Design systems' },
    extracted_urls: [{ url: 'https://example.com', text: 'Already fetched' }],
    brief: { modules: [{ id: 'm1' }] },
    research: { m1: {} },
    topics_by_key: { 'm1/t1': {} },
    error: 'Missing API key',
    message: 'Generation is waiting for an Anthropic API key. Add one to your account, then restart from the saved request.'
  });
  assert.equal(typeof claim.runId, 'string');
  const update = calls.find(call => call.type === 'update');
  assert.equal(update.patch.stage, 'intake');
  assert.equal(update.patch.brief, null);
  assert.equal(update.patch.outline, null);
  assert.deepEqual(update.patch.research, {});
  assert.deepEqual(update.patch.topics_by_key, {});
  assert.deepEqual(update.patch.extracted_urls, [{ url: 'https://example.com', text: 'Already fetched' }]);
  assert.match(update.patch.message, /restarting from the saved request/i);
}

{
  const { client, calls } = supabaseSweepMock();
  const marked = await markRecoveryWaitingForApiKey(client, {
    id: 'job-1',
    owner_id: 'owner-1',
    run_id: null
  }, 'Missing API key');
  assert.equal(marked, true);
  assert.ok(calls.some(call => call.type === 'is' && call.field === 'run_id' && call.value === null));
}

{
  const { client, calls } = supabaseSweepMock();
  const marked = await markRecoveryWaitingForApiKey(client, {
    id: 'job-1',
    owner_id: 'owner-1',
    run_id: 'run-pending-restart',
    message: 'Generation is waiting for an Anthropic API key. Add one to your account, then restart from the saved request.'
  }, 'Missing API key');
  assert.equal(marked, true);
  const update = calls.find(call => call.type === 'update');
  assert.equal(update.patch.message, 'Automatic recovery is waiting for an Anthropic API key. Add one, then restart from the saved request.');
}

{
  const { client, calls, updates } = supabaseExhaustedMock([
    {
      id: 'job-resume',
      owner_id: 'owner-1',
      run_id: 'run-resume',
      status: 'timed_out',
      recovery_attempts: MAX_AUTO_RECOVERY_ATTEMPTS,
      message: 'Generation timed out. You can resume from the latest checkpoint.'
    },
    {
      id: 'job-restart',
      owner_id: 'owner-1',
      run_id: null,
      status: 'timed_out',
      recovery_attempts: MAX_AUTO_RECOVERY_ATTEMPTS,
      message: 'API key saved. Restart from the saved request.'
    },
    {
      id: 'job-already-exhausted',
      owner_id: 'owner-1',
      run_id: 'run-old',
      status: 'timed_out',
      recovery_attempts: MAX_AUTO_RECOVERY_ATTEMPTS,
      error: AUTO_RECOVERY_EXHAUSTED_ERROR,
      message: 'Automatic recovery paused after repeated recovery attempts. You can manually resume from the saved checkpoint.'
    }
  ]);
  const exhausted = await markRecoveryExhausted(client);
  assert.deepEqual(exhausted, ['job-resume', 'job-restart']);
  assert.equal(updates[0].message, 'Automatic recovery paused after repeated recovery attempts. You can manually resume from the saved checkpoint.');
  assert.equal(updates[1].message, 'Automatic recovery paused after repeated recovery attempts. You can manually restart from the saved request.');
  assert.ok(calls.some(call => call.type === 'eq' && call.field === 'run_id' && call.value === 'run-resume'));
  assert.ok(calls.some(call => call.type === 'is' && call.field === 'run_id' && call.value === null));
  assert.equal(
    calls.filter(call => call.type === 'neq' && call.field === 'error' && call.value === AUTO_RECOVERY_EXHAUSTED_ERROR).length,
    3
  );
}

console.log('gen recovery policy tests passed');
