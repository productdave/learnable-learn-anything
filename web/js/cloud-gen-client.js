// Page-side glue for the cloud generation pipeline. The pipeline runs in a
// Vercel function and writes state to Supabase generation_jobs as it goes;
// this module:
//
//   1. Uploads any PDFs from the userBrief to Supabase Storage so the
//      function can fetch them — direct postMessage to the function would
//      blow the 4.5MB request body limit.
//   2. POSTs /api/gen/start with brief + PDF refs + signed access token.
//   3. Subscribes to the row in `generation_jobs` via Supabase Realtime.
//      Each row update translates into the existing `updateJob` calls so
//      the dashboard / progress modal UI stays identical.
//   4. Exposes cancel / resume / review actions against the API endpoints.

import { updateJob, getJob, ensureJob, removeJob, listCloudJobMirrors } from './jobs.js?v=5';
import { sb, getUser } from './auth.js?v=33';
import { invalidateCourseCache } from './course-loader.js?v=8';
import { courseCanSyncToAccount, coursePayloadForAccount, courseRemoteTimestamp, hasLocalChangesSinceSync, shouldInstallRemoteCourse, syncCoursesNow } from './course-sync.js?v=31';
import { _installCourseFromRemote, _readAllCourses, _removeCourseLocalSilent } from './user-courses.js?v=4';
import { agentMessage } from './generator/agents.mjs?v=2';

const STORAGE_BUCKET = 'course-uploads';
const subs = new Map();   // jobId → Realtime channel handle
const reviewSubmissions = new Set(); // jobId → in-flight human review action
let healthCache = null;
const HEALTH_CACHE_MS = 30_000;
const CLOUD_ACTIVE_STATUSES = ['running', 'cancelling', 'queued'];
const CLOUD_REVIEW_STATUSES = ['review_curriculum', 'review_research'];
const CLOUD_RECOVERABLE_STATUSES = ['partial', 'failed', 'timed_out'];
const CLOUD_REHYDRATE_STATUSES = [...CLOUD_ACTIVE_STATUSES, ...CLOUD_REVIEW_STATUSES, ...CLOUD_RECOVERABLE_STATUSES, 'completed', 'cancelled'];
const CLOUD_SUBSCRIBABLE_STATUSES = [...CLOUD_ACTIVE_STATUSES, ...CLOUD_REVIEW_STATUSES];
const CLOUD_TERMINAL_STATUSES = ['completed', 'partial', 'failed', 'cancelled', 'timed_out'];
const CLOUD_INSTALLABLE_COURSE_STATUSES = ['completed', 'partial'];
const CLOUD_API_KEY_WAITING_STATUSES = ['failed', 'timed_out', 'partial', ...CLOUD_REVIEW_STATUSES];
const CLOUD_PENDING_RESTART_STATUSES = ['failed', 'timed_out', 'partial'];

// --------------------------------------------------------------------
// Public API
// --------------------------------------------------------------------

/** Whether the page can talk to the cloud worker. */
export function cloudGenAvailable() {
  return typeof fetch === 'function' && !!getUser();
}

/** Read the backend health endpoint before creating expensive or durable work. */
export async function checkCloudBackendReady({ force = false } = {}) {
  const now = Date.now();
  if (!force && healthCache && now - healthCache.at < HEALTH_CACHE_MS) return healthCache.result;

  let result;
  try {
    const resp = await fetch('/api/health/cloud', { cache: 'no-store' });
    const data = await resp.json().catch(() => ({}));
    const missing = Array.isArray(data.missing) ? data.missing : [];
    if (resp.ok && data.ok !== false) {
      result = { ok: true, missing: [] };
    } else if (missing.length) {
      result = { ok: false, missing, error: `Cloud backend is missing: ${missing.join(', ')}` };
    } else {
      result = { ok: false, missing: [], error: `Cloud backend health check failed (${resp.status}).` };
    }
  } catch (err) {
    result = { ok: false, missing: [], error: `Cloud backend is unavailable from this URL: ${err.message || err}` };
  }
  healthCache = { at: now, result };
  return result;
}

export async function requireCloudBackendReady(options) {
  const health = await checkCloudBackendReady(options);
  if (!health.ok) throw new Error(health.error || 'Cloud backend is not ready.');
  return health;
}

