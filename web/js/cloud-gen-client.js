// Page-side glue for the server-side generation pipeline.
//
// Replaces the Service Worker path (web/sw.js + sw-client.js) for new
// generations. The pipeline now runs in a Vercel function (5-minute
// maxDuration) and writes state to Supabase generation_jobs as it goes;
// this module:
//
//   1. Uploads any PDFs from the userBrief to Supabase Storage so the
//      function can fetch them — direct postMessage to the function would
//      blow the 4.5MB request body limit.
//   2. POSTs /api/gen/start with brief + PDF refs + signed access token.
//   3. Subscribes to the row in `generation_jobs` via Supabase Realtime.
//      Each row update translates into the existing `updateJob` calls so
//      the dashboard / progress modal UI stays identical.
//   4. Exposes cancelGeneration(jobId) → POST /api/gen/cancel, and
//      resumeFromCheckpoint(jobId) → POST /api/gen/resume.

import { updateJob, getJob, createJob, removeJob } from './jobs.js';
import { sb, getUser } from './auth.js?v=5';
import { invalidateCourseCache } from './course-loader.js';
import { syncCoursesNow } from './course-sync.js?v=1';
import { agentMessage } from './generator/agents.mjs';

const STORAGE_BUCKET = 'course-uploads';
const subs = new Map();   // jobId → Realtime channel handle

// --------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------

/** Whether the page can talk to the cloud worker. */
export function cloudGenAvailable() {
  return typeof fetch === 'function' && !!getUser();
}

/**
 * Start a generation against the cloud worker. Returns the jobId.
 * Throws if the user isn't signed in, has no API key on file, or the API
 * call fails outright.
 */
export async function startCloudGeneration(jobId, userBrief) {
  const user = getUser();
  if (!user) throw new Error('Sign in first — cloud generation requires an account.');

  const accessToken = await getAccessToken();
  if (!accessToken) throw new Error('No access token available — try signing in again.');

  // 1. Upload PDFs to Supabase Storage if there are any.
  const pdfRefs = await uploadPdfsToStorage(jobId, userBrief.pdfs || []);

  // 2. Build the slim brief — strip the heavy base64 blobs out, keep the
  //    page-thumb data URLs (they go into the saved course later, not into
  //    the API request).
  const slimBrief = {
    topic: userBrief.topic,
    goal: userBrief.goal,
    starting_point: userBrief.starting_point,
    depth: userBrief.depth,
    time_budget: userBrief.time_budget,
    tone: userBrief.tone || 'conversational',
    source_text: userBrief.source_text,
    source_urls: userBrief.source_urls || [],
    pdfRefs
  };

  // 3. POST /api/gen/start. Function inserts the row, returns jobId, then
  //    keeps running the pipeline. Real-time updates land via subscription.
  const resp = await fetch('/api/gen/start', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${accessToken}`
    },
    body: JSON.stringify({ jobId, brief: slimBrief })
  });
  if (!resp.ok) {
    const errText = await resp.text().catch(() => '');
    let detail = errText;
    try { detail = JSON.parse(errText)?.error || errText; } catch {}
    throw new Error(`Cloud generation start failed: ${resp.status} ${detail}`);
  }
  const data = await resp.json();
  const finalJobId = data.jobId || jobId;

  // Tag the job with its runner so Cancel / Resume route to the right place.
  // (Cancelling a cloud job via the SW — or vice versa — silently no-ops and
  // leaves the card stuck in "Draining…".)
  updateJob(finalJobId, { runner: 'cloud' });

  // 4. Subscribe to row updates → fan into jobs registry.
  subscribeToJob(finalJobId);
  return finalJobId;
}

/** Cancel a running cloud generation. Updates the local job immediately. */
export async function cancelCloudGeneration(jobId) {
  updateJob(jobId, { status: 'cancelling', message: 'Cancelling — waiting for in-flight calls to drain…' });
  const token = await getAccessToken();
  if (token) {
    await fetch('/api/gen/cancel', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jobId })
    }).catch(() => {});
  }
  // Safety net: if no cancelled/terminal row update lands within 60s (the
  // function already exited, the row doesn't exist, Realtime dropped), clean
  // up locally so the card doesn't sit in "Draining…" forever.
  setTimeout(async () => {
    const j = getJob(jobId);
    if (!j || j.status !== 'cancelling') return;
    if (j.savedCourseId) {
      try { (await import('./user-courses.js')).removeUserCourse(j.savedCourseId); } catch {}
    }
    removeJob(jobId);
  }, 60_000);
}

/** Resume an interrupted / failed cloud generation from its checkpoint. */
export async function resumeCloudGeneration(jobId) {
  const token = await getAccessToken();
  if (!token) throw new Error('Sign in to resume.');
  updateJob(jobId, { status: 'running', error: null, message: agentMessage('research', 'Resuming…') });
  const resp = await fetch('/api/gen/resume', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jobId })
  });
  if (!resp.ok) throw new Error('Resume request failed');
  subscribeToJob(jobId);
}

/**
 * Re-subscribe to all in-flight cloud jobs + bring in recently-terminal jobs.
 * Called on page boot. Picks up:
 *  - Any running / cancelling / queued jobs (subscribe to live updates).
 *  - Any partial / failed / cancelled jobs from the last 24h that AREN'T
 *    already in localStorage (so they appear on the dashboard rather than
 *    silently being lost).
 *  - Completed jobs aren't re-pulled here — their courses appear via the
 *    course-sync pull instead.
 */
export async function rehydrateCloudSubscriptions() {
  if (!getUser()) return;
  const client = await sb();
  if (!client) return;
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data } = await client
    .from('generation_jobs')
    .select('id, status, user_brief, brief, outline, message, stage, topics_done, topics_total, failures, saved_course_id, error, started_at, updated_at, research, topics_by_key')
    .gte('updated_at', dayAgo)
    .in('status', ['running', 'cancelling', 'queued', 'partial', 'failed', 'cancelled']);
  for (const row of data || []) {
    // Hydrate the local job from this row (creates if missing), then for
    // live ones also subscribe to future updates.
    applyJobRow(row);
    if (['running', 'cancelling', 'queued'].includes(row.status)) {
      subscribeToJob(row.id);
    }
  }
}

// --------------------------------------------------------------------
// Realtime subscription
// --------------------------------------------------------------------

function subscribeToJob(jobId) {
  if (subs.has(jobId)) return;
  (async () => {
    const client = await sb();
    if (!client) return;
    // Fetch current row state once so the UI hydrates from cloud rather than
    // waiting for the next update event.
    const { data: row } = await client.from('generation_jobs').select('*').eq('id', jobId).maybeSingle();
    if (row) applyJobRow(row);

    const channel = client
      .channel(`gen-${jobId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'generation_jobs',
        filter: `id=eq.${jobId}`
      }, (payload) => applyJobRow(payload.new))
      .subscribe();
    subs.set(jobId, channel);
  })();
}

