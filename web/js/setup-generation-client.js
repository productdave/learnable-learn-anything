import { sb, getUser } from './auth.js?v=33';

export function createSetupGenerationClient({ getIdentity = getUser, getClient = sb, fetcher = fetch } = {}) {
  async function request(owner, path, method, body) {
    const guard = () => { if (!owner || getIdentity()?.id !== owner) throw new Error('Your account changed. Return to Review before continuing.'); };
    guard();
    const sdk = await getClient();
    if (!sdk) throw new Error('Sign in again before continuing.');
    const { data } = await sdk.auth.getSession();
    guard();
    if (data?.session?.user?.id !== owner || !data.session.access_token) throw new Error('Sign in again before continuing.');
    let response;
    try {
      response = await fetcher(path, { method, cache: 'no-store', headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' }, body: body ? JSON.stringify(body) : undefined, signal: AbortSignal.timeout(45000) });
    } catch { guard(); throw new Error('The request couldn’t be confirmed. Retry to check your saved progress before starting again.'); }
    guard();
    let result;
    try { result = await response.json(); } catch { throw new Error('Course creation is temporarily unavailable. Your setup is unchanged.'); }
    guard();
    if (!response.ok) throw Object.assign(new Error(result.error || 'Couldn’t complete this request. Please retry.'), { code: result.code, readiness: result.sources ? result : null });
    return result;
  }
  return {
    connection: owner => request(owner, '/api/providers/connection', 'GET'),
    // Empty body only clears credential-wait messages. A jobId would authorize
    // resuming paid work in this legacy endpoint, so never supply one here.
    refreshCredentials: owner => request(owner, '/api/gen/credentials-ready', 'POST', {}),
    check: (owner, id, revision) => request(owner, '/api/setups/generate', 'POST', { id, revision, action: 'check' }),
    start: (owner, id, revision, sourceReview) => request(owner, '/api/setups/generate', 'POST', { id, revision, action: 'start', ...(sourceReview ? { sourceReview } : {}) }),
    connect: (owner, key) => request(owner, '/api/providers/connection', 'POST', { key }),
    disconnect: owner => request(owner, '/api/providers/connection', 'DELETE')
  };
}
