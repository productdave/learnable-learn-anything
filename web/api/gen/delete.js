// POST /api/gen/delete
// Body: { jobId, expected: { status, runId } }
//
// Deletes an owned generation job. Used when the user dismisses a failed,
// partial, or review-paused job so rehydration on another browser does not
// bring the same card back.

import { readJsonBody, requireSafeJobId, userFromRequest, serviceClient } from '../_lib/supabase-server.mjs';
import { requireGenerationExpectation } from '../_lib/gen-state.mjs';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let supabase, user;
  try {
    ({ user } = await userFromRequest(req));
    supabase = serviceClient();
  }
  catch (e) { return res.status(e.statusCode || 401).json({ error: e.message }); }

  let jobId, expected;
  try {
    const body = await readJsonBody(req); jobId = requireSafeJobId(body?.jobId);
    expected = requireGenerationExpectation(body.expected);
  }
  catch (e) { return res.status(e.statusCode || 400).json({ error: e.message, code: e.code }); }

  const { data, error } = await supabase
    .rpc('delete_generation_job_at_checkpoint', {
      p_job_id: jobId,
      p_owner_id: user.id,
      p_expected_status: expected.status,
      p_expected_run_id: expected.runId
    })
    .maybeSingle();
  if (error) {
    if (String(error.message).includes('GENERATION_CHANGED')) return res.status(409).json({ code: 'GENERATION_CHANGED', error: 'This course changed. Nothing was deleted. Review the latest course state before deleting.' });
    if (error.code === 'PGRST202') return res.status(503).json({ error: 'Safe deletion is not available on this server yet. Your course has not been changed.' });
    const match = String(error.message || '').match(/JOB_NOT_DELETABLE:([a-z_]+)/);
    if (match) return res.status(409).json({ error: `Job is ${match[1]}; cancel active jobs before deleting them.` });
    return res.status(500).json({ error: error.message });
  }
  if (!data) {
    const deletedUploads = await removePdfUploadsForJob(supabase, user.id, jobId);
    return res.status(404).json({ error: 'Job not found', deletedUploads });
  }
  const deletedUploads = await removePdfUploadsForJob(supabase, user.id, jobId);
  return res.status(200).json({
    ok: true,
    deletedCourseId: data.deleted_course_id || null,
    deletedUploads
  });
}

export function pdfUploadPrefixForJob(ownerId, jobId) {
  return `${ownerId}/${jobId}`;
}

export async function removePdfUploadsForJob(supabase, ownerId, jobId) {
  const prefix = pdfUploadPrefixForJob(ownerId, jobId);
  try {
    const bucket = supabase.storage.from('course-uploads');
    const paths = await listStorageFilesRecursive(bucket, prefix);
    if (!paths.length) return [];
    const { error: removeErr } = await bucket.remove(paths);
    if (removeErr) return [];
    return paths;
  } catch {
    return [];
  }
}

export async function listStorageFilesRecursive(bucket, prefix, { limit = 1000 } = {}) {
  const files = [];
  const queue = [prefix];
  const seen = new Set();

  while (queue.length) {
    const folder = queue.shift();
    if (!folder || seen.has(folder)) continue;
    seen.add(folder);

    for (let offset = 0; ; offset += limit) {
      const { data, error } = await bucket.list(folder, { limit, offset });
      if (error || !Array.isArray(data) || !data.length) break;

      for (const item of data) {
        const name = item?.name;
        if (!name || name === '.' || name === '..') continue;
        const path = `${folder}/${name}`;
        if (item.id || item.metadata || item.updated_at || item.created_at || item.last_accessed_at) {
          files.push(path);
        } else {
          queue.push(path);
        }
      }

      if (data.length < limit) break;
    }
  }

  return files;
}
