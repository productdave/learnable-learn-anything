// LocalStorage layer for user-generated courses.
// Phase 2 #3 ships local-only; a Supabase backend follow-up will mirror these
// up so generated courses follow the user across devices.

const KEY = 'learnable-user-courses';

// Admin allowlist — emails that can delete any user-generated course. When
// the user-profile schema gains an is_admin column this moves into Postgres;
// for now it's a hardcoded list keyed on the Supabase auth user's email.
const ADMIN_EMAILS = new Set(['david@davidwang.com.au']);

// Local cache of the signed-in email, updated from auth.js's onUserChange.
// We cache because canDeleteCourse runs on every library card render and we
// don't want every render to await an async session lookup.
let _currentUserEmail = '';

/** Updated by app.js on auth state change. Internal. */
export function _setCurrentUserEmailFromAuth(email) {
  _currentUserEmail = (email || '').trim().toLowerCase();
}

/** Current signed-in user's email, lowercased + trimmed (or '' if not signed in). */
export function getCurrentUserEmail() {
  return _currentUserEmail;
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
 * - Author (course.createdBy === current email): yes.
 * - Otherwise: no.
 *
 * Legacy courses (saved before authorship stamping) have no `createdBy`, so
 * only admin can delete them. Non-admin authors get a clean error message.
 *
 * Accepts either a full saved course OR the slim library-summary shape that
 * loadLibrary() returns (id + user + createdBy).
 */
export function canDeleteCourse(course, email = getCurrentUserEmail()) {
  if (!course) return false;
  const isUserGenerated = !!(course.user || course._brief || course.config);
  if (!isUserGenerated) return false;
  if (isAdmin(email)) return true;
  const author = String(course.createdBy || '').trim().toLowerCase();
  return !!author && !!email && author === email;
}

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; }
}
function writeAll(obj) {
  try { localStorage.setItem(KEY, JSON.stringify(obj)); return true; }
  catch { return false; }
}

export function listUserCourses() {
  return Object.values(readAll()).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

export function getUserCourse(id) {
  return readAll()[id] || null;
}

/** Persist a generated course. Returns the final saved id (renamed on collision).
 *  `extra` can carry { _brief, _research } so surgical retry of failed topics
 *  doesn't have to re-run Stage 1 or Stage 2. */
export function saveUserCourse(course, extra = {}) {
  const all = readAll();
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
      createdBy: prior.createdBy || extra.createdBy || getCurrentUserEmail() || undefined
    };
    all[id] = course;
    writeAll(all);
    return id;
  }

  // First-time save: rename if it collides with a bundled course slug.
  const reserved = new Set(['game-theory', 'pour-over-coffee', 'ai-annotation-platform-pm', 'quiz-demo']);
  while (reserved.has(id)) {
    id = `${id}-${Math.random().toString(36).slice(2, 6)}`;
  }
  // Stamp the current user as author so they (and admins) can manage the
  // course later. If the user hasn't set an email yet, leave createdBy
  // undefined — canDeleteCourse falls back to admin-only deletion.
  const author = extra.createdBy || getCurrentUserEmail() || undefined;
  course = {
    ...course,
    config: { ...course.config, id },
    _brief: extra._brief,
    _research: extra._research,
    createdAt: course.createdAt || Date.now(),
    createdBy: course.createdBy || author
  };
  all[id] = course;
  writeAll(all);
  return id;
}

export function removeUserCourse(id) {
  const all = readAll();
  delete all[id];
  writeAll(all);
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
      createdAt: course.createdAt || Date.now()
      // createdBy is preserved as-is so the original author still owns it
    };
    imported++;
  }
  writeAll(all);
  return { imported, skipped, errors };
}
