import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const cloud = readFileSync(join(root, 'web/js/cloud-gen-client.js'), 'utf8');
const subscribeStart = cloud.indexOf('function subscribeToJob(jobId)');
const subscribeEnd = cloud.indexOf('function removeJobSubscription(jobId)');
const subscribe = cloud.slice(subscribeStart, subscribeEnd);
const rehydrateStart = cloud.indexOf('export async function rehydrateCloudSubscriptions');
const rehydrateEnd = cloud.indexOf('/** Ask the backend to mark any expired cloud jobs as timed_out. */');
const rehydrate = cloud.slice(rehydrateStart, rehydrateEnd);
const clearStart = cloud.indexOf('export function clearCloudGenerationSubscriptions');
const clearEnd = cloud.indexOf('export function removeCloudJobMirror');
const clearSubscriptions = cloud.slice(clearStart, clearEnd);

assert.ok(subscribe.includes('if (subs.has(jobId)) return;'));
assert.ok(subscribe.includes('const token = Symbol(jobId);'));
assert.ok(subscribe.includes('subs.set(jobId, { pending: true, token, unsubscribe() {} });'));
assert.ok(subscribe.indexOf('subs.set(jobId, { pending: true') < subscribe.indexOf('const client = await sb();'));
assert.ok(subscribe.includes('subs.delete(jobId);'));
assert.ok(subscribe.includes('})().catch(() => {'));
assert.ok(subscribe.includes('if (!isSubscriptionCurrent(jobId, token)) return;'));
assert.ok(subscribe.includes('if (isSubscriptionCurrent(jobId, token) && rowBelongsToCurrentOwner(payload.new, jobId)) applyJobRow(payload.new);'));
assert.ok(subscribe.includes('if (isSubscriptionCurrent(jobId, token) && rowBelongsToCurrentOwner(payload.old, jobId)) removeCloudJobMirror(payload.old?.id || jobId);'));
assert.ok(cloud.includes("function rowBelongsToCurrentOwner(row, fallbackJobId = '')"));
assert.ok(cloud.includes('getJob(fallbackJobId)?.ownerId'));
assert.ok(subscribe.includes('} else if (getJob(jobId)?.cloudSeenAt) {'));
assert.ok(subscribe.includes('removeCloudJobMirror(jobId);'));
assert.ok(
  subscribe.indexOf('} else if (getJob(jobId)?.cloudSeenAt) {') <
  subscribe.indexOf('const channel = client'),
  'missing previously-seen cloud rows should be pruned before opening a realtime channel.'
);
assert.ok(subscribe.includes('try { channel.unsubscribe(); } catch {}'));
assert.ok(subscribe.includes('subs.set(jobId, { token, unsubscribe: () => { clearInterval(poll); return channel.unsubscribe(); } });'));
assert.ok(subscribe.includes("status === 'SUBSCRIBED'"));
assert.ok(subscribe.includes('beforeEvent !== eventVersion'));
assert.ok(cloud.includes('function isSubscriptionCurrent(jobId, token)'));
assert.ok(cloud.includes('return subs.get(jobId)?.token === token;'));

assert.ok(cloud.includes("const CLOUD_REVIEW_STATUSES = ['review_curriculum', 'review_research'];"));
assert.ok(cloud.includes('const CLOUD_REHYDRATE_STATUSES = [...CLOUD_ACTIVE_STATUSES, ...CLOUD_REVIEW_STATUSES'));
assert.ok(rehydrate.includes(".in('status', CLOUD_REHYDRATE_STATUSES)"));
assert.ok(!rehydrate.includes('.limit('));

assert.ok(clearSubscriptions.includes('for (const jobId of [...subs.keys()]) removeJobSubscription(jobId);'));
assert.ok(clearStart > cloud.indexOf('function removeJobSubscription(jobId)'));

console.log('cloud subscription idempotency tests passed');
