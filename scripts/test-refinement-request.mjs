import assert from 'node:assert/strict';
import { withCourseCommitRpc } from './fixtures/course-commit-rpc.mjs';
import { randomUUID } from 'node:crypto';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';
import { retainComponentChoices } from '../web/js/generator/component-policy.mjs';
import { assembleCourse } from '../web/js/generator/assemble-course.js';
import { courseRefinementFingerprint, refinementFingerprint, acceptCourseRefinement } from '../web/api/_lib/course-refinement.mjs';
import { buildRefinementProposalRequest, validateRefinementProposalResponse } from '../web/api/_lib/refinement-proposal.mjs';
import { startRefinementRequest, runRefinementRequest, getRefinementRequest, cancelRefinementRequest, discardRefinementRequest, REFINEMENT_REQUEST_LEASE_MS } from '../web/api/_lib/refinement-request.mjs';

let checks = 0;
const check = (ok, message) => { assert.ok(ok, message); checks++; };
const rejects = async (promise, code) => { await assert.rejects(promise, error => error.code === code); checks++; };
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function fixture() {
  const components = ['lessons', 'practice', 'checklists', 'quizzes', 'flashcards'];
  const brief = retainComponentChoices(curriculumFixture(), { components });
  const course = { ...assembleCourse(brief, brief.modules.flatMap(mod => mod.topics.map(topic => ({ moduleId: mod.id, topicId: topic.id, content: lessonFixture(components, topic) })))), _brief: brief, _generationJobId: 'request-job', privateOriginals: { retained: 'private sentinel' } };
  let row = { id: course.config.id, owner_id: 'owner-a', payload: course, updated_at: '2026-09-16T00:00:00.000Z' };
  let clock = Date.parse(row.updated_at), jobStatus = 'completed', writes = 0, calls = 0, fault = null;
  const db = { from(table) {
    const filters = {}; let patch;
    const q = { select() { return q; }, eq(k, v) { filters[k] = v; return q; }, is(k, v) { filters[k] = v; return q; }, update(v) { patch = v; return q; }, async maybeSingle() {
      if (table === 'generation_jobs') return { data: jobStatus ? { status: jobStatus } : null };
      if (!row || filters.owner_id !== row.owner_id || filters.id !== row.id || patch && filters.updated_at !== row.updated_at) return { data: null };
      if (patch) {
        if (fault === 'before') { fault = null; throw new Error('private database details'); }
        Object.assign(row, structuredClone(patch)); writes++;
        if (fault === 'after') { fault = null; throw new Error('lost database reply'); }
      }
      return { data: structuredClone(row) };
    } }; return q;
  } }; withCourseCommitRpc(db);
  const input = { supabase: db, ownerId: 'owner-a', courseId: course.config.id, now: () => clock, operationId: randomUUID(), expectedRequestId: null, consent: true,
    baseHash: courseRefinementFingerprint(course), target: { kind: 'section', moduleId: 'foundations', topicId: 'lesson-1', index: 0 }, instructions: 'Make the opening explanation clearer.', getKey: async () => 'synthetic-private-key' };
  const proposal = args => {
    const prepared = buildRefinementProposalRequest(args);
    const replacement = { ...prepared.snapshot.modules[1]['lesson-1'].sections[0], title: 'A clearer opening explanation' };
    return { ...validateRefinementProposalResponse(prepared, { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_refinement_proposal', input: { replacement, explanation: 'The opening is easier to understand.', cautions: [] } }] }), usage: { total: { calls: 1, inputTokens: 80, outputTokens: 40 } } };
  };
  input.generate = async args => { calls++; return proposal(args); };
  return { input, proposal, get row() { return row; }, get calls() { return calls; }, get writes() { return writes; }, advance: ms => { clock += ms; }, fault: value => { fault = value; }, job: value => { jobStatus = value; }, remove: () => { row = null; }, change: () => { row.payload.config.title = 'A concurrent accepted edit'; row.updated_at = new Date(++clock).toISOString(); }, wrap: fn => { input.generate = async args => { calls++; return fn(args); }; } };
}

for (const [patch, code] of [[{ consent: false }, 'consent'], [{ operationId: 'short' }, 'request'], [{ expectedRequestId: undefined }, 'request'], [{ baseHash: 'wrong' }, 'request'], [{ ownerId: 'owner-b' }, 'not_found'], [{ instructions: 'short' }, 'instructions'], [{ target: { kind: 'section' } }, 'target'], [{ baseHash: '0'.repeat(64) }, 'conflict']]) {
  const f = fixture(); await rejects(startRefinementRequest({ ...f.input, ...patch }), code); check(f.calls === 0 && f.writes === 0, 'invalid admission has no provider call or write');
}
for (const job of ['running', 'partial', 'cancelled']) { const f = fixture(); f.job(job); await rejects(startRefinementRequest(f.input), 'building'); }
{
  const f = fixture(); f.row.payload.failedTopics = ['lesson-2']; f.input.baseHash = courseRefinementFingerprint(f.row.payload); await rejects(startRefinementRequest(f.input), 'building');
}
{
  const f = fixture(), original = structuredClone(f.row.payload);
  check((await getRefinementRequest(f.input)).request === null, 'empty request state is explicit');
  const started = await startRefinementRequest(f.input);
  check(started.request.status === 'queued' && !started.replayed && f.calls === 0, 'start stores a request without calling AI');
  check(courseRefinementFingerprint(f.row.payload) === f.input.baseHash && refinementFingerprint(f.row.payload) !== refinementFingerprint(original), 'only private receipt changes; accepted course fingerprint is stable');
  check(!JSON.stringify(started).includes('dispatchToken') && !JSON.stringify(started).includes('requestHash') && !JSON.stringify(started).includes('private sentinel'), 'request view does not leak internal metadata');
  check((await startRefinementRequest(f.input)).replayed && f.writes === 1, 'duplicate start returns same queued request');
  await rejects(startRefinementRequest({ ...f.input, instructions: 'Different instructions with reused operation' }), 'conflict');
  await rejects(startRefinementRequest({ ...f.input, operationId: randomUUID() }), 'conflict');
  await rejects(startRefinementRequest({ ...f.input, operationId: randomUUID(), expectedRequestId: f.input.operationId }), 'busy');
  const results = await Promise.all([runRefinementRequest(f.input), runRefinementRequest(f.input)]);
  check(f.calls === 1 && results.some(result => result.request.status === 'ready'), 'competing dispatches call the provider once');
  const recovered = await getRefinementRequest({ ...f.input });
  check(recovered.request.status === 'ready' && recovered.request.proposal.changed && recovered.request.usage.total.calls === 1, 'fresh request recovers proposal and observed usage');
  check(f.row.payload.modules[1]['lesson-1'].sections[0].title === original.modules[1]['lesson-1'].sections[0].title, 'AI result is not automatically accepted');
  await runRefinementRequest(f.input); check(f.calls === 1, 'completed request cannot trigger another call');
  await rejects(getRefinementRequest({ ...f.input, ownerId: 'owner-b' }), 'not_found');
  const saved = await acceptCourseRefinement({ ...f.input, operationId: randomUUID(), replacement: recovered.request.proposal.replacement });
  check(saved.saved && f.row.payload.privateOriginals.retained === 'private sentinel', 'existing explicit acceptance works despite receipt metadata');
  check((await getRefinementRequest(f.input)).request.status === 'applied' && !f.row.payload._refinementProposal.proposal, 'accepted suggestion is not offered again on reopen');
}
{
  const f = fixture(); f.fault('after'); await rejects(startRefinementRequest(f.input), 'unavailable');
  check(f.calls === 0 && (await startRefinementRequest(f.input)).replayed, 'uncertain start write recovers its exact queued request');
  await runRefinementRequest(f.input); check(f.calls === 1, 'recovered queued request can dispatch once');
}
{
  const f = fixture(); f.fault('before'); await rejects(startRefinementRequest(f.input), 'unavailable'); check(f.row.payload._refinementProposal === undefined && f.calls === 0, 'failed claim makes no provider call');
}
{
  const f = fixture(); await startRefinementRequest(f.input); f.fault('after'); await rejects(runRefinementRequest(f.input), 'unavailable');
  check(f.calls === 0 && (await getRefinementRequest(f.input)).request.status === 'running', 'uncertain running claim never calls AI');
  await runRefinementRequest(f.input); check(f.calls === 0, 'uncertain running claim is not automatically retried');
  f.advance(REFINEMENT_REQUEST_LEASE_MS); check((await getRefinementRequest(f.input)).request.error.code === 'timeout', 'expired running request reports unknown outcome');
  check((await discardRefinementRequest(f.input)).request.status === 'discarded', 'expired request can be discarded through its failed-state action');
  await runRefinementRequest(f.input); check(f.calls === 0, 'discarded expired request never dispatches');
}
{
  const f = fixture(); await startRefinementRequest(f.input); f.wrap(args => { f.fault('after'); return f.proposal(args); });
  await rejects(runRefinementRequest(f.input), 'unavailable');
  check((await getRefinementRequest(f.input)).request.status === 'ready' && f.calls === 1, 'lost final write reply recovers saved proposal');
  await runRefinementRequest(f.input); check(f.calls === 1, 'lost final reply cannot generate twice');
}
{
  const f = fixture(); await startRefinementRequest(f.input); await cancelRefinementRequest(f.input); await runRefinementRequest(f.input);
  check(f.calls === 0 && (await getRefinementRequest(f.input)).request.status === 'cancelled', 'cancel queued prevents provider call');
  check((await startRefinementRequest(f.input)).request.status === 'cancelled', 'replay cancelled request does not restart');
}
for (const change of ['cancel', 'edit', 'delete', 'expire', 'new']) {
  const f = fixture(), gate = deferred(), entered = deferred(); f.wrap(async args => { entered.resolve(); await gate.promise; return f.proposal(args); });
  await startRefinementRequest(f.input); const running = runRefinementRequest(f.input); await entered.promise;
  if (change === 'cancel' || change === 'new') await cancelRefinementRequest(f.input);
  if (change === 'edit') f.change();
  if (change === 'delete') f.remove();
  if (change === 'expire') f.advance(REFINEMENT_REQUEST_LEASE_MS);
  const nextId = randomUUID();
  if (change === 'new') await startRefinementRequest({ ...f.input, expectedRequestId: f.input.operationId, operationId: nextId });
  gate.resolve(); const result = await running;
  if (change === 'cancel') check(result.request.status === 'cancelled' && !result.request.proposal && result.request.usage.total.calls === 1, 'cancel retains incurred usage but ignores late proposal');
  if (change === 'edit') check(result.request.status === 'stale' && result.request.proposal && f.row.payload.config.title === 'A concurrent accepted edit', 'late result cannot overwrite newer accepted content');
  if (change === 'delete') check(result.stopped && !f.row, 'deleted course is never recreated');
  if (change === 'expire') check(result.request.status === 'failed' && !result.request.proposal && result.request.usage.total.calls === 1, 'expired output is not revived, observed usage retained');
  if (change === 'new') check(result.stopped && f.row.payload._refinementProposal.id === nextId && !f.row.payload._refinementProposal.proposal, 'late old response cannot replace a newer request');
  check(f.calls === 1, 'late state never causes another provider call');
}
for (const code of ['connection', 'rate_limit', 'timeout', 'provider', 'output', 'markup', 'ECONNRESET']) {
  const f = fixture(); f.wrap(() => { throw Object.assign(new Error('private upstream detail sentinel'), { code }); });
  await startRefinementRequest(f.input); const result = await runRefinementRequest(f.input);
  check(result.request.status === 'failed' && result.request.usage === null && !JSON.stringify(result).includes('private upstream'), 'failure is sanitised and missing usage unknown: ' + code);
  await runRefinementRequest(f.input); check(f.calls === 1, 'failure never triggers automatic retry: ' + code);
}
{
  const f = fixture(); await startRefinementRequest(f.input);
  const result = await runRefinementRequest({ ...f.input, getKey: async () => { throw new Error('private key vault error'); } });
  check(result.request.error.code === 'connection' && !result.request.providerAttempted && f.calls === 0, 'missing key fails without provider use');
}
{
  const f = fixture(), keyGate = deferred(); await startRefinementRequest(f.input);
  const keyFailure = runRefinementRequest({ ...f.input, getKey: () => keyGate.promise });
  const providerGate = deferred(), entered = deferred(); f.wrap(async args => { entered.resolve(); await providerGate.promise; return f.proposal(args); });
  const winner = runRefinementRequest(f.input); await entered.promise; keyGate.reject(new Error('late key-read failure')); await keyFailure;
  check((await getRefinementRequest(f.input)).request.status === 'running', 'losing dispatcher cannot fail another active dispatcher');
  providerGate.resolve(); await winner; check(f.calls === 1 && (await getRefinementRequest(f.input)).request.status === 'ready', 'winning dispatcher result preserved');
}
{
  const f = fixture(); await startRefinementRequest(f.input); f.change(); await runRefinementRequest(f.input);
  check(f.calls === 0 && (await getRefinementRequest(f.input)).request.status === 'stale', 'changed course before dispatch makes no call');
}
{
  const f = fixture(); await startRefinementRequest(f.input); f.advance(REFINEMENT_REQUEST_LEASE_MS); await runRefinementRequest(f.input);
  check(f.calls === 0 && (await getRefinementRequest(f.input)).request.status === 'failed', 'expired queued request is not dispatched');
  const newer = { ...f.input, operationId: randomUUID(), expectedRequestId: f.input.operationId };
  await startRefinementRequest(newer); await rejects(startRefinementRequest(f.input), 'conflict');
  check(f.row.payload._refinementProposal.id === newer.operationId, 'late retry of replaced request cannot start again');
}
{
  const f = fixture(), draft = { ...f.row.payload.modules[1]['lesson-1'].sections[0], title: 'My unsaved manual improvement' };
  const input = { ...f.input, workingReplacement: draft };
  const prepared = buildRefinementProposalRequest({ course: f.row.payload, ...input });
  check(JSON.parse(prepared.body.messages[0].content).current_lesson.sections[0].title === draft.title && prepared.baseHash === f.input.baseHash, 'manual draft seeds AI context but acceptance base remains saved course');
  await startRefinementRequest(input);
  check((await getRefinementRequest(input)).request.workingReplacement.title === draft.title, 'manual draft is recoverable with its proposal request');
  check(f.row.payload.modules[1]['lesson-1'].sections[0].title !== draft.title, 'request does not save the manual draft as accepted content');
}
{
  const f = fixture(); await startRefinementRequest(f.input);
  await rejects(discardRefinementRequest(f.input), 'busy');
  await runRefinementRequest(f.input); const savedHash = courseRefinementFingerprint(f.row.payload);
  const discarded = await discardRefinementRequest(f.input);
  check(discarded.request.status === 'discarded' && !discarded.request.proposal && courseRefinementFingerprint(f.row.payload) === savedHash, 'discard is persistent without replacing saved content');
  check((await discardRefinementRequest(f.input)).request.status === 'discarded', 'repeat discard is safe');
  await rejects(discardRefinementRequest({ ...f.input, ownerId: 'owner-b' }), 'not_found');
}
console.log(`Refinement request lifecycle: ${checks} checks passed; synthetic provider and database only.`);
