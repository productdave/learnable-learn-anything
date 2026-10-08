// Local cache for user-generated courses.
// Supabase `user_courses` is the durable account store; course-sync mirrors it
// into localStorage so the library stays fast and works through brief outages.

const KEY = 'learnable-user-courses';

// Admin allowlist — emails that can delete any user-generated course. When
// the user-profile schema gains an is_admin column this moves into Postgres;
// for now it's a hardcoded list keyed on the Supabase auth user's email.
const ADMIN_EMAILS = new Set(['david@davidwang.com.au']);

// Local cache of the signed-in identity, updated from auth.js's onUserChange.
// We cache because canDeleteCourse runs on every library card render and we
// don't want every render to await an async session lookup.
let _currentUserEmail = '';
let _currentUserId = '';
// A failed browser-cache write must not discard a fetched account course. Keep
// one serialized page-only snapshot until persistence succeeds or identity
// changes. Serialization also keeps every reader's snapshot independent.
let _temporaryCourses = null;
const UNKNOWN_CACHE_BASE = Symbol('unknown-cache-base');
let _temporaryCourseBase = UNKNOWN_CACHE_BASE;
let _cacheWriteWarned = false;
const CACHE_ERROR_NAMES = new Set(['QuotaExceededError', 'SecurityError', 'InvalidStateError', 'UnknownError', 'TypeError', 'Error']);

function clearTemporaryCourses() {
  _temporaryCourses = null;
  _temporaryCourseBase = UNKNOWN_CACHE_BASE;
  _cacheWriteWarned = false;
}

/** Updated by app.js on auth state change. Internal. */
export function _setCurrentUserEmailFromAuth(email, userId = '') {
  const nextEmail = (email || '').trim().toLowerCase();
  const nextId = String(userId || '').trim();
  if (nextEmail !== _currentUserEmail || nextId !== _currentUserId) clearTemporaryCourses();
  _currentUserEmail = nextEmail;
  _currentUserId = nextId;
}

/** Current signed-in user's email, lowercased + trimmed (or '' if not signed in). */
export function getCurrentUserEmail() {
  return _currentUserEmail;
}
/** Current signed-in Supabase user id (or '' if not signed in). */
export function getCurrentUserId() {
  return _currentUserId;
}
/** Is this email an admin? Defaults to the current user. */
export function isAdmin(email = getCurrentUserEmail()) {
  return !!email && ADMIN_EMAILS.has(email);
}
/**
 * Can the current user delete this course?
 *
 * Rules:
 * - Bundled (static) courses: never deletable — they're shared assets.
 * - Admin: yes, always.
 * - Author (course.createdByUserId === current user id): yes.
 * - Legacy author (course.createdBy === current email): yes.
 * - Otherwise: no.
 *
 * Legacy courses (saved before authorship stamping) have no `createdBy`, so
 * only admin can delete them. Non-admin authors get a clean error message.
 *
 * Accepts either a full saved course OR the slim library-summary shape that
 * loadLibrary() returns (id + user + createdBy).
 */
export function canDeleteCourse(course, email = getCurrentUserEmail(), userId = getCurrentUserId()) {
  if (!course) return false;
  const isUserGenerated = !!(course.user || course._brief || course.config);
  if (!isUserGenerated) return false;
  if (isAdmin(email)) return true;
  const ownerId = String(course.createdByUserId || '').trim();
  if (ownerId) return !!userId && ownerId === String(userId || '').trim();
  const author = String(course.createdBy || '').trim().toLowerCase();
  return !!author && !!email && author === email;
}

export function courseVisibleToEmail(course, email = getCurrentUserEmail(), userId = getCurrentUserId()) {
  if (!course) return false;
  if (isAdmin(email)) return true;
  const ownerId = String(course.createdByUserId || '').trim();
  if (ownerId) return !!userId && ownerId === String(userId || '').trim();
  const author = String(course.createdBy || '').trim().toLowerCase();
  const viewer = String(email || '').trim().toLowerCase();
  return !author || (!!viewer && author === viewer);
}

