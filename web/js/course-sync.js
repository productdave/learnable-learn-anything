// Cloud mirror for user-generated courses.
//
// Pairs with sync.js (which handles progress + the Anthropic key in a single
// `user_state` row). Courses get their own table — `user_courses` — with one
// row per course because:
//   - course payloads can be 1–5MB (PDF page thumbs as data URLs), so a
//     single bag-of-everything blob is wasteful to push on every change;
//   - per-id commits + delete map cleanly to the page's save/remove events;
//   - Future analytics on the server can reason about courses individually.
//
// Conflict model:
//   - Edits retain the revision and exact timestamp of their original read.
//   - The database atomically compares both, assigns a new revision and returns
//     the stored payload. A fresh remote read never rebases stale local content.
//   - Pull installs newer account content only when no unsynced edit is pending.
//     Conflicting device copies remain intact and are reported, not retried
//     against a newly fetched revision. Legacy direct writes are DB-guarded.
//   - Deletes propagate via hard-delete of the remote row. On the next pull,
//     a cloud-known course missing from the cloud is removed locally — we
//     mark cloud-installed courses with `_syncedAt` so we know they were
//     previously synced (and therefore really got deleted, not "never
//     uploaded yet").

import { sb, getUser, onUserChange } from './auth.js?v=33';
import {
  _readAllCourses,
  _onCoursesChanged,
  _installCourseFromRemote,
  _removeCourseLocalSilent,
  hasVerifiedLocalCourseEdit
} from './user-courses.js?v=4';

const PUSH_DEBOUNCE_MS = 1200;
const DELETE_RETRY_MS = 5000;
const CONFLICT_PULL_DELAY_MS = 250;
const PENDING_DELETE_KEY = 'learnable-course-pending-deletes';
const pushTimers = new Map();   // id → timer
const pendingDeletes = new Set(); // ids waiting to be deleted remotely
const deleteTimers = new Map(); // id → retry timer
let conflictPullTimer = null;
let pulledOnce = false;
let inUserChange = false;
let currentSyncUserId = null;

// --- Observable status -----------------------------------------------
// Visible from the account modal so the user can see exactly what sync is
// doing (or why it isn't). Updated by every pull / push / delete attempt.
const status = {
  lastPullAt: 0,
  lastPullError: null,        // string | null
  lastPullCloudCount: null,   // number | null
  lastPushAt: 0,
  lastPushError: null,        // string | null
  pushFailuresById: new Map() // id → { error, kind, at }
};
const statusListeners = new Set();
function emitStatus() {
  statusListeners.forEach(fn => { try { fn(getStatus()); } catch {} });
}
/** Snapshot of the current sync state for UI display. */
export function getStatus() {
  return {
    lastPullAt: status.lastPullAt,
    lastPullError: status.lastPullError,
    lastPullCloudCount: status.lastPullCloudCount,
    lastPushAt: status.lastPushAt,
    lastPushError: status.lastPushError,
    pushFailures: Array.from(status.pushFailuresById.entries()).map(([id, e]) => ({ id, ...e }))
  };
}
export function onSyncStatus(fn) {
  statusListeners.add(fn);
  return () => statusListeners.delete(fn);
}

/** Classify a Supabase error so the UI can tell the user what to do. */
function classifyError(err) {
  const msg = String(err?.message || err || '');
  const code = err?.code || '';
  if (code === '40001' || code === 'course_conflict') return { kind: 'conflict', message: 'This course changed in another tab. Your pending changes are still on this device and have not replaced the saved course. Open the latest course review before editing again.' };
  // Postgres "relation does not exist" — the migration SQL hasn't been run.
  if (/relation .* does not exist/i.test(msg) || code === '42P01') {
    return { kind: 'missing_table', message: 'The `user_courses` table does not exist in Supabase yet. Run the setup SQL shown in the account modal.' };
  }
  // RLS denial
  if (/row-level security|permission denied|not authorized/i.test(msg) || code === '42501') {
    return { kind: 'rls_denied', message: 'Supabase blocked the write — the row-level-security policies on user_courses aren\'t set up. Re-run the migration SQL.' };
  }
  if (/network|fetch|failed to fetch/i.test(msg)) {
    return { kind: 'network', message: 'Network error — check your connection.' };
  }
  return { kind: 'unknown', message: msg || 'Unknown sync error' };
}

