import { sb, getUser } from './auth.js?v=33';

export function createPublicPreviewClient({ getIdentity = getUser, getClient = sb, fetcher = fetch } = {}) {
  return { async load(owner, courseId) {
    const guard = () => { if (!owner || getIdentity()?.id !== owner) throw Object.assign(new Error('Your account changed. Reopen the course from the correct account.'), { code:'account' }); };
    guard();
    const client = await getClient(), { data } = await client?.auth.getSession() || {};
    guard();
    if (data?.session?.user?.id !== owner || !data.session.access_token) throw Object.assign(new Error('Sign in again to preview your course.'), { code:'account' });
    let response;
    try { response = await fetcher(`/api/courses/public-preview?courseId=${encodeURIComponent(courseId)}`, { method:'GET', cache:'no-store', headers:{ Authorization:`Bearer ${data.session.access_token}` }, signal:AbortSignal.timeout(30000) }); }
    catch { guard(); throw Object.assign(new Error('The latest saved course could not be loaded. Try again; nothing was published.'), { code:'unavailable' }); }
    guard();
    const result = await response.json().catch(() => null);
    guard();
    if (!response.ok || result?.preview?.version !== 1 || !Array.isArray(result.preview.modules)) throw Object.assign(new Error(result?.error || 'The preview could not be loaded. Try again; your saved course is unchanged.'), { code:result?.code || 'unavailable' });
    return result;
  }, async asset(owner,courseId,imageId,reviewToken) {
    const guard=()=>{if(!owner||getIdentity()?.id!==owner)throw new Error('Your account changed. Reopen the preview.');};
    guard();const {data}=await(await getClient()).auth.getSession();guard();
    if(data?.session?.user?.id!==owner)throw new Error('Sign in again to review this image.');
    const params=new URLSearchParams({courseId,imageId,reviewToken});
    const response=await fetcher('/api/courses/public-preview?'+params,{cache:'no-store',headers:{Authorization:`Bearer ${data.session.access_token}`},signal:AbortSignal.timeout(30000)});guard();
    if(!response.ok){const result=await response.json().catch(()=>({}));throw new Error(result.error||'The image could not be loaded. Retry or refresh the preview.');}
    const blob=await response.blob();guard();return blob;
  } };
}
