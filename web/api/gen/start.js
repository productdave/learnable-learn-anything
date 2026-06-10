// POST /api/gen/start
//
// Body: { brief: { topic, source_text, source_urls, depth, tone, pdfRefs }, courseSlug? }
// Header: Authorization: Bearer <supabase access token>
//
// Creates a generation_jobs row, kicks off the pipeline server-side, returns
// { jobId } immediately. The function keeps running until the pipeline
// finishes or maxDuration is hit. Real-time status updates land in the
// generation_jobs row; the client subscribes to those via Realtime.

import { waitUntil } from '@vercel/functions';
import { readJsonBody, userFromRequest, readApiKey } from '../_lib/supabase-server.mjs';
import { runGeneration } from '../_lib/gen-runner.mjs';

export const config = {
  runtime: 'nodejs',
  maxDuration: 300   // Vercel Pro — 5 minutes
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST')    return res.status(405).json({ error: 'POST only' });

  let user, supabase;
  try {
    const auth = await userFromRequest(req);
    user = auth.user; supabase = auth.client;
  } catch (e) {
    return res.status(e.statusCode || 401).json({ error: e.message });
  }

  const body = await readJsonBody(req);
  if (!body?.brief) return res.status(400).json({ error: 'Missing { brief }' });
  const userBrief = body.brief;
  const pdfRefs = userBrief.pdfRefs || [];
  delete userBrief.pdfRefs;  // keep pdfRefs separate from the brief payload

  // Get the user's Anthropic key (stored under user_state by sync.js).
  let apiKey;
  try { apiKey = await readApiKey(supabase, user.id); }
  catch (e) { return res.status(e.statusCode || 400).json({ error: e.message }); }

  // Generate a job + course id. Use a slug derived from the topic; we collision-
  // rename later in the runner if it clashes with a bundled course slug.
  const jobId = body.jobId || `job-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  // Insert the row first so the client can subscribe before work begins.
  const { error: insertErr } = await supabase.from('generation_jobs').insert({
    id: jobId,
    owner_id: user.id,
    user_brief: { ...userBrief, pdfRefs },
    status: 'running',
    stage: 'intake',
    message: 'Starting…'
  });
  if (insertErr) return res.status(500).json({ error: 'Could not create job: ' + insertErr.message });

  // Respond immediately so the client UI can switch to progress mode, then
  // keep the pipeline running via waitUntil — the officially supported way
  // to continue work after the response on Vercel. Without it the runtime
  // may freeze the function the moment the response is sent.
  res.status(200).json({ jobId });

  waitUntil(
    runGeneration({
      supabase,
      jobId,
      ownerId: user.id,
      apiKey,
      userBrief,
      pdfRefs,
      checkpoint: null
    }).catch((err) => {
      // Errors are already persisted on the row by the runner; just log so
      // Vercel captures it.
      console.error(`[/api/gen/start] runner threw for ${jobId}:`, err);
    })
  );
}
