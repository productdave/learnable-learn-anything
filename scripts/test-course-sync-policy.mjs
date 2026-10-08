import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  courseCanSyncToAccount,
  courseLocalTimestamp,
  coursePayloadForAccount,
  coursePayloadForPush,
  courseRemoteTimestamp,
  hasLocalChangesSinceSync,
  localCourseForAccount,
  shouldPushLocalCourse,
  shouldInstallRemoteCourse,
  shouldRemoveLocalCourseAfterPull,
  shouldUploadCourseAfterPull
} from '../web/js/course-sync.js';
import { _onCoursesChanged, canDeleteCourse, courseVisibleToEmail, removeUserCourse, courseMirrorFingerprint } from '../web/js/user-courses.js';
const currentEdit = course => ({ ...course, _courseLocalEdit: { version: 1, fingerprint: courseMirrorFingerprint(course) } });

const root = process.cwd();
const courseSyncSource = readFileSync(join(root, 'web/js/course-sync.js'), 'utf8');
const userCoursesSource = readFileSync(join(root, 'web/js/user-courses.js'), 'utf8');
const pullAllBlock = courseSyncSource.slice(
  courseSyncSource.indexOf('async function pullAll()'),
  courseSyncSource.indexOf('export function localCourseForAccount')
);
const pushOneBlock = courseSyncSource.slice(
  courseSyncSource.indexOf('async function pushOne(id)'),
  courseSyncSource.indexOf('async function deleteRemote')
);

const remoteOld = { updated_at: '2026-06-26T00:00:01.000Z' };
const remoteNew = { updated_at: '2026-06-26T00:00:10.000Z' };
const remotePayloadOnly = { updated_at: 'not-a-date', payload: { updatedAt: Date.parse('2026-06-26T00:00:20.000Z') } };
const oldTs = Date.parse(remoteOld.updated_at);
const newTs = Date.parse(remoteNew.updated_at);
const payloadOnlyTs = remotePayloadOnly.payload.updatedAt;

{
  const original = { config: { id: 'owned' }, _refinementProposal: { id: 'old-local-request', status: 'running' } };
  const receipt = { id: 'current-account-request', status: 'ready', proposal: { replacement: { title: 'Keep current account proposal' } } };
  const outgoing = coursePayloadForPush(original, { payload: { _refinementProposal: receipt } });
  assert.deepEqual(outgoing._refinementProposal, receipt, 'content sync retains latest account request, not stale local receipt');
  assert.notEqual(outgoing._refinementProposal, receipt, 'outgoing receipt cannot mutate the remote snapshot');
  assert.equal(original._refinementProposal.id, 'old-local-request', 'sync preparation does not mutate local edits');
  assert.equal(coursePayloadForPush(original, null)._refinementProposal, undefined, 'inserting a course cannot resurrect a local AI request');
  assert.equal(coursePayloadForPush(original, { payload: {} })._refinementProposal, undefined, 'removed account metadata is not reintroduced');
  assert.deepEqual(outgoing.config, original.config, 'ordinary accepted content is retained');
}

assert.equal(courseLocalTimestamp({ updatedAt: 123 }), 123);
assert.equal(courseRemoteTimestamp(remoteOld), oldTs);
assert.equal(courseRemoteTimestamp(remotePayloadOnly), payloadOnlyTs);

assert.equal(shouldInstallRemoteCourse(null, remoteOld), true);
assert.equal(shouldInstallRemoteCourse({ updatedAt: oldTs - 1 }, remoteOld), true);
assert.equal(shouldInstallRemoteCourse({ updatedAt: newTs + 1 }, remoteNew), false);
assert.equal(shouldInstallRemoteCourse({ updatedAt: payloadOnlyTs - 1 }, remotePayloadOnly), true);
assert.equal(
  shouldInstallRemoteCourse(
    { _generationJobId: 'job-1', _generationRunId: 'run-old', updatedAt: newTs + 1000, _syncedAt: newTs + 1000 },
    { payload: { _generationJobId: 'job-1', _generationRunId: 'run-new' }, updated_at: remoteOld.updated_at }
  ),
  true,
  'newer generated run should install even when the old local timestamp is ahead'
);
assert.equal(
  shouldInstallRemoteCourse(
    { _generationJobId: 'job-1', _generationRunId: 'run-old', updatedAt: newTs + 1000, _syncedAt: oldTs },
    { payload: { _generationJobId: 'job-1', _generationRunId: 'run-new' }, updated_at: remoteOld.updated_at }
  ),
  false,
  'newer generated run should not overwrite unsynced local edits'
);

