import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setupDraft } from '../web/js/setup-model.js';
import { reviewSourceDraft, inspectReviewSources, acceptedReviewSources } from '../web/api/_lib/review-sources.mjs';
import { buildReviewTransition } from '../web/api/gen/review.js';
import { createReviewSourcesHandler } from '../web/api/gen/sources.js';

let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const draft = setupDraft('Window light photography'); draft.brief.audience = 'Beginners'; draft.components = ['lessons'];
draft.sources.notes.push({ id: 'original', title: 'Original note', text: 'OLD MATERIAL' });
const job = { id: 'job-review-sources-test', owner_id: 'owner', status: 'review_research', run_id: 'run-original', user_brief: { ...draft.brief, components: draft.components, source_manifest: draft.sources, source_storage_id: 'setup-original', source_text: 'OLD MATERIAL' }, brief: { id: 'photo', title: 'Photography', components: ['lessons'], modules: [{ id: 'm1', title: 'Light', topics: [] }] }, research: { m1: { key_concepts: ['Old evidence'] } }, extracted_urls: [{ url: 'https://example.com/old', textContent: 'old' }] };
const original = structuredClone(job);
const objects = new Map();
const client = { storage: { from() { return { download: async key => ({ data: objects.get(key), error: !objects.has(key) }) }; } }, from() { const filters = {}; return { select() { return this; }, eq(key, value) { filters[key] = value; return this; }, async maybeSingle() { return { data: filters.owner_id === 'owner' && filters.id === job.id ? job : null, error: null }; } }; } };
const current = await reviewSourceDraft(job, 'owner', client);
check(current.draft.sources.notes[0].text === 'OLD MATERIAL', 'reads accepted source snapshot');
const sources = structuredClone(draft.sources); sources.notes[0].text = 'NEW TRANSCRIPT'; sources.links = [{ id: 'new-link', title: '', url: 'https://example.com/new' }];
const input = { expectedRunId: job.run_id, sources };
const inspected = await inspectReviewSources(job, 'owner', client, input);
check(inspected.inspection.source_text.includes('NEW TRANSCRIPT'), 'new raw text is inspected');
check(inspected.inspection.review.complete, 'notes need no file acknowledgement');
assert.deepEqual(job, original); checks++;
await assert.rejects(() => acceptedReviewSources(job, 'owner', client, { ...input, sourceReview: 'tampered' }), /Check the source changes/); checks++;
const accepted = await acceptedReviewSources(job, 'owner', client, { ...input, sourceReview: inspected.inspection.review.digest });
check(accepted.source_manifest.notes[0].text === 'NEW TRANSCRIPT', 'keeps structured sources for later edits');
assert.deepEqual(accepted.source_review.previous_research, job.research); checks++;
const transition = buildReviewTransition({ action: 'rerun_research', job, sourceUpdate: accepted, runId: 'new-run' });
check(transition.runnerMode === 'research', 'recheck pauses before lessons');
assert.deepEqual(transition.patch.brief.modules, job.brief.modules); checks++;
assert.deepEqual(transition.patch.brief.components, ['lessons']); checks++;
check(transition.runnerRow.user_brief.source_text.includes('NEW TRANSCRIPT'), 'runner request has new text');
check(!transition.checkpoint.brief.source_text.includes('OLD MATERIAL'), 'removed text does not survive in research input');
assert.deepEqual(transition.checkpoint.extracted_urls, []); checks++;
assert.deepEqual(transition.patch.extracted_urls, []); checks++;
assert.throws(() => buildReviewTransition({ action: 'approve_research', job, sourceUpdate: accepted }), /researched again/); checks++;
for (const mutation of [
  { ...input, expectedRunId: 'stale' },
  { sources },
  { ...input, sources: { ...sources, notes: [{ id: 'long', title: '', text: 'x'.repeat(12001) }] } },
  { ...input, sources: { ...sources, links: [{ id: 'bad', title: '', url: 'javascript:alert(1)' }] } },
  { ...input, sources: { ...sources, links: Array.from({ length: 11 }, (_, i) => ({ id: `url-${i}`, title: '', url: 'https://example.com' })) } }
]) { await assert.rejects(() => inspectReviewSources(job, 'owner', client, mutation)); checks++; }
const bytes = Buffer.from('A real source file transcript.'), sha256 = createHash('sha256').update(bytes).digest('hex');
const file = { id: 'source-file', name: 'transcript.txt', size: bytes.length, sha256 };
objects.set(`owner/setup-original/${file.id}/${sha256}`, new Blob([bytes]));
const withFile = { ...input, sources: { ...sources, files: [file] } };
const overBudget = await inspectReviewSources(job, 'owner', client, { ...input, sources: { ...sources, notes: Array.from({ length: 4 }, (_, i) => ({ id: `part-${i}`, title: '', text: 'x'.repeat(12000) })) } });
check(!overBudget.inspection.review.complete && overBudget.inspection.review.characters > 48000, 'labels count toward aggregate budget; no silent truncation');
const fileCheck = await inspectReviewSources(job, 'owner', client, withFile);
check(fileCheck.inspection.review.requiresReview && fileCheck.inspection.review.complete, 'real file text requires explicit review');
check(fileCheck.inspection.source_text.includes(bytes.toString()), 'real file content reaches combined text');
await assert.rejects(() => acceptedReviewSources(job, 'owner', client, { ...withFile, sourceReview: inspected.inspection.review.digest }), /Check the source changes/); checks++;
objects.clear();
check(!(await inspectReviewSources(job, 'owner', client, withFile)).inspection.review.complete, 'missing original blocks application');
const legacy = { ...job, user_brief: { topic: 'Legacy', source_text: '🙂'.repeat(12002) } };
const legacyDraft = await reviewSourceDraft(legacy, 'owner', client);
check(legacyDraft.draft.sources.notes.length === 2 && legacyDraft.draft.sources.notes.map(n => n.text).join('') === legacy.user_brief.source_text, 'legacy Unicode text is split losslessly');
const handler = createReviewSourcesHandler({ authenticate: async req => ({ user: { id: req.owner } }), admin: () => client });
async function call(owner, body) { const res = { setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; await handler({ method: 'POST', owner, body }, res); return res; }
check((await call('other', { jobId: job.id, action: 'read' })).code === 404, 'other account cannot load sources');
check((await call('owner', { jobId: job.id, action: 'read' })).code === 200, 'owner can load sources');
check((await call('owner', { jobId: job.id, action: 'check', ...input })).code === 200, 'check API inspects without changing job');
check((await call('owner', null)).code === 400, 'malformed source request is an actionable client error');
check((await call('owner', { jobId: job.id, action: 'delete' })).code === 400, 'unknown action cannot delete source state');
assert.deepEqual(job, original); checks++;
console.log(`Review sources: ${checks} checks passed. Real TXT parser; no AI or external writes.`);
