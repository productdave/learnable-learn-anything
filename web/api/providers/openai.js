import { userFromRequest, serviceClient } from '../_lib/supabase-server.mjs';
import { readProtectedKey, sealProviderKey } from '../_lib/provider-vault.mjs';
import { boundedJson } from '../_lib/bounded-json.mjs';
import { checkOpenAIKey } from '../_lib/openai-image.mjs';
import { imagePolicy, requireImageConnectionPolicy, validOpenAIKey, ImageGenerationError } from '../_lib/image-policy.mjs';

export const config = { runtime: 'nodejs' };
export function createOpenAIConnectionHandler({ authenticate = userFromRequest, admin = serviceClient,
  validate = checkOpenAIKey, getPolicy = () => imagePolicy(),
} = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Method not supported.' });
    let user;
    try { ({ user } = await authenticate(req)); if (!user?.id) throw new Error(); }
    catch { return res.status(401).json({ error: 'Sign in again to manage your OpenAI connection.' }); }
    try {
      const client = admin(), policy = getPolicy();
      // Disconnect remains possible if generation is disabled after connection.
      if (req.method === 'DELETE') {
        const { error } = await client.from('provider_connections').delete().eq('owner_id', user.id).eq('provider', 'openai');
        if (error) throw new Error();
        return res.status(200).json({ connected: false, provider: 'openai' });
      }
      requireImageConnectionPolicy(policy);
      const summary = { provider: 'openai', funding: 'creator', model: policy.model, generationChecked: false, generationEnabled: policy.enabled };
      if (req.method === 'GET') return res.status(200).json({ ...summary, connected: !!await readProtectedKey(client, user.id, 'openai') });
      let body;
      try { body = await boundedJson(req, 2048); }
      catch { return res.status(400).json({ error: 'Enter a complete OpenAI API key.' }); }
      if (!body || Array.isArray(body) || Object.keys(body).some(k => k !== 'key')) return res.status(400).json({ error: 'Supply only your OpenAI API key.' });
      const key = typeof body.key === 'string' ? body.key.trim() : '';
      if (!validOpenAIKey(key)) return res.status(400).json({ error: 'Enter a complete OpenAI API key.' });
      const encrypted = sealProviderKey(key, user.id, 'openai'); // Validate vault before network.
      await validate(key, policy.model);
      const { error } = await client.from('provider_connections').upsert({ owner_id: user.id, provider: 'openai',
        encrypted_key: encrypted, updated_at: new Date().toISOString() }, { onConflict: 'owner_id,provider' });
      if (error) throw new Error();
      return res.status(200).json({ ...summary, connected: true });
    } catch (error) {
      if (error instanceof ImageGenerationError) return res.status(['disabled', 'funding', 'configuration'].includes(error.code) ? 409 : 503).json({ code: error.code, error: error.message });
      return res.status(503).json({ error: 'Your secure OpenAI connection is unavailable. Please try again. No image was generated.' });
    }
  };
}
export default createOpenAIConnectionHandler();
