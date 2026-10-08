import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { createHomeController } from '../web/js/home.js';

const { window, document } = parseHTML('<html><head><title>Test</title></head><body><main id="content"></main></body></html>');
globalThis.window = window;
globalThis.document = document;
globalThis.location = new URL('https://test.invalid/?filter=mine');
Object.defineProperty(globalThis, 'navigator', { value: { onLine: true }, configurable: true });
globalThis.history = {
  replaceState: (_s, _t, url) => { globalThis.location = new URL(url, location); },
  pushState: (_s, _t, url) => { globalThis.location = new URL(url, location); }
};
let owner = 'owner';
let jobs = [];
let library = [{ id: 'saved', title: 'Saved course', user: true, modules: 1, topics: 3 }];
let deferred = null;
let catalogError = null;
let setups = { drafts: [] };
const listeners = new Set();
const api = {
  getUser: () => owner ? { id: owner } : null,
  listJobs: () => jobs,
  getJob: id => jobs.find(job => job.id === id),
  loadLibrary: async () => deferred ? deferred : { courses: [...library], catalogError },
  listDrafts: async () => setups,
  onJobsChange: fn => { listeners.add(fn); return () => listeners.delete(fn); },
  getSavedCourse: id => id === 'saved' ? { _generationJobId: 'finished' } : null,
  refreshCloud: async () => {},
  canDelete: () => false,
  jobControls: () => '<button data-job-action="open">Open review</button>',
  wireJobs: () => {}, wireCourses: () => {}, openCreate: () => {}, openDraft: () => {}, openAccount: () => {}
};
const host = document.getElementById('content');
const controller = createHomeController(api);
await controller.render(host);
assert.equal(host.querySelector('.home-preview-label'), null, 'default app is not labelled as a preview');
assert.equal(listeners.size, 1);
assert.match(host.textContent, /Saved course/);
assert.deepEqual([...host.querySelectorAll('[data-home-filter]')].map(el => el.textContent), [
  'Community Courses', 'Your Courses'
]);
assert.deepEqual([...host.querySelectorAll('[data-home-status] option')].map(el => el.textContent), ['All courses', 'Needs Your Attention', 'In Progress']);
assert.ok(host.querySelector('[data-home-status]').closest('.home-personal'), 'status control belongs inside Your Courses');
assert.equal(host.querySelector('[data-home-status]').value, 'all');
assert.equal(host.querySelector('[data-home-filter="mine"]').getAttribute('aria-current'), 'page');
assert.equal(host.querySelector('#home-mine').textContent, 'Your Courses');
host.querySelector('#home-outcome').value = 'Preserve this idea';
host.querySelector('[data-home-search]').value = 'Saved';
await controller.refresh();
assert.equal(host.querySelector('#home-outcome').value, 'Preserve this idea');
assert.equal(host.querySelector('[data-home-search]').value, 'Saved');
await controller.render(host);
assert.equal(host.querySelector('#home-outcome').value, 'Preserve this idea');
assert.equal(listeners.size, 1, 'route changes must dispose prior job listeners');
owner = 'different';
await controller.render(host);
assert.equal(host.querySelector('#home-outcome').value, '', 'do not carry another account’s typed idea');

jobs = [{ id: 'private', title: 'Hidden private title', runner: 'cloud', ownerId: 'owner', status: 'running' }];
await controller.render(host, 'private');
assert.match(host.textContent, /Workspace unavailable/);
assert.ok(!host.textContent.includes('Hidden private title'));
owner = 'owner';
await controller.render(host, 'private');
assert.match(host.textContent, /Hidden private title/);
await controller.render(host, 'finished');
assert.match(host.textContent, /Saved · check details/, 'metadata-only record must not claim verified readiness');
assert.ok(host.querySelector('a[href*="course=saved"]'), 'removed completed job resolves through saved course identity');

globalThis.location = new URL('https://test.invalid/?experience=workspace');
let resolveOld;
deferred = new Promise(resolve => { resolveOld = resolve; });
const oldRender = controller.render(host);
deferred = null;
library = [{ id: 'fresh', title: 'Fresh route' }];
await controller.render(host);
resolveOld({ courses: [{ id: 'stale', title: 'Stale course' }] });
await oldRender;
assert.match(host.textContent, /Fresh route/);
assert.ok(!host.textContent.includes('Stale course'), 'late async responses must not overwrite a newer route');

