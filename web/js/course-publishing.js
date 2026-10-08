import { sb,getUser,onUserChange } from './auth.js?v=33';
import { escapeHome as esc } from './home-model.js?v=7';

export async function publicationRequest(path,body=null) {
  const owner=getUser()?.id;if(!owner)throw new Error('Sign in to continue.');
  const {data}=await(await sb()).auth.getSession();
  if(getUser()?.id!==owner||data?.session?.user?.id!==owner)throw new Error('Your account changed. Reopen this course.');
  let response;
  try{response=await fetch(path,{method:body?'POST':'GET',cache:'no-store',headers:{Authorization:`Bearer ${data.session.access_token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(30000)});}catch{throw new Error(body?'The result could not be confirmed. Retry the same action to check whether it completed.':'Publishing status could not be loaded. Try again; no changes were made.');}
  const result=await response.json().catch(()=>null);
  if(getUser()?.id!==owner)throw new Error('Your account changed. Reopen this course.');
  if(!result)throw new Error(body?'The response could not be read. Retry the same action to check whether it completed.':'Publishing status could not be loaded. Try again; no changes were made.');
  if(!response.ok)throw Object.assign(new Error(result.error||'Please try again.'),{code:result.code});
  return result;
}

export function openCoursePublishing(courseId,{title,authorName='',reviewToken,onPublished,mode='review',onPreview}={}){
  const owner=getUser()?.id,opener=document.activeElement,dialog=document.createElement('dialog');
  dialog.className='course-editor public-course-preview';dialog.dataset.publicationDialog='';dialog.setAttribute('aria-labelledby','publication-title');document.body.append(dialog);
  let state=null,busy=false,pendingAction='',error='',reviewed=false,rights=false,images=false,unpublishConfirm=false,closed=false,lastBody=null,success='',unwatch;
  const valid=()=>!closed&&getUser()?.id===owner;
  function close(){if(closed)return;closed=true;unwatch?.();window.removeEventListener('popstate',close);dialog.close();dialog.remove();const fallback=[...document.querySelectorAll('[data-manage-publication],[data-public-preview]')].find(el=>(el.dataset.managePublication||el.dataset.publicPreview)===courseId&&!el.closest('details:not([open])')&&el.getClientRects().length)||[...document.querySelectorAll('[data-home-course]')].find(el=>el.dataset.homeCourse===courseId)?.querySelector('h3 a');(opener?.isConnected?opener:fallback)?.focus();}
  const blocked=()=>!state||state.reviewToken!==reviewToken||state.blockers.length>0;
  const confirmed=()=>reviewed&&rights&&(!state?.imageCount||images);
  const local=['localhost','127.0.0.1'].includes(location.hostname);
  const managing=mode==='manage';
  function paint(){
    if(!valid())return;
    const p=state?.publication,published=p?.status==='published';
    dialog.innerHTML=`<header><div><p class="public-preview-kicker">${local?'Local test workspace · not the live Learnable site':'Community Courses'}</p><h2 id="publication-title">${published?'Manage publication':'Publish your course'}</h2><p>${esc(title)}</p></div><button type="button" data-pub="close" aria-label="Close publishing">×</button></header>
      ${busy?`<p role="status">${pendingAction==='publish'?'Publishing the reviewed version… Closing this dialog won’t cancel it.':pendingAction==='unpublish'?'Ending public access… Closing this dialog won’t cancel it.':'Checking your account…'}</p>`:''}${error?`<p class="editor-error" role="alert">${esc(error)}</p>`:''}${success?`<p role="status">${esc(success)}</p>`:''}
      ${state?`${published?`<section><h3>Public version available</h3><p>Only the last version you published is public. Private edits are not shared automatically.</p><label class="editor-field"><span>Course link</span><input readonly value="${esc(new URL(p.url,location.origin).href)}" aria-label="Course link"></label><a class="home-button" href="${esc(p.url)}" target="_blank" rel="noopener">Open public course →</a>${local?'<p>This localhost link only works on this computer. Sharing outside your network requires hosted release.</p>':''}<button type="button" data-pub="ask-unpublish" ${busy?'disabled':''}>Unpublish course</button></section>`:''}
      ${unpublishConfirm?`<section><h3>Unpublish ${esc(title)}?</h3><p>This removes the Community listing and stops future access through its public link. Your private course stays saved. Copies already downloaded cannot be recalled.</p><button type="button" data-pub="unpublish" ${busy?'disabled':''}>Confirm unpublish</button><button type="button" data-pub="cancel-unpublish" ${busy?'disabled':''}>Keep public</button></section>`:`<section><h3>${published?'Publish an updated version':'Final sharing check'}</h3><p>Anyone can read, share or copy the published course. Confirm that the preview is ready to share. Learnable does not certify its accuracy or safety.</p>
      ${state.reviewToken!==reviewToken?'<p class="editor-error">The saved course changed. Return to preview, refresh it, and review the latest version.</p>':''}
      ${state.blockers.length?`<div class="public-preview-withheld"><strong>Not ready to publish</strong><ul>${state.blockers.map(b=>`<li>${esc(b.message)}</li>`).join('')}</ul><p>Your saved course and any existing public version are unchanged.</p></div>`:''}
      <label class="editor-field"><span id="publish-author-label">Public author name</span><input id="publish-author" aria-labelledby="publish-author-label" value="${esc(authorName)}" ${busy?'disabled':''}><small>A name or pen name, not your email. A circular initials avatar will appear beside it. Saved only when you publish.</small></label>
      <label class="publication-check"><input type="checkbox" data-confirm="reviewed" ${reviewed?'checked':''} ${busy?'disabled':''}><span>I reviewed the preview, checked facts and answers, and removed personal or confidential information. High-stakes instructions need qualified review.</span></label>
      <label class="publication-check"><input type="checkbox" data-confirm="rights" ${rights?'checked':''} ${busy?'disabled':''}><span>I have permission to share this content and want this version to be public.</span></label>
      ${state.imageCount?`<aside class="public-preview-callout"><h4>${state.imageCount} ${state.imageCount===1?'course image':'course images'} will be shared</h4><p>Publishing copies the images already saved in your course. It does not generate new images or use additional AI tokens. Hosting and storage costs are separate. Private originals and generation prompts stay private; anyone may download the shared copies.</p><label class="publication-check"><input type="checkbox" data-confirm="images" ${images?'checked':''} ${busy?'disabled':''}><span>I reviewed these images and their alternative text for accuracy, privacy and rights, and want to share them publicly.</span></label></aside>`:''}
      <button type="button" class="home-button" data-pub="publish" ${busy||blocked()||!confirmed()||!authorName.trim()?'disabled':''}>${published?'Publish updated version':'Publish to Community Courses'}</button></section>`}`:''}
      <footer><button type="button" data-pub="refresh" ${busy?'disabled':''}>${state?'Refresh publishing status':'Try again'}</button><button type="button" data-pub="close">${managing?'Back to Your Courses':'Back to preview'}</button></footer>`;
    if(managing){
      dialog.querySelector('#publication-title').textContent='Manage publication';
      // Management is not content review or consent. Replace the publishing form
      // entirely; the only path to publish/update goes back through the preview.
      const section=dialog.querySelector('#publish-author')?.closest('section');
      if(section)section.innerHTML=`<h3>${published?'Review before updating':'Review before publishing'}</h3><p>${published?(state.sourceChanged?'Your saved copy changed since publication. Your last confirmed public version is still available.':'Private edits are never shared automatically.'):'Your saved account copy is private. Publishing needs a fresh content review and your confirmation.'}</p><button type="button" class="home-button" data-pub="preview" ${busy?'disabled':''}>Review saved course →</button>`;
      if(section&&p?.moderationRemoved)section.innerHTML='<h3>Public sharing restricted</h3><p>Public access was removed after a moderation review. Your private course is still saved, but it cannot be published again until the restriction is lifted.</p>';
    }
    const link=dialog.querySelector('input[aria-label="Course link"]');
    if(link){const copy=document.createElement('button');copy.type='button';copy.dataset.pub='copy';copy.textContent='Copy course link';copy.disabled=busy;const label=link.closest('label'),open=label.nextElementSibling,actions=document.createElement('div');actions.className='publication-link-actions';actions.append(copy);if(open?.matches('a'))actions.append(open);label.after(actions);}
  }
  async function load(){busy=true;pendingAction='';error=success='';paint();try{const result=await publicationRequest('/api/courses/publish?courseId='+encodeURIComponent(courseId));if(valid()){state=result;reviewed=rights=images=false;if(!authorName)authorName=result.publication?.author||'';}}catch(e){if(valid()){error=e.message;state=null;}}finally{if(valid()){busy=false;paint();}}}
  async function act(action){
    if(busy||!state||(managing&&action==='publish'))return;
    const body={courseId,action,version:state.publication?.version||0,...(action==='publish'?{reviewToken,authorName,confirmReviewed:reviewed,confirmRights:rights,confirmImages:images}:{confirmUnpublish:true})};
    const same=lastBody&&JSON.stringify({...lastBody,operationId:undefined})===JSON.stringify(body);
    lastBody={...body,operationId:same?lastBody.operationId:crypto.randomUUID()};
    busy=true;pendingAction=action;error=success='';paint();
    try{const result=await publicationRequest('/api/courses/publish',lastBody);if(!valid())return;state.publication=result.publication;unpublishConfirm=false;reviewed=rights=images=false;lastBody=null;success=action==='publish'?'Published successfully. Your private course is unchanged.':'Unpublished. Your private course is still saved.';if(action==='publish')onPublished?.(result.publication.author);window.dispatchEvent(new Event('publication-changed'));}
    catch(e){if(valid())error=e.message;}
    finally{if(valid()){busy=false;paint();dialog.querySelector('[role="alert"],[role="status"]')?.setAttribute('tabindex','-1');dialog.querySelector('[role="alert"],[role="status"]')?.focus();}}
  }
  dialog.addEventListener('input',e=>{if(e.target.id==='publish-author')authorName=e.target.value;if(e.target.dataset.confirm==='reviewed')reviewed=e.target.checked;if(e.target.dataset.confirm==='rights')rights=e.target.checked;if(e.target.dataset.confirm==='images')images=e.target.checked;const button=dialog.querySelector('[data-pub="publish"]');if(button)button.disabled=busy||blocked()||!confirmed()||!authorName.trim();});
  dialog.addEventListener('click',async e=>{const action=e.target.closest('[data-pub]')?.dataset.pub;if(action==='close')close();if(busy)return;if(action==='refresh')load();if(action==='preview'){close();onPreview?.();}if(action==='copy'){
    const input=dialog.querySelector('input[aria-label="Course link"]');if(!input)return;
    try{await navigator.clipboard.writeText(input.value);if(valid()){success='Course link copied.';error='';paint();}}
    catch{if(valid()){error='Couldn’t copy automatically. Select and copy the course link below.';success='';paint();const field=dialog.querySelector('input[aria-label="Course link"]');field?.focus();field?.select();}}
  }if(action==='ask-unpublish'){unpublishConfirm=true;paint();dialog.querySelector('[data-pub="cancel-unpublish"]')?.focus();}if(action==='cancel-unpublish'){unpublishConfirm=false;paint();}if(['publish','unpublish'].includes(action))act(action);});
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});window.addEventListener('popstate',close);unwatch=onUserChange(()=>{if(!valid())close();});paint();dialog.showModal();load();return {dialog,close};
}

export function openCourseReport(courseId,version){
  const owner=getUser()?.id,dialog=document.createElement('dialog'),opener=document.activeElement;
  dialog.className='course-editor';dialog.setAttribute('aria-labelledby','report-title');
  dialog.innerHTML=`<header><h2 id="report-title">Report this course</h2><button type="button" data-report-close aria-label="Close report">×</button></header>${owner?'<form><label class="editor-field">Reason<select name="reason"><option value="unsafe">Unsafe instruction</option><option value="privacy">Personal or confidential information</option><option value="rights">Content rights</option><option value="misleading">Misleading content</option><option value="other">Other</option></select></label><label class="editor-field">Describe the issue<textarea name="detail" minlength="10" maxlength="2000" required rows="5"></textarea><small>10–2,000 characters. Do not include sensitive personal details.</small></label><p data-report-status role="status"></p><button class="home-button" type="submit">Submit report</button></form>':'<p>Sign in using Account to submit a report. You can keep browsing without signing in.</p>'}`;
  document.body.append(dialog);let closed=false;const unwatch=onUserChange(()=>{if(getUser()?.id!==owner)close();});function close(){if(closed)return;closed=true;unwatch();dialog.close();dialog.remove();opener?.isConnected&&opener.focus();}
  dialog.addEventListener('cancel',e=>{e.preventDefault();close();});dialog.querySelector('[data-report-close]').onclick=close;
  dialog.querySelector('form')?.addEventListener('submit',async e=>{e.preventDefault();const form=e.target,button=form.querySelector('button'),status=form.querySelector('[data-report-status]');button.disabled=true;status.textContent='Submitting…';try{await publicationRequest('/api/courses/community',{courseId,version,reason:form.elements.reason.value,detail:form.elements.detail.value});if(!closed){form.innerHTML='<p role="status">Report received. This does not automatically remove the course or mean it has been reviewed.</p>';}}catch(error){if(!closed){status.textContent=error.message;button.disabled=false;}}});dialog.showModal();
}
