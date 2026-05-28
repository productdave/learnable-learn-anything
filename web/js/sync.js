// Progress sync — mirrors the app's localStorage learning state to Supabase
// so it follows the user across devices. Also exposes logEvent() for the
// append-only learning_events journal.
//
// Inert until Supabase is configured AND a user is signed in.

import { sb, getUser, onUserChange } from './auth.js';
import { store } from './store.js';

const SYNC_KEYS = ['progress', 'quizAnswers', 'exerciseDrafts', 'flashcardState'];
const API_KEY_STORE = 'gametheory-api-key'; // shared with chat.js + generator/index.js
let applyingRemote = false;   // guards against echo: applying a pull shouldn't trigger a push
let pushTimer = null;
let unsubStore = null;
let pulledOnce = false;

// Union remote + local so a sign-in never loses progress made on this device.
function mergeState(remote, local) {
  const out = {};
  out.progress = { ...(remote.progress || {}) };
  for (const [mid, topics] of Object.entries(local.progress || {})) {
    out.progress[mid] = { ...(out.progress[mid] || {}), ...topics };
  }
  for (const k of ['quizAnswers', 'exerciseDrafts', 'flashcardState']) {
    out[k] = { ...(remote[k] || {}), ...(local[k] || {}) };
  }
  return out;
}

async function pull() {
  const c = await sb();
  const u = getUser();
  if (!c || !u) return;
  try {
    const { data } = await c.from('user_state').select('state').eq('user_id', u.id).maybeSingle();
    const remote = data?.state || {};
    const merged = mergeState(remote, store.get());
    applyingRemote = true;
    store.set(merged);
    applyingRemote = false;

    // Mirror the per-user Anthropic API key. Remote wins on first pull so
    // signing in on a new device picks up your saved key; if remote has none
    // but local does, the next push uploads it.
    if (remote._apiKey && remote._apiKey !== localStorage.getItem(API_KEY_STORE)) {
      localStorage.setItem(API_KEY_STORE, remote._apiKey);
    }

    pulledOnce = true;
    schedulePush(); // write the unioned state back (uploads the local key if remote was empty)
  } catch (e) {
    console.warn('[sync] pull failed:', e.message);
  }
}

async function push() {
  const c = await sb();
  const u = getUser();
  if (!c || !u) return;
  const s = store.get();
  const state = {};
  for (const k of SYNC_KEYS) state[k] = s[k] || {};
  // Per-user Anthropic API key — protected by the same RLS as the rest of
  // the blob. Underscore-prefixed so it never collides with store keys.
  const localKey = localStorage.getItem(API_KEY_STORE);
  if (localKey) state._apiKey = localKey;
  try {
    await c.from('user_state').upsert({ user_id: u.id, state, updated_at: new Date().toISOString() });
  } catch (e) {
    console.warn('[sync] push failed:', e.message);
  }
}

/** Trigger a push on demand — used by callers that change state outside the store (e.g. saving the API key). */
export function kickSync() {
  schedulePush();
}

function schedulePush() {
  clearTimeout(pushTimer);
  pushTimer = setTimeout(push, 1200);
}

function startObserving() {
  if (unsubStore) return;
  unsubStore = store.subscribe(() => { if (!applyingRemote) schedulePush(); });
}
function stopObserving() {
  if (unsubStore) { unsubStore(); unsubStore = null; }
}

/** Append-only event log. Fire-and-forget; no-op when signed out. */
export function logEvent(type, payload = {}) {
  (async () => {
    const c = await sb();
    const u = getUser();
    if (!c || !u) return;
    try {
      await c.from('learning_events').insert({
        user_id: u.id,
        course_id: null,   // bundled courses aren't DB rows; slugs live in payload
        topic_id: null,
        event_type: type,
        payload
      });
    } catch { /* analytics are best-effort */ }
  })();
}

function handleUser(user) {
  if (user) {
    if (!pulledOnce) pull();
    startObserving();
  } else {
    stopObserving();
    pulledOnce = false;
  }
}

export function initSync() {
  onUserChange(handleUser);
  // Auth may have resolved before we subscribed — catch the current state.
  if (getUser()) handleUser(getUser());
}
