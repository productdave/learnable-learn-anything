import {getUser,sb} from './auth.js?v=33';

export function createModerationClient({getIdentity=getUser,getSession=async()=> (await (await sb()).auth.getSession()).data?.session,fetcher=(...args)=>fetch(...args)}={}) {
  async function request(path,body=null,binary=false) {
    const owner=getIdentity()?.id;
    if(!owner)throw Object.assign(new Error('Sign in to review reports.'),{code:'auth'});
    const session=await getSession();
    const current=()=>getIdentity()?.id===owner&&session?.user?.id===owner;
    if(!current())throw Object.assign(new Error('Your account changed. Reopen report review.'),{code:'auth'});
    let response;
    try{response=await fetcher('/api/courses/moderation'+path,{method:body?'POST':'GET',cache:'no-store',headers:{Authorization:'Bearer '+session.access_token,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});}
    catch{throw new Error(body?'The decision could not be confirmed. Retry the same decision to check whether it completed.':'Reports could not be loaded. Check your connection and try again.');}
    if(!current())throw Object.assign(new Error('Your account changed. Reopen report review.'),{code:'auth'});
    if(binary&&response.ok){const blob=await response.blob();if(!current())throw new Error('Your account changed.');return blob;}
    const data=await response.json().catch(()=>null);
    if(!current())throw Object.assign(new Error('Your account changed. Reopen report review.'),{code:'auth'});
    if(!response.ok||!data)throw Object.assign(new Error(data?.error||(body?'The decision could not be confirmed. Retry the same decision.':'Reports could not be loaded. Try again.')),{code:data?.code});
    return data;
  }
  return {
    access:()=>request('?access=1'),
    list:(status='open',cursor=null)=>request('?'+new URLSearchParams({status,...(cursor?{cursor}:{})})),
    detail:id=>request('?reportId='+encodeURIComponent(id)),
    decide:body=>request('',body),
    image:(reportId,imageId)=>request('?'+new URLSearchParams({reportId,imageId}),null,true)
  };
}
