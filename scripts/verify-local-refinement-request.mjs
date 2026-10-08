// Real local Auth/Postgres/RLS and API handler; synthetic model only. No migration,
// preview enablement, publication or provider credentials are used by this test.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig } from './dev-setup-server.mjs';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';
import { retainComponentChoices } from '../web/js/generator/component-policy.mjs';
import { assembleCourse } from '../web/js/generator/assemble-course.js';
import { coursePayloadForPush } from '../web/js/course-sync.js';
import { commitCourseRow } from '../web/api/_lib/course-commit.mjs';
import { courseRefinementFingerprint, acceptCourseRefinement } from '../web/api/_lib/course-refinement.mjs';
import { buildRefinementProposalRequest, validateRefinementProposalResponse } from '../web/api/_lib/refinement-proposal.mjs';

const config = await loadPreviewConfig(new URL('../.env.preview.local', import.meta.url));
assert.equal(config.mode, 'local'); assert.equal(config.url, 'http://127.0.0.1:54321');
process.env.SUPABASE_URL = config.url; process.env.SUPABASE_ANON_KEY = config.publicKey;
const { createRefinementProposalHandler } = await import('../web/api/courses/proposal.js');
const admin = createClient(config.url, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const accounts = [], pending = [], reports = []; let checks = 0, calls = 0, gate = null, entered, release;
const check = (ok, message) => { assert.ok(ok, message); checks++; };
const read = async account => { const result = await account.client.from('user_courses').select('payload,updated_at').eq('owner_id', account.owner).eq('id', 'proposal-qa').single(); assert.ok(!result.error); return result.data; };
const handler = createRefinementProposalHandler({ enabled: () => true, getKey: async () => 'synthetic-only-key', background: work => { pending.push(work); }, report: value => reports.push(value), generate: async args => {
  calls++; entered?.(); if (gate) await gate;
  const request = buildRefinementProposalRequest(args);
  return { ...validateRefinementProposalResponse(request, { stop_reason: 'tool_use', content: [{ type: 'tool_use', name: 'submit_refinement_proposal', input: { replacement: { ...request.snapshot.modules[1]['lesson-1'].sections[0], title: 'A clearer account-saved opening' }, explanation: 'Simplifies the first explanation for review.', cautions: [] } }] }), usage: { total: { calls: 1, inputTokens: 80, outputTokens: 40 } } };
} });
async function request(account, body, override = handler) {
  const response = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(value) { this.data = value; return this; } };
  await override({ method: body === undefined ? 'GET' : 'POST', url: '/api/courses/proposal?courseId=proposal-qa', headers: account ? { authorization: `Bearer ${account.token}` } : {}, ...(body === undefined ? {} : { body }) }, response);
  check(response.headers['Cache-Control'] === 'no-store', 'API never caches private proposals');
  return response;
}
try {
  const components = ['lessons', 'practice', 'checklists', 'quizzes', 'flashcards'];
  const brief = retainComponentChoices(curriculumFixture(), { components });
  for (let index = 0; index < 2; index++) {
    const email = `proposal-${randomUUID()}@example.test`, password = `${randomUUID()}Aa9!`;
    const made = await admin.auth.admin.createUser({ email, password, email_confirm: true }); assert.ok(!made.error);
    const account = { owner: made.data.user.id, client: createClient(config.url, config.publicKey, { auth: { persistSession: false, autoRefreshToken: false } }) }; accounts.push(account);
    const auth = await account.client.auth.signInWithPassword({ email, password }); assert.ok(!auth.error); account.token = auth.data.session.access_token;
    const course = assembleCourse(brief, brief.modules.flatMap(mod => mod.topics.map(topic => ({ moduleId: mod.id, topicId: topic.id, content: lessonFixture(components, topic) }))));
    course.config.id = 'proposal-qa'; Object.assign(course, { _brief: brief, createdByUserId: account.owner, privateOriginals: { retained: 'Synthetic private source' } });
    assert.ok(!(await account.client.from('user_courses').insert({ owner_id: account.owner, id: 'proposal-qa', payload: course })).error);
  }
  const [a, b] = accounts, before = await read(a), other = await read(b);
  check((await request(null)).code === 401, 'real session required');
  check((await request(a, undefined, createRefinementProposalHandler({ enabled: () => false }))).data.code === 'disabled', 'unreleased endpoint is gated');
  check((await request(a, '{broken')).code === 400, 'malformed JSON rejected');
  check((await request(a, 'x'.repeat(1100001))).code === 400, 'oversized body rejected');
  check((await request(a, { action: 'publish' })).code === 400, 'proposal route cannot publish');
  const body = { action: 'start', courseId: 'proposal-qa', consent: true, operationId: randomUUID(), expectedRequestId: null, baseHash: courseRefinementFingerprint(before.payload), target: { kind: 'section', moduleId: 'foundations', topicId: 'lesson-1', index: 0 }, instructions: 'Make the opening explanation simpler.' };
  check((await request(a, { ...body, consent: false })).data.code === 'consent' && calls === 0, 'provider consent is enforced');
  gate = new Promise(resolve => { release = resolve; }); const inProvider = new Promise(resolve => { entered = resolve; });
  const starts = await Promise.all([request(a, body), request(a, body)]);
  check(starts.every(result => result.code === 202 || result.code === 200), 'concurrent identical start responses recover one operation');
  await inProvider;
  check(calls === 1, 'actual Postgres CAS admits one provider call');
  const running = await request(a); check(running.data.request.id === body.operationId && running.data.request.status === 'running', 'fresh authenticated read recovers running request');
  const foreign = await request(b); check(foreign.data.request === null && courseRefinementFingerprint((await read(b)).payload) === courseRefinementFingerprint(other.payload), 'same slug in another account cannot expose or mutate proposal');
  check((await request(a, { ...body, operationId: randomUUID() })).code === 409, 'stale second request rejected');
  release(); await Promise.all(pending.splice(0)); gate = null;
  const ready = await request(a); check(ready.data.request.status === 'ready' && ready.data.request.usage.total.calls === 1, 'proposal saved and recovered from real account row');
  check(courseRefinementFingerprint((await read(a)).payload) === body.baseHash, 'accepted course content remains unchanged');
  check((await request(a, body)).data.replayed && calls === 1, 'lost response retry reuses completed request');
  check(!JSON.stringify(ready.data).includes('synthetic-only-key') && !JSON.stringify(ready.data).includes('dispatchToken'), 'API excludes credentials and dispatch token');
  const accepted = await acceptCourseRefinement({ supabase: a.client, ownerId: a.owner, courseId: 'proposal-qa', target: body.target, baseHash: body.baseHash, replacement: ready.data.request.proposal.replacement, operationId: randomUUID() });
  check(accepted.saved && (await read(a)).payload.modules[1]['lesson-1'].sections[0].title === 'A clearer account-saved opening', 'only explicit acceptance changes the stored lesson');
  const next = { ...body, operationId: randomUUID(), expectedRequestId: body.operationId, baseHash: courseRefinementFingerprint(accepted.payload) };
  gate = new Promise(resolve => { release = resolve; }); const secondEntered = new Promise(resolve => { entered = resolve; });
  await request(a, next); await secondEntered;
  const mirrorRead = await read(a);
  const cancelled = await request(a, { action: 'cancel', courseId: 'proposal-qa', operationId: next.operationId });
  check(cancelled.data.request.status === 'cancelled', 'cancel persists through authenticated endpoint');
  const stalePush = await commitCourseRow({supabase:a.client,ownerId:a.owner,courseId:'proposal-qa',row:mirrorRead,payload:coursePayloadForPush(mirrorRead.payload,mirrorRead)});
  check(!stalePush, 'a course-sync write racing cancellation loses its actual Postgres CAS');
  release(); await Promise.all(pending.splice(0)); gate = null;
  const afterCancel = await request(a); check(afterCancel.data.request.status === 'cancelled' && !afterCancel.data.request.proposal && afterCancel.data.request.usage.total.calls === 1, 'late result records usage without reviving cancelled proposal');
  check((await request(a, { action: 'resume', courseId: 'proposal-qa', operationId: next.operationId })).data.request.status === 'cancelled' && calls === 2, 'resume does not restart cancelled work');
  const mirrorLatest = await read(a);
  const currentPush = await commitCourseRow({supabase:a.client,ownerId:a.owner,courseId:'proposal-qa',row:mirrorLatest,payload:coursePayloadForPush(mirrorLatest.payload,mirrorLatest)});
  check(!!currentPush && (await read(a)).payload._refinementProposal.status === 'cancelled', 'ordinary content push preserves latest request rather than restoring a stale local proposal');
  const crossOwner = await b.client.from('user_courses').select('payload').eq('owner_id', a.owner).eq('id', 'proposal-qa');
  check(!crossOwner.error && crossOwner.data.length === 0, 'actual RLS denies foreign proposal row');
  check(reports.length === 0, 'background runs completed without unconfirmed persistence');
  console.log(`Local AI proposal requests: ${checks} checks passed with actual Auth/API/Postgres/RLS; ${calls} synthetic provider calls.`);
} finally {
  release?.();
  await Promise.allSettled(pending);
  for (const account of accounts) {
    assert.ok(!(await admin.from('user_courses').delete().eq('owner_id', account.owner)).error);
    assert.ok(!(await admin.auth.admin.deleteUser(account.owner)).error);
  }
  console.log('Removed only disposable proposal QA accounts and their course rows.');
}
