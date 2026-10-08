import { escapeHome as esc } from './home-model.js?v=7';

export function mountCommunityBrowser(host,{loadPage,renderCourse,wireCourses,query='',onClear=()=>{}}) {
  let q=query.trim(),courses=[],cursor=null,busy=false,error='',request=0,abort=null,timer=null,disposed=false,retryAppend=false;
  const events=new AbortController();
  host.innerHTML=`<section class="home-section community-browser" aria-labelledby="home-community"><div class="community-heading"><h2 id="home-community">Community Courses</h2><button type="button" class="home-button home-button--secondary" data-community-refresh aria-label="Refresh courses">Refresh</button></div><p class="community-description">Courses published by the community, open for everyone to explore.</p><p class="community-order">Newest updates first · Existing collection follows</p><p class="community-status" role="status" aria-live="polite" data-community-status></p><div data-community-error></div><div class="home-course-grid" data-community-grid></div><div data-community-empty></div><div class="community-paging"><button type="button" class="home-button home-button--secondary" data-community-more hidden>Load more courses</button></div></section>`;
  const grid=host.querySelector('[data-community-grid]'),more=host.querySelector('[data-community-more]'),refresh=host.querySelector('[data-community-refresh]');
  function paint() {
    if(disposed)return;
    host.querySelector('[data-community-status]').textContent=busy ? courses.length?'Loading more courses…':q?'Searching Community Courses…':'Loading Community Courses…'
      : error ? `${courses.length?courses.length+' courses shown. ':''}Results could not be fully loaded.`
      : `${courses.length} ${courses.length===1?'course':'courses'} shown${q?' for “'+q+'”':''}.${cursor?' Load more to keep exploring.':courses.length?' You’ve reached the end.':''}`;
    grid.setAttribute('aria-busy',String(busy));
    const failure=host.querySelector('[data-community-error]');
    failure.innerHTML=error?`<div class="home-notice home-notice--warning" role="alert"><div><strong>${retryAppend&&courses.length?'Couldn’t load more courses':'Couldn’t load Community Courses'}</strong><p>${esc(error)}${courses.length?' The courses already shown are still available.':''}</p></div><button type="button" class="home-button home-button--secondary" data-community-retry>Try again</button></div>`:'';
    host.querySelector('[data-community-empty]').innerHTML=!busy&&!error&&!courses.length?`<div class="home-empty"><h3>${q?'No matching community courses':'No community courses yet'}</h3><p>${q?'Search by title, description or author, or clear your search.':'Courses appear here when they are published publicly. Your private courses stay in Your Courses.'}</p>${q?'<button type="button" class="home-button home-button--secondary" data-community-clear>Clear search</button>':''}</div>`:'';
    more.hidden=!cursor||!!error;more.disabled=busy;more.textContent=busy?'Loading…':'Load more courses';refresh.disabled=busy;
  }
  async function load(append=false,focusNew=false) {
    if(disposed||busy)return;
    retryAppend=append;
    clearTimeout(timer);const version=++request;abort?.abort();abort=new AbortController();
    if(navigator.onLine===false){error='You’re offline. Reconnect and try again.';paint();return;}
    if(!append){courses=[];cursor=null;grid.innerHTML='';}
    busy=true;error='';paint();
    try {
      if(navigator.onLine===false)throw new Error('You’re offline. Reconnect and try again.');
      const page=await loadPage({q,cursor:append?cursor:null,signal:abort.signal});
      if(disposed||version!==request)return;
      const ids=new Set(courses.map(c=>c.id));const added=page.courses.filter(c=>!ids.has(c.id)&&ids.add(c.id));
      const first=courses.length;courses.push(...added);cursor=page.nextCursor;
      grid.insertAdjacentHTML('beforeend',added.map(renderCourse).join(''));wireCourses(grid);
      busy=false;paint();
      if(focusNew){const target=grid.children[first]?.querySelector('h3 a')||more; if(!target.hidden)target.focus();else{refresh.focus({preventScroll:true});}}
    }catch(e){
      if(disposed||version!==request)return;
      busy=false;error=e?.message==='Use up to 120 characters to search.'?e.message:navigator.onLine===false?'You’re offline. Reconnect and try again.':'Check your connection and try again.';paint();
      if(focusNew)host.querySelector('[data-community-retry]')?.focus({preventScroll:true});
    }
  }
  function search(value) {
    q=value.trim();clearTimeout(timer);request++;abort?.abort();busy=false;courses=[];cursor=null;error='';grid.innerHTML='';
    // Announce pending search without permitting an old page action during debounce.
    busy=true;paint();timer=setTimeout(()=>{busy=false;load();},300);
  }
  host.addEventListener('click',event=>{
    if(event.target.closest('[data-community-more]'))load(true,true);
    if(event.target.closest('[data-community-retry]'))load(retryAppend,true);
    if(event.target.closest('[data-community-refresh]'))load();
    if(event.target.closest('[data-community-clear]'))onClear();
  },{signal:events.signal});
  return {search,refresh:()=>{clearTimeout(timer);request++;abort?.abort();busy=false;return load();},dispose:()=>{disposed=true;request++;clearTimeout(timer);abort?.abort();events.abort();}};
}
