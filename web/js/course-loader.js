// Course loader — the single source of truth for course metadata + data fetching.
//
// In Phase 0 this fetches static JSON from /data/courses/<id>/. In Phase 2 the
// same interface will fetch from a real backend API (Supabase via a Vercel
// function) without any consumer code changing.

import { listUserCourses, getUserCourse } from './user-courses.js?v=4';
import { normalizePublicAuthor } from './public-author.js?v=1';
import * as appConfig from './config.js?v=1';

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

function slugPart(value, fallback = 'item') {
  const slug = String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || fallback;
}

function topicFromBrief(topic, index) {
  return {
    id: slugPart(topic?.id || topic?.title, `topic-${index + 1}`),
    title: String(topic?.title || `Topic ${index + 1}`),
    quiz_plan: topic?.quiz_plan || null,
    ...(/^[a-f0-9]{24}$/.test(topic?.contentRevision || '') ? { contentRevision: topic.contentRevision } : {})
  };
}

function moduleFromBrief(mod, index) {
  const topics = Array.isArray(mod?.topics) ? mod.topics.map(topicFromBrief) : [];
  return {
    id: slugPart(mod?.id || mod?.title, `module-${index + 1}`),
    number: Number(mod?.number || index + 1),
    title: String(mod?.title || `Module ${index + 1}`),
    description: String(mod?.description || ''),
    icon: mod?.icon || 'target',
    color: mod?.color || ['#4338CA', '#D97706', '#059669', '#8B5CF6', '#0EA5E9'][index % 5],
    topics
  };
}

function normalizeModule(mod, index) {
  const normalized = moduleFromBrief(mod, index);
  const sourceTopics = Array.isArray(mod?.topics) ? mod.topics : [];
  normalized.topics = sourceTopics.map(topicFromBrief);
  return normalized;
}

function curriculumHasRenderableModules(curriculum) {
  return Array.isArray(curriculum?.modules)
    && curriculum.modules.length > 0
    && curriculum.modules.every(mod => Array.isArray(mod?.topics));
}

function curriculumFromBrief(brief, fallbackTitle = 'Generated course') {
  const modules = Array.isArray(brief?.modules) ? brief.modules.map(moduleFromBrief) : [];
  return {
    title: String(brief?.title || fallbackTitle),
    subtitle: String(brief?.subtitle || ''),
    modules
  };
}

export function normalizeSavedCourse(course, courseId = '') {
  if (!course) return null;
  const title = course.config?.title || course.config?.name || course.curriculum?.title || course._brief?.title || courseId || 'Generated course';
  const curriculum = curriculumHasRenderableModules(course.curriculum)
    ? {
        ...course.curriculum,
        title: course.curriculum.title || title,
        subtitle: course.curriculum.subtitle || course.config?.subtitle || course._brief?.subtitle || '',
        modules: course.curriculum.modules.map(normalizeModule)
      }
    : curriculumFromBrief(course._brief, title);
  const config = {
    ...(course.config || {}),
    id: course.config?.id || courseId,
    name: course.config?.name || title,
    title,
    subtitle: course.config?.subtitle || curriculum.subtitle || '',
    storageKeyPrefix: course.config?.storageKeyPrefix || course.config?.id || courseId,
    documentTitle: course.config?.documentTitle || `${title} | Learnable`
  };
  return {
    ...course,
    config,
    curriculum,
    modules: course.modules || {}
  };
}

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
export async function loadLibrary({ allowPartial = false, includePublic = true } = {}) {
  let bundled = { courses: [] };
  let catalogError = null;
  try { if(includePublic) {
    const resp = await fetch('data/courses/index.json', { cache: 'no-cache' });
    if (!resp.ok) {
      if (allowPartial) throw new Error('Public catalog unavailable');
    } else {
      bundled = await resp.json();
      if (!Array.isArray(bundled?.courses)) throw new Error('Invalid public catalog');
    } }
  } catch (error) {
    if (!allowPartial) throw error;
    catalogError = 'Public catalog unavailable';
    bundled = { courses: [] };
  }
  if(includePublic&&appConfig.SELF_PUBLISH_ENABLED){
    try{const response=await fetch('/api/courses/community',{cache:'no-store'});if(!response.ok)throw new Error('Community unavailable');const data=await response.json();if(!Array.isArray(data.courses))throw new Error('Invalid catalog');bundled.courses=[...data.courses,...bundled.courses];}
    catch(error){if(!allowPartial)throw error;catalogError='Some Community Courses could not be loaded. Try again.';}
  }
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
      publicAuthor: normalizePublicAuthor(c.publicAuthor || c.config?.publicAuthor),
      partial: !!c.failedTopics?.length,
      tokenUsage: c._tokenUsage || null,
      createdBy: c.createdBy || null,
      createdByUserId: c.createdByUserId || null
    };
  });
  // A published user course also exists in the static catalog. Keep the
  // owner's local/account-backed card and suppress its public duplicate.
  const userIds = new Set(user.map(course => course.id));
  const publicCourses = bundled.courses.filter(course => !userIds.has(course.id));
  return { courses: [...user, ...publicCourses], ...(allowPartial ? { catalogError } : {}) };
}