// Public discovery remains distinct from personal courses across all states.
globalThis.location = new URL('https://test.invalid/?experience=workspace&filter=library');
library = [{ id: 'own', title: 'Private draft', user: true }, { id: 'shared', title: 'Shared swimming' }];
await controller.render(host);
assert.equal(host.querySelector('[data-home-filter="community"]').getAttribute('aria-current'), 'page');
assert.equal(host.querySelector('#home-community').textContent, 'Community Courses');
assert.equal(host.querySelector('[data-home-status]'), null, 'community browsing has no personal status filter');
assert.ok(!host.textContent.includes('Private draft'));
assert.match(host.textContent, /Shared swimming/);
assert.match(host.querySelector('[data-home-filter="community"]').getAttribute('href'), /filter=community/);

globalThis.location = new URL('https://test.invalid/?experience=workspace&filter=community&q=unmatched');
await controller.render(host);
assert.match(host.textContent, /No matching community courses/);
assert.ok(host.querySelector('a[href="?filter=community"]'));
assert.ok(!host.querySelector('.home-course'));

globalThis.location = new URL('https://test.invalid/?experience=workspace');
library = [{ id: 'own', title: 'Private draft', user: true }];
await controller.render(host);
assert.match(host.textContent, /No community courses yet/);
assert.ok(!host.textContent.includes('Private draft'), 'default Community tab must not mix in personal courses');
assert.ok(host.querySelector('#home-community'), 'community section remains discoverable when empty');
catalogError = 'Public catalog unavailable';
await controller.refresh();
assert.match(host.textContent, /Couldn’t load Community Courses/);
assert.match(host.textContent, /Community Courses are unavailable/);
assert.ok(!host.textContent.includes('No community courses yet'), 'outage must not look like zero published courses');
assert.ok(!host.textContent.includes('Private draft'));
globalThis.location = new URL('https://test.invalid/?experience=workspace&filter=mine');
await controller.render(host);
assert.match(host.textContent, /Private draft/, 'personal courses remain available in their tab during catalog failure');
catalogError = null;
globalThis.location = new URL('https://test.invalid/?experience=workspace');

let resolveCommunity;
deferred = new Promise(resolve => { resolveCommunity = resolve; });
const loadingRender = controller.render(host);
assert.match(host.textContent, /Loading Community Courses/);
assert.ok(!host.textContent.includes('No community courses yet'));
resolveCommunity({ courses: [{ id: 'shared', title: 'Shared swimming' }] });
await loadingRender;
deferred = null;
assert.match(host.textContent, /Shared swimming/);
assert.ok(!host.textContent.includes('Loading Community Courses'));

// Attention and active work are statuses inside the same personal collection.
jobs = [
  { id: 'review', title: 'Review this plan', ownerId: owner, runner: 'cloud', status: 'review_curriculum' },
  { id: 'running', title: 'Creating another course', ownerId: owner, runner: 'cloud', status: 'running' }
];
globalThis.location = new URL('https://test.invalid/?experience=workspace&filter=attention');
await controller.render(host);
assert.equal(host.querySelector('#home-mine').textContent, 'Your Courses');
assert.equal(host.querySelector('[data-home-filter="mine"]').getAttribute('aria-current'), 'page');
assert.equal(host.querySelector('[data-home-status]').value, 'attention');
assert.equal(host.querySelector('#home-attention'), null);
assert.match(host.textContent, /Review this plan/);
assert.ok(!host.textContent.includes('Creating another course'));
globalThis.location = new URL('https://test.invalid/?experience=workspace&filter=building');
await controller.render(host);
assert.equal(host.querySelector('#home-mine').textContent, 'Your Courses');
assert.equal(host.querySelector('[data-home-status]').value, 'building');
assert.match(host.textContent, /Creating another course/);
assert.ok(!host.textContent.includes('Review this plan'));
globalThis.location = new URL('https://test.invalid/?experience=workspace&filter=building&q=unmatched');
await controller.render(host);
assert.equal(host.querySelector('.home-empty a').textContent, 'Clear search');
assert.equal(host.querySelector('.home-empty a').getAttribute('href'), '?filter=mine&status=building');
globalThis.location = new URL('https://test.invalid/?experience=workspace&filter=mine');
await controller.render(host);
assert.match(host.textContent, /Private draft/);
assert.match(host.textContent, /Review this plan/);
assert.match(host.textContent, /Creating another course/);
const statusSelect = host.querySelector('[data-home-status]');
host.querySelector('#home-outcome').value = 'Keep this draft';
// LinkeDOM exposes select.value as read-only; reflect the selected option explicitly.
for (const option of statusSelect.options) option.removeAttribute('selected');
statusSelect.querySelector('[value="attention"]').setAttribute('selected', '');
assert.equal(statusSelect.value, 'attention');
statusSelect.dispatchEvent(new window.Event('change', { bubbles: true }));
assert.equal(location.search, '?filter=mine&status=attention');
assert.match(host.textContent, /Review this plan/);
assert.ok(!host.textContent.includes('Creating another course'));
assert.ok(!host.textContent.includes('Private draft'));
assert.equal(host.querySelector('[data-home-status]'), statusSelect, 'filtering must not replace the focused select');
const search = host.querySelector('[data-home-search]');
search.value = 'Review';
search.dispatchEvent(new window.Event('input', { bubbles: true }));
assert.equal(location.search, '?filter=mine&status=attention&q=Review');
await controller.refresh();
assert.equal(host.querySelector('[data-home-status]'), statusSelect);
assert.equal(host.querySelector('[data-home-status]').value, 'attention');
assert.equal(host.querySelector('#home-outcome').value, 'Keep this draft');
globalThis.location = new URL('https://test.invalid/?experience=workspace&filter=all');
await controller.render(host);
assert.equal(host.querySelector('[data-home-filter="community"]').getAttribute('aria-current'), 'page');
assert.ok(!host.textContent.includes('Private draft'));
assert.ok(!host.textContent.includes('Creating another course'));
controller.dispose();
assert.equal(listeners.size, 0);

