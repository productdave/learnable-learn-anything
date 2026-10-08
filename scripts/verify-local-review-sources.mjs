// Real local auth, private uploads, review API, runner and PostgreSQL. Synthetic
// model responses only: external requests other than those fixtures are blocked.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig } from './dev-setup-server.mjs';
import { setupDraft } from '../web/js/setup-model.js';
import { createReviewSourceClient } from '../web/js/review-source-client.js';
import { curriculumFixture } from './fixtures/component-course.mjs';

const config = await loadPreviewConfig(new URL('../.env.preview.local', import.meta.url));
assert.equal(config.mode, 'local'); assert.equal(config.url, 'http://127.0.0.1:54321');
Object.assign(process.env, { SUPABASE_URL: config.url, SUPABASE_ANON_KEY: config.publicKey, SUPABASE_SECRET_KEY: config.secretKey, LEARNABLE_PROVIDER_VAULT_KEY: config.vaultKey });
const { createReviewHandler } = await import('../web/api/gen/review.js');
const { sealProviderKey } = await import('../web/api/_lib/provider-vault.mjs');
const admin = createClient(config.url, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const base = 'http://127.0.0.1:4173', originalFetch = globalThis.fetch, owners = [], jobId = `job-review-qa-${randomUUID()}`, prompts = [], pending = [];
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
globalThis.fetch = async (input, options) => {
  const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url);
  if (url.origin === 'https://api.anthropic.com' && url.pathname === '/v1/messages') {
    const request = JSON.parse(options.body); prompts.push(request);
    const name = request.tools?.find(tool => tool.name === 'submit_research_bundle')?.name;
    assert.equal(name, 'submit_research_bundle', 'recheck must not call curriculum/lesson tools');
    return new Response(JSON.stringify({ content: [{ type: 'tool_use', name, input: { module_id: 'foundations', key_concepts: ['Natural light', 'Clear composition'], examples: ['Window portrait', 'Single subject'], sources: [], images: [] } }], usage: { input_tokens: 10, output_tokens: 10 } }), { headers: { 'Content-Type': 'application/json' } });
  }
  if (![base, config.url].includes(url.origin)) throw new Error('External request blocked by source-review QA.');
  return originalFetch(input, options);
};
try {
  async function account() {
    const email = `review-sources-${randomUUID()}@example.test`, password = `${randomUUID()}Aa9!`;
    const made = await admin.auth.admin.createUser({ email, password, email_confirm: true }); assert.ok(!made.error); const owner = made.data.user.id; owners.push(owner);
    const sdk = createClient(config.url, config.publicKey, { auth: { persistSession: false, autoRefreshToken: false } });
    const auth = await sdk.auth.signInWithPassword({ email, password }); assert.ok(!auth.error);
    return { sdk, owner, token: auth.data.session.access_token };
  }
  const first = await account(), second = await account();
  const draft = setupDraft('Source-review integration QA'); draft.brief.audience = 'New photographers'; draft.components = ['lessons'];
  draft.sources.notes = [{ id: 'old-note', title: '', text: 'OLD SOURCE REMOVED' }];
  const brief = curriculumFixture(); brief.components = ['lessons']; brief.source_text = 'OLD SOURCE REMOVED';
  const initialResearch = { foundations: { module_id: 'foundations', key_concepts: ['Old accepted research'], examples: ['Old example'] } };
  const inserted = await admin.from('generation_jobs').insert({ id: jobId, owner_id: first.owner, status: 'review_research', stage: 'research', run_id: randomUUID(), brief, research: initialResearch, user_brief: { ...draft.brief, components: ['lessons'], source_manifest: draft.sources, source_storage_id: jobId, source_text: 'OLD SOURCE REMOVED' } }); assert.ok(!inserted.error);
  const sourceClient = createReviewSourceClient({ getClient: async () => first.sdk, getIdentity: () => ({ id: first.owner }), fetcher: (url, options) => fetch(base + url, options) });
  const state = await sourceClient.read(first.owner, jobId);
  check(state.draft.sources.notes[0].text === 'OLD SOURCE REMOVED', 'real API loads accepted source manifest');
  const other = await fetch(base + '/api/gen/sources', { method: 'POST', headers: { Authorization: `Bearer ${second.token}`, 'Content-Type': 'application/json' }, body: JSON.stringify({ jobId, action: 'read' }) });
  check(other.status === 404, 'second account cannot read job sources');
  const edited = structuredClone(state.draft); edited.sources.notes[0].text = 'NEW INTERVIEW TRANSCRIPT';
  const file = new File(['NEW FILE: use a window for soft light.'], 'interview.txt', { type: 'text/plain' });
  edited.sources.files.push({ id: 'interview', name: file.name, size: file.size, type: file.type, blob: file });
  const checked = await sourceClient.check(first.owner, jobId, state, edited);
  check(checked.sources.complete && checked.sources.requiresReview, 'actual upload and real text extraction require acknowledgement');
  check(checked.sources.files[0].text.includes('NEW FILE'), 'source text preview contains actual file content');
  const load = async () => { const result = await admin.from('generation_jobs').select('*').eq('id', jobId).single(); assert.ok(!result.error); return result.data; };
  let job = await load(); check(job.run_id === state.runId && job.user_brief.source_text === 'OLD SOURCE REMOVED', 'checking leaves accepted request/run unchanged');
  const path = `${first.owner}/${jobId}/interview/${checked.changes.sources.files[0].sha256}`;
  const denied = await second.sdk.storage.from('setup-sources').download(path); check(!!denied.error, 'other account cannot download original');
  const handler = createReviewHandler({ background: promise => pending.push(promise) });
  async function apply(changes) {
    const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } };
    await handler({ method: 'POST', headers: { authorization: `Bearer ${first.token}` }, body: { jobId, action: 'rerun_research', expected: { status: 'review_research', runId: changes.expectedRunId }, sourceChanges: changes } }, res); return res;
  }
  check((await apply({ ...checked.changes, sourceReview: 'tampered' })).code === 409, 'unreviewed/altered source digest rejected');
  const noKey = await apply(checked.changes); check(noKey.code >= 400, 'missing provider connection blocks paid work');
  job = await load(); check(job.run_id === state.runId && job.user_brief.source_text === 'OLD SOURCE REMOVED', 'missing credentials preserve accepted sources');
  check(prompts.length === 0, 'read/check/invalid/missing-key paths make no model requests');
  const key = 'sk-ant-synthetic-review-QA-only';
  assert.ok(!(await admin.from('provider_connections').insert({ owner_id: first.owner, provider: 'anthropic', encrypted_key: sealProviderKey(key, first.owner) })).error);
  check((await apply(checked.changes)).code === 200, 'explicit source confirmation accepted once');
  check((await apply(checked.changes)).code === 409, 'duplicate/stale submission cannot start another run');
  await Promise.all(pending);
  job = await load();
  check(job.status === 'review_research', 'real runner returns to research review, not lesson generation');
  check(job.id === jobId && job.saved_course_id === null, 'same job identity, no premature course creation');
  assert.deepEqual(job.brief.modules, brief.modules); checks++;
  assert.deepEqual(job.brief.components, ['lessons']); checks++;
  assert.deepEqual(job.user_brief.source_review.previous_research, initialResearch); checks++;
  check(job.user_brief.source_manifest.files[0].id === 'interview', 'new source manifest persists');
  check(prompts.length === brief.modules.length, 'only research calls, once per module');
  for (const prompt of prompts) {
    const text = JSON.stringify(prompt.messages);
    check(text.includes('NEW INTERVIEW TRANSCRIPT') && text.includes('NEW FILE'), 'real model request includes new note and file');
    check(!text.includes('OLD SOURCE REMOVED'), 'removed source does not leak through old checkpoint');
  }
  const reopened = await sourceClient.read(first.owner, jobId);
  check(reopened.draft.sources.files[0].blob instanceof Blob, 'reopening restores original private file');
  check(reopened.draft.sources.notes[0].text === 'NEW INTERVIEW TRANSCRIPT', 'reopening restores accepted edits');
  await assert.rejects(() => sourceClient.check(first.owner, jobId, state, edited), /changed in another tab/); checks++;
  console.log(`Local review sources: ${checks} checks passed; ${prompts.length} synthetic research call(s), no paid AI.`);
} finally {
  await Promise.allSettled(pending);
  // Remove only this test's explicitly tracked records and private objects.
  for (const owner of owners) {
    const list = await admin.storage.from('setup-sources').list(`${owner}/${jobId}/interview`);
    const paths = (list.data || []).map(file => `${owner}/${jobId}/interview/${file.name}`);
    if (paths.length) await admin.storage.from('setup-sources').remove(paths);
    await admin.from('generation_jobs').delete().eq('id', jobId).eq('owner_id', owner);
    await admin.auth.admin.deleteUser(owner);
  }
  globalThis.fetch = originalFetch;
}