assert.equal(hasLocalChangesSinceSync({ updatedAt: newTs, _syncedAt: oldTs }), true);
assert.equal(hasLocalChangesSinceSync({ updatedAt: oldTs, _syncedAt: oldTs }), false);

assert.equal(shouldUploadCourseAfterPull({ updatedAt: newTs }, null), true);
assert.equal(shouldUploadCourseAfterPull({ updatedAt: oldTs, _syncedAt: oldTs }, null), false);
assert.equal(shouldUploadCourseAfterPull({ updatedAt: newTs, _syncedAt: oldTs }, null), false, 'remote deletion does not silently resurrect a synced course');
assert.equal(shouldUploadCourseAfterPull({ updatedAt: newTs, _syncedAt: oldTs }, remoteOld), false, 'unknown original revision cannot be inferred from a fresh read');
const basedEdit = currentEdit({ updatedAt: newTs, _syncedAt: oldTs, _courseUpdatedAt: remoteOld.updated_at });
assert.equal(shouldUploadCourseAfterPull(basedEdit, remoteOld), true);
assert.equal(shouldUploadCourseAfterPull({ ...basedEdit, updatedAt: newTs + 1 }, remoteOld), false, 'old client cannot reuse current marker on changed content');
assert.equal(shouldUploadCourseAfterPull({ updatedAt: oldTs, _syncedAt: oldTs }, remoteNew), false);
assert.equal(shouldUploadCourseAfterPull({ updatedAt: newTs + 1 }, remoteNew), false);
assert.equal(
  shouldUploadCourseAfterPull(
    { _generationJobId: 'job-1', _generationRunId: 'run-old', updatedAt: newTs, _syncedAt: oldTs },
    { payload: { _generationJobId: 'job-1', _generationRunId: 'run-new' }, updated_at: remoteOld.updated_at }
  ),
  false
);
assert.equal(
  shouldPushLocalCourse(
    { _generationJobId: 'job-1', _generationRunId: 'run-old', updatedAt: newTs, _syncedAt: oldTs },
    { payload: { _generationJobId: 'job-1', _generationRunId: 'run-new' }, updated_at: remoteOld.updated_at }
  ),
  false
);
assert.equal(
  shouldPushLocalCourse(
    currentEdit({ _generationJobId: 'job-1', _generationRunId: 'run-new', updatedAt: newTs, _syncedAt: oldTs, _courseUpdatedAt: remoteOld.updated_at }),
    { payload: { _generationJobId: 'job-1', _generationRunId: 'run-new' }, updated_at: remoteOld.updated_at }
  ),
  true
);

assert.equal(courseCanSyncToAccount({ createdBy: 'david@example.com' }, 'david@example.com'), true);
assert.equal(courseCanSyncToAccount({ createdBy: 'david@example.com' }, 'other@example.com'), false);
assert.equal(courseCanSyncToAccount({ createdByUserId: 'user-1', createdBy: 'david@example.com' }, 'david@example.com', 'user-1'), true);
assert.equal(courseCanSyncToAccount({ createdByUserId: 'user-1', createdBy: 'david@example.com' }, 'david@example.com', 'user-2'), false);
assert.equal(courseCanSyncToAccount({}, 'other@example.com'), true);
assert.deepEqual(
  coursePayloadForAccount({ config: { id: 'legacy' }, createdBy: 'owner@example.com' }, { id: 'user-1', email: 'owner@example.com' }),
  { config: { id: 'legacy' }, createdBy: 'owner@example.com', createdByUserId: 'user-1' }
);
assert.deepEqual(
  coursePayloadForAccount({ config: { id: 'ownerless' } }, { id: 'user-1', email: 'owner@example.com' }),
  { config: { id: 'ownerless' }, createdByUserId: 'user-1', createdBy: 'owner@example.com' }
);
assert.deepEqual(
  coursePayloadForAccount({ config: { id: 'owned' }, createdByUserId: 'user-2', createdBy: 'other@example.com' }, { id: 'user-1', email: 'owner@example.com' }),
  { config: { id: 'owned' }, createdByUserId: 'user-2', createdBy: 'other@example.com' }
);
assert.equal(
  localCourseForAccount({ createdByUserId: 'user-1', updatedAt: newTs }, { id: 'user-1', email: 'owner@example.com' })?.updatedAt,
  newTs
);
assert.equal(
  localCourseForAccount({ createdByUserId: 'user-1', updatedAt: newTs }, { id: 'user-2', email: 'owner@example.com' }),
  null
);
assert.equal(
  shouldInstallRemoteCourse(
    localCourseForAccount({ createdByUserId: 'user-other', updatedAt: newTs + 1000 }, { id: 'user-current', email: 'current@example.com' }),
    remoteNew
  ),
  true
);
assert.equal(
  shouldRemoveLocalCourseAfterPull(
    { createdByUserId: 'user-current', _syncedAt: oldTs, updatedAt: oldTs },
    null,
    { id: 'user-current', email: 'current@example.com' }
  ),
  true
);
assert.equal(
  shouldRemoveLocalCourseAfterPull(
    { createdByUserId: 'user-current', _syncedAt: oldTs, updatedAt: newTs },
    null,
    { id: 'user-current', email: 'current@example.com' }
  ),
  false
);
assert.equal(
  shouldRemoveLocalCourseAfterPull(
    { createdByUserId: 'user-other', _syncedAt: oldTs, updatedAt: oldTs },
    null,
    { id: 'user-current', email: 'current@example.com' }
  ),
  false
);
assert.equal(
  shouldRemoveLocalCourseAfterPull(
    { createdByUserId: 'user-current', _syncedAt: oldTs, updatedAt: oldTs },
    remoteOld,
    { id: 'user-current', email: 'current@example.com' }
  ),
  false
);

