import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

function vaultKey() {
  const value = process.env.LEARNABLE_PROVIDER_VAULT_KEY || '';
  if (!/^[a-f0-9]{64}$/i.test(value)) throw new Error('Secure AI connections are not configured on this server.');
  return Buffer.from(value, 'hex');
}
export function sealProviderKey(key, owner, provider = 'anthropic') {
  const iv = randomBytes(12), cipher = createCipheriv('aes-256-gcm', vaultKey(), iv);
  cipher.setAAD(Buffer.from(`${owner}:${provider}:v1`));
  const data = Buffer.concat([cipher.update(key, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64'), cipher.getAuthTag().toString('base64'), data.toString('base64')].join('.');
}
export function openProviderKey(value, owner, provider = 'anthropic') {
  const [version, iv, tag, data] = String(value).split('.');
  if (version !== 'v1' || !iv || !tag || !data) throw new Error('Invalid encrypted connection.');
  const decipher = createDecipheriv('aes-256-gcm', vaultKey(), Buffer.from(iv, 'base64'));
  decipher.setAAD(Buffer.from(`${owner}:${provider}:v1`)); decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}
export async function readProtectedKey(client, owner, provider = 'anthropic') {
  const { data, error } = await client.from('provider_connections').select('encrypted_key').eq('owner_id', owner).eq('provider', provider).maybeSingle();
  if (error) throw new Error('Secure AI connections are unavailable. Try again later.');
  return data ? openProviderKey(data.encrypted_key, owner, provider) : null;
}
export async function checkAnthropicKey(key, model, fetcher = fetch) {
  let response;
  try { response = await fetcher(`https://api.anthropic.com/v1/models/${encodeURIComponent(model)}`, { headers: { 'x-api-key': key, 'anthropic-version': '2023-06-01' }, redirect: 'error', signal: AbortSignal.timeout(15000) }); }
  catch { throw new Error('Couldn’t reach Claude. Check your connection and try again.'); }
  if (!response.ok) throw new Error(response.status === 401 || response.status === 403 ? 'Claude rejected this API key. Check its access and try again.' : response.status === 404 ? 'This connection cannot access the configured Claude model.' : response.status === 429 ? 'Claude is rate-limiting requests. Wait a moment and retry.' : 'Claude is unavailable. Try again later.');
}