/** Clear durable missing-key messages after the user saves a usable API key. */
export async function markCloudCredentialsReady(jobId = '') {
  const token = await getAccessToken();
  if (!token) throw new Error('Sign in to refresh cloud credentials.');
  const resp = await fetch('/api/gen/credentials-ready', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify(jobId ? { jobId } : {})
  });
  if (!resp.ok) throw await apiError(resp, 'Cloud credential refresh failed');
  return resp.json().catch(() => ({ ok: true, cleared: [] }));
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
  await requireCloudBackendReady();

  // 1. Upload PDFs to Supabase Storage if there are any. If this is a retry
  // after an ambiguous start response, the local brief may already carry
  // uploaded pdfRefs; reuse them so we do not need to keep large PDF base64 in
  // localStorage.
  const existingPdfRefs = userBrief.pdfRefs || [];
  const uploadedThisCall = !existingPdfRefs.length;
  let pdfRefs = existingPdfRefs;
  try {
    pdfRefs = existingPdfRefs.length
      ? existingPdfRefs
      : await uploadPdfsToStorage(jobId, userBrief.pdfs || []);
  } catch (err) {
    if ((userBrief.pdfs || []).length && !existingPdfRefs.length) {
      updateJob(jobId, {
        needsSourceReattach: true,
        message: 'PDF upload failed before the source files were saved.',
        error: `${err.message || err} Reattach the PDFs to try again.`
      });
    }
    throw err;
  }

  // 2. Build the slim brief — strip the heavy base64 blobs out, keep the
  //    page-thumb data URLs (they go into the saved course later, not into
  //    the API request).
  const slimBrief = slimBriefForCloud(userBrief, pdfRefs);
  updateJob(jobId, { brief: slimBrief });

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
    const err = await apiError(resp, 'Cloud generation start failed');
    if (uploadedThisCall) {
      await removeUploadedPdfRefs(pdfRefs);
      if ((userBrief.pdfs || []).length) {
        updateJob(jobId, {
          brief: { ...slimBrief, pdfRefs: [] },
          needsSourceReattach: true,
          message: 'Cloud start failed before the uploaded source files were saved.',
          error: `${err.message || err} Reattach the PDFs to try again.`
        });
      }
    }
    throw err;
  }
  const data = await resp.json();
  const finalJobId = data.jobId || jobId;
  if (data.existing && uploadedThisCall) {
    const unclaimedRefs = unclaimedPdfRefs(pdfRefs, data.pdfRefs || []);
    await removeUploadedPdfRefs(unclaimedRefs);
    if (unclaimedRefs.length) {
      updateJob(finalJobId, {
        brief: { ...slimBrief, pdfRefs: data.pdfRefs || [] },
        message: 'Existing cloud generation found. Reusing its saved source files.'
      });
    }
  }

  // Tag the local mirror so Cancel / Resume route to the cloud endpoints.
  updateJob(finalJobId, { runner: 'cloud' });

  // 4. Hydrate the accepted row immediately, then keep future updates flowing
  // via Realtime. This matters when the start call reattaches to an existing
  // durable job or Realtime is slow to deliver the first event.
  await reattachCloudGeneration(finalJobId);
  subscribeToJob(finalJobId);
  return finalJobId;
}

/** Capture before awaits/confirmation; never replace consent with a later read. */
export function generationActionSnapshot(job) {
  return { status: job?.status || '', runId: job?.runId || null };
}

/** Cancel a running cloud generation. Updates the local job immediately. */
export async function cancelCloudGeneration(jobId, expected = generationActionSnapshot(getJob(jobId))) {
  const prior = getJob(jobId);
  const token = await getAccessToken();
  if (!token) throw new Error('Sign in to cancel.');
  await requireCloudBackendReady();
  updateJob(jobId, { status: 'cancelling', message: 'Cancelling — waiting for in-flight calls to drain…' });
  const resp = await fetch('/api/gen/cancel', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jobId, expected })
  });
  if (!resp.ok) {
    const err = await apiError(resp, 'Cancel request failed');
    if (await reattachAfterActionConflict(jobId, err, prior)) return;
    restoreJobAfterActionError(jobId, prior, err);
    throw err;
  }
  await reattachCloudGeneration(jobId);
  // Safety net: if no cancelled row update lands within 60s (the function
  // already exited, the row doesn't exist, Realtime dropped), remove only the
  // job mirror. Saved courses are deleted solely through the explicit delete
  // endpoint, where the account row is removed first.
  setTimeout(async () => {
    const j = getJob(jobId);
    if (!j || j.status !== 'cancelling') return;
    removeJobSubscription(jobId);
    removeJob(jobId);
  }, 60_000);
}

/** Delete a cloud generation row so dismissed failed/review jobs stay gone. */
export async function deleteCloudGeneration(jobId, expected = generationActionSnapshot(getJob(jobId))) {
  const token = await getAccessToken();
  if (!token) throw new Error('Sign in to delete.');
  await requireCloudBackendReady();
  const prior = getJob(jobId);
  const resp = await fetch('/api/gen/delete', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jobId, expected })
  });
  if (!resp.ok) {
    const err = await apiError(resp, 'Delete request failed');
    if (isMissingCloudJobError(err)) {
      const deletedCourseId = prior?.savedCourseId && localCourseForCurrentUser(prior.savedCourseId, jobId)
        ? prior.savedCourseId
        : null;
      removeCloudJobMirror(jobId);
      return { ok: true, missing: true, deletedCourseId };
    }
    if (await reattachAfterActionConflict(jobId, err, prior)) err.reattached = true;
    throw err;
  }
  const data = await resp.json().catch(() => ({}));
  removeCloudJobMirror(jobId);
  return data;
}

/** Resume an interrupted / failed cloud generation from its checkpoint. */
export async function resumeCloudGeneration(jobId, expected = generationActionSnapshot(getJob(jobId))) {
  const token = await getAccessToken();
  if (!token) throw new Error('Sign in to resume.');
  await requireCloudBackendReady();
  const prior = getJob(jobId);
  updateJob(jobId, { status: 'running', error: null, message: 'Resuming from saved checkpoint…' });
  const resp = await fetch('/api/gen/resume', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jobId, expected })
  });
  if (!resp.ok) {
    const err = await apiError(resp, 'Resume request failed');
    if (await reattachAfterActionConflict(jobId, err, prior)) return;
    restoreJobAfterActionError(jobId, prior, err);
    throw err;
  }
  await reattachCloudGeneration(jobId);
  subscribeToJob(jobId);
}

/** Restart a recoverable cloud job from the original request, keeping source context. */
export async function restartCloudGeneration(jobId, feedback = '', expected = generationActionSnapshot(getJob(jobId))) {
  const token = await getAccessToken();
  if (!token) throw new Error('Sign in to restart.');
  await requireCloudBackendReady();
  const prior = getJob(jobId);
  updateJob(jobId, {
    status: 'running',
    stage: 'intake',
    error: null,
    message: `${agentMessage('intake', 'Restarting from saved request…')}`,
    topicsDone: 0,
    topicsTotal: 0,
    outline: null,
    review: null
  });
  const resp = await fetch('/api/gen/restart', {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
    body: JSON.stringify({ jobId, feedback, expected })
  });
  if (!resp.ok) {
    const err = await apiError(resp, 'Restart request failed');
    if (isMissingApiKeyError(err)) {
      await reattachCloudGeneration(jobId);
      throw err;
    }
    if (await reattachAfterActionConflict(jobId, err, prior)) return;
    restoreJobAfterActionError(jobId, prior, err);
    throw err;
  }
  await reattachCloudGeneration(jobId);
  subscribeToJob(jobId);
}