function readAll() {
  try { return JSON.parse(_temporaryCourses ?? localStorage.getItem(KEY) ?? '{}'); } catch { return {}; }
}
function writeAll(obj) {
  let serialized;
  try { serialized = JSON.stringify(obj); } catch { return false; }
  let persisted = UNKNOWN_CACHE_BASE;
  try { persisted = localStorage.getItem(KEY); } catch { /* Do not guess a missing baseline. */ }
  if (_temporaryCourses !== null && (persisted === UNKNOWN_CACHE_BASE || persisted !== _temporaryCourseBase)) {
    // Another tab may have edited the persistent map while this page had no
    // writable cache. Keep our page usable, but never replace that newer map
    // with a stale full snapshot. Identity change discards this temporary copy.
    _temporaryCourses = serialized;
    return false;
  }
  try {
    localStorage.setItem(KEY, serialized);
    clearTemporaryCourses();
    return true;
  } catch (error) {
    if (_temporaryCourses === null) _temporaryCourseBase = persisted;
    _temporaryCourses = serialized;
    if (!_cacheWriteWarned) {
      _cacheWriteWarned = true;
      const name = CACHE_ERROR_NAMES.has(error?.name) ? error.name : 'Error';
      console.warn('COURSE_CACHE_WRITE_FAILED', name);
    }
    return false; // Readable in this page, not a claim of offline persistence.
  }
}

// Accidental mixed-version cache protection, not an authorization mechanism.
// Old save code merges unknown metadata into a stale body. Bind a current-client
// edit marker to the actual body so the new mirror cannot upload that old merge.
export function courseMirrorFingerprint(course) {
  const { _courseLocalEdit, _syncedAt, ...body } = course;
  const text = JSON.stringify(body); let a = 2166136261, b = 2246822519;
  for (let i = 0; i < text.length; i++) { const n = text.charCodeAt(i); a = Math.imul(a ^ n, 16777619); b = Math.imul(b ^ n, 3266489917); }
  return `${text.length}:${a >>> 0}:${b >>> 0}`;
}
function markLocalEdit(course) {
  course._courseLocalEdit = { version: 1, fingerprint: courseMirrorFingerprint(course) };
  return course;
}
export function hasVerifiedLocalCourseEdit(course) {
  return course?._courseLocalEdit?.version === 1 && course._courseLocalEdit.fingerprint === courseMirrorFingerprint(course);
}

// Listeners (course-sync subscribes; library may too in future). Internal.
const _listeners = new Set();
function _emit(evt) { _listeners.forEach(fn => { try { fn(evt); } catch {} }); }
export function _onCoursesChanged(fn) { _listeners.add(fn); return () => _listeners.delete(fn); }
/** Read the full local courses map (for sync to compute diffs). Internal. */
export function _readAllCourses() { return readAll(); }
/** Install a course row from a remote pull without re-emitting (avoids echo). */
export function _installCourseFromRemote(id, course) {
  const all = readAll();
  all[id] = { ...course, config: { ...(course.config || {}), id } };
  delete all[id]._courseLocalEdit;
  return writeAll(all);
}
/** Delete locally without firing the "removed" event (cloud→local). */
export function _removeCourseLocalSilent(id) {
  const all = readAll();
  delete all[id];
  writeAll(all);
}

