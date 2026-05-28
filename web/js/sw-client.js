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

import { updateJob, getJob } from './jobs.js';
import { saveUserCourse } from './user-courses.js';

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
    if (j?.status === 'completed' && j.savedCourseId) return; // already handled
    const savedId = saveUserCourse(msg.course);
    updateJob(id, { status: 'completed', stage: 'done', message: 'Done!', savedCourseId: savedId });
  }
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
