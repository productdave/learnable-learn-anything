import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { createSetupController } from '../web/js/course-setup.js';
import { setupDraft } from '../web/js/setup-model.js';

const {window,document}=parseHTML('<html><head></head><body><main></main></body></html>');
Object.assign(globalThis,{window,document}); window.scrollTo=()=>{};
const host=document.querySelector('main'), user={id:'owned-qa',email:'fixture@example.test'};
let row={id:'notice-qa',revision:1,...setupDraft('Source recovery'),cloud:{revision:1}};
row.step='context';row.brief.audience='Adult beginners';
row.sources.notes=[{id:'note',title:'Keep this',text:'Exact note text'}];
row.sources.files=['one','two'].map(id=>({id,name:id+'.txt',size:8,type:'text/plain',blob:null}));
let writes=0,network=0,checks=0;
const check=(ok,message)=>{assert.ok(ok,message);checks++;};
const controller=createSetupController({getOwner:()=>user.id,getIdentity:()=>user,navigate:()=>{throw Error('Unexpected navigation');},
  store:{load:async()=>({status:'found',draft:structuredClone(row)}),save:async value=>{writes++;row={...structuredClone(value),revision:row.revision+1};return structuredClone(row);}},
  accountClient:{restore:async()=>{network++;throw Error('No network expected');}}
});
const click=selector=>host.querySelector(selector).dispatchEvent(new window.Event('click',{bubbles:true}));
await controller.render(host,'notice-qa','context');
const notice=host.querySelector('[data-setup-action="restore-files"]').closest('.home-notice');
check(!notice.hidden,'missing account originals show recovery warning');
click('[data-source-kind="files"]');
const reattach=id=>{
  click(`[data-source-id="${id}"] [data-source-action="reattach"]`);
  const input=host.querySelector('[data-reattach-input]');
  Object.defineProperty(input,'files',{value:[new File(['original'],id+'.txt',{type:'text/plain'})],configurable:true});
  input.dispatchEvent(new window.Event('change',{bubbles:true}));
};
const message=host.querySelector('[data-original-retry-message]');message.textContent='Earlier retry failed';
reattach('one');
check(!notice.hidden,'warning stays while another original is missing');
check(host.querySelector('[data-source-id="one"] [data-file-state]').textContent==='Attached','first file is repaired');
reattach('two');
check(notice.hidden,'warning hides immediately after the last original is reattached');
check(message.textContent==='','stale retry error clears on complete recovery');
check(host.querySelectorAll('.source-file').length===2,'reattach preserves source identity without duplicates');
check(host.querySelector('[data-source-id="two"] [data-file-state]').textContent==='Attached','second file is repaired');
check(network===0,'reattachment does not download, save remotely or generate');
controller.dispose();await new Promise(resolve=>setTimeout(resolve,0));

// Fresh missing-original state: remove, undo and unrelated note changes must
// derive the notice from current sources rather than its initial HTML.
row.sources.files=[{id:'one',name:'one.txt',size:8,type:'text/plain',blob:null}];
await controller.render(host,'notice-qa','context');
const again=host.querySelector('[data-setup-action="restore-files"]').closest('.home-notice');
click('[data-source-kind="files"]');click('[data-source-action="remove"]');
check(again.hidden,'removing the last missing source hides the warning');
click('[data-source-action="undo"]');
check(!again.hidden,'undo restores the warning for the missing original');
click('[data-source-kind="notes"]');
const note=host.querySelector('textarea[data-source-field="text"]');
note.value='Exact note text plus edit';note.dispatchEvent(new window.Event('input',{bubbles:true}));
check(!again.hidden,'unrelated note edits do not dismiss a real missing file');
check(host.querySelector('textarea[data-source-field="text"]')===note,'notice update does not replace the editor or steal focus');
controller.dispose();await new Promise(resolve=>setTimeout(resolve,0));
check(row.sources.notes[0].text==='Exact note text plus edit','note edit is preserved');
check(network===0&&writes>0,'only the injected local persistence was used');
console.log(`${checks} original-file notice interaction checks passed; real controller/editor, local store double, no network.`);
