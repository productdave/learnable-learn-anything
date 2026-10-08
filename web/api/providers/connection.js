import { userFromRequest, serviceClient } from '../_lib/supabase-server.mjs';
import { readProtectedKey, sealProviderKey, checkAnthropicKey } from '../_lib/provider-vault.mjs';
import { getAiModelRegistry, assertCloudGenerationModelSupport } from '../_lib/ai-models.mjs';
import { boundedJson } from '../_lib/bounded-json.mjs';

export const config = { runtime: 'nodejs' };
export function createConnectionHandler({ authenticate = userFromRequest, admin = serviceClient, validate = checkAnthropicKey } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!['GET', 'POST', 'DELETE'].includes(req.method)) return res.status(405).json({ error: 'Method not supported.' });
    let user;
    try { ({ user } = await authenticate(req)); } catch { return res.status(401).json({ error: 'Sign in again to manage your AI connection.' }); }
    try {
      const client = admin(), models = getAiModelRegistry(); assertCloudGenerationModelSupport(models);
      if (req.method === 'GET') return res.status(200).json({ connected: !!await readProtectedKey(client, user.id), provider: 'anthropic', model: models.curriculum.model });
      if (req.method === 'DELETE') {
        const { error } = await client.from('provider_connections').delete().eq('owner_id', user.id).eq('provider', 'anthropic');
        if (error) throw new Error('Couldn’t disconnect Claude. Please try again.');
        return res.status(200).json({ connected: false });
      }
      const body = await boundedJson(req);
      const key = typeof body?.key === 'string' ? body.key.trim() : '';
      if (!/^sk-ant-[A-Za-z0-9_-]{20,500}$/.test(key)) return res.status(400).json({ error: 'Enter a complete Anthropic API key.' });
      const encrypted = sealProviderKey(key, user.id); // Fail before sending if vault is not configured.
      await validate(key, models.curriculum.model);
      const { error } = await client.from('provider_connections').upsert({ owner_id: user.id, provider: 'anthropic', encrypted_key: encrypted, updated_at: new Date().toISOString() }, { onConflict: 'owner_id,provider' });
      if (error) throw new Error('Couldn’t save your secure connection. Please retry.');
      return res.status(200).json({ connected: true, provider: 'anthropic', model: models.curriculum.model });
    } catch (error) { return res.status(503).json({ error: error.message?.startsWith('Couldn’t') || /^(Claude|This connection|Secure AI|Enter a|Invalid request|Request is too)/.test(error.message || '') ? error.message : 'Your secure AI connection is unavailable. Try again later.' }); }
  };
}
export default createConnectionHandler();
