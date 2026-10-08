import assert from 'node:assert/strict';
import { setupDraft, setupURL, setupIssues, splitNote, sourceUrlIssue, fileProblem, sourceCounts } from '../web/js/setup-model.js';
import { draftContent, draftExport } from '../web/js/draft-store.js';
import { createSetupSessions } from '../web/js/setup-session.js';

const checks = [];
function check(ok, label) { assert.ok(ok, label); checks.push(label); }
const valid = setupDraft('Swimming confidence'); valid.brief.audience = 'Parent and child';
check(setupIssues(valid).length === 0, 'minimal complete setup');
check(setupIssues(setupDraft()).length === 2, 'topic and audience required');
check(new URLSearchParams(setupURL('a&step=bad').slice(1)).get('draft') === 'a&step=bad', 'route escaping');
check(setupURL('a', 'bad').endsWith('step=goal'), 'unknown step fallback');
const raw = '😀'.repeat(12001) + '\n  End\n';
const parts = splitNote({ id: 'n1', title: 'Transcript', text: raw }, () => crypto.randomUUID());
check(parts.length === 2 && parts.map(p => p.text).join('') === raw, 'Unicode split is lossless including whitespace');
check(parts[0].id === 'n1' && parts[0].text.length === 24000, 'split uses characters not UTF-16 units');
check(!sourceUrlIssue('https://example.com/article?q=x#section'), 'public HTTPS syntax accepted');
for (const url of ['javascript:alert(1)', 'data:text/html,a', 'file:///tmp/a', 'example.com', 'http://localhost/a', 'http://127.0.0.1', 'http://[::1]', 'https://user:pass@example.com']) check(!!sourceUrlIssue(url), `reject unsafe/local URL syntax: ${url}`);
check(sourceUrlIssue('') === '', 'empty URL row remains optional');
check(fileProblem({ name: 'a.exe', size: 10 }).includes('PDF'), 'file type filter');
check(fileProblem({ name: 'a.pdf', size: 0 }).includes('empty'), 'empty file rejected');
check(fileProblem({ name: 'a.pdf', size: 10485761 }).includes('10 MB'), 'file byte limit');
check(fileProblem({ name: 'a.pdf', size: 10 }, [{ id: 'a', name: 'a.pdf', size: 10 }]).includes('already included'), 'duplicate name-size check');
check(fileProblem({ name: 'a.pdf', size: 10 }, [{ id: 'a', name: 'a.pdf', size: 10 }], 'a') === '', 'reattach may replace missing row');
check(fileProblem({ name: 'a.pdf', size: 10 }, Array.from({ length: 5 }, (_, i) => ({ id: `${i}` }))).includes('five'), 'file count limit');
const full = draftContent({ ...valid, components: ['images', 'images', 'evil'], sources: { notes: parts, links: [{ id: 'l1', url: 'incomplete' }], files: [{ id: 'f1', name: 'gone.txt', size: 5 }] } });
check(full.components.join(',') === 'lessons,images', 'components allowlist and required lessons');
check(setupIssues(full).length === 2, 'bad link and missing file need review');
check(sourceCounts(full).notes === 2 && sourceCounts(full).files === 1, 'source counts');
check(JSON.parse(draftExport(full)).components.includes('images'), 'components included in backup');

let owner = null, failure = null, hold = null;
const rows = new Map(), writes = [];
const key = (id, owner) => JSON.stringify([owner, id]);
const store = {
  async save(input, options) {
    writes.push({ input, options });
    if (hold) await hold;
    if (failure) throw { code: failure };
    const k = key(input.id, options.ownerId), old = rows.get(k);
    if ((old?.revision || 0) !== (options.expectedRevision || 0)) throw { code: 'conflict' };
    const record = { ...draftContent(input), id: input.id, revision: (old?.revision || 0) + 1, expiresAt: Date.now() + 100000, updatedAt: Date.now() };
    rows.set(k, record); return record;
  },
  async load(id, owner) { const draft = rows.get(key(id, owner)); return draft ? { status: 'found', draft } : { status: 'missing' }; },
  async list(owner) { if (failure) throw { code: failure }; return { drafts: [...rows.entries()].filter(([k]) => JSON.parse(k)[0] === owner).map(([, draft]) => draft) }; }
};
const sessions = createSetupSessions({ store, getOwner: () => owner });
const first = await sessions.start({ topic: 'Original' }); await sessions.flush(first);
check(first.record.revision === 1, 'new setup saves with stable ID');
let release;
hold = new Promise(resolve => { release = resolve; });
first.draft.brief.topic = 'During save 1'; sessions.edit(first); const saving = sessions.flush(first);
first.draft.brief.topic = 'During save 2'; sessions.edit(first);
release(); hold = null; await saving;
check(rows.get(key(first.id, null)).brief.topic === 'During save 2', 'edits made during a save are serialized');
failure = 'quota'; first.draft.brief.context = 'Unsaved context'; sessions.edit(first); await sessions.flush(first);
check(first.error.code === 'quota' && (await sessions.open(first.id)).session === first, 'failed saves retain in-tab buffer');
check((await sessions.list()).drafts[0].unsaved === true, 'unsaved setup remains discoverable when storage fails');
owner = 'alice';
check((await sessions.open(first.id)).status === 'missing', 'guest setup is not auto-claimed by account');
check((await sessions.list()).drafts.length === 0, 'guest buffer not visible to another owner');
const count = writes.length; await sessions.flush(first);
check(writes.length === count, 'old-owner session cannot start another save');
owner = null; failure = null; await sessions.flush(first);
check(first.version === first.savedVersion, 'retry saves full current buffer');
const before = rows.get(key(first.id, null)); rows.set(key(first.id, null), { ...before, revision: before.revision + 1, brief: { ...before.brief, topic: 'Other tab' } });
first.draft.brief.topic = 'My tab'; sessions.edit(first); await sessions.flush(first);
check(first.error.code === 'conflict', 'optimistic conflict is explicit');
const copy = await sessions.fork(first);
check(copy.id !== first.id && rows.get(key(first.id, null)).brief.topic === 'Other tab' && rows.get(key(copy.id, null)).brief.topic === 'My tab', 'conflict save-copy preserves both records');
check(!sessions.hasUnsaved(), 'successful copy retires only its old unsaved buffer');
const file = new Blob(['original source']); copy.draft.sources.files = [{ id: 'f1', name: 'a.txt', blob: file }];
sessions.edit(copy); await sessions.flush(copy);
check(await rows.get(key(copy.id, null)).sources.files[0].blob.text() === 'original source', 'file bytes included in commit');
check((await sessions.list()).drafts.length === 2, 'multiple setups listed independently');
console.log(`Guest setup: ${checks.length} model/session checks passed.`);
