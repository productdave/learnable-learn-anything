// GET /api/courses/get?id=<courseId>
//
// Returns one saved course row for the signed-in user. The cloud generation
// client uses this as a direct read-after-finish path so a completed background
// job can appear on the dashboard even if Realtime or the broader sync pull is
// delayed.

import { requireSafeJobId, userFromRequest } from '../_lib/supabase-server.mjs';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'GET only' });

  let supabase, user;
  try { ({ client: supabase, user } = await userFromRequest(req)); }
  catch (e) { return res.status(e.statusCode || 401).json({ error: e.message }); }

  const url = new URL(req.url, 'http://localhost');
  const courseId = String(url.searchParams.get('id') || '').trim();
  if (!courseId) return res.status(400).json({ error: 'Missing ?id=<courseId>' });
  try { requireSafeCourseId(courseId); }
  catch (e) { return res.status(e.statusCode || 400).json({ error: e.message }); }
  let jobId = '';
  const jobIdParam = String(url.searchParams.get('jobId') || '').trim();
  if (jobIdParam) {
    try { jobId = requireSafeJobId(jobIdParam); }
    catch (e) { return res.status(e.statusCode || 400).json({ error: e.message }); }
  }
  let runId = '';
  const runIdParam = String(url.searchParams.get('runId') || '').trim();
  if (runIdParam) {
    if (!jobId) return res.status(400).json({ error: 'runId requires jobId.' });
    try { runId = requireSafeRunId(runIdParam); }
    catch (e) { return res.status(e.statusCode || 400).json({ error: e.message }); }
  }

  const { data, error } = await readSavedCourseForUser(supabase, user.id, courseId, jobId, runId);

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(404).json({ error: 'Course not found' });

  return res.status(200).json({
    id: data.id,
    payload: data.payload,
    updatedAt: data.updated_at
  });
}

export async function readSavedCourseForUser(supabase, userId, courseId, jobId = '', runId = '') {
  const result = await supabase
    .from('user_courses')
    .select('id, payload, updated_at')
    .eq('id', courseId)
    .eq('owner_id', userId)
    .maybeSingle();
  if (result.error || !result.data) return result;
  if (!jobId && !runId) return result;
  if (coursePayloadBelongsToJob(result.data.payload, jobId, runId)) return result;
  return { data: null, error: null };
}

export function coursePayloadBelongsToJob(payload, jobId, runId = '') {
  if (!jobId) return false;
  if (jobId && payload?._generationJobId !== jobId) return false;
  if (runId && payload?._generationRunId !== runId) return false;
  return true;
}

export function requireSafeRunId(value) {
  const runId = String(value || '').trim();
  if (!/^[A-Za-z0-9_-]{1,80}$/.test(runId)) {
    const err = new Error('Invalid run id.');
    err.statusCode = 400;
    throw err;
  }
  return runId;
}

export function requireSafeCourseId(value) {
  const courseId = String(value || '').trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,159}$/.test(courseId)) {
    const err = new Error('Invalid course id.');
    err.statusCode = 400;
    throw err;
  }
  return courseId;
}
