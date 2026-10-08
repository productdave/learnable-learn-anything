// Account-owned, course-scoped progress. Conditional writes preserve concurrent
// device edits and never infer ownership of flat legacy records.
import { sb, getUser, onUserChange } from './auth.js?v=33';
import { clearAllProviderKeys, getAllProviderKeys, setAllProviderKeys } from './api-keys.js?v=1';
import { store } from './store.js?v=5';
import { writeLearningSnapshot, boundedLearningQuery } from './learning-state.js?v=2';

let currentSyncUserId = null;
let pushTimer = null, unsubStore = null, queue = Promise.resolve(), revision = 0;
const isCurrent = context => !!context.owner && getUser()?.id === context.owner && currentSyncUserId === context.owner && store.scope().epoch === context.epoch;
function clearPendingPush() { clearTimeout(pushTimer); pushTimer = null; }

async function pull() {
  const context = store.scope();
  if (!isCurrent(context)) return;
  try {
    const client = await sb();
    if (!client || !isCurrent(context)) return;
    const { data, error } = await boundedLearningQuery(client.from('user_state').select('state').eq('user_id', context.owner).maybeSingle());
    if (error) throw error;
    if (!isCurrent(context)) return;
    store.applyRemote(data?.state || {}, context);
    const remote = data?.state || {};
    // Keys entered while a pull was pending must not be replaced by an old read.
    setAllProviderKeys({ ...(remote._apiKeys || {}), ...(remote._apiKey ? { anthropic: remote._apiKey } : {}), ...getAllProviderKeys() });
    schedulePush();
  } catch (error) {
    if (!isCurrent(context)) return;
    store.setSyncStatus('error', context);
    console.warn('[sync] pull failed:', error.message);
  }
}

async function pushNow(context, options) {
  if (!isCurrent(context)) return;
  try {
    const client = await sb();
    if (!client || !isCurrent(context)) return;
    const started = revision;
    store.setSyncStatus('saving', context);
    const state = await writeLearningSnapshot(client, context.owner, store.exportSnapshot(), {
      isCurrent: () => isCurrent(context), providerKeys: getAllProviderKeys()
    });
    if (!state || !isCurrent(context)) return;
    store.applyRemote(state, context);
    store.setSyncStatus(started === revision ? 'saved' : 'pending', context);
    if (started !== revision) schedulePush();
  } catch (error) {
    if (!isCurrent(context)) return;
    store.setSyncStatus('error', context);
    console.warn('[sync] push failed:', error.message);
    if (options.throwOnError) throw error;
  }
}
function push(options = {}) {
  const context = store.scope();
  const next = queue.catch(() => {}).then(() => pushNow(context, options));
  queue = next; return next;
}
function schedulePush() {
  clearPendingPush();
  if (currentSyncUserId) pushTimer = setTimeout(() => { pushTimer = null; push(); }, 1200);
}
export function kickSync() { revision++; schedulePush(); }
export async function flushSync() { clearPendingPush(); await push({ throwOnError: true }); }
export async function pullSyncNow() { await pull(); }

export function logEvent(type, payload = {}) {
  const context = store.scope();
  (async () => {
    const client = await sb();
    if (!client || !isCurrent(context)) return;
    try { await client.from('learning_events').insert({ user_id: context.owner, course_id: null, topic_id: null, event_type: type, payload }); } catch {}
  })();
}
function handleUser(user) {
  const next = user?.id || null;
  if (next !== currentSyncUserId) {
    clearPendingPush();
    try { clearAllProviderKeys(); } catch {}
    currentSyncUserId = next;
    store.setOwner(next);
    // A hung previous-account request must not hold up this account's queue.
    queue = Promise.resolve(); revision++;
    if (next) pull();
  }
}
export function initSync() {
  if (unsubStore) return;
  onUserChange(handleUser);
  handleUser(getUser());
  unsubStore = store.subscribe((_, event) => { if (event.reason === 'local') { revision++; schedulePush(); } });
  globalThis.addEventListener?.('online', () => { if (currentSyncUserId) pull(); });
}