/** Restart a recoverable cloud job after the user reattached lost source files. */
export async function restartCloudGenerationWithSources(jobId, userBrief, feedback = '', expected = generationActionSnapshot(getJob(jobId))) {
  const token = await getAccessToken();
  if (!token) throw new Error('Sign in to restart.');
  await requireCloudBackendReady();

  const prior = getJob(jobId);
  const existingPdfRefs = userBrief.pdfRefs || [];
  const uploadedThisCall = !existingPdfRefs.length;
  let pdfRefs = existingPdfRefs;
  try {
    pdfRefs = existingPdfRefs.length
      ? existingPdfRefs
      : await uploadPdfsToStorage(jobId, userBrief.pdfs || []);
  } catch (err) {
    updateJob(jobId, {
      needsSourceReattach: true,
      message: 'PDF upload failed before the source files were saved.',
      error: `${err.message || err} Reattach the PDFs to try again.`
    });
    throw err;
  }

  const slimBrief = slimBriefForCloud(userBrief, pdfRefs);
  updateJob(jobId, {
    runner: 'cloud',
    status: 'running',
    stage: 'intake',
    brief: slimBrief,
    error: null,
    needsSourceReattach: false,
    message: `${agentMessage('intake', 'Restarting from reattached source files…')}`,
    topicsDone: 0,
    topicsTotal: 0,
    outline: null,
    review: null
  });

  let resp;
  try {
    resp = await fetch('/api/gen/restart', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jobId, feedback, brief: slimBrief, expected })
    });
  } catch (err) {
    if (await reattachCloudGeneration(jobId)) return;
    updateJob(jobId, {
      runner: 'cloud',
      brief: slimBrief,
      needsSourceReattach: false,
      error: `${err.message || err} The reattached source files are still saved for retry.`
    });
    throw err;
  }
  if (!resp.ok) {
    const err = await apiError(resp, 'Restart request failed');
    if (isMissingApiKeyError(err)) {
      await reattachCloudGeneration(jobId);
      throw err;
    }
    if (uploadedThisCall) await removeUploadedPdfRefs(pdfRefs);
    if (await reattachAfterActionConflict(jobId, err, prior)) return;
    if (isMissingCloudJobError(err)) {
      restoreJobAfterActionError(jobId, prior, err);
      await startCloudGeneration(jobId, userBrief);
      return;
    }
    restoreJobAfterActionError(jobId, prior, err);
    updateJob(jobId, {
      needsSourceReattach: true,
      error: `${err.message || err} Reattach the PDFs to try again.`
    });
    throw err;
  }
  await reattachCloudGeneration(jobId);
  subscribeToJob(jobId);
}

/** Restart a known cloud row; if the row never existed, start from the saved local brief. */
export async function restartOrStartCloudGeneration(jobId, userBrief, feedback = '', expected = generationActionSnapshot(getJob(jobId))) {
  try {
    await restartCloudGeneration(jobId, feedback, expected);
    return 'restarted';
  } catch (err) {
    if (err.code === 'GENERATION_CHANGED') throw err;
    if (isCloudJobStateConflictError(err)) {
      if (await reattachCloudGeneration(jobId)) return 'reattached';
      throw err;
    }
    if (!isMissingCloudJobError(err)) throw err;
    if (!userBrief) throw err;
    updateJob(jobId, {
      runner: 'cloud',
      status: 'running',
      stage: 'intake',
      error: null,
      message: agentMessage('intake', 'Starting from saved request…'),
      topicsDone: 0,
      topicsTotal: 0,
      outline: null,
      review: null
    });
    await startCloudGeneration(jobId, userBrief);
    return 'started';
  }
}

