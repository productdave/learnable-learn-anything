import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { researchEvidence, researchEvidenceHTML, safeEvidenceURL, researchTextItems, reviewIdentity, captureReviewState, restoreReviewState } from '../web/js/research-evidence.js';
import { hasCompleteResearchCheckpoint, isUsableResearchBundle } from '../web/api/_lib/gen-research-checkpoint.mjs';
import { jobPatchFromRow } from '../web/js/cloud-gen-client.js';

let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
globalThis.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
for (const bad of ['', 'javascript:alert(1)', 'data:text/html,hi', 'file:///private/file', 'https://name:secret@example.com', 'http://localhost', 'http://127.0.0.1', 'https://[::1]', 'https://service.internal', 'not a url']) {
  check(!safeEvidenceURL(bad), `unsafe/nonpublic link is not navigable: ${bad}`);
}
check(safeEvidenceURL(' HTTPS://Example.COM/guide?q=one#read ') === 'https://example.com/guide?q=one#read', 'safe link canonicalization retains path/query/fragment');
const row = {
  id: 'evidence-test', owner_id: 'owner', status: 'review_research', run_id: 'run-1',
  user_brief: { source_urls: ['https://example.com/read', 'https://example.com/fail', 'https://example.com/empty', 'https://example.com/query?a=1', 'https://example.com/query?a=2', 'https://name:secret@example.com', 'https://example.com/read'],
    source_manifest: { links: [{ title: 'Workshop handout', url: 'https://example.com/read' }] } },
  brief: { modules: [{ id: 'm1', title: '<script>bad</script>' }, { id: 'm2', title: 'Empty research' }, { id: 'm3', title: 'Legacy research' }, { id: 'm4', title: 'Notes-only research' }] },
  research: {
    m1: { key_concepts: ['Observe light'], examples: 'Legacy single example', misconceptions: [42, 'More equipment is always better'], sources: [
      { title: 'Light & shadow', url: 'https://example.com/reference?x=1&y=2' },
      { title: 'Same reference', url: 'https://example.com/reference?x=1&y=2' },
      { title: '<img src=x onerror=bad()>', url: 'javascript:bad()' },
      { url: 'https://name:secret@example.com' }, null, 9, { title: 'Printed handbook' }
    ] },
    m2: {}, m3: { key_concepts: 'A legacy concept', sources: 'A legacy book' }, m4: { key_concepts: ['Private source concept'] }
  },
  extracted_urls: [
    { requestedUrl: 'https://example.com/read', url: 'https://reference.example.com/final', ok: true, textContent: 'PRIVATE EXTRACT BODY' },
    { url: 'https://example.com/fail', ok: false, error: '<script>private server detail</script>', textContent: 'stale partial data' },
    { url: 'https://example.com/empty', ok: true, textContent: '   ' },
    { url: 'https://example.com/query?a=10', ok: true, textContent: 'Wrong query' },
    { requestedUrl: 'https://example.com/other', url: 'https://example.com/query?a=2', ok: true, textContent: 'Wrong original request' }
  ]
};
const job = { id: row.id, ...jobPatchFromRow(row) };
const evidence = researchEvidence(job);
check(evidence.modules.length === 4 && evidence.missing === 1 && !evidence.complete, 'real cloud row mapping exposes all modules and blocks an empty bundle');
check(evidence.complete === hasCompleteResearchCheckpoint(row.brief, row.research), 'browser and server agree on completeness');
check(evidence.referenced === 2 && evidence.unreferenced === 1, 'reference coverage is counted per researched module');
check(evidence.submitted.length === 6, 'duplicate exact submitted links collapse');
check(evidence.submitted[0].status === 'available' && evidence.submitted[0].redirected, 'redirected readable source is matched by requested URL');
check(evidence.submitted[0].title === 'Workshop handout', 'submitted title comes from manifest');
check(evidence.submitted[1].status === 'failed', 'explicit failure wins over stale partial text');
check(evidence.submitted[2].status === 'unknown', 'ok without text is not successful reading');
check(evidence.submitted[3].status === 'unknown', 'different query is not a prefix match');
check(evidence.submitted[4].status === 'unknown', 'redirect destination is not evidence of reading another submitted request');
check(evidence.submitted[3].title !== evidence.submitted[4].title, 'untitled URLs on the same domain have distinguishable labels');
check(evidence.submitted[5].status === 'invalid' && !evidence.submitted[5].url, 'invalid submitted address remains a visible nonclickable warning');
check(evidence.modules[0].references.length === 4, 'duplicate URLs removed while title-only and invalid references remain');
check(evidence.modules[2].references[0].title === 'A legacy book', 'legacy string reference is retained');
check(evidence.modules[0].examples[0] === 'Legacy single example', 'legacy string examples render without crashing');
check(researchTextItems([{}, null, 5, 'ok']).join() === 'ok', 'malformed text fields are excluded');

const html = researchEvidenceHTML(evidence);
const { document } = parseHTML(`<html><body>${html}</body></html>`);
check(document.querySelectorAll('script,img').length === 0, 'reference/module titles are escaped');
check(!html.includes('name:secret') && !html.includes('javascript:'), 'unsafe raw addresses are not disclosed in markup');
check(!html.includes('PRIVATE EXTRACT BODY') && !html.includes('private server detail'), 'private body/error internals are not dumped into review');
check(document.querySelectorAll('a').length === 6, 'safe submitted links and deduplicated reference are clickable');
check([...document.querySelectorAll('a')].every(a => a.target === '_blank' && a.rel === 'noopener noreferrer' && a.getAttribute('referrerpolicy') === 'no-referrer'), 'external navigation is isolated with no referrer');
check(document.body.textContent.includes('No references listed'), 'missing citations are disclosed');
check(document.body.textContent.includes('check the reference manually'), 'title-only/bad-address references have recovery copy');
check(document.body.textContent.includes('not independently verified'), 'agent citations are not presented as verified');
check(document.body.textContent.includes('may reuse earlier link-read results'), 'plain rerun does not promise another URL fetch');