export function courseLocalTimestamp(course) {
  return Number(course?.updatedAt || course?.createdAt || 0) || 0;
}

export function courseRemoteTimestamp(row) {
  const rowTs = row?.updated_at ? (Date.parse(row.updated_at) || 0) : 0;
  return rowTs || courseLocalTimestamp(row?.payload);
}

export function hasLocalChangesSinceSync(course) {
  const localTs = courseLocalTimestamp(course);
  const syncedTs = Number(course?._syncedAt || 0) || 0;
  return localTs > syncedTs;
}

export function shouldInstallRemoteCourse(local, remoteRow) {
  if (!remoteRow) return false;
  if (!local) return true;
  if ((local._courseRevision || null) !== (remoteRow.payload?._courseRevision || null)) return !hasLocalChangesSinceSync(local);
  if (remoteRow.payload?._lastRefinement?.operationId && local._lastRefinement?.operationId !== remoteRow.payload._lastRefinement.operationId) {
    return !hasLocalChangesSinceSync(local);
  }
  if (isDifferentGenerationRun(local, remoteRow?.payload)) {
    if (local._syncedAt && hasLocalChangesSinceSync(local)) return false;
    return true;
  }
  return courseRemoteTimestamp(remoteRow) > courseLocalTimestamp(local);
}

export function shouldUploadCourseAfterPull(local, remoteRow) {
  if (!local) return false;
  if (!remoteRow) return !local._syncedAt && !local._courseRevision;
  if (!hasVerifiedLocalCourseEdit(local)) return false;
  if ((local._courseRevision || null) !== (remoteRow.payload?._courseRevision || null)) return false;
  if (!local._courseUpdatedAt || local._courseUpdatedAt !== remoteRow.updated_at) return false;
  if (remoteRow.payload?._lastRefinement?.operationId !== local._lastRefinement?.operationId) return false;
  if (isDifferentGenerationRun(local, remoteRow?.payload)) return false;
  if (!local._syncedAt) return false;
  return hasLocalChangesSinceSync(local) && courseLocalTimestamp(local) > courseRemoteTimestamp(remoteRow);
}

export function shouldPushLocalCourse(local, remoteRow) {
  return shouldUploadCourseAfterPull(local, remoteRow);
}

export function courseCanSyncToAccount(course, email, userId = '') {
  if (!course) return false;
  const ownerId = String(course.createdByUserId || '').trim();
  if (ownerId) return !!userId && ownerId === String(userId || '').trim();
  const author = String(course.createdBy || '').trim().toLowerCase();
  const account = String(email || '').trim().toLowerCase();
  return !author || (!!account && author === account);
}

export function coursePayloadForAccount(course, user) {
  if (!course || !user?.id) return course;
  const ownerId = String(course.createdByUserId || '').trim();
  if (ownerId) return course;
  const email = String(user.email || '').trim().toLowerCase();
  const author = String(course.createdBy || '').trim().toLowerCase();
  return {
    ...course,
    createdByUserId: user.id,
    createdBy: author || email || course.createdBy
  };
}

// Browser mirrors do not own the durable AI request receipt. Restore the latest
// account receipt on a content push; the original revision/timestamp CAS protects a
// request transition occurring between this read and the write. Never resurrect
// an old request from a local copy when inserting a missing course.
export function coursePayloadForPush(course, remoteRow) {
  const { _refinementProposal, _courseLocalEdit, _syncedAt, ...payload } = course;
  if (remoteRow?.payload?._refinementProposal) payload._refinementProposal = structuredClone(remoteRow.payload._refinementProposal);
  return payload;
}

