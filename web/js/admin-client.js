import { getUser, sb } from './auth.js?v=35';

export function createAdminClient({getIdentity=getUser,getSession=async()=> (await (await sb()).auth.getSession()).data?.session,fetcher=(...args)=>fetch(...args)}={}) {
  async function request(params) {
    const owner=getIdentity()?.id;
    if(!owner)throw Object.assign(new Error('Sign in with your admin account.'),{code:'auth'});
    const session=await getSession();
    const valid=()=>getIdentity()?.id===owner&&session?.user?.id===owner&&!!session?.access_token;
    if(!valid())throw Object.assign(new Error('Your account changed. Reopen Admin.'),{code:'auth'});
    let response;
    try {response=await fetcher('/api/admin/generation?'+new URLSearchParams(params),{method:'GET',cache:'no-store',headers:{Authorization:'Bearer '+session.access_token},signal:AbortSignal.timeout(30000)});}
    catch {throw new Error('Admin data could not be loaded. Check your connection and try again.');}
    if(!valid())throw Object.assign(new Error('Your account changed. Reopen Admin.'),{code:'auth'});
    const data=await response.json().catch(()=>null);
    if(!valid())throw Object.assign(new Error('Your account changed. Reopen Admin.'),{code:'auth'});
    if(!response.ok||!data)throw Object.assign(new Error(data?.error||'Admin data could not be loaded.'),{code:data?.code});
    return data;
  }
  return {access:()=>request({access:'1'}),list:(days=30)=>request({days:String(days)}),detail:jobId=>request({jobId})};
}