assert.equal(courseVisibleToEmail({ createdBy: 'david@example.com' }, 'david@example.com'), true);
assert.equal(courseVisibleToEmail({ createdBy: 'david@example.com' }, 'other@example.com'), false);
assert.equal(courseVisibleToEmail({ createdByUserId: 'user-1', createdBy: 'david@example.com' }, 'other@example.com', 'user-1'), true);
assert.equal(courseVisibleToEmail({ createdByUserId: 'user-1', createdBy: 'david@example.com' }, 'david@example.com', 'user-2'), false);
assert.equal(courseVisibleToEmail({}, 'other@example.com'), true);

assert.equal(canDeleteCourse({ config: {}, createdByUserId: 'user-1' }, 'other@example.com', 'user-1'), true);
assert.equal(canDeleteCourse({ config: {}, createdByUserId: 'user-1' }, 'david@example.com', 'user-2'), false);
assert.equal(canDeleteCourse({ config: {}, createdBy: 'david@example.com' }, 'david@example.com'), true);

{
  const store = new Map();
  globalThis.localStorage = {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    }
  };
  const removedCourse = {
    config: { id: 'owned-course', title: 'Owned Course' },
    createdByUserId: 'user-1',
    updatedAt: newTs
  };
  localStorage.setItem('learnable-user-courses', JSON.stringify({ 'owned-course': removedCourse }));
  const events = [];
  const off = _onCoursesChanged(evt => events.push(evt));
  removeUserCourse('owned-course');
  off();
  assert.deepEqual(events, [{ type: 'removed', id: 'owned-course', course: removedCourse }]);
}