function readPendingDeleteStore() {
  try {
    const parsed = JSON.parse(localStorage.getItem(PENDING_DELETE_KEY) || '{}');
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function writePendingDeleteStore(store) {
  try { localStorage.setItem(PENDING_DELETE_KEY, JSON.stringify(store)); } catch {}
}

function pendingDeleteIdsForUser(userId) {
  const rows = readPendingDeleteStore()[userId] || {};
  return Object.keys(rows);
}

function rememberPendingDelete(ownerId, courseId) {
  if (!ownerId || !courseId) return;
  const store = readPendingDeleteStore();
  store[ownerId] = { ...(store[ownerId] || {}), [courseId]: Date.now() };
  writePendingDeleteStore(store);
}

function forgetPendingDelete(ownerId, courseId) {
  if (!ownerId || !courseId) return;
  const store = readPendingDeleteStore();
  if (!store[ownerId]) return;
  delete store[ownerId][courseId];
  if (!Object.keys(store[ownerId]).length) delete store[ownerId];
  writePendingDeleteStore(store);
}

function loadPendingDeletesForUser(userId) {
  pendingDeletes.clear();
  for (const id of pendingDeleteIdsForUser(userId)) pendingDeletes.add(id);
}

async function pullAll() {
  const c = await sb();
  const u = getUser();
  if (!c || !u) return;
  const pullOwnerId = u.id;
  let data;
  try {
    const res = await c.from('user_courses').select('id, payload, updated_at').eq('owner_id', u.id);
    if (res.error) throw res.error;
    if (!isCurrentPullOwner(pullOwnerId)) return;
    data = res.data || [];
    status.lastPullAt = Date.now();
    status.lastPullError = null;
    status.lastPullCloudCount = data.length;
    // eslint-disable-next-line no-console
    console.info(`[course-sync] pulled ${data.length} cloud course${data.length === 1 ? '' : 's'} for ${u.email}`);
  } catch (e) {
    if (!isCurrentPullOwner(pullOwnerId)) return;
    const c2 = classifyError(e);
    status.lastPullAt = Date.now();
    status.lastPullError = c2.message;
    status.lastPullCloudCount = null;
    // eslint-disable-next-line no-console
    console.error('[course-sync] pull failed:', c2.kind, c2.message, e);
    emitStatus();
    return;
  }

  // A pending delete is stronger than a stale pull. If the remote delete
  // failed once, the row may still exist in cloud for a few seconds; don't
  // reinstall it locally while the retry loop is trying to remove it.
  const activeCloudRows = data.filter(row => !pendingDeletes.has(row.id));
  const cloudById = new Map(activeCloudRows.map(r => [r.id, r]));
  const localAll = _readAllCourses();
  let localChanged = false;

  // 1. Cloud rows → install locally if newer or absent.
  for (const row of activeCloudRows) {
    const local = localCourseForAccount(localAll[row.id], u);
    const remoteTs = courseRemoteTimestamp(row);
    if (shouldInstallRemoteCourse(local, row)) {
      // Stamp _syncedAt so future pulls know "this was synced; if it's now
      // missing from cloud, it was deleted remotely."
      const installed = { ...coursePayloadForAccount(row.payload, u), _courseUpdatedAt: row.updated_at, _syncedAt: remoteTs };
      _installCourseFromRemote(row.id, installed);
      status.pushFailuresById.delete(row.id);
      localChanged = true;
    } else if (hasLocalChangesSinceSync(local) && !shouldUploadCourseAfterPull(local, row)) {
      recordPushConflict(row.id);
    }
  }

  // 2. Local courses that were previously synced but no longer in cloud →
  //    treat as remote-delete unless this device changed them after the last
  //    sync. Local changes win over a missing cloud row because we do not have
  //    tombstones yet; this avoids losing offline edits.
  for (const [id, local] of Object.entries(localAll)) {
    if (shouldRemoveLocalCourseAfterPull(local, cloudById.get(id), u)) {
      _removeCourseLocalSilent(id);
      localChanged = true;
    }
  }

  pulledOnce = true;

  // 3. Local courses missing from cloud, or locally changed since their last
  //    successful sync and newer than the cloud row → upload.
  const toUpload = [];
  for (const [id, local] of Object.entries(_readAllCourses())) {
    if (courseCanSyncToAccount(local, u.email, u.id) && shouldUploadCourseAfterPull(local, cloudById.get(id))) toUpload.push(id);
  }
  if (toUpload.length) {
    // eslint-disable-next-line no-console
    console.info(`[course-sync] queuing upload of ${toUpload.length} local course${toUpload.length === 1 ? '' : 's'} missing from cloud:`, toUpload);
  }
  toUpload.forEach(id => schedulePush(id, { force: true }));
  emitStatus();

  // If the pull installed or removed anything locally, tell the library to
  // re-render. _installCourseFromRemote / _removeCourseLocalSilent deliberately
  // don't fire the per-course `saved`/`removed` event (to avoid an upload
  // echo). Use a dedicated `learnable-cloud-pulled` event — distinct from the
  // user-initiated `learnable-courses-imported` event so the listener doesn't
  // schedule yet another pull and loop. Fixes: after a magic-link sign-in
  // the library would stay empty until the user clicked something — now it
  // refreshes the moment the pull lands.
  if (localChanged && typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('learnable-cloud-pulled'));
  }
}

function isCurrentPullOwner(ownerId) {
  return isCurrentSyncOwner(ownerId);
}

function isCurrentSyncOwner(ownerId) {
  return !!ownerId && getUser()?.id === ownerId && currentSyncUserId === ownerId;
}

export function localCourseForAccount(course, user) {
  if (!course || !user) return null;
  return courseCanSyncToAccount(course, user.email, user.id) ? course : null;
}

export function shouldRemoveLocalCourseAfterPull(local, remoteRow, user) {
  if (!local?._syncedAt || remoteRow || !user) return false;
  if (!courseCanSyncToAccount(local, user.email, user.id)) return false;
  return !hasLocalChangesSinceSync(local);
}

async function pushOne(id) {
  const c = await sb();
  const u = getUser();
  if (!c || !u) return { pushed: false, failed: false, skipped: true };
  const pushOwnerId = u.id;
  const all = _readAllCourses();
  const course = all[id];
  if (!course) return { pushed: false, failed: false, skipped: true };
  if (!courseCanSyncToAccount(course, u.email, pushOwnerId)) return { pushed: false, failed: false, skipped: true };
  const payload = coursePayloadForAccount(course, u);
  try {
    const remoteRow = await loadRemoteCourseForPush(c, pushOwnerId, id);
    if (!shouldPushLocalCourse(payload, remoteRow)) {
      if (hasLocalChangesSinceSync(course)) recordPushConflict(id);
      queuePullAfterPushConflict(pushOwnerId);
      return { pushed: false, failed: false, skipped: true, conflict: !!remoteRow };
    }
    const saved = await writeRemoteCourseFromPush(c, pushOwnerId, id, payload, remoteRow);
    if (!saved) {
      recordPushConflict(id);
      queuePullAfterPushConflict(pushOwnerId);
      return { pushed: false, failed: false, skipped: true, conflict: true };
    }
    if (!isCurrentSyncOwner(pushOwnerId)) return { pushed: false, failed: false, skipped: true, stale: true };
    // Mark synced so a future pull knows this course existed in cloud.
    const updated = _readAllCourses();
    const unchanged = updated[id] && JSON.stringify(updated[id]) === JSON.stringify(course);
    if (unchanged) _installCourseFromRemote(id, { ...coursePayloadForAccount(saved.payload, u), _courseUpdatedAt: saved.updatedAt, _syncedAt: Date.parse(saved.updatedAt) });
    status.lastPushAt = Date.now();
    status.lastPushError = null;
    status.pushFailuresById.delete(id);
    // Never attach a newly returned revision to edits made while the save was
    // in flight: their original basis is still the old version.
    if (!unchanged) recordPushConflict(id);
    // eslint-disable-next-line no-console
    console.info(`[course-sync] pushed “${course.config?.title || id}” → cloud`);
    emitStatus();
    return { pushed: true, failed: false, skipped: false, pending: !unchanged };
  } catch (e) {
    if (!isCurrentSyncOwner(pushOwnerId)) return { pushed: false, failed: false, skipped: true, stale: true };
    const c2 = classifyError(e);
    status.lastPushAt = Date.now();
    status.lastPushError = c2.message;
    status.pushFailuresById.set(id, { error: c2.message, kind: c2.kind, at: Date.now() });
    // eslint-disable-next-line no-console
    console.error(`[course-sync] push failed for “${course.config?.title || id}”:`, c2.kind, c2.message, e);
    emitStatus();
    return { pushed: false, failed: true, skipped: false };
  }
}

async function loadRemoteCourseForPush(client, ownerId, id) {
  const { data, error } = await client
    .from('user_courses')
    .select('id, payload, updated_at')
    .eq('owner_id', ownerId)
    .eq('id', id)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

async function writeRemoteCourseFromPush(client, ownerId, id, payload, remoteRow) {
  const { data, error } = await client.rpc('commit_user_course', {
    p_owner: ownerId, p_id: id, p_expected_revision: payload._courseRevision || null,
    p_updated_at: payload._courseUpdatedAt || null,
    p_payload: coursePayloadForPush(payload, remoteRow), p_action: 'save'
  });
  if (error) throw error;
  if (data?.error === 'conflict') return null;
  if (!data?.saved || !data.payload?._courseRevision || !data.updatedAt) throw new Error('The course save could not be confirmed. Retry to check its status.');
  return data;
}

function recordPushConflict(id) {
  const conflict = classifyError({ code: 'course_conflict' });
  status.lastPushError = conflict.message;
  status.pushFailuresById.set(id, { error: conflict.message, kind: conflict.kind, at: Date.now() });
  emitStatus();
}

function isDifferentGenerationRun(local, remotePayload) {
  const localJobId = String(local?._generationJobId || '');
  const remoteJobId = String(remotePayload?._generationJobId || '');
  if (!localJobId || !remoteJobId || localJobId !== remoteJobId) return false;
  const localRunId = String(local?._generationRunId || '');
  const remoteRunId = String(remotePayload?._generationRunId || '');
  return !!localRunId && !!remoteRunId && localRunId !== remoteRunId;
}

function queuePullAfterPushConflict(ownerId) {
  if (!isCurrentSyncOwner(ownerId)) return;
  clearTimeout(conflictPullTimer);
  conflictPullTimer = setTimeout(() => {
    conflictPullTimer = null;
    if (isCurrentSyncOwner(ownerId)) pullAll();
  }, CONFLICT_PULL_DELAY_MS);
}

async function deleteRemote(id, expectedOwnerId = '') {
  const c = await sb();
  const u = getUser();
  if (expectedOwnerId && u?.id && u.id !== expectedOwnerId) return;
  if (!c || !u) { scheduleDeleteRetry(id, expectedOwnerId); return; }
  if (expectedOwnerId && u.id !== expectedOwnerId) return;
  try {
    const { error } = await c.from('user_courses').delete().eq('owner_id', u.id).eq('id', id);
    if (error) throw error;
    clearTimeout(deleteTimers.get(id));
    deleteTimers.delete(id);
    pendingDeletes.delete(id);
    forgetPendingDelete(u.id, id);
  } catch (e) {
    const c2 = classifyError(e);
    status.lastPushAt = Date.now();
    status.lastPushError = c2.message;
    status.pushFailuresById.set(id, { error: c2.message, kind: c2.kind, at: Date.now() });
    emitStatus();
    console.warn('[course-sync] delete failed for', id, c2.message);
    scheduleDeleteRetry(id, u.id);
  }
}

function scheduleDeleteRetry(id, ownerId = getUser()?.id || currentSyncUserId || '') {
  if (!pendingDeletes.has(id)) return;
  clearTimeout(deleteTimers.get(id));
  deleteTimers.set(id, setTimeout(() => {
    deleteTimers.delete(id);
    if (pendingDeletes.has(id)) deleteRemote(id, ownerId);
  }, DELETE_RETRY_MS));
}

function schedulePush(id, options = {}) {
  if (inUserChange && !options.force) return;
  clearTimeout(pushTimers.get(id));
  pushTimers.set(id, setTimeout(() => pushOne(id), PUSH_DEBOUNCE_MS));
}
function scheduleDelete(id, removedCourse = null) {
  if (inUserChange) return;
  const user = getUser();
  const ownerId = user?.id || '';
  if (!ownerId) return;
  if (!removedCourse || !courseCanSyncToAccount(removedCourse, user.email, ownerId)) return;
  // Cancel any pending push for this id — the row is going away.
  clearTimeout(pushTimers.get(id));
  pushTimers.delete(id);
  pendingDeletes.add(id);
  rememberPendingDelete(ownerId, id);
  clearTimeout(deleteTimers.get(id));
  deleteTimers.set(id, setTimeout(() => {
    deleteTimers.delete(id);
    if (pendingDeletes.has(id)) deleteRemote(id, ownerId);
  }, 200));
}

function handleUser(user) {
  const nextUserId = user?.id || null;
  if (nextUserId !== currentSyncUserId) {
    currentSyncUserId = nextUserId;
    pulledOnce = false;
	    pushTimers.forEach(t => clearTimeout(t));
	    pushTimers.clear();
	    deleteTimers.forEach(t => clearTimeout(t));
	    deleteTimers.clear();
	    clearTimeout(conflictPullTimer);
	    conflictPullTimer = null;
    if (nextUserId) loadPendingDeletesForUser(nextUserId);
    else pendingDeletes.clear();
  }
  if (user) {
    for (const id of pendingDeletes) scheduleDeleteRetry(id, user.id);
    if (!pulledOnce) {
      inUserChange = true;
      pullAll().finally(() => { inUserChange = false; });
    }
  } else {
    // Sign-out: reset state so a future sign-in pulls fresh.
    pulledOnce = false;
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
    if (evt.type === 'removed') scheduleDelete(evt.id, evt.course);
  });
}

/** Manual re-pull (e.g. after course import). */
export async function syncCoursesNow() {
  await pullAll();
}

/**
 * Force every local course up to the cloud, regardless of `_syncedAt`. Used
 * by account-level troubleshooting when the user
 * suspects something didn't sync. Pushes are sequential (not debounced) so
 * the UI can report the final state when this resolves.
 */
export async function pushAllNow() {
  const u = getUser();
  if (!u) return { pushed: 0, failed: 0, skipped: 0 };
  const ids = Object.keys(_readAllCourses());
  let pushed = 0, failed = 0, skipped = 0;
  for (const id of ids) {
    // Cancel any pending debounce — we're doing the push directly now.
    clearTimeout(pushTimers.get(id));
    pushTimers.delete(id);
    const result = await pushOne(id);
    if (result?.failed) failed++;
    else if (result?.pushed) pushed++;
    else skipped++;
  }
  return { pushed, failed, skipped };
}

/** Push one specific course immediately. Used after generation completes so
 *  we don't accidentally upload unrelated local courses into this account. */
export async function pushCourseNow(id) {
  const u = getUser();
  if (!u || !id) return { pushed: false, failed: false };
  clearTimeout(pushTimers.get(id));
  pushTimers.delete(id);
  const result = await pushOne(id);
  return {
    pushed: !!result?.pushed,
    failed: !!result?.failed,
    skipped: !!result?.skipped
  };
}
