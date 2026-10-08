import { sb, getUser } from './auth.js?v=33';
import { SETUP_BUCKET, accountIssue, prepareAccountPayload, normalizeAccountPayload, sha256, sourcePath } from './setup-account-model.js?v=7';

// Supabase owns token verification. Keep only a generic error flag, never an
// access token, raw provider error, email or source body in return markers.
const returnedAuthError = typeof location !== 'undefined' && /(?:^|[?#&])error(?:_code|_description)?=/.test(location.hash + location.search);
export function setupAuthReturnProblem() { return returnedAuthError ? 'That sign-in link could not be verified. It may have expired or already been used. Your device draft has not been deleted; request a new link.' : ''; }
export async function sendSetupSignInLink(email, redirect) {
  const client = await sb();
  if (!client) throw accountIssue('unavailable', 'Sign-in is not configured on this preview. You can keep editing on this device.');
  const { error } = await client.auth.signInWithOtp({ email, options: { emailRedirectTo: redirect } });
  if (error) throw accountIssue(error.status === 429 ? 'rate-limit' : 'auth-send', error.status === 429 ? 'Too many sign-in requests. Wait a little longer before retrying; your email and setup are still here.' : 'Couldn’t send the sign-in link. Check your connection and email address, then try again.');
}

function boundedTransfer(promise) {
  let timer;
  return Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(accountIssue('upload', 'The file transfer could not be confirmed. Keep the original and retry; an accepted file will not be overwritten.')), 30000); })]).finally(() => clearTimeout(timer));
}

export function createSetupAccountClient({ getClient = sb, getIdentity = getUser, fetcher = globalThis.fetch } = {}) {
  const assertOwner = owner => { if (!owner || getIdentity()?.id !== owner) throw accountIssue('auth', 'Your account changed. Sign in to the same account and retry; no new account was selected automatically.'); };
  async function connection(owner) {
    assertOwner(owner); const client = await getClient();
    if (!client) throw accountIssue('unavailable', 'Account saving is not configured in this preview. Your setup stays on this device.');
    const { data, error } = await client.auth.getSession(); assertOwner(owner);
    if (error || data?.session?.user?.id !== owner || !data.session.access_token) throw accountIssue('auth', 'Sign in again before saving to your account.');
    return { client, token: data.session.access_token };
  }
  async function request(owner, path = '', body, method = body ? 'POST' : 'GET') {
    const { token } = await connection(owner);
    let response;
    try { response = await fetcher(`/api/setups/store${path}`, { method, headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) }, body: body ? JSON.stringify(body) : undefined, cache: 'no-store', signal: AbortSignal.timeout(20000) }); }
    catch { assertOwner(owner); throw accountIssue('network', method === 'DELETE' ? 'Couldn’t confirm deletion. Retry to check the same draft; your other courses are unchanged.' : 'Couldn’t confirm the account save. Your device copy is safe. Retry to check the existing version before saving again.'); }
    assertOwner(owner);
    let value; try { value = await response.json(); } catch { throw accountIssue('unavailable', 'Account setup saving is not available on this server yet. Keep your device copy and try again after the backend is enabled.'); }
    assertOwner(owner);
    if (!response.ok) throw accountIssue(value.code || 'unavailable', value.error || 'Account setup request failed.');
    return value;
  }
  async function read(owner, id) { return request(owner, `?id=${encodeURIComponent(id)}`); }
  return {
    list: owner => request(owner), read,
    remove: (owner,id,expectedRevision) => request(owner,'',{id,expectedRevision},'DELETE'),
    async save(owner, id, draft, expectedRevision = 0, progress = () => {}) {
      assertOwner(owner); const { payload, hash } = await prepareAccountPayload(draft); assertOwner(owner);
      let old;
      try { old = await read(owner, id); } catch (error) { if (error.code !== 'missing') throw error; }
      if (old?.content_hash === hash) return { id, revision: old.revision, contentHash: hash, updatedAt: old.updated_at };
      if ((old?.revision || 0) !== expectedRevision) throw accountIssue('conflict', 'Your account has a different version. Save these edits as a separate setup to keep both.');
      const { client } = await connection(owner); const files = [];
      for (const metadata of payload.sources.files) {
        assertOwner(owner); progress([...files, { name: metadata.name, status: 'Uploading…' }]);
        const original = draft.sources.files.find(file => file.id === metadata.id);
        // Some file pickers omit MIME type. Multipart uploads use the Blob's
        // type, so normalize that envelope without changing the original bytes.
        const uploadBlob = original.blob.slice(0, original.blob.size, metadata.type);
        const { error } = await boundedTransfer(client.storage.from(SETUP_BUCKET).upload(sourcePath(owner, id, metadata), uploadBlob, { upsert: false, contentType: metadata.type }));
        assertOwner(owner);
        // An immutable object may already exist after an ambiguous response. The
        // commit checks the exact manifest path and size before acknowledging it.
        if (error && !['409', 'Duplicate'].includes(String(error.statusCode || error.code)) && !/already exists/i.test(error.message || '')) {
          progress([...files, { name: metadata.name, status: 'Upload failed — retry' }]);
          throw accountIssue('upload', `${metadata.name} could not be uploaded. ${files.length} original files transferred so far; the new account setup revision is not saved. Retry keeps successful files.`);
        }
        files.push({ name: metadata.name, status: 'Transferred' }); progress([...files]);
      }
      assertOwner(owner);
      return request(owner, '', { id, expectedRevision, payload });
    },
    async restore(owner, id) {
      const row = await read(owner, id); const payload = normalizeAccountPayload(row.payload);
      const { client } = await connection(owner); const files = [];
      for (const file of payload.sources.files) {
        assertOwner(owner); let blob = null;
        try {
          const { data, error } = await boundedTransfer(client.storage.from(SETUP_BUCKET).download(sourcePath(owner, id, file))); assertOwner(owner);
          if (!error && data?.size === file.size && await sha256(await data.arrayBuffer()) === file.sha256) blob = data;
        } catch (error) { if (error.code === 'auth') throw error; }
        files.push({ ...file, blob });
      }
      assertOwner(owner);
      return { draft: { ...payload, sources: { ...payload.sources, files } }, cloud: { revision: row.revision, contentHash: row.content_hash, updatedAt: row.updated_at }, missing: files.filter(file => !file.blob).length };
    }
  };
}