// Unfinished setup UI names the user's next action, never a separate backup product.
globalThis.location = new URL('https://test.invalid/?experience=workspace&filter=mine');
setups = { drafts: [
  { id: 'browser-setup', step: 'goal', brief: { topic: 'Browser setup' } },
  { id: 'account-setup', step: 'review', cloudOnly: true, brief: { topic: 'Account setup' } },
  { id: 'unsaved-setup', step: 'context', unsaved: true, brief: { topic: 'Latest text' } }
] };
await controller.render(host);
const setupSection = host.querySelector('.home-local-setups');
assert.match(setupSection.textContent, /Continue setting up/);
assert.doesNotMatch(setupSection.textContent, /Local setup|Account backup|Device copy|Device-only/);
assert.equal(setupSection.querySelectorAll('a').length, 3);
assert.match(setupSection.textContent, /Your latest details could not be saved/);
setups = { ...setups, accountError: true };
await controller.refresh();
assert.match(host.querySelector('[data-home-results]').textContent, /couldn’t load all of your unfinished setups/);
assert.doesNotMatch(host.querySelector('[data-home-results]').textContent, /backend may not be enabled|account setup backups/);
assert.equal(host.querySelectorAll('.home-local-setups a').length, 3, 'load failure keeps available setups accessible');
controller.dispose();
console.log('Home controller: persistence, account boundaries, cleanup, workspace resolution, stale responses and community browsing/empty/error/loading states passed.');

// Visibility is independent of course readiness and scoped to this render/account.
owner='owner';jobs=[];setups={drafts:[]};library=[{id:'saved',title:'Saved course',user:true}];api.canDelete=()=>true;
let statusResolver;
api.loadPublicationStatuses=()=>new Promise(resolve=>statusResolver=resolve);
const loadingStatuses=controller.render(host);
await new Promise(resolve=>setTimeout(resolve,0));
assert.match(host.textContent,/Checking visibility/);
assert.equal(host.querySelector('[data-publication-state="private"]'),null,'loading cannot masquerade as private');
statusResolver(new Map([['saved',{state:'published',sourceChanged:true,publication:{id:'public-aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa'}}]]));
await loadingStatuses;assert.match(host.textContent,/Saved copy changed/);assert.ok(host.querySelector('[data-manage-publication]'));
api.loadPublicationStatuses=async()=>{throw new Error('offline');};await controller.refresh();
assert.match(host.textContent,/Status unavailable/);assert.equal(host.querySelector('.home-publication a'),null,'failed refresh hides stale public link');
api.loadPublicationStatuses=()=>new Promise(resolve=>statusResolver=resolve);
const oldStatus=controller.refresh();await new Promise(resolve=>setTimeout(resolve,0));const oldResolver=statusResolver;
owner='other';library=[];api.loadPublicationStatuses=async()=>new Map();await controller.render(host);oldResolver(new Map([['saved',{state:'published'}]]));await oldStatus;
assert.equal(host.querySelector('[data-manage-publication]'),null,'late prior-account status cannot appear');
controller.dispose();console.log('Home publication status: loading, change signal, error, stale-link removal and account-race checks passed.');
