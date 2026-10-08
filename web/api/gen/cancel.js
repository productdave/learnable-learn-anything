// POST /api/gen/cancel
// Body: { jobId, expected: { status, runId } }
//
// Signals active rows to cancel. The runner checks this between dispatches and
// writes the terminal cancelled state; paused review jobs become terminal
// immediately because no runner is left to observe a cancelling signal.

import { readJsonBody, requireSafeJobId, userFromRequest, serviceClient } from '../_lib/supabase-server.mjs';
import { removePdfUploadsForJob } from './delete.js';
import {
  ACTIVE_GENERATION_STATUSES,
  CANCELLABLE_GENERATION_STATUSES,
  generationCancelledTerminalFields,
  generationCancelLeaseFields,
  sameRunFilter, requireGenerationExpectation
} from '../_lib/gen-state.mjs';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let supabase, user;
  try {
    ({ user } = await userFromRequest(req));
    supabase = serviceClient();
  }
  catch (e) { return res.status(e.statusCode || 401).json({ error: e.message }); }

  let jobId, body;
  try { body = await readJsonBody(req); jobId = requireSafeJobId(body?.jobId); }
  catch (e) { return res.status(e.statusCode || 400).json({ error: e.message }); }

  const { data: job, error: loadErr } = await supabase
    .from('generation_jobs')
    .select('status,run_id')
    .eq('id', jobId)
    .eq('owner_id', user.id)
    .maybeSingle();
  if (loadErr) return res.status(500).json({ error: loadErr.message });
  if (!job) return res.status(404).json({ error: 'Job not found' });
  try { requireGenerationExpectation(body.expected, job); }
  catch (e) { return res.status(e.statusCode).json({ error: e.message, code: e.code }); }
  if (!CANCELLABLE_GENERATION_STATUSES.includes(job.status)) {
    return res.status(409).json({ error: `Job is ${job.status}; only active or review-paused jobs can be cancelled.` });
  }

  const patch = ACTIVE_GENERATION_STATUSES.includes(job.status)
    ? generationCancelLeaseFields()
    : generationCancelledTerminalFields();

  let query = supabase
    .from('generation_jobs')
    .update(patch)
    .eq('id', jobId)
    .eq('owner_id', user.id)
    .eq('status', job.status);
  query = sameRunFilter(query, job.run_id);
  const { data, error } = await query
    .select('id,status')
    .maybeSingle();

  if (error) return res.status(500).json({ error: error.message });
  if (!data) return res.status(409).json({ code: 'GENERATION_CHANGED', error: 'This course changed. No action was taken. Review the latest course state before trying again.' });
  const deletedUploads = data.status === 'cancelled'
    ? await removePdfUploadsForJob(supabase, user.id, jobId)
    : [];
  return res.status(200).json({ ok: true, status: data.status, deletedUploads });
}
