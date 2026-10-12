import { userFromRequest } from '../_lib/supabase-server.mjs';
import { readFundedAccess } from '../_lib/funded-access.mjs';

export const config = { runtime: 'nodejs', maxDuration: 30 };
export function createAccountAccessHandler({ authenticate = userFromRequest, read = readFundedAccess } = {}) {
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Vary', 'Authorization');
    if (req.method !== 'GET') return res.status(405).json({ error: 'GET only.' });
    let user, client;
    try { ({ user, client } = await authenticate(req, { fetcher: (url, init) => fetch(url, { ...init, signal: AbortSignal.timeout(10000) }) })); }
    catch { return res.status(401).json({ error: 'Sign in again to view your account.' }); }
    try { return res.status(200).json(await read(client, user.id)); }
    catch { return res.status(503).json({ code: 'account_unavailable', error: 'Account access could not be checked. Try again.' }); }
  };
}
export default createAccountAccessHandler();
