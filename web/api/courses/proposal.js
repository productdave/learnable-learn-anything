import { waitUntil } from '@vercel/functions';
import { userFromRequest, readApiKey, serviceClient } from '../_lib/supabase-server.mjs';
import { boundedJson } from '../_lib/bounded-json.mjs';
import { requireSafeCourseId } from './get.js';
import { startRefinementRequest, getRefinementRequest, runRefinementRequest, cancelRefinementRequest, discardRefinementRequest } from '../_lib/refinement-request.mjs';

export const config = { runtime: 'nodejs', maxDuration: 180 };
const publicCodes = new Set(['consent', 'request', 'instructions', 'target', 'identity', 'size', 'context_size', 'image_unavailable', 'unsupported', 'provider_configuration', 'validation', 'markup', 'media', 'not_found', 'building', 'busy', 'conflict', 'unavailable']);
// Separate opt-in defaults OFF. Local editor acceptance does not enable a hosted
// release; enable only after that environment's recovery and sync checks pass.
export function createRefinementProposalHandler({
  authenticate = userFromRequest,
  enabled = () => process.env.LEARNABLE_SETUP_GENERATION === '1' && process.env.LEARNABLE_AI_REFINEMENT === '1',
  background = waitUntil,
  getKey = (_client, owner) => readApiKey(serviceClient(), owner),
  generate,
  now,
  report = value => console.warn('[course-proposal]', JSON.stringify(value))
} = {}) {
  return async (req, res) => {
    res.setHeader?.('Cache-Control', 'no-store');
    if (!enabled()) return res.status(503).json({ code: 'disabled', error: 'AI suggestions are not enabled here yet.' });
    if (!['GET', 'POST'].includes(req.method)) return res.status(405).json({ code: 'method', error: 'Use GET or POST.' });
    try {
      const { user, client } = await authenticate(req);
      let body;
      try { body = req.method === 'POST' ? await boundedJson(req, 1100000) : null; }
      catch { return res.status(400).json({ code: 'request', error: 'The proposal request is invalid or too large. Your saved course is unchanged.' }); }
      const courseId = requireSafeCourseId(body?.courseId || new URL(req.url, 'http://localhost').searchParams.get('courseId'));
      const args = { supabase: client, ownerId: user.id, courseId, getKey, generate, now, operationId: body?.operationId };
      const dispatch = () => background(runRefinementRequest(args).catch(error => {
        // Never log feedback, course content, key material or upstream messages.
        report({ operationId: args.operationId, code: publicCodes.has(error.code) ? error.code : 'unavailable' });
      }));
      let result;
      if (!body) result = await getRefinementRequest(args);
      else if (body.action === 'start') {
        result = await startRefinementRequest({ ...args, expectedRequestId: body.expectedRequestId, consent: body.consent, baseHash: body.baseHash, target: body.target, instructions: body.instructions, workingReplacement: body.workingReplacement });
        if (result.request.status === 'queued') dispatch();
      } else if (body.action === 'resume') {
        result = await getRefinementRequest(args);
        if (!result.request || result.request.id !== body.operationId) return res.status(409).json({ code: 'conflict', error: 'Load the current proposal request before continuing.' });
        if (result.request.status === 'queued') dispatch();
      } else if (body.action === 'cancel') result = await cancelRefinementRequest(args);
      else if (body.action === 'discard') result = await discardRefinementRequest(args);
      else return res.status(400).json({ code: 'action', error: 'Choose whether to generate, check or cancel a proposal.' });
      return res.status(['queued', 'running'].includes(result.request?.status) ? 202 : 200).json(result);
    } catch (error) {
      if (error.statusCode === 401) return res.status(401).json({ code: 'auth', error: 'Sign in to your account to continue. Your saved course is unchanged.' });
      const known = publicCodes.has(error.code);
      const status = known ? (error.statusCode || 400) : error.statusCode === 400 ? 400 : 503;
      return res.status(status).json({ code: known ? error.code : status === 400 ? 'request' : 'unavailable', error: known ? error.message : 'The proposal request could not be confirmed. Check the same request before starting another.' });
    }
  };
}
export default createRefinementProposalHandler();
