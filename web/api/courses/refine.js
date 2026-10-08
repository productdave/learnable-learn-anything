import { userFromRequest } from '../_lib/supabase-server.mjs';
import { boundedJson } from '../_lib/bounded-json.mjs';
import { requireSafeCourseId } from './get.js';
import { courseRefinementFingerprint, proposeCourseRefinement, acceptCourseRefinement } from '../_lib/course-refinement.mjs';

export const config = { runtime: 'nodejs', maxDuration: 60 };
export function createRefinementHandler({ authenticate = userFromRequest, enabled = () => process.env.LEARNABLE_SETUP_GENERATION === '1' } = {}) {
  return async (req, res) => {
    res.setHeader?.('Cache-Control', 'no-store');
    if (!enabled()) return res.status(503).json({ code: 'disabled', error: 'Course editing is not enabled here yet.' });
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ code: 'method', error: 'Use GET or POST.' });
    try {
      const { user, client } = await authenticate(req);
      const body = req.method === 'POST' ? await boundedJson(req, 1080000) : null;
      const courseId = requireSafeCourseId(body?.courseId || new URL(req.url, 'http://localhost').searchParams.get('courseId'));
      if (body?.action === 'accept') {
        const result = await acceptCourseRefinement({ supabase: client, ownerId: user.id, courseId, target: body.target, replacement: body.replacement, baseHash: body.baseHash, operationId: body.operationId });
        return res.status(200).json(result);
      }
      if (body && body.action !== 'preview') return res.status(400).json({ code: 'action', error: 'Preview the change before accepting it.' });
      const { data: row, error } = await client.from('user_courses').select('payload,updated_at').eq('id', courseId).eq('owner_id', user.id).maybeSingle();
      if (error) throw error;
      if (!row || row.payload?.config?.id !== courseId) return res.status(404).json({ code: 'not_found', error: 'This saved course is not available to your account.' });
      let busy = !!row.payload.failedTopics?.length;
      if (row.payload._generationJobId) {
        const result = await client.from('generation_jobs').select('status').eq('owner_id', user.id).eq('id', row.payload._generationJobId).maybeSingle();
        if (result.error) throw result.error;
        busy ||= !!result.data && result.data.status !== 'completed';
      }
      if (busy) return res.status(409).json({ code: 'building', error: 'Finish or recover this build before editing the saved result. Your current course is unchanged.' });
      const baseHash = courseRefinementFingerprint(row.payload);
      if (!body) return res.status(200).json({ courseId, payload: row.payload, baseHash, updatedAt: row.updated_at });
      if (body.baseHash !== baseHash) return res.status(409).json({ code: 'conflict', error: 'The saved course changed. Compare the latest version before replacing anything.' });
      const proposal = proposeCourseRefinement(row.payload, body.target, body.replacement);
      return res.status(200).json({ baseHash, target: proposal.target, changed: proposal.changed, replacement: proposal.replacement, impact: proposal.impact });
    } catch (error) {
      const status = error.statusCode || (/Request is too large|Invalid request/.test(error.message) ? 400 : 503);
      return res.status(status).json({ code: error.code || (status === 400 ? 'request' : 'unavailable'), error: status < 500 ? error.message : 'The save could not be confirmed. Keep your change here and retry to check your account copy.' });
    }
  };
}
export default createRefinementHandler();
