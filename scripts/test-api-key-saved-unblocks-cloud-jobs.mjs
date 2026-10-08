import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { clearCredentialWaitsForUser, isMissingApiKeyText, isPendingRestartWait, recoverCredentialWaitsForUser } from '../web/api/gen/credentials-ready.js';

const root = process.cwd();
const app = readFileSync(join(root, 'web/js/app.js'), 'utf8');
const auth = readFileSync(join(root, 'web/js/auth.js'), 'utf8');
const cloud = readFileSync(join(root, 'web/js/cloud-gen-client.js'), 'utf8');
const intake = readFileSync(join(root, 'web/js/intake.js'), 'utf8');
const credentialsReady = readFileSync(join(root, 'web/api/gen/credentials-ready.js'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const keySubmitStart = auth.indexOf("body.querySelectorAll('.auth-keyform')");
const keySubmitEnd = auth.indexOf('});', keySubmitStart);
const keySubmitBlock = auth.slice(keySubmitStart, keySubmitEnd);
const apiKeySavedStart = app.indexOf("window.addEventListener('learnable-api-key-saved'");
const apiKeySavedEnd = app.indexOf('});', apiKeySavedStart);
const apiKeySavedBlock = app.slice(apiKeySavedStart, apiKeySavedEnd);

assert.ok(
  auth.includes("new CustomEvent('learnable-api-key-saved'") &&
    auth.includes('detail: { intent, jobId }') &&
    auth.includes('openAccount({ intent, jobId })'),
  'account modal should emit job-aware API-key-save events.'
);

assert.ok(
  keySubmitBlock.includes('let synced = false;') &&
    keySubmitBlock.indexOf('await flushSync();') < keySubmitBlock.indexOf("new CustomEvent('learnable-api-key-saved'") &&
    keySubmitBlock.includes("if (synced && provider === 'anthropic') {"),
  'account modal should only emit cloud job continuation events after the active Anthropic key sync succeeds.'
);

assert.ok(
    app.includes("window.addEventListener('learnable-api-key-saved'") &&
    app.includes('let refreshedAfterCredentialRecovery = false;') &&
    app.includes("const jobId = event.detail?.jobId || '';") &&
    app.includes('const result = await markCloudCredentialsReady(jobId);') &&
    app.includes('const cleared = Array.isArray(result?.cleared) ? result.cleared : [];') &&
    app.includes('const started = Array.isArray(result?.started) ? result.started : [];') &&
    app.includes('clearApiKeyWaitForCloudJobs(jobId, cleared);') &&
    app.includes('if (jobId && started.includes(jobId)) {') &&
    app.includes('await refreshCloudGenerationState();') &&
    app.includes('refreshedAfterCredentialRecovery = true;') &&
    app.includes("if (getJobLazy(jobId)?.runner === 'cloud') openIntakeForJob(jobId);") &&
    app.includes('} else if (jobId && cleared.includes(jobId)) {') &&
    app.includes('continueCloudJobAfterApiKeySaved') &&
    app.includes('if (!refreshedAfterCredentialRecovery) {') &&
    app.includes('refreshCloudGenerationState().catch(() => {});') &&
    app.includes('function clearApiKeyWaitForCloudJobs(preferredJobId = \'\', clearedJobIds = null)') &&
    app.includes('const hasClearedFilter = Array.isArray(clearedJobIds);') &&
    app.includes('if (hasClearedFilter && !cleared.has(job.id)) continue;') &&
    app.includes('job.runner !== \'cloud\' || !job.needsApiKey') &&
    app.includes('needsApiKey: false') &&
    app.includes('pendingRestart: isPendingRestartJob(job)') &&
    app.includes('API key saved. Continue from this checkpoint.') &&
    app.includes('API key saved. Retry missing topics from the saved checkpoint.') &&
    app.includes('API key saved. Resume from the saved checkpoint.') &&
    app.includes('API key saved. Restart from the saved request.'),
  'app should unblock cloud job cards after the user saves an API key.'
);

assert.ok(
  apiKeySavedBlock.indexOf('const result = await markCloudCredentialsReady(jobId);') < apiKeySavedBlock.indexOf('clearApiKeyWaitForCloudJobs(jobId, cleared);') &&
    apiKeySavedBlock.indexOf('clearApiKeyWaitForCloudJobs(jobId, cleared);') < apiKeySavedBlock.indexOf('if (jobId && started.includes(jobId)) {') &&
    apiKeySavedBlock.indexOf('if (jobId && started.includes(jobId)) {') < apiKeySavedBlock.indexOf('await refreshCloudGenerationState();') &&
    apiKeySavedBlock.indexOf('await refreshCloudGenerationState();') < apiKeySavedBlock.indexOf('refreshedAfterCredentialRecovery = true;') &&
    apiKeySavedBlock.indexOf('refreshedAfterCredentialRecovery = true;') < apiKeySavedBlock.indexOf("if (getJobLazy(jobId)?.runner === 'cloud') openIntakeForJob(jobId);") &&
    apiKeySavedBlock.indexOf("if (getJobLazy(jobId)?.runner === 'cloud') openIntakeForJob(jobId);") < apiKeySavedBlock.indexOf('} else if (jobId && cleared.includes(jobId)) {') &&
    apiKeySavedBlock.indexOf('} else if (jobId && cleared.includes(jobId)) {') < apiKeySavedBlock.indexOf('await continueCloudJobAfterApiKeySaved(jobId);'),
  'app should rehydrate server-started API-key recoveries instead of issuing a duplicate resume/restart.'
);

const continueAfterKeyStart = app.indexOf('async function continueCloudJobAfterApiKeySaved');
const continueAfterKeyEnd = app.indexOf('function isPendingRestartJob', continueAfterKeyStart);
const continueAfterKeyBlock = app.slice(continueAfterKeyStart, continueAfterKeyEnd);
assert.ok(
  continueAfterKeyBlock.includes('const job = getJobLazy(jobId);') &&
    continueAfterKeyBlock.includes("job.runner !== 'cloud'") &&
    continueAfterKeyBlock.includes("job.status === 'review_curriculum' || job.status === 'review_research'") &&
    continueAfterKeyBlock.includes('job.needsSourceReattach') &&
    continueAfterKeyBlock.includes('isPendingRestartJob(job)') &&
    continueAfterKeyBlock.includes('await restartOrStartCloudGeneration(jobId, job.brief);') &&
    continueAfterKeyBlock.includes('await resumeCloudGeneration(jobId);') &&
    continueAfterKeyBlock.includes('openIntakeForJob(jobId);'),
  'saving an API key from a cloud job should continue that specific recoverable job from its durable state.'
);

assert.ok(
  cloud.includes("export async function markCloudCredentialsReady(jobId = '')") &&
    cloud.includes("fetch('/api/gen/credentials-ready'") &&
    cloud.includes('body: JSON.stringify(jobId ? { jobId } : {})') &&
    app.includes('markCloudCredentialsReady'),
  'client should clear durable cloud waiting rows after saving the API key.'
);

assert.ok(
    credentialsReady.includes('API_KEY_WAITING_STATUSES') &&
    credentialsReady.includes('readJsonBody') &&
    credentialsReady.includes('requireSafeJobId') &&
    credentialsReady.includes('let jobId = \'\';') &&
    credentialsReady.includes(".select('*')") &&
    credentialsReady.includes('if (jobId) query = query.eq(\'id\', jobId);') &&
    credentialsReady.includes('export async function clearCredentialWaitsForUser') &&
    credentialsReady.includes('export async function recoverCredentialWaitsForUser') &&
    credentialsReady.includes(".in('status', API_KEY_WAITING_STATUSES)") &&
    credentialsReady.includes('await readApiKey(supabase, user.id);') &&
    credentialsReady.includes('started: result.started') &&
    credentialsReady.includes('maxDuration: 300') &&
    credentialsReady.includes('startRecoverable: !!jobId') &&
    credentialsReady.includes('startRecoverable = !!jobId') &&
    credentialsReady.includes('background = waitUntil') &&
    credentialsReady.includes('background(Promise.all(result.runs.map') &&
    credentialsReady.includes('requestBudget?.assertCanStart();') &&
    credentialsReady.includes('requestBudget: requestBudget.fork()') &&
    credentialsReady.includes('runGeneration(run)') &&
    credentialsReady.includes('claimRecoverableWaitingRow') &&
    credentialsReady.includes('startRecoverable && apiKey && isRecoverableStatus(row.status)') &&
    credentialsReady.includes('isRecoverableStatus(row.status)') &&
    credentialsReady.includes("status: 'running'") &&
    credentialsReady.includes('run_id: runId') &&
    credentialsReady.includes('recovery_attempts: 0') &&
    credentialsReady.includes('last_recovery_at: null') &&
    credentialsReady.includes('generationLeaseFields()') &&
    credentialsReady.includes("isMissingApiKeyText(`${row.error || ''}\\n${row.message || ''}`)") &&
    credentialsReady.includes('API key saved. Continue from this checkpoint.') &&
    credentialsReady.includes('API key saved. Retry missing topics from the saved checkpoint.') &&
    credentialsReady.includes('API key saved. Resume from the saved checkpoint.') &&
    credentialsReady.includes('API key saved. Restart from the saved request.') &&
    credentialsReady.includes('isPendingRestartWait(row)') &&
    credentialsReady.includes('export function isPendingRestartWait') &&
    credentialsReady.includes('const result = await recoverCredentialWaitsForUser(supabase, user.id, jobId') &&
    credentialsReady.includes('const results = await Promise.all(waiting.map(row => recoverWaitingRow') &&
    credentialsReady.includes('const confirmed = results.filter(Boolean);') &&
    credentialsReady.includes('res.status(200).json({ ok: true, cleared: result.cleared, started: result.started });') &&
    credentialsReady.includes(".eq('owner_id', ownerId)") &&
    credentialsReady.includes(".eq('status', row.status)") &&
    credentialsReady.includes('sameRunFilter(update, row.run_id)') &&
    credentialsReady.includes("sameValueFilter(update, 'error', row.error)") &&
    credentialsReady.includes("sameValueFilter(update, 'message', row.message)") &&
    credentialsReady.includes('function sameValueFilter') &&
    credentialsReady.includes(".select('id')") &&
    credentialsReady.includes('.maybeSingle()') &&
    credentialsReady.includes('return data?.id || null;'),
  'credentials-ready endpoint should owner-scope durable missing-key cleanup and return only confirmed cleared rows.'
);

assert.equal(isMissingApiKeyText('Missing API key'), true);
assert.equal(
  isMissingApiKeyText('Missing API key\nGeneration is waiting for an Anthropic API key. Add one to your account, then restart from the saved request.'),
  true
);
assert.equal(
  isMissingApiKeyText('Generation is waiting for an Anthropic API key. Add one to your account, then restart from the saved request.'),
  true
);
assert.equal(isPendingRestartWait({
  error: 'Missing API key',
  message: 'Generation is waiting for an Anthropic API key. Add one to your account, then restart from the saved request.'
}), true);
assert.equal(isPendingRestartWait({
  status: 'timed_out',
  message: 'Curriculum Designer is restarting from your saved request...'
}), true);

function credentialsReadySupabaseMock(rows, { beforeUpdate = null } = {}) {
  const calls = [];
  const updates = [];
  let beforeUpdateCalled = false;

  function filterRows(filters, statusFilter) {
    return rows.filter(row => {
      for (const [field, value] of Object.entries(filters)) {
        if (row[field] !== value) return false;
      }
      if (statusFilter && !statusFilter.includes(row.status)) return false;
      return true;
    });
  }

  function selectBuilder(table, columns) {
    const filters = {};
    let statusFilter = null;
    const builder = {
      eq(field, value) {
        calls.push({ type: 'eq', table, field, value });
        filters[field] = value;
        return builder;
      },
      in(field, values) {
        calls.push({ type: 'in', table, field, values });
        if (field === 'status') statusFilter = values;
        return builder;
      },
      then(resolve, reject) {
        return Promise.resolve({
          data: filterRows(filters, statusFilter).map(row => columns === '*' ? { ...row } : ({
            id: row.id,
            status: row.status,
            run_id: row.run_id,
            error: row.error,
            message: row.message
          })),
          error: null
        }).then(resolve, reject);
      }
    };
    calls.push({ type: 'select', table, columns });
    return builder;
  }

  function updateBuilder(table, patch) {
    const filters = {};
    const builder = {
      eq(field, value) {
        calls.push({ type: 'update-eq', table, field, value });
        filters[field] = value;
        return builder;
      },
      is(field, value) {
        calls.push({ type: 'update-is', table, field, value });
        filters[field] = value;
        return builder;
      },
      select(columns) {
        calls.push({ type: 'update-select', table, columns });
        return builder;
      },
      maybeSingle() {
        if (!beforeUpdateCalled && beforeUpdate) {
          beforeUpdateCalled = true;
          beforeUpdate(rows);
        }
        const row = rows.find(candidate => Object.entries(filters).every(([field, value]) => candidate[field] === value));
        if (!row) return Promise.resolve({ data: null, error: null });
        Object.assign(row, patch);
        updates.push({ id: row.id, patch });
        return Promise.resolve({ data: { id: row.id }, error: null });
      }
    };
    calls.push({ type: 'update', table, patch });
    return builder;
  }

  return {
    calls,
    updates,
    rows,
    from(table) {
      return {
        select(columns) { return selectBuilder(table, columns); },
        update(patch) { return updateBuilder(table, patch); }
      };
    }
  };
}

{
  const supabase = credentialsReadySupabaseMock([
    {
      id: 'job-target',
      owner_id: 'owner-1',
      run_id: 'run-target',
      status: 'timed_out',
      error: 'Missing API key',
      message: 'Generation is waiting for an Anthropic API key. Add one to your account, then resume from the saved checkpoint.'
    },
    {
      id: 'job-other',
      owner_id: 'owner-1',
      run_id: 'run-other',
      status: 'timed_out',
      error: 'Missing API key',
      message: 'Generation is waiting for an Anthropic API key. Add one to your account, then resume from the saved checkpoint.'
    },
    {
      id: 'job-target',
      owner_id: 'owner-2',
      run_id: 'run-other-owner',
      status: 'timed_out',
      error: 'Missing API key',
      message: 'Generation is waiting for an Anthropic API key. Add one to your account, then resume from the saved checkpoint.'
    }
  ]);

  const cleared = await clearCredentialWaitsForUser(supabase, 'owner-1', 'job-target');
  assert.deepEqual(cleared, ['job-target']);
  assert.deepEqual(supabase.updates.map(update => update.id), ['job-target']);
  assert.equal(supabase.rows.find(row => row.id === 'job-other').error, 'Missing API key');
  assert.equal(supabase.rows.find(row => row.owner_id === 'owner-2').error, 'Missing API key');
  assert.ok(supabase.calls.some(call => call.type === 'eq' && call.field === 'owner_id' && call.value === 'owner-1'));
  assert.ok(supabase.calls.some(call => call.type === 'eq' && call.field === 'id' && call.value === 'job-target'));
  assert.ok(supabase.calls.some(call => call.type === 'update-eq' && call.field === 'run_id' && call.value === 'run-target'));
  assert.ok(supabase.calls.some(call => call.type === 'update-eq' && call.field === 'error' && call.value === 'Missing API key'));
  assert.ok(supabase.calls.some(call => call.type === 'update-eq' && call.field === 'message' && /resume from the saved checkpoint/.test(call.value)));
}

{
  const supabase = credentialsReadySupabaseMock([
    {
      id: 'job-resume-server',
      owner_id: 'owner-1',
      run_id: 'run-waiting',
      status: 'timed_out',
      stage: 'topics',
      user_brief: { topic: 'AI for PMs', pdfRefs: [{ storage_path: 'owner-1/job-resume-server/source.pdf' }] },
      brief: { id: 'ai-for-pms', title: 'AI for PMs', modules: [] },
      research: { m1: { summary: 'Done' } },
      topics_by_key: { 'm1/t1': { title: 'Intro' } },
      failures: [],
      extracted_urls: [{ ok: true, url: 'https://example.com' }],
      error: 'Missing API key',
      message: 'Generation is waiting for an Anthropic API key. Add one to your account, then resume from the saved checkpoint.'
    }
  ]);

  const result = await recoverCredentialWaitsForUser(supabase, 'owner-1', 'job-resume-server', {
    apiKey: 'sk-ant-test',
    ownerEmail: 'dave@example.com'
  });
  assert.deepEqual(result.cleared, ['job-resume-server']);
  assert.deepEqual(result.started, ['job-resume-server']);
  assert.equal(result.runs.length, 1);
  assert.equal(result.runs[0].jobId, 'job-resume-server');
  assert.equal(result.runs[0].ownerId, 'owner-1');
  assert.equal(result.runs[0].apiKey, 'sk-ant-test');
  assert.equal(result.runs[0].mode, 'complete');
  assert.equal(result.runs[0].checkpoint.brief.title, 'AI for PMs');
  const row = supabase.rows[0];
  assert.equal(row.status, 'running');
  assert.equal(row.stage, 'topics');
  assert.equal(row.error, null);
  assert.equal(row.recovery_attempts, 0);
  assert.equal(row.last_recovery_at, null);
  assert.ok(row.run_id && row.run_id !== 'run-waiting');
  assert.match(row.message, /Lesson Writer|checkpoint|lessons/i);
}

{
  const supabase = credentialsReadySupabaseMock([
    {
      id: 'job-restart-server',
      owner_id: 'owner-1',
      run_id: 'run-restart-waiting',
      status: 'failed',
      stage: 'intake',
      user_brief: { topic: 'Code for Designers', source_text: 'Original request' },
      brief: { id: 'old-brief', title: 'Old brief', modules: [] },
      research: { stale: true },
      topics_by_key: { stale: true },
      failures: [{ error: 'old' }],
      extracted_urls: [{ ok: true, url: 'https://example.com/context' }],
      error: 'Missing API key',
      message: 'Generation is waiting for an Anthropic API key. Add one to your account, then restart from the saved request.'
    }
  ]);

  const result = await recoverCredentialWaitsForUser(supabase, 'owner-1', 'job-restart-server', {
    apiKey: 'sk-ant-test'
  });
  assert.deepEqual(result.cleared, ['job-restart-server']);
  assert.deepEqual(result.started, ['job-restart-server']);
  assert.equal(result.runs[0].mode, 'curriculum');
  assert.deepEqual(result.runs[0].checkpoint, {
    extracted_urls: [{ ok: true, url: 'https://example.com/context' }]
  });
  const row = supabase.rows[0];
  assert.equal(row.status, 'running');
  assert.equal(row.stage, 'intake');
  assert.equal(row.brief, null);
  assert.deepEqual(row.research, {});
  assert.deepEqual(row.topics_by_key, {});
  assert.deepEqual(row.failures, []);
  assert.match(row.message, /Restarting from the saved request/);
}

{
  const supabase = credentialsReadySupabaseMock([
    {
      id: 'job-general-save',
      owner_id: 'owner-1',
      run_id: 'run-general-save',
      status: 'timed_out',
      stage: 'topics',
      user_brief: { topic: 'General save should not fan out' },
      brief: { id: 'general-save', title: 'General save', modules: [] },
      error: 'Missing API key',
      message: 'Generation is waiting for an Anthropic API key. Add one to your account, then resume from the saved checkpoint.'
    },
    {
      id: 'job-general-other-owner',
      owner_id: 'owner-2',
      run_id: 'run-other-owner',
      status: 'timed_out',
      error: 'Missing API key',
      message: 'Generation is waiting for an Anthropic API key. Add one to your account, then resume from the saved checkpoint.'
    }
  ]);

  const result = await recoverCredentialWaitsForUser(supabase, 'owner-1', '', {
    apiKey: 'sk-ant-test'
  });
  assert.deepEqual(result.cleared, ['job-general-save']);
  assert.deepEqual(result.started, []);
  assert.deepEqual(result.runs, []);
  const row = supabase.rows.find(candidate => candidate.id === 'job-general-save');
  assert.equal(row.status, 'timed_out');
  assert.equal(row.run_id, 'run-general-save');
  assert.equal(row.error, null);
  assert.equal(row.message, 'API key saved. Resume from the saved checkpoint.');
  assert.equal(supabase.rows.find(candidate => candidate.id === 'job-general-other-owner').error, 'Missing API key');
}

{
  const supabase = credentialsReadySupabaseMock([
    {
      id: 'job-review',
      owner_id: 'owner-1',
      run_id: null,
      status: 'review_curriculum',
      error: 'Missing API key',
      message: 'Review is waiting for an Anthropic API key. Add one to your account, then continue from this checkpoint.'
    },
    {
      id: 'job-noop',
      owner_id: 'owner-1',
      run_id: 'run-noop',
      status: 'failed',
      error: 'Something else',
      message: 'Schema failed for unrelated reasons.'
    }
  ]);

  const cleared = await clearCredentialWaitsForUser(supabase, 'owner-1');
  assert.deepEqual(cleared, ['job-review']);
  assert.deepEqual(supabase.updates.map(update => update.id), ['job-review']);
  assert.equal(supabase.rows.find(row => row.id === 'job-review').message, 'API key saved. Continue from this checkpoint.');
  assert.equal(supabase.rows.find(row => row.id === 'job-noop').error, 'Something else');
  assert.ok(supabase.calls.some(call => call.type === 'update-is' && call.field === 'run_id' && call.value === null));
}

{
  const supabase = credentialsReadySupabaseMock([
    {
      id: 'job-review-scoped',
      owner_id: 'owner-1',
      run_id: 'review-run',
      status: 'review_research',
      error: 'Missing API key',
      message: 'Review is waiting for an Anthropic API key. Add one to your account, then continue from this checkpoint.',
      user_brief: { topic: 'Human review should stay paused' },
      brief: { id: 'review-course', title: 'Review course', modules: [] },
      research: { m1: { summary: 'Ready for human approval' } },
      topics_by_key: {}
    }
  ]);

  const result = await recoverCredentialWaitsForUser(supabase, 'owner-1', 'job-review-scoped', {
    apiKey: 'sk-ant-test',
    ownerEmail: 'dave@example.com'
  });
  assert.deepEqual(result.cleared, ['job-review-scoped']);
  assert.deepEqual(result.started, []);
  assert.deepEqual(result.runs, []);
  const row = supabase.rows[0];
  assert.equal(row.status, 'review_research');
  assert.equal(row.run_id, 'review-run');
  assert.equal(row.error, null);
  assert.equal(row.message, 'API key saved. Continue from this checkpoint.');
  assert.ok(supabase.calls.some(call => call.type === 'update-eq' && call.field === 'run_id' && call.value === 'review-run'));
}

{
  const supabase = credentialsReadySupabaseMock([
    {
      id: 'job-raced',
      owner_id: 'owner-1',
      run_id: 'run-old',
      status: 'failed',
      error: 'Missing API key',
      message: 'Generation is waiting for an Anthropic API key. Add one to your account, then resume from the saved checkpoint.'
    }
  ], {
    beforeUpdate(rows) {
      rows[0].run_id = 'run-new';
      rows[0].error = 'Schema failed after API key wait was selected.';
      rows[0].message = 'A newer failure should stay visible.';
    }
  });

  const cleared = await clearCredentialWaitsForUser(supabase, 'owner-1', 'job-raced');
  assert.deepEqual(cleared, []);
  assert.deepEqual(supabase.updates, []);
  assert.equal(supabase.rows[0].run_id, 'run-new');
  assert.equal(supabase.rows[0].error, 'Schema failed after API key wait was selected.');
  assert.equal(supabase.rows[0].message, 'A newer failure should stay visible.');
}

assert.ok(
    cloud.includes('pendingRestart: pendingRestartForRow(row)') &&
    cloud.includes('export function pendingRestartForRow') &&
    cloud.includes('export function hasSavedRequestRestartIntent') &&
    app.includes('function isPendingRestartJob(job)') &&
    app.includes('hasSavedRequestRestartIntent(job)') &&
    app.includes("pendingRestart ? 'Restart from request'") &&
    app.includes("pendingRestart ? 'restart'") &&
    intake.includes('function pendingRestart(job)') &&
    intake.includes('hasSavedRequestRestartIntent(job)') &&
    intake.includes("wantsRestart ? 'Restart from request'") &&
    intake.includes("wantsRestart ? 'restart'"),
  'pending restart jobs should keep restart as the primary action after an API key is saved.'
);

assert.ok(app.includes("openAccount({ intent: 'course-generation', jobId: id })"));
assert.ok(intake.includes("openAccount({ intent: 'course-generation', jobId })"));
assert.ok(packageJson.scripts['verify:cloud-architecture'].includes('test:api-key-saved-unblocks-cloud-jobs'));

console.log('API key saved cloud job unblock tests passed');
