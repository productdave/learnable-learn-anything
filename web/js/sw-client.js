// Page-side glue for the generator service worker.
//
// - Registers /sw.js on first call (idempotent).
// - Installs a single global message listener that routes the SW's
//   gen-progress / gen-error events into the jobs registry + course storage.
//   This keeps the dashboard up to date whether or not the intake modal is
//   open and whether or not the page that started the job is still the
//   active one. (Reload, switch courses, open new tabs — the registry stays
//   accurate as long as the SW is still working.)
// - Exposes startGeneration() to fire a job off in the SW.

import { updateJob, getJob, createJob } from './jobs.js';
import { saveUserCourse, getUserCourse } from './user-courses.js';
import { invalidateCourseCache } from './course-loader.js';

let regPromise = null;
let listenerInstalled = false;

function supported() {
  return typeof navigator !== 'undefined' && 'serviceWorker' in navigator;
}

/** Register the SW once, return the registration (or null if unsupported/failed). */
export function ensureSW() {
  if (!supported()) return Promise.resolve(null);
  if (regPromise) return regPromise;
  regPromise = (async () => {
    try {
      const reg = await navigator.serviceWorker.register('/sw.js', { type: 'module' });
      await navigator.serviceWorker.ready;
      installGlobalListener();
      return reg;
    } catch (err) {
      console.warn('[sw] registration failed, falling back to in-page generation:', err);
      return null;
    }
  })();
  return regPromise;
}

function installGlobalListener() {
  if (listenerInstalled || !supported()) return;
  listenerInstalled = true;

  navigator.serviceWorker.addEventListener('message', (e) => {
    const msg = e.data;
    if (!msg || !msg.jobId) return;

    if (msg.type === 'gen-progress') applyProgress(msg);
    else if (msg.type === 'gen-error') {
      updateJob(msg.jobId, { status: 'failed', error: msg.error || 'unknown error' });
    }
  });
}

function applyProgress(msg) {
  const id = msg.jobId;
  if (msg.stage === 'intake') {
    updateJob(id, { stage: 'intake', message: 'Designing the outline…' });
  } else if (msg.stage === 'intake_done') {
    const b = msg.brief;
    updateJob(id, {
      stage: 'research',
      message: `Researching ${b.modules.length} module${b.modules.length === 1 ? '' : 's'} in parallel…`,
      title: b.title,
      outline: {
        title: b.title,
        subtitle: b.subtitle,
        modules: b.modules.map(m => ({ title: m.title, topicCount: m.topics.length }))
      }
    });
  } else if (msg.stage === 'research') {
    updateJob(id, { stage: 'research' });
  } else if (msg.stage === 'topics') {
    updateJob(id, { stage: 'topics', message: 'Writing topic content…', topicsDone: 0, topicsTotal: msg.total || 0 });
  } else if (msg.stage === 'topic_done' || msg.stage === 'topic_failed') {
    updateJob(id, { stage: 'topics', topicsDone: msg.done || 0, topicsTotal: msg.total || 0 });
  } else if (msg.stage === 'assemble') {
    updateJob(id, { stage: 'assemble', message: 'Finalising…' });
  } else if (msg.stage === 'done') {
    const j = getJob(id);
    if (j?.savedCourseId && (j.status === 'completed' || j.status === 'partial')) return; // already handled
    const course = msg.course;
    const savedId = saveUserCourse(course, { _brief: msg._brief, _research: msg._research });
    invalidateCourseCache(savedId); // so the renderer re-reads the fresh course on next load/route
    // Classify outcome: all topics OK → completed; some OK + some missing →
    // partial (retry surface activates); zero topics OK → failed.
    const failedCount = (course.failedTopics || []).length;
    const totalTopics = computeTotalTopics(course);
    let status, message;
    if (failedCount === 0)            { status = 'completed'; message = 'Done!'; }
    else if (failedCount >= totalTopics) { status = 'failed';  message = `Generation failed — no topics produced (${failedCount} errors).`; }
    else                              { status = 'partial';  message = `${totalTopics - failedCount} of ${totalTopics} topics done — ${failedCount} failed.`; }
    updateJob(id, { status, stage: 'done', message, savedCourseId: savedId, failedCount, totalTopics });
  }
}

