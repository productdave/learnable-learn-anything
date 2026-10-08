const PAGE_SIZE=12;
const unavailable=()=>new Error('Community courses could not be loaded. Try again.');

// Public metadata only. Cursor state stays in this browsing session, not account storage.
export function createCommunityCatalog({fetcher=(...args)=>fetch(...args),enabled=false}={}) {
  return async function loadPage({q='',cursor=null,signal}={}) {
    q=q.trim();
    if(q.length>120)throw new Error('Use up to 120 characters to search.');
    if(cursor && cursor.q!==q)throw unavailable();
    let live=[];
    if(enabled && cursor?.kind!=='bundled') {
      const params=new URLSearchParams();if(q)params.set('q',q);if(cursor?.value)params.set('cursor',cursor.value);
      const response=await fetcher('/api/courses/community?'+params,{cache:'no-store',signal});
      if(!response.ok)throw unavailable();
      const body=await response.json();
      if(!Array.isArray(body.courses)||body.courses.length>PAGE_SIZE || !(body.nextCursor===null||typeof body.nextCursor==='string'))throw unavailable();
      live=body.courses;
      if(body.nextCursor)return {courses:live,nextCursor:{kind:'live',value:body.nextCursor,q}};
      // Do not lose the final live page if the separate bundled catalog is down.
      // Bundled results follow as their own page, with independent retry.
      if(live.length)return {courses:live,nextCursor:{kind:'bundled',offset:0,q}};
    }
    const response=await fetcher('data/courses/index.json',{cache:'no-cache',signal});
    if(!response.ok)throw unavailable();
    const body=await response.json();if(!Array.isArray(body.courses))throw unavailable();
    const seen=new Set();
    const bundled=body.courses.filter(c=> {
      if(!c || typeof c.id!=='string'||c.user||c.internal||(c.visibility&&c.visibility!=='public')||seen.has(c.id))return false;
      seen.add(c.id);
      return `${c.title||''} ${c.subtitle||''} ${c.publicAuthor?.displayName||''}`.toLowerCase().includes(q.toLowerCase());
    });
    const offset=cursor?.kind==='bundled'?cursor.offset:0;
    if(!Number.isSafeInteger(offset)||offset<0)throw unavailable();
    return {courses:bundled.slice(offset,offset+PAGE_SIZE),nextCursor:offset+PAGE_SIZE<bundled.length?{kind:'bundled',offset:offset+PAGE_SIZE,q}:null};
  };
}
