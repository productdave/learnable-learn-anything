import { RUNNER_WRITABLE_STATUSES } from './gen-state.mjs';
import { commitCourseRow } from './course-commit.mjs';
import { GENERATION_IO_UNCERTAIN } from './gen-request-budget.mjs';

function cleanSlugPart(value) {
  return String(value || '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export function courseIdCandidates(baseId, jobId) {
  const base = cleanSlugPart(baseId) || 'generated-course';
  const fingerprint = cleanSlugPart(String(jobId || '').replace(/^job-/, '')) || 'job';
  const tails = [
    fingerprint.slice(-6),
    fingerprint.slice(-10),
    fingerprint.slice(-14),
    fingerprint.slice(0, 18),
    fingerprint
  ].filter(Boolean);
  return [...new Set([base, ...tails.map(tail => `${base}-${tail}`)])];
}

export function courseWithId(course, id) {
  return {
    ...course,
    config: {
      ...(course.config || {}),
      id,
      storageKeyPrefix: id
    }
  };
}

export function courseRowBelongsToJob(payload, jobId, savedCourseId, candidateId) {
  if (payload?._generationJobId === jobId) return true;
  return false;
}

export async function saveGeneratedCourse({ supabase, ownerId, jobId, runId, baseCourseId, course, brief, researchByModule, ownerEmail, tokenUsage = null }) {
  await assertJobStillOwnedByRun(supabase, ownerId, jobId, runId);
  const existingJobCourseId = await savedCourseIdForJob(supabase, ownerId, jobId);
  const candidates = existingJobCourseId
    ? [existingJobCourseId, ...courseIdCandidates(baseCourseId, jobId).filter(id => id !== existingJobCourseId)]
    : courseIdCandidates(baseCourseId, jobId);

  for (const courseId of candidates) {
    const existing = await loadCourseRow(supabase, ownerId, courseId);
    if (existing?.payload && !courseRowBelongsToJob(existing.payload, jobId, existingJobCourseId, courseId)) continue;

    const payload = buildPayload({
      course,
      courseId,
      brief,
      researchByModule,
      ownerEmail,
      ownerId,
      jobId,
      runId,
      tokenUsage,
      priorPayload: existing?.payload
    });

    await assertJobStillOwnedByRun(supabase, ownerId, jobId, runId);
    if (existing) {
      const saved = await commitCourseRow({ supabase, ownerId, courseId, row: existing, payload });
      if (!saved) throw new Error('Cannot update generated course because a newer revision was saved.');
      const savedRevision = saved.payload._courseRevision, savedUpdatedAt = saved.updated_at;
      await recordSavedCourseIdOrRollback({
        supabase,
        ownerId,
        jobId,
        runId,
        courseId,
        priorPayload: existing?.payload || null,
        priorUpdatedAt: existing?.updated_at || null,
        savedRevision, savedUpdatedAt
      });
      return {
        courseId,
        payload: saved.payload, savedRevision, savedUpdatedAt,
        priorPayload: existing?.payload || null,
        priorUpdatedAt: existing?.updated_at || null,
        priorSavedCourseId: existingJobCourseId || null,
        inserted: false
      };
    }

    const saved = await commitCourseRow({ supabase, ownerId, courseId, payload });
    if (saved) {
      const savedRevision = saved.payload._courseRevision, savedUpdatedAt = saved.updated_at;
      await recordSavedCourseIdOrRollback({ supabase, ownerId, jobId, runId, courseId, savedRevision, savedUpdatedAt });
      return {
        courseId,
        payload: saved.payload, savedRevision, savedUpdatedAt,
        priorPayload: null,
        priorUpdatedAt: null,
        priorSavedCourseId: existingJobCourseId || null,
        inserted: true
      };
    }
    // Insert-only commit lost the unique-ID race. Never turn this into an upsert.
    continue;
  }

  throw new Error('Could not claim a course id for this generation job.');
}

export async function rollbackGeneratedCourseSave({ supabase, ownerId, courseId, jobId, runId, priorPayload = null, savedRevision, savedUpdatedAt }) {
  if (!courseId || !jobId || !runId || !savedRevision || !savedUpdatedAt) return false;
  const current = await loadCourseRow(supabase, ownerId, courseId);
  if (!current?.payload) return false;
  if (current.payload._generationJobId !== jobId || current.payload._generationRunId !== runId || current.payload._courseRevision !== savedRevision || current.updated_at !== savedUpdatedAt) {
    return false;
  }

  // Restore content with a NEW revision. Never rewind a token or delete a later
  // accepted edit, even when it belongs to the same generation job and run.
  return !!await commitCourseRow({ supabase, ownerId, courseId, row: current,
    payload: priorPayload, action: priorPayload ? 'save' : 'delete' });
}

// A resumed design/image pass keeps the saved lesson draft instead of assembling
// it again. Reconcile only its run marker before declaring that run complete.
// Use the same revision CAS and guarded pointer/rollback as the initial save.
export async function reconcileGeneratedCourseRun({ supabase, ownerId, jobId, runId, courseId }) {
  await assertJobStillOwnedByRun(supabase, ownerId, jobId, runId);
  if (await savedCourseIdForJob(supabase, ownerId, jobId) !== courseId) throw new Error('Saved course pointer changed.');
  const prior = await loadCourseRow(supabase, ownerId, courseId);
  if (!prior?.payload || prior.payload._generationJobId !== jobId) throw new Error('Saved course belongs to another generation job.');
  if (prior.payload._generationRunId === runId) return false;
  await assertJobStillOwnedByRun(supabase, ownerId, jobId, runId);
  const saved = await commitCourseRow({ supabase, ownerId, courseId, row: prior,
    payload: { ...prior.payload, _generationRunId: runId } });
  if (!saved) throw new Error('Saved course changed while confirming the completed run.');
  await recordSavedCourseIdOrRollback({ supabase, ownerId, jobId, runId, courseId,
    priorPayload: prior.payload, priorUpdatedAt: prior.updated_at,
    savedRevision: saved.payload._courseRevision, savedUpdatedAt: saved.updated_at });
  return true;
}

export async function clearSavedCourseIdForJob({ supabase, ownerId, jobId, runId, courseId }) {
  if (!courseId || !jobId || !runId) return false;
  const { data, error } = await supabase
    .from('generation_jobs')
    .update({ saved_course_id: null, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('owner_id', ownerId)
    .eq('run_id', runId)
    .eq('saved_course_id', courseId)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function assertJobStillOwnedByRun(supabase, ownerId, jobId, runId) {
  if (!runId) throw new Error('Course save requires runId.');
  const { data, error } = await supabase
    .from('generation_jobs')
    .select('status, run_id')
    .eq('id', jobId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('Cannot save generated course because the generation job no longer exists.');
  if (data.run_id !== runId) throw new Error('Cannot save generated course because another runner owns this job.');
  if (!RUNNER_WRITABLE_STATUSES.includes(data.status)) {
    throw new Error(`Cannot save generated course while job is ${data.status}.`);
  }
}

async function savedCourseIdForJob(supabase, ownerId, jobId) {
  const { data, error } = await supabase
    .from('generation_jobs')
    .select('saved_course_id')
    .eq('id', jobId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (error) throw error;
  return data?.saved_course_id || null;
}

async function recordSavedCourseIdForJob(supabase, ownerId, jobId, runId, courseId) {
  const { data, error } = await supabase
    .from('generation_jobs')
    .update({ saved_course_id: courseId, updated_at: new Date().toISOString() })
    .eq('id', jobId)
    .eq('owner_id', ownerId)
    .eq('run_id', runId)
    .in('status', RUNNER_WRITABLE_STATUSES)
    .select('id')
    .maybeSingle();
  if (error) throw error;
  if (!data) {
    throw new Error('Cannot checkpoint saved course because the generation job is no longer active.');
  }
}

async function recordSavedCourseIdOrRollback({ supabase, ownerId, jobId, runId, courseId, priorPayload = null, priorUpdatedAt = null, savedRevision, savedUpdatedAt }) {
  try {
    await recordSavedCourseIdForJob(supabase, ownerId, jobId, runId, courseId);
  } catch (err) {
    // The pointer write may have committed even if its acknowledgement timed
    // out. Keep the confirmed course; a guarded resume reconciles it by job ID.
    if (err?.code === GENERATION_IO_UNCERTAIN) throw err;
    await rollbackGeneratedCourseSave({
      supabase,
      ownerId,
      courseId,
      jobId,
      runId,
      priorPayload,
      priorUpdatedAt, savedRevision, savedUpdatedAt
    });
    throw err;
  }
}

async function loadCourseRow(supabase, ownerId, courseId) {
  const { data, error } = await supabase
    .from('user_courses')
    .select('payload, updated_at')
    .eq('id', courseId)
    .eq('owner_id', ownerId)
    .maybeSingle();
  if (error) throw error;
  return data || null;
}

function buildPayload({ course, courseId, brief, researchByModule, ownerEmail, ownerId, jobId, runId, tokenUsage, priorPayload }) {
  const now = Date.now();
  const savedCourse = courseWithId(course, courseId);
  const savedBrief = { ...(brief || {}), id: courseId };
  return {
    ...savedCourse,
    _brief: savedBrief,
    _research: researchByModule,
    _generationJobId: jobId,
    _generationRunId: runId,
    _tokenUsage: tokenUsage || priorPayload?._tokenUsage || null,
    _sourceCourseId: brief?.id || course?.config?.id || courseId,
    createdAt: priorPayload?.createdAt || now,
    updatedAt: now,
    createdByUserId: priorPayload?.createdByUserId || ownerId || null,
    createdBy: priorPayload?.createdBy || ownerEmail || null
  };
}
