import { sb, getUser } from './auth.js?v=33';
import { prepareAccountPayload, sourcePath, sha256, SETUP_BUCKET } from './setup-account-model.js?v=7';

export function createReviewSourceClient({ getClient = sb, getIdentity = getUser, fetcher = fetch } = {}) {
  const guard = owner => { if (!owner || getIdentity()?.id !== owner) throw new Error('Your account changed. Return to the review and sign in again.'); };
  async function connection(owner) {
    guard(owner); const client = await getClient();
    if (!client) throw new Error('Sign in again to adjust sources.');
    const { data } = await client.auth.getSession(); guard(owner);
    if (data?.session?.user?.id !== owner || !data.session.access_token) throw new Error('Sign in again to adjust sources.');
    return { client, token: data.session.access_token };
  }
  async function request(owner, path, body) {
    const { token } = await connection(owner);
    let response;
    try { response = await fetcher(path, { method: 'POST', cache: 'no-store', headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(60000) }); }
    catch { guard(owner); throw new Error('The request couldn’t be confirmed. Your edits are still here. Retry, or return to the latest review to check progress.'); }
    guard(owner); let result;
    try { result = await response.json(); } catch { throw new Error('Source review is temporarily unavailable. Keep your edits and retry.'); }
    if (!response.ok) throw new Error(result.error || 'Couldn’t update sources. Please retry.');
    return result;
  }
  const transfer = async promise => {
    let timer;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The file transfer timed out. Keep the original and retry.')), 30000); })]); }
    finally { clearTimeout(timer); }
  };
  return {
    async read(owner, jobId) {
      const result = await request(owner, '/api/gen/sources', { jobId, action: 'read' });
      const { client } = await connection(owner);
      for (const file of result.draft.sources.files) {
        file.blob = null;
        try {
          const { data, error } = await transfer(client.storage.from(SETUP_BUCKET).download(sourcePath(owner, result.storageId, file))); guard(owner);
          if (!error && data?.size === file.size && await sha256(await data.arrayBuffer()) === file.sha256) file.blob = data;
        } catch { guard(owner); }
      }
      guard(owner); return result;
    },
    async check(owner, jobId, state, draft) {
      const { payload } = await prepareAccountPayload(draft); guard(owner);
      const { client } = await connection(owner);
      for (const file of payload.sources.files) {
        const original = draft.sources.files.find(item => item.id === file.id);
        const { error } = await transfer(client.storage.from(SETUP_BUCKET).upload(sourcePath(owner, state.storageId, file), original.blob.slice(0, original.blob.size, file.type), { upsert: false, contentType: file.type }));
        guard(owner);
        if (error && !['409', 'Duplicate'].includes(String(error.statusCode || error.code)) && !/already exists/i.test(error.message || '')) throw new Error(`${file.name} could not be uploaded. Your accepted sources are unchanged; retry the check.`);
      }
      const changes = { sources: payload.sources, expectedRunId: state.runId };
      const result = await request(owner, '/api/gen/sources', { jobId, action: 'check', ...changes });
      return { ...result, changes: { ...changes, sourceReview: result.sources.digest } };
    },
    apply: (owner, jobId, changes, feedback = '') => request(owner, '/api/gen/review', { jobId, action: 'rerun_research', feedback, sourceChanges: changes, expected: { status: 'review_research', runId: changes.expectedRunId } })
  };
}
