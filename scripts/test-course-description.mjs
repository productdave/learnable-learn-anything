import assert from 'node:assert/strict';
import { setupDraft, setupIssues } from '../web/js/setup-model.js';
import { normalizeAccountPayload, prepareAccountPayload } from '../web/js/setup-account-model.js';
import { setupToGenerationBrief } from '../web/api/_lib/setup-generation.mjs';
import { createSetupHandler } from '../web/api/setups/store.js';

const checks = [];
const check = (condition, label) => { assert.ok(condition, label); checks.push(label); };
const draft = setupDraft('Course details\n' + 'x'.repeat(5000 - 15));
draft.brief.audience = 'Beginners';
const prepared = await prepareAccountPayload(draft);
check(prepared.payload.brief.topic === draft.brief.topic, '5,000-character description survives account preparation without truncation');
check(setupIssues(draft).length === 0, '5,000-character description passes setup validation');

const long = structuredClone(draft);
long.brief.topic += 'x';
check(setupIssues(long).some(issue => issue.field === 'topic' && /5,000/.test(issue.text)), 'over-limit description is caught before sign-in');
assert.throws(() => normalizeAccountPayload({ ...prepared.payload, brief: long.brief }), /5,000/);
checks.push('server rejects 5,001 characters');
check(long.brief.topic.length === 5001, 'over-limit validation leaves all pasted text intact');

const unicode = structuredClone(draft);
unicode.brief.topic = '😀'.repeat(5000);
check((await prepareAccountPayload(unicode)).payload.brief.topic === unicode.brief.topic && setupIssues(unicode).length === 0, 'Unicode character count is consistent on client and server');
unicode.brief.topic += '😀';
check(setupIssues(unicode).some(issue => issue.field === 'topic'), '5,001 Unicode characters are rejected before sign-in');

const withNotes = { ...prepared.payload, sources: { ...prepared.payload.sources, notes: [{ id: 'note-1', title: 'Transcript', text: 'n'.repeat(12000) }] } };
check(normalizeAccountPayload(withNotes).sources.notes[0].text.length === 12000, '12,000-character transcript allowance is unchanged');
assert.throws(() => normalizeAccountPayload({ ...withNotes, sources: { ...withNotes.sources, notes: [{ ...withNotes.sources.notes[0], text: 'n'.repeat(12001) }] } }), /12,000/);
checks.push('12,001-character note is still rejected');

const oldFlags = ['LEARNABLE_CREATION_IMAGES', 'LEARNABLE_GPT_IMAGES', 'LEARNABLE_IMAGE_REQUESTS', 'LEARNABLE_IMAGE_FUNDING'].map(key => [key, process.env[key]]);
try {
  for (const [key] of oldFlags) process.env[key] = key === 'LEARNABLE_IMAGE_FUNDING' ? 'creator' : '1';
  const brief = await setupToGenerationBrief({ id: 'description-test', revision: 1, content_hash: prepared.hash, payload: prepared.payload }, 'owner', {}, { source_text: '', issues: [], review: { digest: 'test-digest' } });
  check(brief.topic === draft.brief.topic, 'complete description reaches generation without truncation');
} finally {
  for (const [key, value] of oldFlags) value === undefined ? delete process.env[key] : process.env[key] = value;
}

let committed = null, commits = 0;
const handler = createSetupHandler({
  authenticate: async () => ({ user: { id: 'verified-owner' }, client: {} }),
  admin: () => ({ rpc: async (_name, args) => { commits++; committed = args; return { data: { revision: 1 }, error: null }; } })
});
const response = () => ({ code: 0, body: null, setHeader() {}, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } });
let res = response();
await handler({ method: 'POST', body: { id: 'description-test', expectedRevision: 0, payload: prepared.payload } }, res);
check(res.code === 200 && committed.p_payload.brief.topic === draft.brief.topic && committed.p_owner === 'verified-owner', 'real account API accepts the full description with verified ownership');
res = response();
await handler({ method: 'POST', body: { id: 'description-test', expectedRevision: 0, payload: { ...prepared.payload, brief: long.brief } } }, res);
check(res.code === 400 && commits === 1, 'over-limit API request cannot reach database commit');

console.log(`Course description: ${checks.length} model/API/generation checks passed (no database or AI calls).`);
