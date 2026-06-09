// POST /api/gen/cancel
// Body: { jobId }
//
// Flips the row's status to 'cancelling'. The runner checks this between
// dispatches and bails. In-flight Anthropic calls finish naturally (≤ ~45s);
// we don't AbortController them to avoid wasting partial completions.

import { readJsonBody, userFromRequest } from '../_lib/supabase-server.mjs';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  let supabase;
  try { ({ client: supabase } = await userFromRequest(req)); }
  catch (e) { return res.status(e.statusCode || 401).json({ error: e.message }); }

  const { jobId } = (await readJsonBody(req)) || {};
  if (!jobId) return res.status(400).json({ error: 'Missing { jobId }' });

  const { error } = await supabase
    .from('generation_jobs')
    .update({
      status: 'cancelling',
      message: 'Cancelling — waiting for in-flight calls to drain…',
      updated_at: new Date().toISOString()
    })
    .eq('id', jobId);

  if (error) return res.status(500).json({ error: error.message });
  return res.status(200).json({ ok: true });
}
