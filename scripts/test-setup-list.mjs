import assert from 'node:assert/strict';
import { mergeUnfinishedSetups } from '../web/js/setup-list.js';
import { setupDraft } from '../web/js/setup-model.js';
import { prepareAccountPayload } from '../web/js/setup-account-model.js';
const draft = { id: 'setup-list-qa', ...setupDraft('A saved course request') };
draft.brief.audience = 'A beginner';
draft.sources.notes = [{ id: 'note', title: '', text: 'Keep this private original.' }];
draft.sources.files = [{ id: 'file', name: 'original.txt', blob: new Blob(['private source bytes']) }];
const prepared = await prepareAccountPayload(draft);
draft.cloud = { contentHash: prepared.hash, revision: 1 };
const row = { id: draft.id, brief: draft.brief, content_hash: prepared.hash, generation: { id: 'job-owned', status: 'completed' }, updated_at: new Date().toISOString() };
assert.deepEqual(await mergeUnfinishedSetups([draft], [row]), [], 'unchanged completed request is not listed as incomplete');
assert.deepEqual(await mergeUnfinishedSetups([], [row]), [], 'new device also omits represented request');
assert.equal(draft.sources.notes[0].text, 'Keep this private original.');
assert.equal(await draft.sources.files[0].blob.text(), 'private source bytes', 'originals were not mutated/deleted');
for (const status of ['running', 'review_curriculum', 'review_research', 'partial', 'failed', 'timed_out']) assert.equal((await mergeUnfinishedSetups([draft], [{ ...row, generation: { ...row.generation, status } }])).length, 0);
for (const change of [
  { unsaved: true }, { cloud: undefined },
  { brief: { ...draft.brief, topic: 'Edited course' } },
  { components: ['lessons'] },
  { sources: { ...draft.sources, notes: [{ id: 'note', title: '', text: 'Edited note' }] } },
  { sources: { ...draft.sources, files: [{ id: 'file', name: 'original.txt', blob: new Blob(['changed bytes']) }] } },
  { sources: { ...draft.sources, files: [{ id: 'file', name: 'original.txt', blob: null }] } },
]) assert.equal((await mergeUnfinishedSetups([{ ...draft, ...change }], [row])).length, 1, 'new/unsaved/unverifiable work remains discoverable');
assert.equal((await mergeUnfinishedSetups([draft], [])).length, 1, 'missing account listing cannot hide local work');
assert.equal((await mergeUnfinishedSetups([], [{ ...row, generation: null }])).length, 1, 'unstarted account request stays visible');
assert.equal((await mergeUnfinishedSetups([draft], [{ ...row, generation: { id: 'cancelled-job', status: 'cancelled' } }])).length, 1, 'cancelled setup is retained for recovery');
assert.equal((await mergeUnfinishedSetups([draft], [{ ...row, content_hash: 'different' }])).length, 1, 'different account version cannot hide local edits');
console.log('unfinished setup listing checks passed: exact content, remote recovery, edits, missing files, cancellation and non-destructive behavior');
