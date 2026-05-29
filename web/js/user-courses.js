// LocalStorage layer for user-generated courses.
// Phase 2 #3 ships local-only; a Supabase backend follow-up will mirror these
// up so generated courses follow the user across devices.

const KEY = 'learnable-user-courses';
const EMAIL_KEY = 'learnable-user-email';

// Admin allowlist — emails that can delete any user-generated course. When
// Supabase auth lands this becomes an `is_admin` column on the user profile;
// for now it's a hardcoded list keyed on the locally-stored email identity.
const ADMIN_EMAILS = new Set(['david@davidwang.com.au']);

/** Current user's email, lowercased + trimmed (or '' if unset). */
export function getCurrentUserEmail() {
  return (localStorage.getItem(EMAIL_KEY) || '').trim().toLowerCase();
}
/** Persist the current user's email. Pass '' to clear. */
export function setCurrentUserEmail(email) {
  const v = (email || '').trim().toLowerCase();
  if (!v) localStorage.removeItem(EMAIL_KEY);
  else localStorage.setItem(EMAIL_KEY, v);
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
