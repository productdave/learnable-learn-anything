import { createHash } from 'node:crypto';
import { userFromRequest, serviceClient } from '../_lib/supabase-server.mjs';
import { normalizeAccountPayload, setupIdentifier } from '../../js/setup-account-model.js';
import { setupJobId } from '../_lib/setup-generation.mjs';

export const config = { runtime: 'nodejs' };
export function createSetupHandler({ authenticate = userFromRequest, admin = serviceClient } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) return res.status(405).json({ code: 'method', error: 'GET, POST or DELETE only' });
    let client, user;
    try { ({ client, user } = await authenticate(req)); } catch { return res.status(401).json({ code: 'auth', error: 'Sign in again to access your account setup.' }); }
    try {
      if (req.method === 'GET') {
        const id = new URL(req.url, 'http://localhost').searchParams.get('id');
        if (id) {
          setupIdentifier(id);
          const { data, error } = await client.from('course_setups').select('id,revision,payload,content_hash,updated_at').eq('owner_id', user.id).eq('id', id).maybeSingle();
          if (error) throw error;
          if (!data) return res.status(404).json({ code: 'missing', error: 'Account setup not found.' });
          return res.status(200).json(data);
        }
        const { data, error } = await client.from('course_setups').select('id,revision,content_hash,updated_at,brief:payload->brief').eq('owner_id', user.id).order('updated_at', { ascending: false }).limit(100);
        if (error) throw error;
        // Match only the exact account/setup/content-derived job. Do not infer
        // completion from a title, delete the request, or expose source bodies.
        const drafts = data || [];
        if (drafts.length) {
          const ids = drafts.map(row => setupJobId(user.id, row.id, row.content_hash));
          const result = await client.from('generation_jobs').select('id,status').eq('owner_id', user.id).in('id', ids);
          if (result.error) throw result.error;
          const jobs = new Map((result.data || []).map(job => [job.id, job]));
          return res.status(200).json({ drafts: drafts.map((row, index) => ({ ...row, generation: jobs.get(ids[index]) || null })), limit: 100 });
        }
        return res.status(200).json({ drafts, limit: 100 });
      }
      const body = await boundedBody(req);
      const id = setupIdentifier(body?.id), expected = body?.expectedRevision;
      if (!Number.isInteger(expected) || expected < 0 || expected > 2147483646) throw Object.assign(new Error('Invalid setup revision.'), { code: 'invalid' });
      if (req.method === 'DELETE') {
        const { data, error } = await admin().rpc('delete_course_setup', { p_owner:user.id,p_id:id,p_expected:expected });
        if (error) throw error;
        if (data?.error) return res.status(409).json({ code:data.error,error:'This draft changed in another tab. Close this confirmation and review it before deleting.' });
        if (!data?.deleted) throw new Error('Missing deletion acknowledgement');
        return res.status(200).json(data);
      }
      const payload = normalizeAccountPayload(body.payload);
      const hash = createHash('sha256').update(JSON.stringify(payload)).digest('hex');
      const { data, error } = await admin().rpc('commit_course_setup', { p_owner: user.id, p_id: id, p_expected: expected, p_payload: payload, p_hash: hash });
      if (error) throw error;
      if (data?.error) return res.status(409).json({ code: data.error, error: data.error === 'deleted' ? 'This draft was deleted. Start a new course setup to use these details again.' : data.error === 'conflict' ? 'An account version changed. Keep your edits and save a separate setup.' : 'Some originals are not uploaded yet. Keep this page open and retry.' });
      if (!Number.isInteger(data?.revision)) throw new Error('Missing commit acknowledgement');
      return res.status(200).json(data);
    } catch (error) {
      const invalid = error?.code === 'invalid';
      return res.status(invalid ? 400 : 503).json({ code: invalid ? 'invalid' : 'unavailable', error: invalid ? error.message : 'Account setup storage is unavailable. Your device copy is unchanged. Try again later.' });
    }
  };
}
async function boundedBody(req) {
  const max = 1100000;
  let raw;
  if (req.body !== undefined) raw = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  else {
    const chunks = []; let size = 0;
    for await (const part of req) { const chunk = Buffer.from(part); size += chunk.length; if (size > max) throw Object.assign(new Error('Setup text is too large.'), { code: 'invalid' }); chunks.push(chunk); }
    raw = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.byteLength(raw || '') > max) throw Object.assign(new Error('Setup text is too large.'), { code: 'invalid' });
  try { return JSON.parse(raw); } catch { throw Object.assign(new Error('Invalid setup request.'), { code: 'invalid' }); }
}
export default createSetupHandler();
