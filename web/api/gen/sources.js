// Read/check source edits without changing the accepted job or starting AI.
import { userFromRequest, serviceClient, requireSafeJobId } from '../_lib/supabase-server.mjs';
import { boundedJson } from '../_lib/bounded-json.mjs';
import { reviewSourceDraft, inspectReviewSources } from '../_lib/review-sources.mjs';

export const config = { runtime: 'nodejs', maxDuration: 60 };
export function createReviewSourcesHandler({ authenticate = userFromRequest, admin = serviceClient } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
    let user;
    try { ({ user } = await authenticate(req)); } catch { return res.status(401).json({ error: 'Sign in again to adjust your sources.' }); }
    let body;
    try { body = await boundedJson(req, 1100000); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('Invalid body'); }
    catch { return res.status(400).json({ error: 'Invalid or oversized source request.' }); }
    try {
      const id = requireSafeJobId(body.jobId);
      if (!['read', 'check'].includes(body.action)) return res.status(400).json({ error: 'Invalid source action.' });
      const client = admin();
      const { data: job, error } = await client.from('generation_jobs').select('*').eq('id', id).eq('owner_id', user.id).maybeSingle();
      if (error) throw new Error('Read failed');
      if (!job) return res.status(404).json({ error: 'Course creation not found.' });
      if (body.action === 'read') return res.status(200).json(await reviewSourceDraft(job, user.id, client));
      const checked = await inspectReviewSources(job, user.id, client, body);
      return res.status(200).json({ sources: checked.inspection.review, issues: checked.inspection.issues });
    } catch (error) {
      return res.status(error.statusCode || 503).json({ error: error.statusCode ? error.message : 'Couldn’t check your sources. Your current research is unchanged; please retry.' });
    }
  };
}
export default createReviewSourcesHandler();