export function listUserCourses() {
  return Object.values(readAll())
    .filter(course => courseVisibleToEmail(course))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function getUserCourse(id) {
  const course = readAll()[id] || null;
  return courseVisibleToEmail(course) ? course : null;
}

/** Persist a generated course. Returns the final saved id (renamed on collision).
 *  `extra` can carry { _brief, _research } so surgical retry of failed topics
 *  doesn't have to re-run Stage 1 or Stage 2. */
export function saveUserCourse(course, extra = {}) {
  const all = readAll();
  const baseRevision = course._courseRevision || null, baseUpdatedAt = course._courseUpdatedAt || null;
  let id = course.config.id;
  // If this same course (same id) was saved before, merge — keep prior _brief /
  // _research, overlay new modules/curriculum, etc. This is how surgical retry
  // updates an existing partial course in place rather than creating a new one.
  if (all[id]) {
    const prior = all[id];
    course = {
      ...prior,
      ...course,
      config: { ...prior.config, ...course.config },
      _brief: extra._brief || prior._brief,
      _research: extra._research || prior._research,
      createdAt: prior.createdAt,
      createdByUserId: prior.createdByUserId || extra.createdByUserId || getCurrentUserId() || undefined,
      createdBy: prior.createdBy || extra.createdBy || getCurrentUserEmail() || undefined,
      updatedAt: Date.now()
    };
    course._courseRevision = baseRevision; course._courseUpdatedAt = baseUpdatedAt;
    all[id] = markLocalEdit(course);
    writeAll(all);
    _emit({ type: 'saved', id, course });
    return id;
  }

  // First-time save: rename if it collides with a bundled course slug.
  const reserved = new Set(['game-theory', 'pour-over-coffee', 'ai-annotation-platform-pm', 'quiz-demo']);
  while (reserved.has(id)) {
    id = `${id}-${Math.random().toString(36).slice(2, 6)}`;
  }
  // Stamp the current user as author so they (and admins) can manage the
  // course later. Prefer the stable Supabase user id, with email retained for
  // legacy display and cross-deployment imports.
  const ownerId = extra.createdByUserId || getCurrentUserId() || undefined;
  const author = extra.createdBy || getCurrentUserEmail() || undefined;
  course = {
    ...course,
    config: { ...course.config, id },
    _brief: extra._brief,
    _research: extra._research,
    createdAt: course.createdAt || Date.now(),
    createdByUserId: course.createdByUserId || ownerId,
    createdBy: course.createdBy || author,
    updatedAt: Date.now()
  };
  all[id] = markLocalEdit(course);
  writeAll(all);
  _emit({ type: 'saved', id, course });
  return id;
}

export function removeUserCourse(id) {
  const all = readAll();
  const course = all[id] || null;
  delete all[id];
  writeAll(all);
  _emit({ type: 'removed', id, course });
}

// --- Cross-deployment migration ---------------------------------------
//
// localStorage is origin-scoped, so courses generated on an older
// deployment URL can't be read by this one. We expose simple
// export/import primitives so a user can copy the raw JSON across.

/** Serialize all user-generated courses as a JSON string for export. */
export function exportCoursesJson() {
  return JSON.stringify(readAll(), null, 2);
}

/**
 * Merge an exported courses blob into this device's localStorage. Accepts
 * either:
 *   - the raw `learnable-user-courses` value (object keyed by id, each with
 *     config/curriculum/modules etc.)
 *   - a single course object (one entry)
 *   - an array of course objects
 *
 * Returns `{ imported, skipped, errors }` so the UI can summarise the result.
 * Courses keep their original id when there's no collision; collisions get a
 * short suffix so nothing already in the library is overwritten.
 */
export function importCoursesJson(text) {
  let parsed;
  try { parsed = JSON.parse(text); }
  catch (err) { return { imported: 0, skipped: 0, errors: [`Not valid JSON: ${err.message}`] }; }

  // Normalise the shape: { id: course, ... } | course | [course, ...]
  let entries = [];
  if (Array.isArray(parsed)) {
    entries = parsed.map(c => [c?.config?.id || '', c]);
  } else if (parsed && typeof parsed === 'object') {
    if (parsed.config && parsed.curriculum) {
      // single course
      entries = [[parsed.config.id, parsed]];
    } else {
      entries = Object.entries(parsed);
    }
  }

  const all = readAll();
  const reserved = new Set(['game-theory', 'pour-over-coffee', 'ai-annotation-platform-pm', 'quiz-demo']);
  let imported = 0, skipped = 0;
  const errors = [];
  const savedIds = [];

  for (const [origId, course] of entries) {
    if (!course || !course.config || !course.curriculum) {
      skipped++;
      errors.push(`Skipped an entry that doesn't look like a course (${origId || 'unknown'})`);
      continue;
    }
    // Resolve final id — keep original if free, otherwise add a short suffix.
    let id = origId || course.config.id;
    if (!id) { skipped++; errors.push('Skipped a course with no id'); continue; }
    if (all[id] || reserved.has(id)) {
      // Already have this id (or it collides with a bundled slug) — add suffix.
      let attempt = `${id}-${Math.random().toString(36).slice(2, 6)}`;
      while (all[attempt] || reserved.has(attempt)) attempt = `${id}-${Math.random().toString(36).slice(2, 6)}`;
      id = attempt;
    }
    all[id] = {
      ...course,
      config: { ...course.config, id },
      createdAt: course.createdAt || Date.now(),
      // Bump updatedAt so cloud sync recognises this as fresh material to upload.
      updatedAt: Date.now()
      // createdBy is preserved as-is so the original author still owns it.
      // _syncedAt is intentionally cleared so this device pushes it up.
    };
    delete all[id]._syncedAt;
    delete all[id]._courseRevision; delete all[id]._courseUpdatedAt;
    markLocalEdit(all[id]);
    savedIds.push(id);
    imported++;
  }
  writeAll(all);
  // Fire a "saved" event per imported course so course-sync schedules an
  // upload to the cloud for each.
  for (const id of savedIds) _emit({ type: 'saved', id, course: all[id] });
  return { imported, skipped, errors };
}