function computeTotalTopics(course) {
  let n = 0;
  for (const m of (course.curriculum?.modules || [])) n += (m.topics || []).length;
  return n;
}

/** Surgically retry only the topics that failed on an existing partial course.
 *  Reuses the saved brief + research bundles so no re-payment for Stage 1/2. */
export async function resumeMissing(courseId) {
  const saved = getUserCourse(courseId);
  if (!saved) throw new Error('No saved course to retry');
  if (!saved._brief || !saved._research) {
    throw new Error('This course was generated before the resume feature was added — full retry required.');
  }
  // Figure out which topics are missing.
  const missingTopics = [];
  for (const mod of saved.curriculum.modules) {
    const topicMap = saved.modules?.[mod.number] || {};
    for (const topic of mod.topics) {
      if (!topicMap[topic.id]) missingTopics.push({ moduleId: mod.id, topicId: topic.id });
    }
  }
  if (!missingTopics.length) return null; // nothing to do

  // Create a job to track progress.
  const job = createJob({
    topic: saved.config.title,
    source_text: undefined,
    source_urls: []
  });
  // Pre-fill the job's outline so the dashboard card looks coherent immediately.
  updateJob(job.id, {
    stage: 'topics',
    title: saved.config.title,
    message: `Retrying ${missingTopics.length} topic${missingTopics.length === 1 ? '' : 's'}…`,
    topicsTotal: missingTopics.length,
    topicsDone: 0,
    savedCourseId: courseId,         // so the result merges into THIS course, not a new one
    outline: {
      title: saved.config.title,
      subtitle: saved.config.subtitle,
      modules: saved.curriculum.modules.map(m => ({ title: m.title, topicCount: m.topics.length }))
    }
  });

  // Tell the SW. The done broadcast will save back into the SAME course id
  // because saveUserCourse merges when the id already exists.
  const reg = await ensureSW();
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => {
      if (navigator.serviceWorker.controller) return resolve();
      const t = setTimeout(resolve, 1500);
      navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); resolve(); }, { once: true });
    });
  }
  if (!navigator.serviceWorker.controller) {
    updateJob(job.id, { status: 'failed', error: 'Service worker not available' });
    return job.id;
  }
  const apiKey = localStorage.getItem('gametheory-api-key') || '';
  navigator.serviceWorker.controller.postMessage({
    type: 'gen-resume',
    jobId: job.id,
    apiKey,
    brief: { ...saved._brief, id: saved.config.id },  // ensure ids align
    research: saved._research,
    existingContent: saved.modules || {},
    missingTopics
  });
  return job.id;
}

/**
 * Kick off a generation in the SW. Resolves once the SW has received the
 * start message; the actual work continues in the SW and is observed via
 * the global listener that updates the jobs registry.
 *
 * Throws if the SW isn't available — callers can catch and fall back to
 * the in-page generator.
 */
export async function startGeneration(jobId, userBrief, apiKey) {
  const reg = await ensureSW();
  // We need an active controller to receive postMessages. On very first
  // registration the page may not be controlled yet — give it a beat.
  if (!reg || !navigator.serviceWorker.controller) {
    // Try one short wait for the controller to take over (claim) the page.
    await new Promise((resolve) => {
      if (navigator.serviceWorker.controller) return resolve();
      const t = setTimeout(resolve, 1500);
      navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); resolve(); }, { once: true });
    });
  }
  if (!navigator.serviceWorker.controller) {
    throw new Error('Service worker not active');
  }
  navigator.serviceWorker.controller.postMessage({
    type: 'gen-start',
    jobId, userBrief, apiKey
  });
}

/** Ask the SW whether it remembers the result of a job (used after reload). */
export function querySWForJob(jobId) {
  if (!supported() || !navigator.serviceWorker.controller) return;
  navigator.serviceWorker.controller.postMessage({ type: 'gen-query', jobId });
}
