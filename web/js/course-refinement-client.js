import { sb, getUser } from './auth.js?v=33';

export function createCourseRefinementClient({ getIdentity = getUser, getClient = sb, fetcher = fetch } = {}) {
  async function request(owner, method, body, endpoint = 'refine') {
    const guard = () => { if (!owner || getIdentity()?.id !== owner) throw Object.assign(new Error('Your account changed. Reopen the course from the correct account.'), { code: 'account' }); };
    guard();
    const client = await getClient(), { data } = await client?.auth.getSession() || {};
    guard();
    if (data?.session?.user?.id !== owner || !data.session.access_token) throw Object.assign(new Error('Sign in again to edit your course.'), { code: 'account' });
    const url = `/api/courses/${endpoint}` + (method === 'GET' ? `?courseId=${encodeURIComponent(body.courseId)}` : '');
    let response;
    try { response = await fetcher(url, { method, cache: 'no-store', headers: { Authorization: `Bearer ${data.session.access_token}`, 'Content-Type': 'application/json' }, ...(method === 'POST' ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30000) }); }
    catch { guard(); throw Object.assign(new Error(endpoint === 'proposal' ? 'The AI request could not be confirmed. Check the same request before starting another; charges may still apply.' : 'The request could not be confirmed. Your change is still here. Retry to check the same save.'), { code: 'unavailable' }); }
    guard();
    const result = await response.json().catch(() => null);
    guard();
    if (!response.ok || !result) throw Object.assign(new Error(result?.error || 'The request could not be confirmed. Keep your change and retry.'), { code: result?.code || 'unavailable' });
    return result;
  }
  return {
    load: (owner, courseId) => request(owner, 'GET', { courseId }),
    preview: (owner, data) => request(owner, 'POST', { ...data, action: 'preview' }),
    accept: (owner, data) => request(owner, 'POST', { ...data, action: 'accept' }),
    proposalStatus: (owner, courseId) => request(owner, 'GET', { courseId }, 'proposal'),
    startProposal: (owner, data) => request(owner, 'POST', { ...data, action: 'start' }, 'proposal'),
    resumeProposal: (owner, data) => request(owner, 'POST', { ...data, action: 'resume' }, 'proposal'),
    cancelProposal: (owner, data) => request(owner, 'POST', { ...data, action: 'cancel' }, 'proposal'),
    discardProposal: (owner, data) => request(owner, 'POST', { ...data, action: 'discard' }, 'proposal')
  };
}
