// Generation-job registry. Each "Generate" click creates a job we persist to
// localStorage; the dashboard renders it as a card, the modal reads from it,
// and a page refresh can detect interrupted jobs (in-flight API calls die
// when the tab does — we can't auto-resume them but we can surface a Retry).

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

export function createJob(brief) {
  const id = 'job-' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const job = {
    id,
    brief,
    title: brief.topic && brief.topic !== '(infer from source material)'
      ? brief.topic
      : (brief.source_text ? 'New course from your text' : 'New course'),
    status: 'running',     // running | interrupted | completed | failed
    stage: 'intake',       // intake | research | topics | assemble | done
    message: 'Designing the outline…',
    topicsDone: 0,
    topicsTotal: 0,
    outline: null,         // populated when Stage 1 returns: { title, subtitle, modules: [...] }
    error: null,
    savedCourseId: null,
    startedAt: Date.now(),
    lastUpdatedAt: Date.now()
  };
  const all = readAll(); all[id] = job; writeAll(all); emit();
  return job;
}

export function updateJob(id, patch) {
  const all = readAll();
  if (!all[id]) return null;
  all[id] = { ...all[id], ...patch, lastUpdatedAt: Date.now() };
  writeAll(all); emit();
  return all[id];
}

export function getJob(id) { return readAll()[id] || null; }

/** Jobs visible on the dashboard: anything not completed. Newest first. */
export function listActiveJobs() {
  return Object.values(readAll())
    .filter(j => j.status !== 'completed')
    .sort((a, b) => b.startedAt - a.startedAt);
}

export function removeJob(id) {
  const all = readAll(); delete all[id]; writeAll(all); emit();
}

export function onJobsChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** On boot: any 'running' job whose tab is gone (no heartbeat in 60s) is marked interrupted. */
export function markInterruptedIfStale() {
  const all = readAll();
  const cutoff = Date.now() - STALE_MS;
  let changed = false;
  for (const j of Object.values(all)) {
    if (j.status === 'running' && j.lastUpdatedAt < cutoff) {
      j.status = 'interrupted';
      changed = true;
    }
  }
  if (changed) { writeAll(all); emit(); }
}
