import { escapeHome as esc } from './home-model.js?v=7';
import { onUserChange } from './auth.js?v=33';
import { briefTitle } from './brief-presentation.js?v=1';

// Shared confirmation for Home and setup. Cards disappear only after deletion
// is acknowledged; account failures retain the local setup for retry.
export function confirmDraftDeletion({ prepare, remove, getOwner, watchIdentity = onUserChange }) {
  const owner=getOwner() || null, opener=document.activeElement, dialog=document.createElement('dialog');
  dialog.className='draft-delete-dialog';dialog.setAttribute('aria-labelledby','draft-delete-title');
  document.body.append(dialog);
  let snapshot,busy=false,disposed=false,unwatch,resolveResult;
  const result=new Promise(resolve=>{resolveResult=resolve;});
  const valid=()=>!disposed&&(getOwner()||null)===owner;
  function close(deleted=false){
    if(disposed)return;disposed=true;unwatch?.();dialog.close();dialog.remove();
    if(opener?.isConnected)opener.focus();resolveResult(deleted);
  }
  function paint(error=''){
    dialog.innerHTML=`<h2 id="draft-delete-title">Delete draft?</h2>${snapshot ? `<p class="draft-delete-name">${esc(briefTitle(snapshot.title))}</p><p>This removes the unfinished setup${owner ? ' from your account and this browser' : ' from this browser'}. You can’t undo this.</p><p>Courses you’ve created and builds already started are not deleted or stopped.</p>${owner ? '<p class="source-help">Uploaded account source files are retained separately; deleting a draft does not erase those originals.</p>' : ''}` : '<p role="status">Checking this draft…</p>'}${error ? `<p class="draft-delete-error" role="alert" tabindex="-1">${esc(error)}</p>` : ''}<div class="draft-delete-actions"><button type="button" data-draft-keep ${busy?'disabled':''}>${error&&!snapshot?'Close':'Keep draft'}</button><button type="button" data-draft-confirm ${busy||!snapshot?'disabled':''}>${busy?'Deleting…':error?'Retry deletion':'Delete draft'}</button></div>`;
    if(error)dialog.querySelector('[role="alert"]')?.focus();
  }
  unwatch=watchIdentity?.(()=>{if(!valid())close();});
  dialog.addEventListener('cancel',event=>{event.preventDefault();if(!busy)close();});
  dialog.addEventListener('click',async event=>{
    if(event.target.closest('[data-draft-keep]')&&!busy)return close();
    if(!event.target.closest('[data-draft-confirm]')||busy||!snapshot||!valid())return;
    busy=true;paint();
    try {await remove(snapshot);if(valid())close(true);}
    catch(error){if(valid()){busy=false;paint(error.message || 'Deletion could not be confirmed. Retry; your other courses are unchanged.');}}
  });
  paint();dialog.showModal();dialog.querySelector('[data-draft-keep]').focus();
  Promise.resolve().then(prepare).then(value=>{if(valid()){snapshot=value;paint();dialog.querySelector('[data-draft-keep]').focus();}}).catch(error=>{if(valid())paint(error.message||'Could not load the draft. Close this window and try again.');});
  return { result,close:()=>close() };
}
