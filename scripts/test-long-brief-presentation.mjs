import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';

// The same checks run against source and the actual fresh staging namespace.
const source = resolve(process.env.BRIEF_SOURCE_ROOT || 'web/js');
const load = name => import(pathToFileURL(join(source, name)).href);
const { briefTitle, briefPreviewHTML } = await load('brief-presentation.js');
const { reviewHTML } = await load('course-setup.js');
const { homeJobHTML, homeSetupDraftHTML, originalRequestHTML } = await load('home.js');
const { setupDraft } = await load('setup-model.js');
const { createSetupSignIn } = await load('setup-signin.js');
const { createSetupCreation } = await load('setup-create.js');
const { normalizeAccountPayload } = await load('setup-account-model.js');
const checks = [];
const check = (condition, label) => { assert.ok(condition, label); checks.push(label); };
const body = html => parseHTML('<html><body>' + html + '</body></html>').document.body;
const topic = '  A course about improvement loops\n\n' + 'Full details <not markup> & examples.\n'.repeat(150);
const full = topic.slice(0, 5000), oversized = full.repeat(3);
check(briefTitle(full) === 'A course about improvement loops', 'label uses first line, not the whole description');
check(Array.from(briefTitle('😀'.repeat(5000))).length === 96, 'title cap counts Unicode characters');
check(briefTitle('  \n ') === 'Untitled course', 'empty title fallback');
check(briefTitle('One    useful title') === 'One useful title', 'label whitespace is normalized only for display');
for (const value of [full, oversized, '😀'.repeat(5000)]) {
  const dom = body(briefPreviewHTML(value, { label: 'course description' }));
  const region = dom.querySelector('[role="region"]');
  check(region.textContent === value, 'full-text disclosure preserves exact source: ' + Array.from(value).length);
  check(!dom.querySelector('details').hasAttribute('open'), 'long disclosure starts collapsed');
  check(region.tabIndex === 0 || region.getAttribute('tabindex') === '0', 'full-text scroll region is keyboard reachable');
  check(Array.from(dom.querySelector('.brief-preview-excerpt').textContent).length <= 321, 'preview is bounded');
  check(dom.querySelector('not') === null, 'brief text is escaped, not interpreted as HTML');
}
check(body(briefPreviewHTML('Short description')).querySelector('details') === null, 'short text needs no extra disclosure');
const draft = setupDraft(full); draft.id = 'long-brief-fixture';
draft.brief.audience = 'Product managers ' + 'a'.repeat(1800);
draft.brief.goal = 'Outcome ' + 'g'.repeat(5800);
draft.brief.starting_point = 'Starting point ' + 's'.repeat(5800);
draft.brief.context = 'Context ' + 'c'.repeat(11900);
draft.sources.notes = [{ id: 'note-one', title: 'Transcript', text: 'n'.repeat(12000) }];
draft.sources.links = [{ id: 'link-one', title: '', url: 'https://example.com/?q=' + 'l'.repeat(3000) }];
const before = structuredClone(draft), review = body(reviewHTML(draft, null));
for (const [label, value] of Object.entries({ 'course description': full, audience: draft.brief.audience, outcome: draft.brief.goal, 'starting point': draft.brief.starting_point, context: draft.brief.context, 'note text': draft.sources.notes[0].text, 'link URL': draft.sources.links[0].url })) {
  check(review.querySelector(`[aria-label="Full ${label}"]`).textContent === value, 'Review keeps complete ' + label + ' behind a readable preview');
}
check(review.querySelectorAll('.setup-review-section h2').length === 3, 'Review retains Goal, Experience and Context headings');
check(review.querySelectorAll('a').length >= 3, 'edit links remain available');
check(review.querySelector('.setup-source-overview') && !review.querySelector('.setup-source-overview').hasAttribute('open'), 'source content is progressively disclosed');
assert.deepEqual(draft, before); checks.push('rendering never rewrites saved brief or sources');
const normalized = normalizeAccountPayload({ schemaVersion: 1, brief: draft.brief, components: draft.components, sources: draft.sources });
check(normalized.brief.topic === full && normalized.sources.notes[0].text.length === 12000, 'accepted account payload retains full description and note');
const job = { id: 'job-long', title: 'x'.repeat(15000), status: 'running', brief: { topic: full, goal: draft.brief.goal } };
for (const html of [homeJobHTML(job), homeSetupDraftHTML({ ...draft, brief: { ...draft.brief, topic: job.title } })]) {
  const card = body(html);
  check(Array.from(card.querySelector('h3').textContent).length <= 96, 'draft/job cards have bounded titles');
  check(!!card.querySelector('a[href]'), 'card keeps its continuation route');
}
const original = body(originalRequestHTML(job));
check(original.querySelector('[role="region"] p').textContent === full && !original.querySelector('details').hasAttribute('open'), 'workspace retains exact original request in a collapsed scroll region');

const { document, window } = parseHTML('<html><body><main></main></body></html>');
globalThis.document = document; globalThis.window = window;
window.scrollTo = () => {};
globalThis.location = new URL('https://test.invalid/?draft=long-brief-fixture&step=account');
globalThis.sessionStorage = { getItem: () => null };
window.HTMLElement.prototype.showModal = function () { this.setAttribute('open', ''); };
window.HTMLElement.prototype.close = function () { this.removeAttribute('open'); };
const host = document.querySelector('main'); let dispatches = 0;
const signIn = createSetupSignIn({ sessions: {}, handoffs: {}, getUser: () => null, sendLink: () => { dispatches++; }, navigate: () => {} });
signIn.show(host, draft.id, { draft });
check(document.querySelector('.setup-signin-topic strong').textContent === briefTitle(full), 'sign-in identifies course without rendering the whole description');
check(!!document.querySelector('input[type="email"]') && !!document.querySelector('form button'), 'email field and sign-in action still exist');
signIn.dispose();
const user = { id: 'synthetic-owner', email: 'fixture@example.invalid' };
const target = { id: draft.id, owner: user.id, draft, version: 1, record: {} };
let saved = null;
const creation = createSetupCreation({ sessions: { flush: async () => true, acknowledge: async () => true }, getUser: () => user,
  accountClient: { save: async (_owner, _id, payload) => { saved = payload; return { revision: 1 }; } },
  client: { check: async () => ({ enabled: true, ready: false, connected: false, issues: [], sources: null }), start: () => { dispatches++; } },
  imageClient: { connection: async () => ({ connected: false }) }, navigate: () => {}, openJob: () => {} });
await creation.render(host, target);
await new Promise(resolve => setImmediate(resolve));
check(host.querySelector('h2').textContent === briefTitle(full), 'Create uses a compact course title');
check(host.querySelector('[aria-label="Full course description"]').textContent === full, 'Create still provides the complete request');
check(saved?.brief.topic === full && saved.sources.notes[0].text.length === 12000, 'Create passes unabridged content to account saving');
check(!!host.querySelector('[data-create-action="retry"]') && !!host.querySelector('input[type="password"]'), 'connection and retry controls are not removed');
check(dispatches === 0, 'presentation, sign-in opening and readiness checks never dispatch paid work or email');
creation.dispose();
console.log(`Long brief presentation: ${checks.length} actual-render/model checks passed; no network or provider requests.`);
