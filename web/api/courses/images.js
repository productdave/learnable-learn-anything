import { waitUntil } from '@vercel/functions';
import { userFromRequest, serviceClient } from '../_lib/supabase-server.mjs';
import { boundedJson } from '../_lib/bounded-json.mjs';
import { ImageRequestError } from '../_lib/image-request-store.mjs';
import { ImageGenerationError } from '../_lib/image-policy.mjs';
import { acceptCourseImage } from '../_lib/image-acceptance.mjs';
import { createImageExecution } from '../_lib/image-execution.mjs';
import { inspectImageLesson, startImageRequest, getImageRequest, listImageRequests, runImageRequest, reconcileImageRequest,
  cancelImageRequest, discardImageRequest, readImageAsset, cleanupImageCandidate } from '../_lib/image-request.mjs';

export const config = { runtime: 'nodejs', maxDuration: 300 };
export function createCourseImageHandler({ authenticate = userFromRequest, admin = serviceClient,
  enabled = () => process.env.LEARNABLE_GPT_IMAGES === '1' && process.env.LEARNABLE_IMAGE_REQUESTS === '1',
  background = waitUntil, env, generate, now,
  execution = createImageExecution,
  report = code => console.warn('[course-image]', code),
} = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'private, no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    if (!['GET','POST'].includes(req.method)) return res.status(405).json({ code: 'method', error: 'Use GET or POST.' });
    const budget = execution();
    let handedOff = false;
    try {
      let user;
      try { ({ user } = await budget.wait(() => authenticate(req, { fetcher: budget.fetch }), { timeoutMs: budget.foregroundMs() })); if (!user?.id) throw new Error(); }
      catch (error) { if (budget.signal.aborted) throw error; return res.status(401).json({ code: 'auth', error: 'Sign in to the account that owns this image request.' }); }
      const query = new URL(req.url, 'http://localhost').searchParams;
      let body = null;
      if (req.method === 'POST') {
        try { body = await budget.wait(() => boundedJson(req, 24000), { timeoutMs: budget.foregroundMs() }); }
        catch (error) { if (budget.signal.aborted) throw error; throw new ImageRequestError('request', 400); }
      }
      const action = body?.action || query.get('action') || 'get';
      if (req.method === 'GET' && !['get','list','inspect','asset'].includes(action)) throw new ImageRequestError('request', 400);
      if (['start','resume','inspect'].includes(action) && !enabled()) return res.status(503).json({ code: 'disabled', error: 'New image requests are not enabled here yet. Existing saved images are unchanged.' });
      const args = { supabase: admin({ fetcher: budget.fetch }), ownerId: user.id, courseId: body?.courseId || query.get('courseId'),
        operationId: body?.operationId || query.get('operationId') || undefined, env, generate, now, signal: budget.signal, remainingMs: budget.remainingMs };
      let result;
      if (action === 'asset') {
        const image = await budget.wait(() => readImageAsset(args), { timeoutMs: budget.foregroundMs() });
        res.setHeader('Content-Type', 'image/png'); res.setHeader('Content-Length', image.bytes.length);
        return res.status(200).end(image.bytes);
      }
      result = await budget.wait(async () => {
        if (action === 'get') return getImageRequest(args);
        else if (action === 'list') return listImageRequests({ ...args, after: query.get('after') || undefined });
        else if (action === 'inspect') return inspectImageLesson({ ...args, target: { moduleId: query.get('moduleId'), topicId: query.get('topicId') } });
        else if (action === 'start') return startImageRequest({ ...args, expectedRequestId: body.expectedRequestId, target: body.target,
          slot: body.slot, baseHash: body.baseHash, prompt: body.prompt, alt: body.alt, consent: body.consent,
          fundingHash: body.fundingHash, acknowledgePossibleCharge: body.acknowledgePossibleCharge });
        else if (action === 'resume' || action === 'reconcile') return reconcileImageRequest(args);
        else if (action === 'cancel') return cancelImageRequest(args);
        else if (action === 'discard') return discardImageRequest(args);
        else if (action === 'cleanup') return cleanupImageCandidate(args);
        else if (action === 'accept') return acceptCourseImage({ ...args, acceptanceId: body.acceptanceId, alt: body.alt, caption: body.caption, reviewed: body.reviewed });
        else throw new ImageRequestError('request', 400);
      }, { timeoutMs: budget.foregroundMs() });
      if (['start','resume'].includes(action) && result.request?.status === 'queued') {
        handedOff = true;
        background(budget.wait(() => runImageRequest(args)).catch(() => report('request-unconfirmed')).finally(() => budget.close()));
      }
      return res.status(['queued','running','persisting'].includes(result.request?.status) ? 202 : 200).json(result);
    } catch (error) {
      const known = error instanceof ImageRequestError || error instanceof ImageGenerationError;
      return res.status(known ? error.statusCode || 409 : 503).json({ code: known ? error.code : 'unavailable',
        error: known ? error.message : 'The image request could not be confirmed. Check the same attempt before starting another.' });
    } finally { if (!handedOff) budget.close(); }
  };
}
export default createCourseImageHandler();
