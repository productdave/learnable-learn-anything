// Server-side Supabase client used by the /api/gen/* functions.
//
// Two flavours of client:
//
// 1. `clientFromRequest(req)` — uses the user's JWT from the Authorization
//    header. Reads/writes are scoped to that user by RLS. This is what the
//    function should use for all data operations (creating jobs, updating
//    jobs, reading the user's Anthropic key from user_state, writing the
//    final course to user_courses).
//
// 2. `serviceClient()` — uses the SUPABASE_SERVICE_ROLE_KEY env var. Bypasses
//    RLS. Reserved for cases where the function needs to do something the
//    user themselves couldn't do (e.g. operating on someone else's row).
//    Avoid unless necessary.

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('[supabase-server] SUPABASE_URL / SUPABASE_ANON_KEY env vars missing');
}

/** Build an RLS-scoped Supabase client from the Authorization header. */
export function clientFromRequest(req) {
  const auth = req.headers.authorization || req.headers.Authorization || '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!jwt) {
    const err = new Error('Missing Authorization: Bearer <jwt>');
    err.statusCode = 401;
    throw err;
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
    auth:   { persistSession: false, autoRefreshToken: false }
  });
}

/** Service-role client. Use sparingly. */
export function serviceClient() {
  if (!SUPABASE_SERVICE_ROLE_KEY) {
    const err = new Error('SUPABASE_SERVICE_ROLE_KEY not set');
    err.statusCode = 500;
    throw err;
  }
  return createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

/** Resolve the current user from the JWT. */
export async function userFromRequest(req) {
  const c = clientFromRequest(req);
  const { data, error } = await c.auth.getUser();
  if (error || !data?.user) {
    const e = new Error('Invalid session');
    e.statusCode = 401;
    throw e;
  }
  return { user: data.user, client: c };
}

/** Read the user's stored Anthropic API key from user_state. */
export async function readApiKey(client, userId) {
  const { data, error } = await client
    .from('user_state')
    .select('state')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  const key = data?.state?._apiKey;
  if (!key) {
    const e = new Error('No Anthropic API key on file. Set it in the account modal first.');
    e.statusCode = 400;
    throw e;
  }
  return key;
}

/** Sign an existing storage object so the Anthropic call can fetch it. */
export async function signedPdfUrl(client, path, ttlSeconds = 60 * 30) {
  const { data, error } = await client.storage.from('course-uploads').createSignedUrl(path, ttlSeconds);
  if (error) throw error;
  return data.signedUrl;
}

/** Read a JSON helper for request bodies. */
export async function readJsonBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return null; }
  }
  const chunks = [];
  for await (const chunk of req) chunks.push(chunk);
  if (!chunks.length) return null;
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { return null; }
}
