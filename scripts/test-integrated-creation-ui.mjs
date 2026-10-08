// Synthetic Create-screen interaction: both creator connections, one course
// action, no metered work on render/connect/recheck. No browser/provider calls.
import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { setupDraft } from '../web/js/setup-model.js';
import { createSetupCreation } from '../web/js/setup-create.js';

const {window,document}=parseHTML('<html><head></head><body><main></main></body></html>');
Object.defineProperty(document,'activeElement',{value:document.body,writable:true});
window.HTMLElement.prototype.focus=function(){document.activeElement=this;};
window.scrollTo=()=>{};window.confirm=()=>true;
Object.assign(globalThis,{window,document});
let checks=0,connected=false,available=true,failCheck=false,starts=0,opened=0,connections=0,disconnects=0,owner='owner';
const check=(v,label)=>{assert.ok(v,label);checks++;};
const tick=async()=>{for(let i=0;i<5;i++)await new Promise(resolve=>setImmediate(resolve));};
const draft=setupDraft('Explain recursive improvement');draft.brief.audience='Beginner product managers';
const session={owner:'owner',id:'setup-test',draft,version:1,record:{cloud:{revision:1}}};
const host=document.querySelector('main');
const creation=createSetupCreation({sessions:{flush:async()=>true,acknowledge:async()=>true},getUser:()=>owner?{id:owner,email:'test@example.test'}:null,
  accountClient:{save:async()=>({revision:1})},navigate:()=>{},openJob:async()=>{opened++;},
  client:{check:async()=>({ready:true,connected:true,enabled:true,issues:[],model:'synthetic'}),start:async()=>{starts++;return{jobId:'synthetic-job'};}},
  imageClient:{connection:async()=>{if(failCheck)throw new Error('Cannot check OpenAI');return{connected,generationEnabled:available};},connect:async(o,key)=>{check(o==='owner'&&key==='synthetic-key','connection is owner scoped');connections++;connected=true;},disconnect:async()=>{disconnects++;connected=false;}}});
creation.render(host,session);await tick();
check(host.textContent.includes('Connect OpenAI for instructional images'),'OpenAI connection is part of Create, not an image studio');
check(!host.querySelector('[data-create-action="start"]')&&starts===0,'missing OpenAI blocks generation before text spending');
const field=host.querySelector('#setup-image-provider-key');field.value='synthetic-key';
host.querySelector('[data-image-connection-form]').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await tick();
check(connections===1&&starts===0&&opened===0&&field.value==='','connecting clears the key and does not generate');
check(host.querySelector('[data-create-action="start"]')?.textContent==='Create course →','one integrated Create course action is available');
check(host.textContent.includes('text and image charges')&&host.textContent.includes('No separate image approvals'),'one combined creation explanation');
host.querySelector('[data-create-action="disconnect-images"]').click();await tick();
check(disconnects===1&&!host.querySelector('[data-create-action="start"]'),'disconnect immediately removes paid-start eligibility');
connected=true;available=false;host.querySelector('[data-create-action="retry"]').click();await tick();
check(!host.querySelector('[data-create-action="start"]')&&host.textContent.includes('unavailable on this server'),'disabled visual generation blocks incomplete automatic creation');
available=true;failCheck=true;host.querySelector('[data-create-action="retry"]').click();await tick();
check(!host.querySelector('[data-create-action="start"]')&&host.textContent.includes('Cannot check OpenAI'),'unconfirmed connection stays blocked with recovery copy');
failCheck=false;host.querySelector('[data-create-action="retry"]').click();await tick();
host.querySelector('[data-create-action="start"]').click();host.querySelector('[data-create-action="start"]')?.click();await tick();
check(starts===1&&opened===1,'explicit creation starts one course and opens its workspace');
creation.dispose();
check(!JSON.stringify(session).includes('synthetic-key'),'OpenAI key never enters saved setup state');
console.log(`Integrated creation UI: ${checks} assertions passed. Provider calls: 0.`);
