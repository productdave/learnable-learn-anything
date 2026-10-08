import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { requireGenerationExpectation } from '../web/api/_lib/gen-state.mjs';

const oldRun = '11111111-1111-4111-8111-111111111111';
const newRun = '22222222-2222-4222-8222-222222222222';
const expected = { status: 'review_curriculum', runId: oldRun };
const row = { status: expected.status, run_id: oldRun };
assert.equal(requireGenerationExpectation(expected, row), expected);
assert.deepEqual(requireGenerationExpectation({ status: 'failed', runId: null }, { status: 'failed', run_id: null }), { status: 'failed', runId: null });
for (const value of [undefined, {}, { status: row.status }, { ...expected, runId: 'bad' }, { ...expected, runId: newRun }, { ...expected, runId: null }, { ...expected, status: 'running' }]) {
  assert.throws(() => requireGenerationExpectation(value, row), error => error.statusCode === 409 && error.code === 'GENERATION_CHANGED');
}

// Execute the actual client action implementations with controlled transport,
// authentication and reattachment. A render snapshot must survive every await.
const source = readFileSync(new URL('../web/js/cloud-gen-client.js', import.meta.url), 'utf8');
function section(start, end) {
  const from = source.indexOf(start), to = source.indexOf(end, from);
  assert.ok(from >= 0 && to > from); return source.slice(from, to).replaceAll('export ', '');
}
const actions = section('export function generationActionSnapshot', '/** Hydrate a local mirror');
const review = section('export async function submitCloudReview', '/**\n * Re-subscribe');
const helpers = source.slice(source.indexOf('function restoreJobAfterActionError')).replaceAll('export ', '');
let count = 0;
for (const refreshFails of [false, true]) for (const explicit of [false, true]) for (const kind of ['cancel', 'delete', 'resume', 'restart', 'sources', 'review', 'restartOrStart']) {
  let job = { status: 'review_curriculum', runId: explicit ? newRun : oldRun, brief: {}, error: null };
  let payload, removed = 0, started = 0;
  const fresh = { status: 'review_research', runId: newRun, brief: { title: 'New version' } };
  const context = vm.createContext({
    getJob: () => ({ ...job }),
    updateJob: (_id, patch) => { job = { ...job, ...patch }; },
    getAccessToken: async () => 'synthetic',
    requireCloudBackendReady: async () => { job = { ...job, runId: newRun }; },
    fetch: async (_url, init) => { payload = JSON.parse(init.body); return { ok: false, status: 409, text: async () => JSON.stringify({ code: 'GENERATION_CHANGED', error: 'Nothing changed. Review latest version.' }) }; },
    reattachCloudGeneration: async () => { if (refreshFails) throw Error('Network offline'); job = { ...job, ...fresh }; return true; },
    isCloudJobStateConflictError: error => error.status === 409,
    isMissingApiKeyError: () => false, isMissingCloudJobError: () => false,
    removeCloudJobMirror: () => { removed++; }, startCloudGeneration: () => { started++; },
    removeJobSubscription: () => {}, removeJob: () => { removed++; },
    localCourseForCurrentUser: () => false,
    agentMessage: () => 'Working', subscribeToJob: () => {}, setTimeout: () => {},
    slimBriefForCloud: value => value, removeUploadedPdfRefs: async () => {},
    reviewPendingForAction: () => ({ message: 'Sending' }), reviewSubmissions: new Set(),
  });
  vm.runInContext(actions + review + helpers, context);
  const checkpoint = explicit ? expected : undefined;
  const invoke = {
    cancel: () => context.cancelCloudGeneration('fixture', checkpoint),
    delete: () => context.deleteCloudGeneration('fixture', checkpoint),
    resume: () => context.resumeCloudGeneration('fixture', checkpoint),
    restart: () => context.restartCloudGeneration('fixture', '', checkpoint),
    sources: () => context.restartCloudGenerationWithSources('fixture', { pdfRefs: [{ path: 'fixture' }] }, '', checkpoint),
    review: () => context.submitCloudReview('fixture', 'approve_curriculum', 'Keep this feedback', checkpoint),
    restartOrStart: () => context.restartOrStartCloudGeneration('fixture', {}, '', checkpoint),
  }[kind];
  await assert.rejects(invoke, error => error.code === 'GENERATION_CHANGED');
  assert.deepEqual(payload.expected, expected, kind + ': uses displayed/invocation checkpoint before awaits');
  assert.equal(removed, 0); assert.equal(started, 0);
  assert.ok(!['running', 'cancelling'].includes(job.status), kind + ': no stranded optimistic state');
  if (!refreshFails) { assert.equal(job.status, fresh.status); assert.equal(job.runId, fresh.runId); }
  assert.match(job.error, refreshFails ? /Nothing changed/ : /No action was taken/);
  count++;
}
console.log(`Generation action expectations: helper validation and ${count} real-client transport/recovery scenarios passed.`);