/** Hydrate a local mirror from an existing owned cloud row. */
export async function reattachCloudGeneration(jobId) {
  const user = getUser();
  if (!user) return false;
  const ownerId = user.id;
  const client = await sb();
  if (!client) return false;
  const { data: row } = await client
    .from('generation_jobs')
    .select('*')
    .eq('id', jobId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (!isCurrentCloudOwner(ownerId)) return false;
  if (!row) return false;
  applyJobRow(row);
  if (CLOUD_SUBSCRIBABLE_STATUSES.includes(row.status)) {
    subscribeToJob(jobId);
  }
  return true;
}

export function isMissingCloudJobError(err) {
  return err?.status === 404 || /\(404\).*Job not found/i.test(err?.message || '');
}

export function isCloudJobStateConflictError(err) {
  return err?.status === 409 || /\(409\): Job is /i.test(err?.message || '');
}

/** Continue a cloud human-review checkpoint. */
export function reviewPendingForAction(action) {
  return ({
    approve_curriculum: {
      action,
      message: 'Starting research from the approved curriculum...',
      status: 'Approved. Researcher is starting now...',
      continueLabel: 'Starting research...'
    },
    revise_curriculum: {
      action,
      message: 'Sending curriculum feedback...',
      status: 'Sending your curriculum feedback to the agent...',
      regenerateLabel: 'Sending feedback...'
    },
    approve_research: {
      action,
      message: 'Starting lesson writing from the approved research...',
      status: 'Approved. Lesson Writer is starting now...',
      continueLabel: 'Starting lesson writing...'
    },
    rerun_research: {
      action,
      message: 'Sending research feedback...',
      status: 'Sending your research feedback to the agent...',
      regenerateLabel: 'Sending feedback...'
    }
  })[action] || {
    action,
    message: 'Sending review feedback...',
    status: 'Sending your feedback to the agent...',
    continueLabel: 'Working...'
  };
}

export async function submitCloudReview(jobId, action, feedback = '', expected = generationActionSnapshot(getJob(jobId))) {
  if (reviewSubmissions.has(jobId)) return;
  reviewSubmissions.add(jobId);
  try {
    const token = await getAccessToken();
    if (!token) throw new Error('Sign in to continue.');
    await requireCloudBackendReady();
    const prior = getJob(jobId);
    const pending = reviewPendingForAction(action);
    updateJob(jobId, { error: null, message: pending.message, reviewPending: pending });
    const resp = await fetch('/api/gen/review', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ jobId, action, feedback, expected })
    });
    if (!resp.ok) {
      const err = await apiError(resp, 'Review request failed');
      if (isMissingApiKeyError(err)) {
        const reattached = await reattachCloudGeneration(jobId);
        if (!reattached) restoreJobAfterActionError(jobId, prior, err);
        throw err;
      }
      if (await reattachAfterActionConflict(jobId, err, prior)) return;
      restoreJobAfterActionError(jobId, prior, err);
      throw err;
    }
    await reattachCloudGeneration(jobId);
    updateJob(jobId, { reviewRecovery: null });
    subscribeToJob(jobId);
  } finally {
    reviewSubmissions.delete(jobId);
  }
}

/**
 * Re-subscribe to all actionable cloud jobs.
 * Called on page boot. Picks up:
 *  - Running / queued jobs after refresh or browser changes.
 *  - Human-review checkpoints no matter how long the user was away.
 *  - Partial / failed / timed-out jobs that can be resumed or deleted.
 *  - Completed jobs whose saved course has not landed locally yet. This gives
 *    a fresh browser a direct path from generation_jobs → user_courses instead
 *    of relying only on the broader course-sync pull.
 */
export async function rehydrateCloudSubscriptions() {
  const user = getUser();
  if (!user) return;
  const ownerId = user.id;
  const client = await sb();
  if (!client) return;
  const { data, error } = await client
    .from('generation_jobs')
    .select('id, owner_id, status, user_brief, brief, outline, message, stage, topics_done, topics_total, failures, saved_course_id, error, started_at, updated_at, heartbeat_at, lease_expires_at, run_id, research, topics_by_key, extracted_urls, review_history, image_progress, design_progress')
    .eq('owner_id', ownerId)
    .in('status', CLOUD_REHYDRATE_STATUSES)
    .order('updated_at', { ascending: false });
  if (!isCurrentCloudOwner(ownerId)) return;
  if (error || !Array.isArray(data)) return;
  const remoteIds = new Set(data.map(row => row.id));
  for (const row of data) {
    // Hydrate the local job from this row (creates if missing), then keep
    // active and review-paused jobs subscribed to future updates/deletes.
    applyJobRow(row);
    if (CLOUD_SUBSCRIBABLE_STATUSES.includes(row.status)) subscribeToJob(row.id);
  }
  pruneMissingCloudJobMirrors(remoteIds);
}

