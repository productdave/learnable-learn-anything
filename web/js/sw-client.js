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

import { updateJob, getJob, createJob, removeJob } from './jobs.js';
import { saveUserCourse, getUserCourse, removeUserCourse } from './user-courses.js';
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
    else if (msg.type === 'gen-cancelled') {
      // SW confirmed the cancel landed. Remove the job and clean up any
      // partial saved course. (Cancel = wipe everything created so far.)
      const j = getJob(msg.jobId);
      if (j?.savedCourseId) {
        try { import('./user-courses.js').then(m => m.removeUserCourse(j.savedCourseId)); } catch {}
      }
      removeJob(msg.jobId);
    }
  });
}

/** Read the per-job checkpoint, mutate it, and write back via updateJob. */
function mergeCheckpoint(jobId, patch) {
  const j = getJob(jobId);
  if (!j) return;
  const cp = { ...(j.checkpoint || {}), ...patch };
  updateJob(jobId, { checkpoint: cp });
}
function addCheckpointResearch(jobId, moduleId, bundle) {
  const j = getJob(jobId);
  if (!j) return;
  const cp = j.checkpoint || {};
  cp.researchByModule = { ...(cp.researchByModule || {}), [moduleId]: bundle };
  updateJob(jobId, { checkpoint: cp });
}
function addCheckpointTopic(jobId, moduleId, topicId, content) {
  const j = getJob(jobId);
  if (!j) return;
  const cp = j.checkpoint || {};
  cp.topicsByKey = { ...(cp.topicsByKey || {}), [`${moduleId}/${topicId}`]: content };
  updateJob(jobId, { checkpoint: cp });
}

