// Generation-job registry. Each "Generate" click creates a local mirror of a
// durable cloud generation_jobs row. The dashboard renders it as a card and
// the modal reads from it; Supabase remains the source of truth for cloud jobs.

import { agentMessage } from './generator/agents.mjs?v=2';

const KEY = 'learnable-gen-jobs';
const listeners = new Set();
const STALE_MS = 60 * 1000; // a 'running' job with no progress in >60s = the tab/refresh killed it

function readAll() {
  try { return JSON.parse(localStorage.getItem(KEY) || '{}'); }
  catch { return {}; }
}
function writeAll(o) {
  try { localStorage.setItem(KEY, JSON.stringify(o)); } catch {}
}
function emit() { listeners.forEach(fn => { try { fn(); } catch {} }); }

function buildJob(id, brief, patch = {}) {
  const localBrief = compactBriefForLocalJob(brief);
  const title = brief.topic && brief.topic !== '(infer from source material)'
    ? brief.topic
    : (brief.source_text ? 'New course from your text' : 'New course');
  return {
    id,
    brief: localBrief,
    title,
    status: 'running',
    stage: 'intake',
    message: agentMessage('intake'),
    topicsDone: 0,
    topicsTotal: 0,
    outline: null,
    error: null,
    savedCourseId: null,
    startedAt: Date.now(),
    lastUpdatedAt: Date.now(),
    ...patch
  };
}

export function createJob(brief) {
  const id = createJobId();
  const job = buildJob(id, brief);
  const all = readAll(); all[id] = job; writeAll(all); emit();
  return job;
}

export function createJobId() {
  if (globalThis.crypto?.randomUUID) return `job-${globalThis.crypto.randomUUID()}`;
  return `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function ensureJob(id, brief, patch = {}) {
  const all = readAll();
  if (!all[id]) {
    all[id] = buildJob(id, brief, patch);
  } else {
    all[id] = { ...all[id], ...patch, lastUpdatedAt: Date.now() };
  }
  writeAll(all); emit();
  return all[id];
}

export function updateJob(id, patch) {
  const all = readAll();
  if (!all[id]) return null;
  if (patch && Object.hasOwn(patch, 'brief')) {
    patch = { ...patch, brief: compactBriefForLocalJob(patch.brief) };
  }
  all[id] = { ...all[id], ...patch, lastUpdatedAt: Date.now() };
  writeAll(all); emit();
  return all[id];
}

export function getJob(id) { return readAll()[id] || null; }

/** Jobs visible on the dashboard: anything actionable. Completed cloud jobs
 * stay visible until their saved course has landed locally, so the dashboard
 * never briefly shows neither progress nor the finished course. */
export function listActiveJobs() {
  return Object.values(readAll())
    .filter(j => j.status !== 'completed' || (j.runner === 'cloud' && j.savedCourseId && !j.courseInstalled))
    .sort((a, b) => b.startedAt - a.startedAt);
}

export function listCloudJobMirrors() {
  return Object.values(readAll())
    .filter(j => j.runner === 'cloud')
    .sort((a, b) => b.startedAt - a.startedAt);
}

export function removeJob(id) {
  const all = readAll(); delete all[id]; writeAll(all); emit();
}

export function removeCloudJobs() {
  const all = readAll();
  let changed = false;
  for (const [id, job] of Object.entries(all)) {
    if (job.runner === 'cloud') {
      delete all[id];
      changed = true;
    }
  }
  if (changed) { writeAll(all); emit(); }
}

export function onJobsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Watchdog — called at boot AND on an interval while the page is open.
 *  - Legacy local 'running' jobs with no heartbeat go 'interrupted'
 *    (Resume/Delete appear).
 *  - Cloud jobs are intentionally skipped here. Supabase generation_jobs is
 *    the source of truth for cloud leases; /api/gen/watchdog marks expired
 *    rows timed_out/cancelled so the UI does not show false failures while a
 *    long cloud step is still alive.
 *  - Legacy local 'cancelling' jobs stuck > 60s flip to 'failed' so the card
 *    regains its Delete button instead of showing "Draining…" forever. */
export function markInterruptedIfStale() {
  const all = readAll();
  const now = Date.now();
  let changed = false;
  for (const j of Object.values(all)) {
    if (j.runner === 'cloud') continue;
    if (j.status === 'running' && j.lastUpdatedAt < now - STALE_MS) {
      j.status = 'interrupted';
      changed = true;
    } else if (j.status === 'cancelling' && j.lastUpdatedAt < now - STALE_MS) {
      j.status = 'failed';
      j.error = 'Cancel timed out — the runner may have already stopped. Safe to delete.';
      changed = true;
    }
  }
  if (changed) { writeAll(all); emit(); }
}

export function compactBriefForLocalJob(brief = {}) {
  if (!brief || typeof brief !== 'object') return brief;
  const compact = { ...brief };
  if (Array.isArray(compact.pdfs)) {
    compact.pdfs = compact.pdfs.map((pdf) => ({
      file_index: pdf.file_index,
      name: pdf.name,
      pageThumbs: pdf.pageThumbs || [],
      sizeBytes: pdf.sizeBytes
    }));
  }
  return compact;
}