/** Ask the backend to mark any expired cloud jobs as timed_out. */
export async function markStaleCloudJobs() {
  const ownerId = getUser()?.id || null;
  if (!ownerId) return [];
  const token = await getAccessToken();
  if (!token) return [];
  const resp = await fetch('/api/gen/watchdog', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${token}`
    }
  });
  if (!resp.ok) return [];
  const data = await resp.json().catch(() => ({}));
  if (!isCurrentCloudOwner(ownerId)) return [];
  const ids = data.timedOut || [];
  const cancelled = data.cancelled || [];
  markTimedOutJobsFromWatchdog(ids);
  if (ids.length || cancelled.length) await rehydrateCloudSubscriptions();
  for (const id of cancelled) {
    removeJobSubscription(id);
    removeJob(id);
  }
  return ids;
}

export function markTimedOutJobsFromWatchdog(ids = []) {
  for (const id of ids || []) {
    if (!id) continue;
    const prior = getJob(id);
    const pendingRestart = hasSavedRequestRestartIntent(prior) || !!prior?.pendingRestart;
    updateJob(id, {
      runner: 'cloud',
      status: 'timed_out',
      message: pendingRestart
        ? 'Generation timed out while restarting. You can restart from the saved request.'
        : 'Generation timed out. You can resume from the latest checkpoint.',
      error: pendingRestart
        ? 'Cloud restart timed out before the next checkpoint.'
        : 'Cloud generation timed out before the next checkpoint.',
      pendingRestart
    });
  }
  return ids;
}

// --------------------------------------------------------------------
// Realtime subscription
// --------------------------------------------------------------------

function subscribeToJob(jobId) {
  if (subs.has(jobId)) return;
  const token = Symbol(jobId);
  subs.set(jobId, { pending: true, token, unsubscribe() {} });
  (async () => {
    const client = await sb();
    if (!client) {
      if (isSubscriptionCurrent(jobId, token)) subs.delete(jobId);
      return;
    }
    if (!isSubscriptionCurrent(jobId, token)) return;
    // Fetch current row state once so the UI hydrates from cloud rather than
    // waiting for the next update event.
    const user = getUser();
    if (!user) {
      if (isSubscriptionCurrent(jobId, token)) subs.delete(jobId);
      return;
    }
    const ownerId = user.id;
    const { data: row } = await client
      .from('generation_jobs')
      .select('*')
      .eq('id', jobId)
      .eq('owner_id', ownerId)
      .maybeSingle();
    if (!isSubscriptionCurrent(jobId, token)) return;
    if (!isCurrentCloudOwner(ownerId)) {
      if (isSubscriptionCurrent(jobId, token)) subs.delete(jobId);
      return;
    }
    if (row) {
      applyJobRow(row);
    } else if (getJob(jobId)?.cloudSeenAt) {
      removeCloudJobMirror(jobId);
      return;
    }
    if (!isSubscriptionCurrent(jobId, token)) return;

    // A job can finish between the initial read and the realtime handshake.
    // Read again on subscription, with a bounded fallback while work is active.
    // Realtime events win over reads that began before the event arrived.
    let eventVersion = 0, reading = false;
    async function refreshActiveJob() {
      if (reading || !isSubscriptionCurrent(jobId, token) || !isCurrentCloudOwner(ownerId)) return;
      reading = true;
      const beforeEvent = eventVersion;
      try {
        const { data: latest, error } = await client.from('generation_jobs').select('*')
          .eq('id', jobId).eq('owner_id', ownerId).abortSignal(AbortSignal.timeout(10000)).maybeSingle();
        if (error || beforeEvent !== eventVersion || !isSubscriptionCurrent(jobId, token) || !isCurrentCloudOwner(ownerId)) return;
        if (latest) applyJobRow(latest);
        else if (getJob(jobId)?.cloudSeenAt) removeCloudJobMirror(jobId);
      } catch { /* Keep the last saved state; a later read can recover. */ }
      finally { reading = false; }
    }
    const channel = client
      .channel(`gen-${jobId}`)
      .on('postgres_changes', {
        event: 'UPDATE',
        schema: 'public',
        table: 'generation_jobs',
        filter: `id=eq.${jobId}`
      }, (payload) => {
        eventVersion++;
        if (isSubscriptionCurrent(jobId, token) && rowBelongsToCurrentOwner(payload.new, jobId)) applyJobRow(payload.new);
      })
      .on('postgres_changes', {
        event: 'DELETE',
        schema: 'public',
        table: 'generation_jobs',
        filter: `id=eq.${jobId}`
      }, (payload) => {
        eventVersion++;
        if (isSubscriptionCurrent(jobId, token) && rowBelongsToCurrentOwner(payload.old, jobId)) removeCloudJobMirror(payload.old?.id || jobId);
      })
      .subscribe(status => { if (status === 'SUBSCRIBED') void refreshActiveJob(); });
    if (!isSubscriptionCurrent(jobId, token)) {
      try { channel.unsubscribe(); } catch {}
      return;
    }
    const poll = setInterval(() => {
      if (document.visibilityState === 'hidden' || navigator.onLine === false) return;
      if (CLOUD_ACTIVE_STATUSES.includes(getJob(jobId)?.status)) void refreshActiveJob();
    }, 5000);
    subs.set(jobId, { token, unsubscribe: () => { clearInterval(poll); return channel.unsubscribe(); } });
  })().catch(() => {
    if (isSubscriptionCurrent(jobId, token)) subs.delete(jobId);
  });
}

function isSubscriptionCurrent(jobId, token) {
  return subs.get(jobId)?.token === token;
}

function removeJobSubscription(jobId) {
  const ch = subs.get(jobId);
  if (ch) { try { ch.unsubscribe(); } catch {} subs.delete(jobId); }
}

export function clearCloudGenerationSubscriptions() {
  for (const jobId of [...subs.keys()]) removeJobSubscription(jobId);
}

export function removeCloudJobMirror(jobId) {
  if (!jobId) return;
  const prior = getJob(jobId);
  const savedCourseId = prior?.savedCourseId || null;
  const removedCourseIds = new Set();
  removeJobSubscription(jobId);
  removeJob(jobId);
  if (savedCourseId && localCourseForCurrentUser(savedCourseId, jobId)) {
    _removeCourseLocalSilent(savedCourseId);
    invalidateCourseCache(savedCourseId);
    removedCourseIds.add(savedCourseId);
  }
  for (const courseId of localCourseIdsForGenerationJob(jobId)) {
    if (removedCourseIds.has(courseId)) continue;
    _removeCourseLocalSilent(courseId);
    invalidateCourseCache(courseId);
    removedCourseIds.add(courseId);
  }
  if (removedCourseIds.size) {
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('learnable-cloud-pulled'));
    }
    syncCoursesNow().catch(() => {});
  }
}

export function pruneMissingCloudJobMirrors(remoteIds = new Set()) {
  for (const job of listCloudJobMirrors()) {
    if (!job?.id || !job.cloudSeenAt || remoteIds.has(job.id)) continue;
    removeCloudJobMirror(job.id);
  }
}

function applyJobRow(row) {
  if (!row) return;
  if (!rowBelongsToCurrentOwner(row)) return;
  if (row.status === 'cancelled') {
    removeJobSubscription(row.id);
    removeJob(row.id);
    return;
  }
  if (completedCourseAlreadyInstalled(row)) {
    removeJobSubscription(row.id);
    removeJob(row.id);
    return;
  }
  // Reconstruct the local job entry if it doesn't exist (e.g. user signed in
  // on a new device, or localStorage was cleared).
  if (!getJob(row.id)) {
    ensureJob(row.id, row.user_brief || {}, {
      runner: 'cloud',
      startedAt: row.started_at ? Date.parse(row.started_at) || Date.now() : Date.now()
    });
  }
  const patch = jobPatchFromRow(row);
  updateJob(row.id, patch);

  // On terminal states, drop the subscription + invalidate caches + tell
  // course-sync to pull (so the freshly-saved course appears in the library).
  if (CLOUD_TERMINAL_STATUSES.includes(row.status)) {
    if (row.status === 'completed') removeJobSubscription(row.id);
    if (row.saved_course_id && shouldInstallSavedCourseForJobStatus(row.status)) {
      invalidateCourseCache(row.saved_course_id);
      installSavedCloudCourse(row.saved_course_id, row.id, row.run_id || '').finally(() => {
        syncCoursesNow().catch(() => {});
      });
    } else {
      syncCoursesNow().catch(() => {});
    }
  }
}

export function shouldInstallSavedCourseForJobStatus(status) {
  return CLOUD_INSTALLABLE_COURSE_STATUSES.includes(status);
}

function completedCourseAlreadyInstalled(row) {
  if (row?.status !== 'completed' || !row.saved_course_id) return false;
  const local = localCourseForCurrentUser(row.saved_course_id, row.id);
  return savedCourseRunMatchesCompletedRow(local, row);
}

function removeCompletedJobMirrorIfInstalled(jobId, courseId) {
  if (!jobId || !courseId || !isSavedCourseInstalledForCurrentUser(courseId, jobId)) return false;
  const job = getJob(jobId);
  if (job?.status !== 'completed' || job.savedCourseId !== courseId) return false;
  removeJobSubscription(jobId);
  removeJob(jobId);
  return true;
}

export async function pullSavedCloudCourseForJob(jobId, courseId) {
  const ok = await installSavedCloudCourse(courseId, jobId, getJob(jobId)?.runId || '');
  if (ok) {
    updateJob(jobId, { error: null });
  } else {
    updateJob(jobId, {
      error: 'Could not sync the saved course yet. Try again in a moment.'
    });
  }
  syncCoursesNow().catch(() => {});
  return ok;
}

export function jobPatchFromRow(row, previous = getJob(row.id), now = Date.now()) {
  const failures = Array.isArray(row.failures) ? row.failures : [];
  const topicsTotal = row.topics_total || 0;
  const failedCount = failures.length;
  const patch = {
    runner: 'cloud',   // rehydrated rows are cloud jobs by definition
    ownerId: row.owner_id || null,
    cloudSeenAt: now,
    // A fresh browser read is not a fresh worker heartbeat. Keep them separate.
    heartbeatAt: generationTimestamp(row.heartbeat_at),
    leaseExpiresAt: generationTimestamp(row.lease_expires_at),
    serverStatus: row.status,
    activityObservation: generationActivityObservation(row, previous, now),
    status: mapStatus(row.status),
    stage: row.stage || null,
    message: row.message || '',
    brief: row.user_brief || null,
    topicsDone: row.topics_done || 0,
    topicsTotal,
    imageProgress: row.image_progress || null,
    designProgress: row.design_progress || null,
    totalTopics: topicsTotal,
    outline: row.outline || null,
    failures,
    failedCount,
    reviewHistory: Array.isArray(row.review_history) ? row.review_history : [],
    savedCourseId: row.saved_course_id || null,
    runId: row.run_id || null,
    courseInstalled: savedCourseRunMatchesCompletedRow(localCourseForCurrentUser(row.saved_course_id, row.id), row),
    error: row.error || null,
    needsSourceReattach: needsSourceReattachForRow(row),
    needsApiKey: needsApiKeyForRow(row),
    pendingRestart: pendingRestartForRow(row)
  };
  if (row.brief?.title) {
    patch.title = row.brief.title;
  } else if (row.user_brief?.topic && row.user_brief.topic !== '(infer from source material)') {
    patch.title = row.user_brief.topic;
  }
  if (row.status === 'review_curriculum' && row.brief) {
    patch.review = { kind: 'curriculum', brief: row.brief };
  } else if (row.status === 'review_research' && row.brief) {
    patch.review = { kind: 'research', researchResults: researchResultsFromRow(row) };
  } else if (!['review_curriculum', 'review_research'].includes(row.status)) {
    patch.review = null;
  }
  patch.reviewPending = null;
  // Mirror the checkpoint structure so the existing job-card resume path keeps
  // working as a fallback (it reads job.checkpoint.brief, .researchByModule,
  // .topicsByKey).
  patch.checkpoint = {
    brief: row.brief || null,
    researchByModule: row.research || null,
    topicsByKey: row.topics_by_key || null,
    imageProgress: row.image_progress || null,
    designProgress: row.design_progress || null,
    extractedUrls: row.extracted_urls || null
  };
  return patch;
}

function generationTimestamp(value) {
  const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;
  return Number.isFinite(timestamp) && timestamp > 0 ? timestamp : null;
}

// This is a browser observation, not a fabricated server save time. Preserve it
// across ordinary polls/heartbeats, but not account/run changes or connection gaps.
export function generationActivityObservation(row, previous, now) {
  const signature = JSON.stringify([
    !!row.brief,
    Object.keys(row.research || {}).filter(key => row.research[key]).sort(),
    Object.keys(row.topics_by_key || {}).filter(key => row.topics_by_key[key]).sort(),
    !!row.design_progress?.reviewed,
    row.design_progress?.completed || 0,
    Object.entries(row.design_progress?.items || {}).filter(([, item]) => item?.status === 'saved').sort(([a], [b]) => a.localeCompare(b)),
    row.image_progress?.completed || 0,
    Object.entries(row.image_progress?.items || {}).filter(([, item]) => item?.status === 'saved' || item?.status === 'completed').map(([key, item]) => [key, item.operationId]).sort()
  ]);
  const prior = previous?.activityObservation;
  const continuous = previous?.ownerId === row.owner_id && previous?.runId === (row.run_id || null)
    && previous?.stage === row.stage && previous?.serverStatus === row.status
    && previous.cloudSeenAt > now - 90_000 && previous.cloudSeenAt <= now
    && prior?.since > 0 && prior.since <= now;
  if (!continuous) return { signature, since: now, changedAt: null };
  return signature === prior.signature ? prior : { signature, since: now, changedAt: now };
}

export function needsSourceReattachForRow(row) {
  if (row?.status !== 'failed') return false;
  return isBrokenSourceError(row.error);
}

export function isBrokenSourceError(error) {
  return /Could not download PDF|not attached to this generation job/i.test(String(error || ''));
}

export function needsApiKeyForRow(row) {
  if (!CLOUD_API_KEY_WAITING_STATUSES.includes(row?.status)) return false;
  // The design pass uses Anthropic; images and their final save do not. Keep
  // image connection recovery in the existing OpenAI form, never the text-key UI.
  const requiresDesign = row.user_brief?.visual_designer_policy === 'learner-experience-v1' || row.brief?.visual_designer_policy === 'learner-experience-v1';
  const designReady = !requiresDesign || row.design_progress?.status === 'complete';
  if (designReady && (row.stage === 'images' || row.stage === 'assemble' && row.image_progress?.status === 'complete')) return false;
  return isMissingApiKeyError(`${row.error || ''}\n${row.message || ''}`);
}

export function isMissingApiKeyError(message) {
  return /No Anthropic API key|Missing API key|Anthropic API key (?:is )?required|waiting for an Anthropic API key|Add one(?: to your account)?, then (?:resume|continue|restart)/i.test(String(message || ''));
}

export function pendingRestartForRow(row) {
  if (!CLOUD_PENDING_RESTART_STATUSES.includes(row?.status)) return false;
  return hasSavedRequestRestartIntent(row);
}

export function hasSavedRequestRestartIntent(row) {
  return /restart(?:ing)? from (?:the |your )?saved request/i.test(`${row?.error || ''}\n${row?.message || ''}`);
}

function slimBriefForCloud(userBrief, pdfRefs) {
  return {
    ...(Array.isArray(userBrief.components) ? { components: userBrief.components } : {}),
    ...(userBrief.materials_policy ? { materials_policy: userBrief.materials_policy } : {}),
    ...(userBrief.visual_designer_policy ? { visual_designer_policy: userBrief.visual_designer_policy } : {}),
    topic: userBrief.topic,
    goal: userBrief.goal,
    starting_point: userBrief.starting_point,
    depth: userBrief.depth,
    experience: userBrief.experience || 'standard',
    time_budget: userBrief.time_budget,
    tone: userBrief.tone || 'conversational',
    source_text: userBrief.source_text,
    source_urls: userBrief.source_urls || [],
    pdfRefs
  };
}

async function installSavedCloudCourse(courseId, jobId = '', expectedRunId = '') {
  const ownerId = getUser()?.id || null;
  if (!ownerId) return false;
  const token = await getAccessToken();
  if (!token || !courseId) return false;
  const query = new URLSearchParams({ id: courseId });
  if (jobId) query.set('jobId', jobId);
  if (expectedRunId) query.set('runId', expectedRunId);
  const resp = await fetch(`/api/courses/get?${query.toString()}`, {
    headers: { authorization: `Bearer ${token}` }
  });
  if (!resp.ok) return false;
  const row = await resp.json().catch(() => null);
  if (!isCurrentCloudOwner(ownerId)) return false;
  if (!row?.id || !row?.payload) return false;
  if (jobId && !coursePayloadBelongsToJob(row.payload, jobId)) return false;
  if (expectedRunId && String(row.payload?._generationRunId || '') !== String(expectedRunId)) return false;

  const remoteRow = { id: row.id, payload: row.payload, updated_at: row.updatedAt };
  const local = localCourseForCurrentUser(row.id, jobId);
  if (!shouldInstallSavedCloudCourse(local, remoteRow, jobId)) {
    if (local && savedCoursePayloadMatchesRun(local, expectedRunId)) {
      if (jobId) updateJob(jobId, { courseInstalled: true });
      removeCompletedJobMirrorIfInstalled(jobId, row.id);
      return true;
    }
    return false;
  }

  const remoteTs = courseRemoteTimestamp(remoteRow) || Date.now();
  _installCourseFromRemote(row.id, { ...coursePayloadForAccount(row.payload, getUser()), _courseUpdatedAt: row.updatedAt, _syncedAt: remoteTs });
  if (jobId) updateJob(jobId, { courseInstalled: true });
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('learnable-cloud-pulled'));
  }
  removeCompletedJobMirrorIfInstalled(jobId, row.id);
  return true;
}

export function shouldInstallSavedCloudCourse(local, remoteRow, jobId = '') {
  if (!remoteRow) return false;
  if (!local) return true;
  if (local._syncedAt && hasLocalChangesSinceSync(local)) return false;
  if (jobId && remoteRow.payload?._generationJobId === jobId) {
    const remoteRunId = String(remoteRow.payload?._generationRunId || '');
    const localRunId = String(local?._generationRunId || '');
    if (remoteRunId && remoteRunId !== localRunId) return true;
  }
  return shouldInstallRemoteCourse(local, remoteRow);
}

export function savedCourseRunMatchesCompletedRow(local, row) {
  if (!local || row?.status !== 'completed') return false;
  return savedCoursePayloadMatchesRun(local, row?.run_id || '');
}

export function savedCoursePayloadMatchesRun(local, expectedRunId = '') {
  if (!local) return false;
  const rowRunId = String(expectedRunId || '');
  if (!rowRunId) return true;
  return String(local?._generationRunId || '') === rowRunId;
}

export function isSavedCourseInstalledForCurrentUser(courseId, jobId = '') {
  return !!localCourseForCurrentUser(courseId, jobId);
}

function localCourseForCurrentUser(courseId, jobId = '') {
  if (!courseId) return null;
  const local = _readAllCourses()[courseId] || null;
  if (jobId && !coursePayloadBelongsToJob(local, jobId)) return null;
  const user = getUser();
  if (!user) return courseCanSyncToAccount(local, '', '') ? local : null;
  return courseCanSyncToAccount(local, user.email || '', user.id || '') ? local : null;
}

function coursePayloadBelongsToJob(course, jobId) {
  return !!course && !!jobId && course._generationJobId === jobId;
}

function isCurrentCloudOwner(ownerId) {
  return !!ownerId && getUser()?.id === ownerId;
}

function rowBelongsToCurrentOwner(row, fallbackJobId = '') {
  const ownerId = row?.owner_id || '';
  if (ownerId) return isCurrentCloudOwner(ownerId);
  const mirrorOwnerId = fallbackJobId ? getJob(fallbackJobId)?.ownerId || '' : '';
  return !!mirrorOwnerId && isCurrentCloudOwner(mirrorOwnerId);
}

function localCourseIdsForGenerationJob(jobId) {
  if (!jobId) return [];
  const user = getUser();
  return Object.entries(_readAllCourses())
    .filter(([, course]) => course?._generationJobId === jobId)
    .filter(([, course]) => user
      ? courseCanSyncToAccount(course, user.email || '', user.id || '')
      : courseCanSyncToAccount(course, '', ''))
    .map(([courseId]) => courseId);
}

function researchResultsFromRow(row) {
  const modules = row.brief?.modules || [];
  const research = row.research || {};
  return modules.map(mod => ({ mod, bundle: research[mod.id] || null }));
}

function mapStatus(s) {
  // Keep cloud terminal states visible in the local mirror so UI actions match
  // the durable generation_jobs row exactly.
  if (s === 'queued') return 'running';
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
  const uploadToken = uniqueUploadToken();
  const refs = [];
  try {
    for (const p of pdfs) {
      const path = pdfUploadPath({
        ownerId: u.id,
        jobId,
        fileIndex: p.file_index,
        name: p.name,
        uploadToken
      });
      // Decode the base64 we already have client-side back into a Blob to upload.
      const bytes = Uint8Array.from(atob(p.base64), c => c.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'application/pdf' });
      const { error } = await client.storage.from(STORAGE_BUCKET).upload(path, blob, {
        upsert: false,
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
  } catch (err) {
    await removeUploadedPdfRefs(refs, client);
    throw err;
  }
  return refs;
}

export function pdfUploadPath({ ownerId, jobId, fileIndex = 0, name, uploadToken }) {
  const safeName = (name || `pdf-${fileIndex}.pdf`).replace(/[^a-zA-Z0-9._-]/g, '_');
  const token = String(uploadToken || uniqueUploadToken()).replace(/[^a-zA-Z0-9_-]/g, '');
  return `${ownerId}/${jobId}/${fileIndex}-${token}-${safeName}`;
}

function uniqueUploadToken() {
  if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID();
  return `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
}

export async function removeUploadedPdfRefs(refs, client = null) {
  const paths = (refs || [])
    .map(ref => ref?.storage_path)
    .filter(Boolean);
  if (!paths.length) return [];
  try {
    const c = client || await sb();
    if (!c) return [];
    await c.storage.from(STORAGE_BUCKET).remove(paths);
  } catch {
    // Best-effort cleanup. The generation row is still the durable source of truth.
  }
  return paths;
}

export function unclaimedPdfRefs(uploadedRefs = [], existingRefs = []) {
  const existingPaths = new Set((existingRefs || [])
    .map(ref => ref?.storage_path)
    .filter(Boolean));
  return (uploadedRefs || [])
    .filter(ref => ref?.storage_path && !existingPaths.has(ref.storage_path));
}

async function getAccessToken() {
  const client = await sb();
  if (!client) return null;
  const { data } = await client.auth.getSession();
  return data?.session?.access_token || null;
}

function restoreJobAfterActionError(jobId, prior, err) {
  const error = err?.message || String(err);
  const missingApiKey = isMissingApiKeyError(error);
  const patch = {
    error,
    ...(missingApiKey ? { needsApiKey: true } : {})
  };
  if (prior) updateJob(jobId, { ...prior, ...patch });
  else updateJob(jobId, patch);
}

async function reattachAfterActionConflict(jobId, err, prior) {
  if (!isCloudJobStateConflictError(err)) return false;
  if (err.code === 'GENERATION_CHANGED') {
    try { err.reattached = await reattachCloudGeneration(jobId); } catch { /* Preserve the explicit conflict. */ }
    if (err.reattached) {
      err.message = err.message.includes('Nothing was deleted')
        ? 'This course changed. Nothing was deleted. The latest version is now shown. Review it before deleting.'
        : 'This course changed. No action was taken. The latest version is now shown. Review it before trying again.';
      updateJob(jobId, { reviewPending: null, error: err.message });
    }
    else restoreJobAfterActionError(jobId, prior, err);
    throw err; // Never report an unperformed user action as success.
  }
  try { return await reattachCloudGeneration(jobId); }
  catch { return false; }
}

async function apiErrorMessage(resp, fallback, error = null) {
  const txt = await resp.text().catch(() => '');
  let detail = txt;
  try { const data = JSON.parse(txt); detail = data?.error || txt; if (error) error.code = data?.code; } catch {}
  const suffix = detail ? `: ${detail}` : '';
  return `${fallback} (${resp.status})${suffix}`;
}

async function apiError(resp, fallback) {
  const err = new Error();
  err.message = await apiErrorMessage(resp, fallback, err);
  err.status = resp.status;
  return err;
}