// Review must not silently hide claims that can be used by the lesson writer.
const completeNotes = {
  key_concepts: ['Concept 1', 'Concept 2', 'Concept 3', 'Concept 4', 'Phone controls vary by model', 'Concept 6', '<img src=x onerror=bad()>'],
  examples: ['Example 1', 'Example 2', 'Example 3', 'Observe without promising an effect', 'Example 5'],
  misconceptions: ['Misconception 1', 'Misconception 2', 'Window light is not always soft', 'Misconception 4'],
  sources: [{ title: 'Supplied workshop notes' }]
};
const completeHTML = researchEvidenceHTML(researchEvidence({ review: { researchResults: [
  { mod: { title: 'Review every learning note' }, bundle: completeNotes }
] } }));
const completeDOM = parseHTML(`<html><body>${completeHTML}</body></html>`).document;
const allNotes = completeDOM.querySelector('[data-evidence-panel="module-0-notes"]');
check(!!allNotes, 'long research has an explicit full learning-notes disclosure');
check(allNotes.tagName === 'DETAILS' && !!allNotes.querySelector('summary'), 'full notes use native keyboard-accessible disclosure');
check(allNotes.querySelector('summary').textContent.includes('16'), 'disclosure reports the complete learning-note count');
for (const value of [...completeNotes.key_concepts, ...completeNotes.examples, ...completeNotes.misconceptions]) {
  check(allNotes.textContent.includes(value), 'every concept/example/misconception is available for review');
}
check(allNotes.querySelectorAll('li').length === 16, 'expanded notes contain each item once');
check(allNotes.querySelectorAll('img,script').length === 0, 'expanded model content is escaped, never interpreted as markup');
check(allNotes.dataset.evidencePanel !== 'module-0', 'notes and references use distinct preserved-state keys');
check(!document.querySelector('[data-evidence-panel="module-0-notes"]'), 'short research needs no redundant full-notes disclosure');
for (const group of ['key_concepts', 'examples', 'misconceptions']) {
  const onlyOneLongGroup = researchEvidenceHTML(researchEvidence({ review: { researchResults: [
    { bundle: { key_concepts: ['Short concept'], [group]: completeNotes[group] } }
  ] } }));
  check(onlyOneLongGroup.includes('module-0-notes'), 'each truncated category independently exposes full notes');
}

for (const bundle of [null, {}, [], ['bad'], 'bad', 0]) {
  check(!isUsableResearchBundle(bundle), 'invalid/missing research is rejected by shared gate');
  check(!researchEvidence({ review: { researchResults: [{ bundle }] } }).complete, 'browser missing-research gate matches server');
}
const privateOnly = researchEvidence({ review: { researchResults: [{ bundle: { key_concepts: ['Note-based'] } }] } });
check(privateOnly.complete && privateOnly.unreferenced === 1, 'no references is warning, not blanket rejection of private material');
check(researchEvidenceHTML(privateOnly).includes('No web links were submitted'), 'notes-only course has honest source explanation');
check(!researchEvidence({ review: { researchResults: [] } }).complete, 'zero-module research cannot approve');
check(!researchEvidence(null).complete, 'absent job is safely incomplete');
check(!researchEvidence({ review: { researchResults: 'bad' } }).complete, 'malformed results do not crash');
check(researchEvidence({ brief: { source_manifest: { links: [{ url: 'https://example.com/manifest' }] } } }).submitted.length === 1, 'legacy manifest-only links remain visible');

const identity = reviewIdentity(job);
for (const patch of [{ id: 'other' }, { ownerId: 'other' }, { runId: 'other' }, { status: 'review_curriculum' }]) {
  check(identity !== reviewIdentity({ ...job, ...patch }), 'review state cannot cross checkpoint identity');
}
check(!reviewIdentity({ ...job, status: 'running' }), 'running state has no review identity');
const dom = parseHTML('<html><body><div class="intake-modal"><div id="card"><textarea data-review-feedback></textarea><details data-evidence-panel="module-0"><summary>References</summary></details><details data-evidence-panel="module-0-notes"><summary>All learning notes</summary></details></div></div></body></html>');
const card = dom.document.querySelector('#card'); card.dataset.reviewIdentity = identity;
card.querySelector('textarea').value = 'Keep this feedback';
card.querySelector('details').open = true;
card.querySelector('[data-evidence-panel="module-0-notes"]').open = true;
const state = captureReviewState(card, identity);
check(state.feedback === 'Keep this feedback' && state.panels[0][1], 'captures typed feedback and open panels');
check(captureReviewState(card, 'new identity') === null, 'different checkpoint does not capture old feedback');
card.querySelector('textarea').value = ''; card.querySelector('details').open = false;
card.querySelector('[data-evidence-panel="module-0-notes"]').open = false;
restoreReviewState(card, state);
check(card.querySelector('textarea').value === 'Keep this feedback' && card.querySelector('details').open, 'same checkpoint restoration retains feedback/disclosure');
check(card.querySelector('[data-evidence-panel="module-0-notes"]').open, 'same checkpoint restores expanded learning notes independently');
console.log(`${checks} research evidence checks passed`);
