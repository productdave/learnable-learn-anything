// POST /api/gen/resume
// Body: { jobId }
//
// Reads the existing generation_jobs row, picks up the pipeline from the last
// checkpoint (brief, research per module, topics_by_key). Skips work that
// already finished — no re-billing.

import { readJsonBody, userFromRequest, readApiKey } from '../_lib/supabase-server.mjs';
import { runGeneration } from '../_lib/gen-runner.mjs';

export const config = {
  runtime: 'nodejs',
  maxDuration: 300
};

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let user, supabase;
  try {
    const auth = await userFromRequest(req);
    user = auth.user; supabase = auth.client;
  } catch (e) {
    return res.status(e.statusCode || 401).json({ error: e.message });
  }

  const { jobId } = (await readJsonBody(req)) || {};
  if (!jobId) return res.status(400).json({ error: 'Missing { jobId }' });

  const { data: job, error } = await supabase
    .from('generation_jobs')
    .select('*')
    .eq('id', jobId)
    .maybeSingle();
  if (error || !job) return res.status(404).json({ error: 'Job not found' });

  let apiKey;
  try { apiKey = await readApiKey(supabase, user.id); }
  catch (e) { return res.status(e.statusCode || 400).json({ error: e.message }); }

  await supabase.from('generation_jobs').update({
    status: 'running',
    error: null,
    message: 'Resuming from checkpoint…',
    updated_at: new Date().toISOString()
  }).eq('id', jobId);

  res.status(200).json({ jobId, resumed: true });

  try {
    await runGeneration({
      supabase,
      jobId,
      ownerId: user.id,
      apiKey,
      userBrief: job.user_brief,
      pdfRefs: job.user_brief?.pdfRefs || [],
      checkpoint: {
        brief: job.brief || null,
        research: job.research || {},
        topics_by_key: job.topics_by_key || {},
        failures: job.failures || []
      }
    });
  } catch (err) {
    console.error(`[/api/gen/resume] runner threw for ${jobId}:`, err);
  }
}
