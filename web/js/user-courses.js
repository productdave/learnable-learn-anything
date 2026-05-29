// LocalStorage layer for user-generated courses.
// Phase 2 #3 ships local-only; a Supabase backend follow-up will mirror these
// up so generated courses follow the user across devices.

const KEY = 'learnable-user-courses';

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
      createdAt: prior.createdAt
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
  course = {
    ...course,
    config: { ...course.config, id },
    _brief: extra._brief,
    _research: extra._research,
    createdAt: course.createdAt || Date.now()
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