function applyProgress(msg) {
  const id = msg.jobId;
  if (msg.stage === 'fetching_urls') {
    const total = msg.total || 0;
    const done = msg.done || 0;
    const label = total > 1
      ? `Reading ${done}/${total} source URL${done === 1 && total !== 1 ? '' : 's'}…`
      : 'Reading source URL…';
    updateJob(id, { stage: 'intake', message: label });
  } else if (msg.stage === 'intake') {
    updateJob(id, { stage: 'intake', message: 'Designing the outline…' });
  } else if (msg.stage === 'intake_done') {
    const b = msg.brief;
    // Persist the brief into the job's checkpoint so a future refresh can
    // resume from here without re-running Stage 1.
    mergeCheckpoint(id, { brief: b });
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
  } else if (msg.stage === 'research_module') {
    // Checkpoint successful bundles so resume can skip re-research per module.
    if (msg.status === 'ok' && msg.bundle) addCheckpointResearch(id, msg.moduleId, msg.bundle);
    // Surface a granular research message based on how many modules are done.
    const j = getJob(id);
    if (j) {
      const modulesDone = Object.keys(j.checkpoint?.researchByModule || {}).length;
      const modulesTotal = j.outline?.modules?.length || j.checkpoint?.brief?.modules?.length || 0;
      const moduleTitle = (j.checkpoint?.brief?.modules || []).find(m => m.id === msg.moduleId)?.title;
      const label = msg.status === 'ok'
        ? `Researched ${modulesDone}/${modulesTotal}${moduleTitle ? ` · just finished “${moduleTitle}”` : ''}`
        : `Research warning${moduleTitle ? ` for “${moduleTitle}”` : ''} — continuing without it`;
      updateJob(id, { stage: 'research', message: label });
    }
  } else if (msg.stage === 'topics') {
    updateJob(id, { stage: 'topics', message: 'Writing topic content…', topicsDone: msg.done || 0, topicsTotal: msg.total || 0 });
  } else if (msg.stage === 'topic_done' || msg.stage === 'topic_failed') {
    // Checkpoint successful topics so resume only re-runs the missing ones.
    if (msg.stage === 'topic_done' && msg.content) addCheckpointTopic(id, msg.moduleId, msg.topicId, msg.content);
    // Resolve a human title for the topic so the modal can say what just finished.
    const j = getJob(id);
    let topicTitle = msg.topicId;
    if (j?.checkpoint?.brief?.modules) {
      const mod = j.checkpoint.brief.modules.find(m => m.id === msg.moduleId);
      const t = mod?.topics?.find(t => t.id === msg.topicId);
      if (t?.title) topicTitle = t.title;
    }
    const verb = msg.stage === 'topic_done' ? 'Wrote' : 'Skipped (error)';
    const patch = {
      stage: 'topics',
      topicsDone: msg.done || 0,
      topicsTotal: msg.total || 0,
      message: `${verb} “${topicTitle}” — ${msg.done || 0}/${msg.total || 0} topics done`,
      lastTopicTitle: topicTitle
    };
    // On failure: append a structured entry to job.failures so the modal +
    // dashboard card can surface every error with full detail. Also page-side
    // console so it shows up in DevTools without opening the SW inspector.
    if (msg.stage === 'topic_failed') {
      const prior = (j?.failures || []).slice();
      prior.push({
        moduleId: msg.moduleId,
        topicId: msg.topicId,
        topicTitle,
        error: msg.error || 'unknown',
        kind: msg.errorKind || null,
        attempts: msg.errorAttempts || null,
        at: Date.now()
      });
      patch.failures = prior;
      // eslint-disable-next-line no-console
      console.warn(`[learnable] topic failed: ${topicTitle} (${msg.moduleId}/${msg.topicId}) →`, msg.errorAttempts || msg.error);
    }
    updateJob(id, patch);
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
    // Clear the checkpoint once the course is saved — the persisted course
    // becomes the source of truth, and partial-state retry uses _brief/_research.
    updateJob(id, { status, stage: 'done', message, savedCourseId: savedId, failedCount, totalTopics, checkpoint: null });
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
  // userBrief includes `pdfs: [{ file_index, name, base64, pageThumbs }]` when
  // the user uploaded any. The SW reads `pdfs` directly and prepends document
  // blocks to each stage's API call; pageThumbs ride along so assemble can
  // resolve PDF image refs to data URLs on the final course object.
  // (Surgical retry — gen-resume — does NOT re-send PDFs in v1; rerun topics
  // can still cite web image refs from the saved research bundle. PDF-ref
  // sections in re-tried topics are dropped at assemble time.)
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

/**
 * Cancel an in-flight generation. The SW stops dispatching new topics and
 * broadcasts gen-cancelled when it finishes draining in-flight calls. We
 * also mark the job locally so the dashboard updates immediately, and the
 * gen-cancelled handler does the actual cleanup (remove job + partial course).
 */
export function cancelGeneration(jobId) {
  updateJob(jobId, { status: 'cancelling', message: 'Cancelling — waiting for in-flight calls to drain…' });
  if (supported() && navigator.serviceWorker.controller) {
    navigator.serviceWorker.controller.postMessage({ type: 'gen-cancel', jobId });
  }
  // Safety: if the SW is already dead, no broadcast will land. Schedule a
  // local cleanup after a short grace period.
  setTimeout(() => {
    const j = getJob(jobId);
    if (!j || j.status !== 'cancelling') return;
    if (j.savedCourseId) { try { removeUserCourse(j.savedCourseId); } catch {} }
    removeJob(jobId);
  }, 35_000);
}

/**
 * Resume an interrupted / failed job from its checkpoint. Sends the saved
 * brief + research bundles + topic content to the SW; the SW skips work that
 * already finished and only runs what's missing. Saves the user from paying
 * for stages that already succeeded.
 *
 * Returns true if a resume was dispatched, false if no checkpoint was
 * available (caller can fall back to a full restart).
 */
export async function resumeFromCheckpoint(jobId) {
  const job = getJob(jobId);
  if (!job) return false;
  if (!job.checkpoint || !job.checkpoint.brief) return false;
  await ensureSW();
  if (!navigator.serviceWorker.controller) {
    await new Promise((resolve) => {
      if (navigator.serviceWorker.controller) return resolve();
      const t = setTimeout(resolve, 1500);
      navigator.serviceWorker.addEventListener('controllerchange', () => { clearTimeout(t); resolve(); }, { once: true });
    });
  }
  if (!navigator.serviceWorker.controller) {
    updateJob(jobId, { status: 'failed', error: 'Service worker not available' });
    return false;
  }
  const apiKey = localStorage.getItem('gametheory-api-key') || '';
  // Reset job state to running; preserve checkpoint + outline so UI stays coherent.
  updateJob(jobId, { status: 'running', error: null, message: 'Resuming from checkpoint…', stage: job.checkpoint.topicsByKey ? 'topics' : (job.checkpoint.researchByModule ? 'research' : 'intake') });
  navigator.serviceWorker.controller.postMessage({
    type: 'gen-resume-checkpoint',
    jobId,
    apiKey,
    userBrief: job.brief,
    checkpoint: job.checkpoint
  });
  return true;
}

/** Does this job have enough checkpoint data to skip work on retry? */
export function hasCheckpoint(job) {
  return !!(job?.checkpoint && job.checkpoint.brief);
}
