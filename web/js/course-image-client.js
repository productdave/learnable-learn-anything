import { sb, getUser } from './auth.js?v=33';

export function createCourseImageClient({ getIdentity = getUser, getClient = sb, fetcher = fetch } = {}) {
  async function request(owner, method, body, endpoint = '/api/courses/images', binary = false) {
    const guard = () => { if (!owner || getIdentity()?.id !== owner) throw Object.assign(new Error('Your account changed. Reopen this course from its owning account.'), { code:'account' }); };
    guard();
    const client = await getClient(), { data } = await client?.auth.getSession() || {};
    guard();
    if (data?.session?.user?.id !== owner || !data.session.access_token) throw Object.assign(new Error('Sign in again to use your course images.'), { code:'account' });
    const query = method === 'GET' && body ? `?${new URLSearchParams(body)}` : '';
    let response;
    try { response = await fetcher(endpoint + query, { method, cache:'no-store', headers:{ Authorization:`Bearer ${data.session.access_token}`, 'Content-Type':'application/json' }, ...(method === 'POST' ? { body:JSON.stringify(body) } : {}), signal:AbortSignal.timeout(30000) }); }
    catch { guard(); throw Object.assign(new Error(binary ? 'Your saved image could not be loaded. Retry loading the same file; no new image will be generated.' : 'The request could not be confirmed. Check the same attempt before starting another. Your saved lesson is unchanged unless acceptance completed.'), { code:'unavailable' }); }
    guard();
    if (binary && response.ok) {
      if (!response.headers.get('content-type')?.startsWith('image/png')) throw new Error('The image file could not be loaded.');
      const blob = await response.blob(); guard(); return blob;
    }
    const result = await response.json().catch(() => null); guard();
    if (!response.ok || !result) throw Object.assign(new Error(result?.error || 'This image request is unavailable. Check again; no image was regenerated.'), { code:result?.code || 'unavailable' });
    return result;
  }
  return {
    loadCourse:(owner,courseId) => request(owner,'GET',{ id:courseId },'/api/courses/get'),
    inspect:(owner,courseId,target) => request(owner,'GET',{ courseId,action:'inspect',...target }),
    list:async (owner,courseId) => {
      let after, requests = [];
      do { const page = await request(owner,'GET',{ courseId,action:'list',...(after ? { after } : {}) }); requests.push(...page.requests); after = page.nextCursor; } while (after);
      return requests;
    },
    action:(owner,body) => request(owner,'POST',body),
    asset:(owner,courseId,operationId) => request(owner,'GET',{ courseId,operationId,action:'asset' },'/api/courses/images',true),
    connection:owner => request(owner,'GET',null,'/api/providers/openai'),
    connect:(owner,key) => request(owner,'POST',{ key },'/api/providers/openai'),
    disconnect:owner => request(owner,'DELETE',null,'/api/providers/openai'),
  };
}