function applyJobRow(row) {
  if (!row) return;
  // Reconstruct the local job entry if it doesn't exist (e.g. user signed in
  // on a new device, or localStorage was cleared). updateJob() bails when
  // the id isn't already in the registry, so without this, rehydration on a
  // fresh device would silently drop everything.
  if (!getJob(row.id)) {
    const userBrief = row.user_brief || {};
    createJob({
      ...userBrief,
      // createJob assigns its own id; we need this one. Patch below overrides.
    });
    // createJob auto-generates an id. Replace its row with our row id by
    // direct localStorage write — small but cleanest path.
    try {
      const KEY = 'learnable-gen-jobs';
      const all = JSON.parse(localStorage.getItem(KEY) || '{}');
      // Find the just-created job (newest by startedAt) and re-key it.
      const newest = Object.entries(all).sort((a, b) => b[1].startedAt - a[1].startedAt)[0];
      if (newest && newest[0] !== row.id) {
        const job = newest[1];
        delete all[newest[0]];
        all[row.id] = { ...job, id: row.id };
        localStorage.setItem(KEY, JSON.stringify(all));
      }
    } catch {}
  }
  const patch = {
    runner: 'cloud',   // rehydrated rows are cloud jobs by definition
    status: mapStatus(row.status),
    stage: row.stage,
    message: row.message || '',
    topicsDone: row.topics_done || 0,
    topicsTotal: row.topics_total || 0
  };
  if (row.brief?.title) patch.title = row.brief.title;
  if (row.outline) patch.outline = row.outline;
  if (row.failures?.length) patch.failures = row.failures;
  if (row.saved_course_id) patch.savedCourseId = row.saved_course_id;
  if (row.error) patch.error = row.error;
  // Mirror the checkpoint structure so the existing job-card resume path keeps
  // working as a fallback (it reads job.checkpoint.brief, .researchByModule,
  // .topicsByKey).
  patch.checkpoint = {
    brief: row.brief || null,
    researchByModule: row.research || null,
    topicsByKey: row.topics_by_key || null
  };
  updateJob(row.id, patch);

  // On terminal states, drop the subscription + invalidate caches + tell
  // course-sync to pull (so the freshly-saved course appears in the library).
  if (['completed', 'partial', 'failed', 'cancelled'].includes(row.status)) {
    const ch = subs.get(row.id);
    if (ch) { try { ch.unsubscribe(); } catch {} subs.delete(row.id); }
    if (row.saved_course_id) {
      invalidateCourseCache(row.saved_course_id);
      syncCoursesNow().catch(() => {});
    }
  }
}

function mapStatus(s) {
  // generation_jobs.status uses: queued | running | cancelling | completed | partial | failed | cancelled
  // jobs registry uses:          running | cancelling | completed | partial | failed | interrupted
  if (s === 'queued') return 'running';
  if (s === 'cancelled') return 'failed';
  return s;
}

// --------------------------------------------------------------------
// PDF upload helpers
// --------------------------------------------------------------------

async function uploadPdfsToStorage(jobId, pdfs) {
  if (!pdfs?.length) return [];
  const client = await sb();
  if (!client) throw new Error('Supabase unavailable');
  const u = getUser();
  const refs = [];
  for (const p of pdfs) {
    const safeName = (p.name || `pdf-${p.file_index}.pdf`).replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${u.id}/${jobId}/${p.file_index}-${safeName}`;
    // Decode the base64 we already have client-side back into a Blob to upload.
    const bytes = Uint8Array.from(atob(p.base64), c => c.charCodeAt(0));
    const blob = new Blob([bytes], { type: 'application/pdf' });
    const { error } = await client.storage.from(STORAGE_BUCKET).upload(path, blob, {
      upsert: true,
      contentType: 'application/pdf'
    });
    if (error) throw new Error(`Could not upload "${p.name}": ${error.message}`);
    refs.push({
      file_index: p.file_index,
      name: p.name,
      storage_path: path,
      pageThumbs: p.pageThumbs || []
    });
  }
  return refs;
}

async function getAccessToken() {
  const client = await sb();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data?.session?.access_token || null;
}
