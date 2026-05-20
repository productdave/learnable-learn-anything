// Course loader — the single source of truth for course metadata + data fetching.
//
// In Phase 0 this fetches static JSON from /data/courses/<id>/. In Phase 2 the
// same interface will fetch from a real backend API (Supabase via a Vercel
// function) without any consumer code changing.

const courseCache = {};
const moduleCache = {};
let _activeCourseId = null;

/**
 * Determine which course to load. Returns null when no `?course=<id>` is
 * specified — caller renders the course library instead.
 */
export function getCurrentCourseId() {
  const params = new URLSearchParams(window.location.search);
  return params.get('course') || null;
}

/**
 * Load the public course library index. For Phase 2.1 this is a static JSON
 * file served alongside course data; in Phase 2.2+ it comes from Supabase.
 */
export async function loadLibrary() {
  const resp = await fetch('data/courses/index.json');
  if (!resp.ok) throw new Error('Course library not available');
  return await resp.json();
}

/**
 * Fetch and cache the course config + curriculum for a given courseId.
 * Returns { config, curriculum }.
 */
export async function loadCourse(courseId = getCurrentCourseId()) {
  if (courseCache[courseId]) return courseCache[courseId];

  const base = `data/courses/${courseId}`;
  const [configResp, curriculumResp] = await Promise.all([
    fetch(`${base}/course.json`),
    fetch(`${base}/curriculum.json`)
  ]);

  if (!configResp.ok) throw new Error(`Course config not found: ${courseId}`);
  if (!curriculumResp.ok) throw new Error(`Curriculum not found: ${courseId}`);

  const config = await configResp.json();
  const curriculum = await curriculumResp.json();

  courseCache[courseId] = { config, curriculum };
  _activeCourseId = courseId;
  return courseCache[courseId];
}

/**
 * Synchronous accessors — only safe to call AFTER `loadCourse()` has resolved.
 * Most consumers (sidebar, search index, chat system prompt) call these from
 * functions that run post-boot, so this is fine.
 */
export function getCourseConfig() {
  const id = _activeCourseId;
  if (!id || !courseCache[id]) throw new Error('Course not loaded yet — call loadCourse() first');
  return courseCache[id].config;
}

export function getCurriculum() {
  const id = _activeCourseId;
  if (!id || !courseCache[id]) throw new Error('Course not loaded yet — call loadCourse() first');
  return courseCache[id].curriculum;
}

/**
 * Fetch and cache the topic content for a given module of a given course.
 * `moduleId` is the curriculum module id (e.g. 'strategic-lens'); we map to
 * the module's `number` to find the JSON file.
 *
 * Returns the topics object: { [topicId]: { id, title, sections[], flashcards[] } }
 */
export async function loadModule(moduleId, courseId = getCurrentCourseId()) {
  const cacheKey = `${courseId}/${moduleId}`;
  if (moduleCache[cacheKey]) return moduleCache[cacheKey];

  const { curriculum } = await loadCourse(courseId);
  const mod = curriculum.modules.find(m => m.id === moduleId);
  if (!mod) throw new Error(`Unknown moduleId: ${moduleId}`);

  const resp = await fetch(`data/courses/${courseId}/modules/module-${mod.number}.json`);
  if (!resp.ok) throw new Error(`Module data not found: ${moduleId}`);
  const data = await resp.json();

  moduleCache[cacheKey] = data;
  return data;
}

/**
 * Convenience: load every module's topic data for a course. Used by search +
 * flashcards which need to scan everything.
 */
export async function loadAllModules(courseId = getCurrentCourseId()) {
  const { curriculum } = await loadCourse(courseId);
  const results = await Promise.all(
    curriculum.modules.map(async mod => {
      try {
        const data = await loadModule(mod.id, courseId);
        return { mod, data };
      } catch {
        return { mod, data: null };
      }
    })
  );
  return results;
}
