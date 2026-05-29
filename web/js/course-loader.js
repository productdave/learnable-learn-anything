// Course loader — the single source of truth for course metadata + data fetching.
//
// In Phase 0 this fetches static JSON from /data/courses/<id>/. In Phase 2 the
// same interface will fetch from a real backend API (Supabase via a Vercel
// function) without any consumer code changing.

import { listUserCourses, getUserCourse } from './user-courses.js';

/** Fallback emoji for user-generated courses created before Stage 1 picked one. */
function deriveEmoji(title = '') {
  const t = String(title).toLowerCase();
  const rules = [
    [/coffee|brew|espresso|barista/, '☕'],
    [/\bai\b|machine learning|model|llm|gpt|claude|annotat/, '🤖'],
    [/data|analytics|stat|metric|rubric|eval/, '📊'],
    [/game theor|negoti|strategy/, '🎲'],
    [/product manag|\bpm\b|roadmap/, '💼'],
    [/code|programming|software|engineer|developer/, '💻'],
    [/cook|food|recipe|chef|bak/, '🍳'],
    [/finance|invest|money|tax|budget/, '💰'],
    [/health|fitness|exercise|workout|nutrition/, '💪'],
    [/design|ux|ui|figma|typography/, '🎨'],
    [/write|writing|essay|copywrit|content/, '✍️'],
    [/photo|camera|photograph|cinemato/, '📷'],
    [/music|guitar|piano|sing|drum/, '🎵'],
    [/lang|french|spanish|chinese|german|japanese|english/, '🗣️'],
    [/garden|plant|botan|farm/, '🌱'],
    [/travel|trip|tour/, '✈️'],
    [/parent|child|kid|baby/, '👶'],
    [/sleep|meditat|mindful/, '🧘'],
    [/marketing|growth|seo|campaign/, '📈'],
    [/legal|law|contract/, '⚖️'],
    [/medical|doctor|health|clinic/, '🩺']
  ];
  for (const [re, e] of rules) if (re.test(t)) return e;
  return '🎓';
}

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

/** Clear cached config/curriculum/module data for a course. Call after a
 *  course is re-saved (e.g. surgical retry filled in missing topics) so the
 *  next load reflects the fresh state. */
export function invalidateCourseCache(courseId) {
  delete courseCache[courseId];
  for (const key of Object.keys(moduleCache)) {
    if (key.startsWith(`${courseId}/`)) delete moduleCache[key];
  }
  if (_activeCourseId === courseId) _activeCourseId = null;
}

/**
 * Load the public course library index. For Phase 2.1 this is a static JSON
 * file served alongside course data; in Phase 2.2+ it comes from Supabase.
 */
export async function loadLibrary() {
  const resp = await fetch('data/courses/index.json');
  const bundled = resp.ok ? await resp.json() : { courses: [] };
  // User-generated courses (localStorage) come first, freshly-made on top.
  const user = listUserCourses().map(c => {
    const totalTopics = c.curriculum.modules.reduce((n, m) => n + m.topics.length, 0);
    return {
      id: c.config.id,
      title: c.config.title,
      subtitle: c.config.subtitle,
      modules: c.curriculum.modules.length,
      topics: totalTopics,
      accentColor: c.curriculum.modules[0]?.color || c.config.moduleColorAccents?.[0] || '#4338CA',
      icon: c.curriculum.modules[0]?.icon || 'sparkle',
      emoji: c.config.emoji || deriveEmoji(c.config.title),  // Stage-1 emoji, with a keyword-derived fallback
      user: true,
      partial: !!c.failedTopics?.length,
      createdBy: c.createdBy || null  // pass author through so canDeleteCourse can run on the slim summary
    };
  });
  return { courses: [...user, ...bundled.courses] };
}

/**
 * Fetch and cache the course config + curriculum for a given courseId.
 * Returns { config, curriculum }.
 */
export async function loadCourse(courseId = getCurrentCourseId()) {
  if (courseCache[courseId]) return courseCache[courseId];

  // 1. Try user-generated (localStorage) first.
  const user = getUserCourse(courseId);
  if (user) {
    courseCache[courseId] = { config: user.config, curriculum: user.curriculum };
    _activeCourseId = courseId;
    return courseCache[courseId];
  }

  // 2. Fall through to static bundled courses.
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

  // User-generated course → module data lives in localStorage.
  const user = getUserCourse(courseId);
  if (user) {
    const data = user.modules?.[mod.number] || {};
    moduleCache[cacheKey] = data;
    return data;
  }

  // Static bundled course → fetch JSON.
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
