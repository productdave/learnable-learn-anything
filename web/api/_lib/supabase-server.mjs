// Server-side Supabase client used by the /api/gen/* functions.
//
// Two flavours of client:
//
// 1. `clientFromRequest(req)` — uses the user's JWT from the Authorization
//    header. API routes use this to prove who is making the request.
//
// 2. `serviceClient()` — uses SUPABASE_SECRET_KEY, falling back to the legacy
//    SUPABASE_SERVICE_ROLE_KEY env var. Bypasses RLS. Cloud generation uses
//    this for the durable state machine because browser clients cannot be
//    allowed to mutate generation_jobs directly. Every privileged write must
//    stay explicitly scoped by owner_id and, for runner writes, the active
//    run_id/status lease.

import { createClient } from '@supabase/supabase-js';
import { readProtectedKey } from './provider-vault.mjs';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SUPABASE_ANON_KEY = process.env.SUPABASE_ANON_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SUPABASE_ADMIN_KEY = process.env.SUPABASE_SECRET_KEY || process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!SUPABASE_URL || !SUPABASE_ANON_KEY) {
  console.warn('[supabase-server] SUPABASE_URL / SUPABASE_ANON_KEY env vars missing');
}

/** Build an RLS-scoped Supabase client from the Authorization header. */
export function clientFromRequest(req, { fetcher } = {}) {
  const auth = req.headers.authorization || req.headers.Authorization || '';
  const jwt = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  if (!jwt) {
    const err = new Error('Missing Authorization: Bearer <jwt>');
    err.statusCode = 401;
    throw err;
  }
  return createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` }, ...(fetcher ? { fetch: fetcher } : {}) },
    auth:   { persistSession: false, autoRefreshToken: false }
  });
}

/** Service-role client. Use sparingly. */
export function serviceClient({ fetcher } = {}) {
  if (!SUPABASE_ADMIN_KEY) {
    const err = new Error('SUPABASE_SECRET_KEY or SUPABASE_SERVICE_ROLE_KEY not set');
    err.statusCode = 500;
    throw err;
  }
  return createClient(SUPABASE_URL, SUPABASE_ADMIN_KEY, {
    ...(fetcher ? { global: { fetch: fetcher } } : {}),
    auth: { persistSession: false, autoRefreshToken: false }
  });
}

/** Resolve the current user from the JWT. */
export async function userFromRequest(req, options) {
  const c = clientFromRequest(req, options);
  const { data, error } = await c.auth.getUser();
  if (error || !data?.user) {
    const e = new Error('Invalid session');
    e.statusCode = 401;
    throw e;
  }
  return { user: data.user, client: c };
}

/** Read the user's stored provider API key from user_state. */
export async function readProviderApiKey(client, userId, provider = 'anthropic') {
  if (process.env.LEARNABLE_PROVIDER_VAULT_KEY && provider === 'anthropic') {
    const protectedKey = await readProtectedKey(client, userId, provider);
    if (protectedKey) return protectedKey;
  }
  const { data, error } = await client
    .from('user_state')
    .select('state')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  const key = data?.state?._apiKeys?.[provider] || (provider === 'anthropic' ? data?.state?._apiKey : '');
  if (!key) {
    const labels = { anthropic: 'Anthropic', openai: 'OpenAI', google: 'Google Gemini' };
    const label = labels[provider] || provider[0].toUpperCase() + provider.slice(1);
    const e = new Error(`No ${label} API key on file. Set it in the account modal first.`);
    e.statusCode = 400;
    throw e;
  }
  return key;
}

/** Backward-compatible Anthropic key reader for the current course runner. */
export function readApiKey(client, userId) {
  return readProviderApiKey(client, userId, 'anthropic');
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

export function requireSafeJobId(value, label = 'jobId') {
  const id = String(value || '').trim();
  if (!id) {
    const err = new Error(`Missing { ${label} }`);
    err.statusCode = 400;
    throw err;
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/.test(id)) {
    const err = new Error(`Invalid ${label}.`);
    err.statusCode = 400;
    throw err;
  }
  return id;
}

export function requirePdfRefsBelongToJob(pdfRefs = [], { ownerId, jobId } = {}) {
  if (!Array.isArray(pdfRefs)) {
    const err = new Error('Invalid pdfRefs.');
    err.statusCode = 400;
    throw err;
  }
  const expectedPrefix = `${ownerId}/${jobId}/`;
  for (const ref of pdfRefs) {
    const path = String(ref?.storage_path || '');
    if (!path || !path.startsWith(expectedPrefix) || path.includes('..')) {
      const err = new Error('PDF source files must belong to this signed-in user and generation job.');
      err.statusCode = 400;
      throw err;
    }
  }
  return pdfRefs;
}
