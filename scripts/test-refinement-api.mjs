import assert from 'node:assert/strict';
import { withCourseCommitRpc } from './fixtures/course-commit-rpc.mjs';
import { createRefinementHandler } from '../web/api/courses/refine.js';
import { createCourseRefinementClient } from '../web/js/course-refinement-client.js';
import { curriculumFixture, lessonFixture, richComponentCombinations } from './fixtures/component-course.mjs';
import { retainComponentChoices } from '../web/js/generator/component-policy.mjs';
import { assembleCourse } from '../web/js/generator/assemble-course.js';
import { refinementFingerprint } from '../web/api/_lib/course-refinement.mjs';

let checks = 0;
const check = (ok, message) => { assert.ok(ok, message); checks++; };
const components = richComponentCombinations[15], brief = retainComponentChoices(curriculumFixture(), { components });
const course = { ...assembleCourse(brief, brief.modules.flatMap(mod => mod.topics.map(topic => ({ moduleId: mod.id, topicId: topic.id, content: lessonFixture(components, topic) })))), _generationJobId: 'job-api-refine' };
const original = structuredClone(course), target = { kind: 'section', moduleId: 'foundations', topicId: 'lesson-1', index: 0 };
let owner = 'owner-a', active = true, failure = false, status = 'completed', writes = 0;
const row = { id: course.config.id, owner_id: owner, payload: course, updated_at: '2026-09-16T00:00:00.000Z' };
const db = { from(table) {
  const filters = {}; let patch;
  const query = { select() { return query; }, eq(key, value) { filters[key] = value; return query; }, is(key, value) { filters[key] = value; return query; }, update(value) { patch = value; return query; }, async maybeSingle() {
    if (failure) return { error: new Error('Do not expose database details') };
    if (table === 'generation_jobs') return { data: status ? { status } : null };
    if (filters.owner_id !== row.owner_id || filters.id !== row.id || (patch && filters.updated_at !== row.updated_at)) return { data: null };
    if (patch) { Object.assign(row, structuredClone(patch)); writes++; }
    return { data: structuredClone(row) };
  } }; return query;
} }; withCourseCommitRpc(db);
const handler = createRefinementHandler({ enabled: () => active, authenticate: async () => { if (!owner) throw Object.assign(new Error('Sign in first.'), { statusCode: 401 }); return { user: { id: owner }, client: db }; } });
async function request(method = 'GET', body, suffix = '') {
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, status(code) { this.code = code; return this; }, json(data) { this.data = data; return this; } };
  await handler({ method, url: `/api/courses/refine?courseId=${course.config.id}${suffix}`, ...(body === undefined ? {} : { body }) }, res);
  check(res.headers['Cache-Control'] === 'no-store', 'private responses are not cacheable');
  return res;
}
active = false; check((await request()).code === 503, 'disabled route rejects'); active = true;
check((await request('DELETE')).code === 405, 'method admission');
owner = null; check((await request()).code === 401, 'authentication required');
owner = 'owner-b'; check((await request()).code === 404, 'cannot load another account course'); owner = 'owner-a';
let result = await request(); check(result.code === 200 && result.data.baseHash === refinementFingerprint(course), 'load returns authoritative fingerprint');
const baseHash = result.data.baseHash, replacement = { ...course.modules[1]['lesson-1'].sections[0], title: 'A clearer starting concept' };
const preview = { action: 'preview', courseId: course.config.id, target, replacement, baseHash };
check((await request('POST', '{bad')).code === 400, 'malformed JSON rejected');
check((await request('POST', 'x'.repeat(1080001))).code === 400, 'request size bounded');
check((await request('POST', { ...preview, courseId: '../wrong' })).code === 400, 'unsafe course ID rejected');
check((await request('POST', { ...preview, action: 'publish' })).code === 400, 'editing cannot publish');
for (const state of ['running', 'queued', 'partial', 'cancelled']) { status = state; check((await request()).data.code === 'building', 'build state blocks editing: ' + state); }
status = null; check((await request()).code === 200, 'pruned job does not block complete course'); status = 'completed';
course.failedTopics = ['lesson-2']; check((await request()).data.code === 'building', 'partial course blocked'); course.failedTopics = original.failedTopics;
check((await request('POST', { ...preview, baseHash: 'stale' })).data.code === 'conflict', 'stale preview rejected');
result = await request('POST', { ...preview, replacement: { ...replacement, content: 'short' } });
check(result.data.code === 'validation' && result.data.error.includes('content'), 'actionable validation without applying: ' + JSON.stringify(result.data));
result = await request('POST', { ...preview, replacement: original.modules[1]['lesson-1'].sections[0] });
check(!result.data.changed && writes === 0, 'no-op preview writes nothing');
result = await request('POST', preview);
check(result.code === 200 && result.data.changed && writes === 0 && JSON.stringify(course) === JSON.stringify(original), 'preview is not acceptance');
const accept = { ...preview, action: 'accept', operationId: 'api-first-operation', replacement: result.data.replacement, ownerId: 'owner-b' };
result = await request('POST', accept); check(result.code === 200 && writes === 1 && row.owner_id === 'owner-a', 'accept uses authenticated owner, not caller owner');
check((await request('POST', accept)).code === 200 && writes === 1, 'same-save replay does not write twice');
check((await request('POST', { ...accept, operationId: 'different-operation' })).data.code === 'conflict' && writes === 1, 'stale new operation cannot overwrite');
failure = true; result = await request(); check(result.code === 503 && !result.data.error.includes('database details'), 'database failures are private and honest'); failure = false;

let identity = { id: 'a' }, sessionOwner = 'a', response, seen, clientFailure;
const client = createCourseRefinementClient({ getIdentity: () => identity, getClient: async () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: sessionOwner }, access_token: 'synthetic-token' } } }) } }), fetcher: async (url, options) => { seen = { url, options }; if (clientFailure) throw clientFailure; return response; } });
const reject = async (work, code) => { await assert.rejects(work, error => error.code === code); checks++; };
response = new Response(JSON.stringify({ payload: {}, baseHash: 'hash' }));
await client.load('a', 'some-course'); check(seen.url.endsWith('?courseId=some-course') && seen.options.method === 'GET' && seen.options.cache === 'no-store', 'load URL/method/private cache');
check(seen.options.headers.Authorization === 'Bearer synthetic-token', 'request carries account session');
response = new Response(JSON.stringify({ changed: true })); await client.preview('a', { courseId: 'some-course' });
check(JSON.parse(seen.options.body).action === 'preview' && seen.options.method === 'POST', 'preview has distinct action');
response = new Response(JSON.stringify({ changed: true })); await client.accept('a', { operationId: 'same-operation' });
check(JSON.parse(seen.options.body).operationId === 'same-operation' && JSON.parse(seen.options.body).action === 'accept', 'accept preserves idempotency key');
identity = { id: 'b' }; await reject(client.load('a', 'course'), 'account'); identity = { id: 'a' };
sessionOwner = 'b'; await reject(client.load('a', 'course'), 'account'); sessionOwner = 'a';
clientFailure = new Error('network'); await reject(client.accept('a', {}), 'unavailable'); clientFailure = null;
response = new Response('not-json'); await reject(client.load('a', 'course'), 'unavailable');
response = new Response(JSON.stringify({ code: 'conflict', error: 'Newer copy exists' }), { status: 409 }); await reject(client.preview('a', {}), 'conflict');
response = { ok: true, async json() { identity = { id: 'b' }; return { payload: {} }; } }; await reject(client.load('a', 'course'), 'account');
console.log(`Refinement API/client: ${checks} checks passed.`);
