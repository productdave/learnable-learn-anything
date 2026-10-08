import assert from 'node:assert/strict';
import { createCourseRefinementClient } from '../web/js/course-refinement-client.js';
let checks = 0, owner = 'owner-a', calls = [], fail = false, changeDuringResponse = false;
const check = (value, label) => { assert.ok(value, label); checks++; };
const client = createCourseRefinementClient({
  getIdentity: () => owner ? { id: owner } : null,
  getClient: async () => ({ auth: { getSession: async () => ({ data: { session: { user: { id: owner }, access_token: 'synthetic-auth-token' } } }) } }),
  fetcher: async (url, options) => {
    calls.push({ url, options });
    if (fail) throw new Error('private network detail');
    return { ok: true, json: async () => { if (changeDuringResponse) owner = 'owner-b'; return { request: { id: 'saved-operation', status: 'running' } }; } };
  }
});
await client.proposalStatus(owner, 'course / id');
check(calls[0].url === '/api/courses/proposal?courseId=course%20%2F%20id' && calls[0].options.method === 'GET', 'read status uses account endpoint with encoded course ID');
check(calls[0].options.cache === 'no-store' && calls[0].options.headers.Authorization === 'Bearer synthetic-auth-token', 'private status request uses session authorization and no cache');
const input = { courseId: 'course-a', operationId: 'a-stable-operation', expectedRequestId: null, consent: true, instructions: 'Clearer explanation', workingReplacement: { title: 'My unsaved draft' } };
for (const [method, action] of [['startProposal', 'start'], ['resumeProposal', 'resume'], ['cancelProposal', 'cancel'], ['discardProposal', 'discard']]) {
  await client[method](owner, input); const call = calls.at(-1), body = JSON.parse(call.options.body);
  check(call.url === '/api/courses/proposal' && call.options.method === 'POST' && body.action === action, 'correct explicit action: ' + action);
  check(body.operationId === input.operationId && body.workingReplacement.title === input.workingReplacement.title, 'operation and draft remain intact: ' + action);
}
fail = true;
await assert.rejects(client.startProposal(owner, input), error => error.code === 'unavailable' && /same request/.test(error.message) && !error.message.includes('private network')); checks++;
check(calls.length === 6, 'failed generation transport is not automatically retried');
fail = false; changeDuringResponse = true;
await assert.rejects(client.proposalStatus('owner-a', 'course-a'), error => error.code === 'account'); checks++;
const before = calls.length;
await assert.rejects(client.startProposal('owner-a', input), error => error.code === 'account'); checks++;
check(calls.length === before, 'foreign-owner request rejected before network');
console.log(`AI editor client: ${checks} checks passed; no network or account writes.`);
