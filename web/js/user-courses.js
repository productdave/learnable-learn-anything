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

/** Persist a generated course. Returns the final saved id (renamed on collision). */
export function saveUserCourse(course) {
  const all = readAll();
  let id = course.config.id;
  // Avoid collisions with bundled course ids (game-theory / pour-over-coffee / ai-annotation-platform-pm / quiz-demo).
  const reserved = new Set(['game-theory', 'pour-over-coffee', 'ai-annotation-platform-pm', 'quiz-demo']);
  while (reserved.has(id) || (all[id] && all[id] !== course && all[id].config !== course.config)) {
    id = `${id}-${Math.random().toString(36).slice(2, 6)}`;
  }
  course = { ...course, config: { ...course.config, id }, createdAt: course.createdAt || Date.now() };
  all[id] = course;
  writeAll(all);
  return id;
}

export function removeUserCourse(id) {
  const all = readAll();
  delete all[id];
  writeAll(all);
}
