// Cloud mirror for user-generated courses.
//
// Pairs with sync.js (which handles progress + the Anthropic key in a single
// `user_state` row). Courses get their own table — `user_courses` — with one
// row per course because:
//   - course payloads can be 1–5MB (PDF page thumbs as data URLs), so a
//     single bag-of-everything blob is wasteful to push on every change;
//   - per-id upsert + delete map cleanly to the page's save/remove events;
//   - Future analytics on the server can reason about courses individually.
//
// Conflict model:
//   - Each course carries `updatedAt` (ms epoch). saveUserCourse stamps it.
//   - Pull installs cloud rows where the cloud `updated_at` is newer than
//     the local `updatedAt` (or where the local copy doesn't exist).
//   - Push uploads any course where local `updatedAt` exceeds the last
//     remote-updated-at we recorded for it.
//   - Deletes propagate via hard-delete of the remote row. On the next pull,
//     a cloud-known course missing from the cloud is removed locally — we
//     mark cloud-installed courses with `_syncedAt` so we know they were
//     previously synced (and therefore really got deleted, not "never
//     uploaded yet").

import { sb, getUser, onUserChange } from './auth.js?v=4';
import {
  _readAllCourses,
  _onCoursesChanged,
  _installCourseFromRemote,
  _removeCourseLocalSilent
} from './user-courses.js';

const PUSH_DEBOUNCE_MS = 1200;
const pushTimers = new Map();   // id → timer
const pendingDeletes = new Set(); // ids waiting to be deleted remotely
let pulledOnce = false;
let inUserChange = false;

async function pullAll() {
  const c = await sb();
  const u = getUser();
  if (!c || !u) return;
  let data;
  try {
    const res = await c.from('user_courses').select('id, payload, updated_at').eq('owner_id', u.id);
    data = res.data || [];
  } catch (e) {
    console.warn('[course-sync] pull failed:', e.message);
    return;
  }

  const cloudById = new Map(data.map(r => [r.id, r]));
  const localAll = _readAllCourses();

  // 1. Cloud rows → install locally if newer or absent.
  for (const row of data) {
    const local = localAll[row.id];
    const remoteTs = Date.parse(row.updated_at) || 0;
    const localTs  = local?.updatedAt || local?.createdAt || 0;
    if (!local || remoteTs > localTs) {
      // Stamp _syncedAt so future pulls know "this was synced; if it's now
      // missing from cloud, it was deleted remotely."
      const installed = { ...row.payload, _syncedAt: remoteTs };
      _installCourseFromRemote(row.id, installed);
    }
  }

  // 2. Local courses that were previously synced but no longer in cloud →
  //    treat as remote-delete. Don't touch local-only courses that were
  //    never pushed (they'll be pushed on next save).
  for (const [id, local] of Object.entries(localAll)) {
    if (local._syncedAt && !cloudById.has(id)) {
      _removeCourseLocalSilent(id);
    }
  }

  pulledOnce = true;

  // 3. Local courses not in cloud (yet) → upload.
  for (const [id, local] of Object.entries(_readAllCourses())) {
    if (!cloudById.has(id)) schedulePush(id);
  }
}

async function pushOne(id) {
  const c = await sb();
  const u = getUser();
  if (!c || !u) return;
  const all = _readAllCourses();
  const course = all[id];
  if (!course) return;
  const updatedAt = course.updatedAt || course.createdAt || Date.now();
  try {
    const { error } = await c.from('user_courses').upsert(
      {
        id,
        owner_id: u.id,
        payload: course,
        updated_at: new Date(updatedAt).toISOString()
      },
      { onConflict: 'id,owner_id' }
    );
    if (error) throw error;
    // Mark synced so a future pull knows this course existed in cloud.
    const updated = _readAllCourses();
    if (updated[id]) {
      updated[id]._syncedAt = updatedAt;
      try { localStorage.setItem('learnable-user-courses', JSON.stringify(updated)); } catch {}
    }
  } catch (e) {
    console.warn('[course-sync] push failed for', id, e.message);
  }
}

async function deleteRemote(id) {
  const c = await sb();
  const u = getUser();
  if (!c || !u) { pendingDeletes.delete(id); return; }
  try {
    const { error } = await c.from('user_courses').delete().eq('owner_id', u.id).eq('id', id);
    if (error) throw error;
  } catch (e) {
    console.warn('[course-sync] delete failed for', id, e.message);
  }
  pendingDeletes.delete(id);
}

function schedulePush(id) {
  if (inUserChange) return;
  clearTimeout(pushTimers.get(id));
  pushTimers.set(id, setTimeout(() => pushOne(id), PUSH_DEBOUNCE_MS));
}
function scheduleDelete(id) {
  if (inUserChange) return;
  // Cancel any pending push for this id — the row is going away.
  clearTimeout(pushTimers.get(id));
  pushTimers.delete(id);
  pendingDeletes.add(id);
  setTimeout(() => { if (pendingDeletes.has(id)) deleteRemote(id); }, 200);
}

function handleUser(user) {
  if (user) {
    if (!pulledOnce) {
      inUserChange = true;
      pullAll().finally(() => { inUserChange = false; });
    }
  } else {
    // Sign-out: reset state so a future sign-in pulls fresh.
    pulledOnce = false;
    pushTimers.forEach(t => clearTimeout(t));
    pushTimers.clear();
    pendingDeletes.clear();
  }
}

export function initCourseSync() {
  onUserChange(handleUser);
  // If auth already resolved before we subscribed, kick in now.
  if (getUser()) handleUser(getUser());
  // Mirror local saves/removes to the cloud.
  _onCoursesChanged((evt) => {
    if (!getUser()) return;            // local-only when signed out
    if (evt.type === 'saved')   schedulePush(evt.id);
    if (evt.type === 'removed') scheduleDelete(evt.id);
  });
}

/** Manual re-pull (e.g. after course import). */
export async function syncCoursesNow() {
  await pullAll();
}