/**
 * Fetch and cache the course config + curriculum for a given courseId.
 * Returns { config, curriculum }.
 */
export async function loadCourse(courseId = getCurrentCourseId()) {
  // Recheck publication status on entry/navigation. Never turn the public copy
  // into an account-owned course or silently serve an unpublished cached copy.
  if(/^public-[a-f0-9-]{36}$/.test(courseId||'')){
    const response=await fetch('/api/courses/community?courseId='+encodeURIComponent(courseId),{cache:'no-store'});
    if(!response.ok){invalidateCourseCache(courseId);throw new Error('This public course is unavailable.');}
    const {course}=await response.json();
    invalidateCourseCache(courseId);
    courseCache[courseId]={config:course.config,curriculum:course.curriculum};
    for(const mod of course.curriculum.modules)moduleCache[`${courseId}/${mod.id}`]=course.modules[mod.number];
    _activeCourseId=courseId;return courseCache[courseId];
  }
  if (courseCache[courseId]) {
    _activeCourseId = courseId;
    return courseCache[courseId];
  }

  // 1. Try user-generated (localStorage) first.
  const user = getUserCourse(courseId);
  if (user) {
    const normalized = normalizeSavedCourse(user, courseId);
    if (!curriculumHasRenderableModules(normalized?.curriculum)) {
      throw new Error(`Saved course is missing a renderable curriculum: ${courseId}`);
    }
    courseCache[courseId] = { config: normalized.config, curriculum: normalized.curriculum };
    _activeCourseId = courseId;
    return courseCache[courseId];
  }

  // 2. Fall through to static bundled courses.
  const base = `data/courses/${courseId}`;
  const [configResp, curriculumResp] = await Promise.all([
    fetch(`${base}/course.json`, { cache: 'no-cache' }),
    fetch(`${base}/curriculum.json`, { cache: 'no-cache' })
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

  if(/^public-[a-f0-9-]{36}$/.test(courseId||'')){await loadCourse(courseId);const data=moduleCache[cacheKey];if(!data)throw new Error('This lesson is unavailable.');return data;}

  const { curriculum } = await loadCourse(courseId);
  const mod = curriculum.modules.find(m => m.id === moduleId);
  if (!mod) throw new Error(`Unknown moduleId: ${moduleId}`);

  // User-generated course → module data lives in localStorage.
  const user = getUserCourse(courseId);
  if (user) {
    const normalized = normalizeSavedCourse(user, courseId);
    const data = normalized?.modules?.[mod.number] || {};
    moduleCache[cacheKey] = data;
    return data;
  }

  // Static bundled course → fetch JSON.
  const resp = await fetch(`data/courses/${courseId}/modules/module-${mod.number}.json`, { cache: 'no-cache' });
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