assert.ok(courseSyncSource.includes('toUpload.forEach(id => schedulePush(id, { force: true }));'));
assert.ok(courseSyncSource.includes('const pullOwnerId = u.id;'));
assert.ok(courseSyncSource.includes('function isCurrentPullOwner(ownerId)'));
assert.ok(courseSyncSource.includes('function isCurrentSyncOwner(ownerId)'));
assert.ok(courseSyncSource.includes('getUser()?.id === ownerId && currentSyncUserId === ownerId'));
assert.ok(
  pullAllBlock.indexOf('if (!isCurrentPullOwner(pullOwnerId)) return;') <
  pullAllBlock.indexOf('data = res.data || [];'),
  'stale account pulls should stop before installing cloud courses or scheduling uploads.'
);
assert.ok(
  pullAllBlock.indexOf('} catch (e) {') <
  pullAllBlock.indexOf('if (!isCurrentPullOwner(pullOwnerId)) return;', pullAllBlock.indexOf('} catch (e) {')),
  'stale account pull errors should not overwrite the current account sync status.'
);
assert.ok(pushOneBlock.includes('const pushOwnerId = u.id;'));
assert.ok(pushOneBlock.includes('const payload = coursePayloadForAccount(course, u);'));
assert.ok(pushOneBlock.includes('const remoteRow = await loadRemoteCourseForPush(c, pushOwnerId, id);'));
assert.ok(pushOneBlock.includes('if (!shouldPushLocalCourse(payload, remoteRow)) {'));
assert.ok(pushOneBlock.includes('queuePullAfterPushConflict(pushOwnerId);'));
assert.ok(pushOneBlock.includes('const saved = await writeRemoteCourseFromPush(c, pushOwnerId, id, payload, remoteRow);'));
assert.ok(
  pushOneBlock.indexOf('queuePullAfterPushConflict(pushOwnerId);') <
    pushOneBlock.indexOf('return { pushed: false, failed: false, skipped: true, conflict: !!remoteRow };'),
  'push conflicts should queue a pull before returning skipped.'
);
assert.ok(pushOneBlock.includes('if (!saved) {'));
assert.ok(pushOneBlock.includes('return { pushed: false, failed: false, skipped: true, conflict: true };'));
assert.ok(courseSyncSource.includes('p_owner: ownerId'));
assert.ok(pushOneBlock.includes('payload,'));
assert.equal(pushOneBlock.includes(".from('user_courses').upsert"), false);
assert.ok(pushOneBlock.includes('if (!isCurrentSyncOwner(pushOwnerId)) return { pushed: false, failed: false, skipped: true, stale: true };'));
assert.ok(
  pushOneBlock.indexOf('if (!isCurrentSyncOwner(pushOwnerId)) return { pushed: false, failed: false, skipped: true, stale: true };') <
    pushOneBlock.indexOf('const updated = _readAllCourses();'),
  'stale account pushes should stop before stamping local _syncedAt.'
);
assert.ok(
  pushOneBlock.indexOf('} catch (e) {') <
    pushOneBlock.indexOf('if (!isCurrentSyncOwner(pushOwnerId)) return { pushed: false, failed: false, skipped: true, stale: true };', pushOneBlock.indexOf('} catch (e) {')),
  'stale account push errors should not overwrite current account sync status.'
);
assert.ok(pushOneBlock.includes('JSON.stringify(updated[id]) === JSON.stringify(course)'));
assert.ok(pushOneBlock.includes('...coursePayloadForAccount(saved.payload, u)'));
assert.ok(pushOneBlock.includes("client.rpc('commit_user_course'"));
assert.ok(pushOneBlock.includes('p_updated_at: payload._courseUpdatedAt || null'));
assert.ok(pushOneBlock.includes('p_expected_revision: payload._courseRevision || null'));
assert.ok(courseSyncSource.includes('const activeCloudRows = data.filter(row => !pendingDeletes.has(row.id));'));
assert.ok(courseSyncSource.includes('const cloudById = new Map(activeCloudRows.map(r => [r.id, r]));'));
assert.ok(courseSyncSource.includes('for (const row of activeCloudRows)'));
assert.ok(
  courseSyncSource.indexOf('const activeCloudRows = data.filter(row => !pendingDeletes.has(row.id));') <
  courseSyncSource.indexOf('for (const row of activeCloudRows)'),
  'pending remote deletes should be masked before cloud rows are installed locally.'
);
assert.ok(courseSyncSource.includes('const local = localCourseForAccount(localAll[row.id], u);'));
assert.ok(
  courseSyncSource.includes('const installed = { ...coursePayloadForAccount(row.payload, u), _courseUpdatedAt: row.updated_at, _syncedAt: remoteTs };'),
  'remote pulls should stamp legacy ownerless payloads to the signed-in account before local install.'
);
assert.ok(courseSyncSource.includes('_installCourseFromRemote(row.id, installed);'));
assert.ok(courseSyncSource.includes('shouldRemoveLocalCourseAfterPull(local, cloudById.get(id), u)'));
assert.ok(courseSyncSource.includes('function schedulePush(id, options = {})'));
assert.ok(courseSyncSource.includes('if (inUserChange && !options.force) return;'));
assert.ok(courseSyncSource.includes('const DELETE_RETRY_MS = 5000;'));
assert.ok(courseSyncSource.includes("const PENDING_DELETE_KEY = 'learnable-course-pending-deletes';"));
assert.ok(courseSyncSource.includes('const deleteTimers = new Map();'));
assert.ok(courseSyncSource.includes('function readPendingDeleteStore()'));
assert.ok(courseSyncSource.includes('function writePendingDeleteStore(store)'));
assert.ok(courseSyncSource.includes('function rememberPendingDelete(ownerId, courseId)'));
assert.ok(courseSyncSource.includes('function forgetPendingDelete(ownerId, courseId)'));
assert.ok(courseSyncSource.includes('function loadPendingDeletesForUser(userId)'));
assert.ok(courseSyncSource.includes('for (const id of pendingDeleteIdsForUser(userId)) pendingDeletes.add(id);'));
assert.ok(userCoursesSource.includes('const course = all[id] || null;'));
assert.ok(userCoursesSource.includes("_emit({ type: 'removed', id, course });"));
assert.ok(courseSyncSource.includes('function scheduleDelete(id, removedCourse = null)'));
assert.ok(courseSyncSource.includes('const user = getUser();'));
assert.ok(courseSyncSource.includes("const ownerId = user?.id || '';"));
assert.ok(courseSyncSource.includes('if (!ownerId) return;'));
assert.ok(courseSyncSource.includes('if (!removedCourse || !courseCanSyncToAccount(removedCourse, user.email, ownerId)) return;'));
assert.ok(courseSyncSource.includes('rememberPendingDelete(ownerId, id);'));
assert.ok(courseSyncSource.includes('forgetPendingDelete(u.id, id);'));
assert.ok(courseSyncSource.includes('if (nextUserId) loadPendingDeletesForUser(nextUserId);'));
assert.ok(courseSyncSource.includes('for (const id of pendingDeletes) scheduleDeleteRetry(id, user.id);'));
assert.ok(courseSyncSource.includes("async function deleteRemote(id, expectedOwnerId = '')"));
assert.ok(courseSyncSource.includes('if (expectedOwnerId && u?.id && u.id !== expectedOwnerId) return;'));
assert.ok(courseSyncSource.includes('if (!c || !u) { scheduleDeleteRetry(id, expectedOwnerId); return; }'));
assert.ok(courseSyncSource.includes('function scheduleDeleteRetry(id, ownerId = getUser()?.id || currentSyncUserId || \'\')'));
assert.ok(courseSyncSource.includes('if (pendingDeletes.has(id)) deleteRemote(id, ownerId);'));
assert.ok(courseSyncSource.includes("deleteTimers.set(id, setTimeout(() => {\n    deleteTimers.delete(id);\n    if (pendingDeletes.has(id)) deleteRemote(id, ownerId);\n  }, 200));"));
assert.ok(courseSyncSource.includes('pendingDeletes.delete(id);'));
assert.ok(
  courseSyncSource.indexOf('pendingDeletes.delete(id);') > courseSyncSource.indexOf("if (error) throw error;"),
  'remote delete intent should clear only after Supabase delete succeeds.'
);
assert.ok(courseSyncSource.includes('deleteTimers.forEach(t => clearTimeout(t));'));
assert.ok(courseSyncSource.includes("return { pushed: false, failed: false, skipped: true };"));
assert.ok(courseSyncSource.includes("return { pushed: true, failed: false, skipped: false, pending: !unchanged };"));
assert.ok(courseSyncSource.includes("return { pushed: false, failed: true, skipped: false };"));
assert.ok(courseSyncSource.includes('export function shouldPushLocalCourse'));
assert.ok(courseSyncSource.includes('function loadRemoteCourseForPush'));
assert.ok(courseSyncSource.includes('async function writeRemoteCourseFromPush'));
assert.ok(courseSyncSource.includes('const CONFLICT_PULL_DELAY_MS = 250;'));
assert.ok(courseSyncSource.includes('let conflictPullTimer = null;'));
assert.ok(courseSyncSource.includes('function queuePullAfterPushConflict(ownerId)'));
assert.ok(courseSyncSource.includes('if (isCurrentSyncOwner(ownerId)) pullAll();'));
assert.ok(courseSyncSource.includes('clearTimeout(conflictPullTimer);'));
assert.ok(courseSyncSource.includes('conflictPullTimer = null;'));
assert.ok(courseSyncSource.includes("client.rpc('commit_user_course'"));
assert.ok(courseSyncSource.includes("if (data?.error === 'conflict') return null;"));
assert.ok(!pushOneBlock.includes('.update({ payload'));
assert.ok(!pushOneBlock.includes('p_updated_at: remoteRow.updated_at'), 'fresh remote timestamp is never attached to an old local body');
assert.ok(courseSyncSource.includes('function isDifferentGenerationRun'));
assert.ok(courseSyncSource.includes('if (isDifferentGenerationRun(local, remoteRow?.payload)) return false;'));
assert.ok(courseSyncSource.includes('else skipped++;'));
assert.ok(courseSyncSource.includes('return { pushed, failed, skipped };'));

console.log('course sync policy tests passed');
