import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source = readFileSync(new URL('../web/js/cloud-gen-client.js', import.meta.url), 'utf8');
const start = source.indexOf('function subscribeToJob(jobId)'), end = source.indexOf('function removeJobSubscription(jobId)');
assert.ok(start >= 0 && end > start);
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
function fixture() {
  const q = { owner: 'a', reads: 0, applied: [], timers: new Map(), events: {}, channels: 0, unsubscribed: 0, row: { id: 'job', owner_id: 'a', status: 'running' }, subs: new Map(), document: { visibilityState: 'visible' }, navigator: { onLine: true } };
  const chain = { select() { return this; }, eq() { return this; }, abortSignal(signal) { assert.ok(signal instanceof AbortSignal); return this; }, async maybeSingle() { q.reads++; return q.deferred ? q.deferred : q.error ? { error: q.error } : { data: q.row }; } };
  const client = { from: () => chain, channel: () => { q.channels++; return { on(_type, options, handler) { q.events[options.event] = handler; return this; }, subscribe(callback) { q.subscribed = callback; return this; }, unsubscribe() { q.unsubscribed++; } }; } };
  const deps = { sb: async () => client, subs: q.subs, getUser: () => q.owner ? { id: q.owner } : null,
    isCurrentCloudOwner: owner => q.owner === owner, getJob: () => ({ cloudSeenAt: 1, status: q.localStatus || 'running' }),
    rowBelongsToCurrentOwner: row => row.owner_id === q.owner, applyJobRow: row => q.applied.push(row),
    removeCloudJobMirror: () => { q.removed = true; }, CLOUD_ACTIVE_STATUSES: ['running', 'queued', 'cancelling'],
    setInterval: (callback, delay) => { assert.equal(delay, 5000); q.timers.set(1, callback); return 1; }, clearInterval: id => q.timers.delete(id), document: q.document, navigator: q.navigator };
  q.subscribe = new Function('deps', `const { ${Object.keys(deps).join(',')} } = deps;\n${source.slice(start, end)}\nreturn subscribeToJob;`)(deps);
  return q;
}
const q = fixture(); q.subscribe('job'); q.subscribe('job'); await flush();
assert.equal(q.channels, 1); assert.equal(q.reads, 1); assert.equal(q.timers.size, 1);
q.row = { ...q.row, status: 'review_curriculum' }; q.subscribed('SUBSCRIBED'); await flush();
assert.equal(q.applied.at(-1).status, 'review_curriculum', 'handshake rereads a checkpoint missed between read and subscription');
q.row = { ...q.row, status: 'review_research' }; q.timers.get(1)(); await flush();
assert.equal(q.applied.at(-1).status, 'review_research', 'active fallback catches a checkpoint without realtime');
const count = q.reads;
q.document.visibilityState = 'hidden'; q.timers.get(1)(); await flush(); assert.equal(q.reads, count);
q.document.visibilityState = 'visible'; q.navigator.onLine = false; q.timers.get(1)(); await flush(); assert.equal(q.reads, count);
q.navigator.onLine = true; q.localStatus = 'review_research'; q.timers.get(1)(); await flush(); assert.equal(q.reads, count, 'paused reviews do not poll every five seconds');
q.localStatus = 'running'; q.error = new Error('Offline'); q.timers.get(1)(); await flush(); assert.equal(q.removed, undefined, 'read errors preserve the last known job'); q.error = null;
let finish; q.deferred = new Promise(resolve => { finish = resolve; }); q.timers.get(1)(); await flush(); const pendingReads = q.reads;
q.timers.get(1)(); await flush(); assert.equal(q.reads, pendingReads, 'pending reads cannot overlap');
q.events.UPDATE({ new: { id: 'job', owner_id: 'a', status: 'completed' } });
finish({ data: { id: 'job', owner_id: 'a', status: 'running' } }); await flush();
assert.equal(q.applied.at(-1).status, 'completed', 'a stale read cannot overwrite a newer realtime event');
q.deferred = new Promise(resolve => { finish = resolve; }); q.timers.get(1)(); await flush(); const before = q.applied.length;
q.owner = 'b'; finish({ data: q.row }); await flush(); assert.equal(q.applied.length, before, 'late reads do not cross account ownership');
q.subs.get('job').unsubscribe(); assert.equal(q.timers.size, 0); assert.equal(q.unsubscribed, 1);
const removed = fixture(); removed.subscribe('job'); await flush();
removed.deferred = new Promise(resolve => { finish = resolve; }); removed.subscribed('SUBSCRIBED'); await flush();
removed.subs.get('job').unsubscribe(); removed.subs.delete('job'); const appliedBefore = removed.applied.length;
finish({ data: { ...removed.row, status: 'completed' } }); await flush(); assert.equal(removed.applied.length, appliedBefore, 'removed subscription ignores late reads');
console.log('live handoff behavioral checks passed: handshake, bounded fallback, errors, ordering, identity, overlap and cleanup');
