// WORKSPACE-INLINE-01 regression: use the existing review UI without a modal.
// Synthetic dependencies only; no provider, account or live job calls.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';
import * as evidence from '../web/js/research-evidence.js';
import { COURSE_AGENT_SEQUENCE, agentNameForStage } from '../web/js/generator/agents.mjs';
import { imageCostHTML } from '../web/js/image-cost.js';

const root = resolve(process.env.INLINE_JS_ROOT || 'web/js');
const strip = source => source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '').replace(/^export /gm, '');
const { window, document } = parseHTML('<html><head></head><body data-experience="workspace"><main id="content"></main></body></html>');
Object.defineProperty(document, 'activeElement', { value: document.body, writable: true });
window.HTMLElement.prototype.focus = function() { document.activeElement = this; };
window.HTMLElement.prototype.setSelectionRange = function(a,b) { this.selectionStart=a;this.selectionEnd=b; };
Object.defineProperty(window.HTMLElement.prototype, 'elements', { get() { return Object.fromEntries([...this.querySelectorAll('[name]')].map(el=>[el.name,el])); } });
window.scrollTo = () => {}; window.scrollY = 170;
const location = new URL('https://test.invalid/?experience=workspace&workspace=job');
const navigator = { onLine:true }, jobs = new Map(), listeners = new Set(), authListeners = new Set(), timers = new Set(), calls=[];
let user = { id:'owner' }, sourceOptions, mounts=0, destroyed=0, confirms=0, assertions=0;
const check = (condition, message) => { assert.ok(condition, message); assertions++; };
const tick = () => new Promise(resolve=>setImmediate(resolve));
const brief = { topic:'Test course', subtitle:'Useful first draft', materials_policy:'integrated-visuals-v2', components:['lessons','images','quizzes'], modules:[{number:1,id:'basics',title:'Basics',description:'Keep this existing description',topics:[{id:'first',title:'First lesson'}]}] };
let job = { id:'job',ownerId:'owner',runner:'cloud',runId:'run-1',status:'running',stage:'intake',title:'Test course',message:'Designing outline',startedAt:Date.now(),brief,checkpoint:{brief},topicsTotal:1,topicsDone:0 };
jobs.set('job', job);
const emit = () => { for(const fn of [...listeners]) fn(); };
const update = patch => { job={...job,...patch};jobs.set('job',job);emit(); };
const context = vm.createContext({ window,document,location,navigator,history:{pushState(){calls.push('navigate');}},PopStateEvent:window.Event,AbortController,URLSearchParams,console,
  setTimeout,clearTimeout,setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn),
  localStorage:{getItem:()=>null,removeItem(){}},sessionStorage:{getItem:()=>null,removeItem(){}},
  confirm:()=>{confirms++;return true;}, getUser:()=>user,onUserChange:fn=>authListeners.add(fn),getJob:id=>jobs.get(id),
  onJobsChange:fn=>{listeners.add(fn);return()=>listeners.delete(fn);},updateJob:(_id,patch)=>update(patch),
  hasApiKey:()=>true,cloudGenAvailable:()=>true,hasSavedRequestRestartIntent:()=>false,
  generationActionSnapshot:j=>({status:j?.status,runId:j?.runId}),
  reviewPendingForAction:action=>({action,status:'Working...',continueLabel:'Working...'}),
  submitCloudReview:async(...args)=>{calls.push(args);},resumeCloudGeneration:async(...args)=>{calls.push(['resume',...args]);},
  restartOrStartCloudGeneration:async(...args)=>{calls.push(['restart',...args]);},
  cancelCloudGeneration:async()=>{calls.push('cancel');update({status:'cancelling'});},
  deleteCloudGeneration:async()=>{jobs.delete('job');emit();return {};},
  openAccount:args=>calls.push(['account',args]),
  createCourseImageClient:()=>({connect:async(owner,key)=>{calls.push(['connect-openai',owner]);check(key==='synthetic-openai-key','explicit connection uses the entered key only');}}),
  mountReviewSourceEditor:(card,options)=>{sourceOptions=options;mounts++;card.innerHTML='<textarea data-source-notes></textarea><button data-editor-back>Back</button>';return{owner:'owner',destroy(){destroyed++;}};},
  COURSE_AGENT_SEQUENCE,agentNameForStage,imageCostHTML,...evidence
});
vm.runInContext(strip(readFileSync(resolve(root,'intake.js'),'utf8'))+'\nglobalThis.intakeTest={mountIntakeForJob,openIntakeForJob,openIntake};', context);
const intake = context.intakeTest, card=document.createElement('section');document.body.append(card);
let mount=intake.mountIntakeForJob(card,'job');
check(card.querySelector('h1')?.textContent==='Test course','inline has one course heading');
check(!card.querySelector('.intake-close')&&!document.querySelector('[role="dialog"]'),'no modal shell or Close');
check(card.querySelectorAll('.intake-agent').length===COURSE_AGENT_SEQUENCE.length,'existing agents retained');
check(card.querySelectorAll('.intake-stages').length===1,'one existing tracker');
check(timers.size===1,'running timer active');
update({status:'review_curriculum',review:{brief},message:'Waiting for curriculum review'});
check(card.textContent.includes('Keep this existing description')&&card.textContent.includes('First lesson'),'full review retained');
check(card.textContent.includes('creates and saves those images automatically')&&!card.textContent.includes('confirm each OpenAI charge'),'images integrated without per-image approval');
check(timers.size===0,'review stops timer');
let input=card.querySelector('[data-review-feedback]');input.value='Keep my context';input.setSelectionRange(3,8);input.focus();
update({lastUpdatedAt:Date.now()});
input=card.querySelector('[data-review-feedback]');
check(input.value==='Keep my context','feedback survives realtime refresh');
check(document.activeElement===input&&input.selectionStart===3,'focus and caret preserved');
card.querySelector('[data-review-continue]').click();card.querySelector('[data-review-continue]').click();await tick();
check(calls.filter(Array.isArray).length===1,'pending approval blocks duplicate clicks');
check(calls[0][1]==='approve_curriculum'&&calls[0][2]==='Keep my context'&&calls[0][3].runId==='run-1','existing approval feedback and checkpoint preserved');
update({status:'running',stage:'research',review:null});
check(timers.size===1,'timer resumes when review starts work');
update({status:'review_research',review:{researchResults:[]}});
check(card.querySelector('[data-review-continue]').disabled,'missing research still blocks approval');
navigator.onLine=false;window.dispatchEvent(new window.Event('offline'));
check(card.querySelector('[data-review-regenerate]').disabled,'offline paid action disabled');
navigator.onLine=true;window.dispatchEvent(new window.Event('online'));
check(card.querySelector('[data-review-continue]').disabled&&!card.querySelector('[data-review-regenerate]').disabled,'reconnect does not enable invalid research');
input=card.querySelector('[data-review-feedback]');input.value='Keep source feedback';
card.querySelector('[data-adjust-sources]').click();card.querySelector('[data-source-notes]').value='Unsubmitted transcript';
update({lastUpdatedAt:Date.now()});
check(card.querySelector('[data-source-notes]').value==='Unsubmitted transcript'&&mounts===1,'source editing survives realtime events');
sourceOptions.onBack();
check(card.querySelector('[data-review-feedback]').value==='Keep source feedback','return from sources restores feedback');
check(document.activeElement===card.querySelector('[data-adjust-sources]'),'return restores source control focus');
for(const status of ['failed','interrupted','timed_out','partial']) {
  update({status,error:'Example failure',review:null,needsApiKey:false});
  check(!!card.querySelector('[data-resume]')&&!!card.querySelector('[data-delete]'),status+' recovery retained');
}
update({status:'failed',stage:'images',error:'OpenAI course image generation could not finish (connection).',imageProgress:{planned:1,completed:0,omitted:0}});
check(card.querySelector('[data-resume]').textContent==='Resume course creation','visual failure resumes the same course flow');
let imageKey=card.querySelector('#intake-image-key');imageKey.value='synthetic-openai-key';imageKey.focus();imageKey.setSelectionRange(2,5);
update({lastUpdatedAt:Date.now()});
check(card.querySelector('#intake-image-key')===imageKey&&imageKey.value==='synthetic-openai-key','polling retains the actual password field without copying it to state');
check(document.activeElement===imageKey&&imageKey.selectionStart===2&&imageKey.selectionEnd===5,'polling retains password focus and caret');
const priorActions=calls.length;
card.querySelector('[data-image-reconnect]').dispatchEvent(new window.Event('submit',{bubbles:true,cancelable:true}));await tick();
check(calls.length===priorActions+1&&calls.at(-1)[0]==='connect-openai','reconnect does not automatically resume or generate');
check(imageKey.value===''&&!JSON.stringify(job).includes('synthetic-openai-key'),'key cleared from form and absent from job state');
check(card.querySelector('[data-image-connection-notice]').textContent.includes('No image was generated'),'reconnect accurately describes next action');
update({stage:'topics',imageProgress:null});
update({needsApiKey:true});card.querySelector('[data-api-key]').click();
check(calls.some(call=>Array.isArray(call)&&call[0]==='account'),'credential recovery opens existing account UI');
update({needsApiKey:false,needsSourceReattach:true});card.querySelector('[data-reattach]').click();
check(!!card.querySelector('[data-back-progress]')&&!document.querySelector('[role="dialog"]'),'file recovery stays inline');
card.querySelector('[data-back-progress]').click();check(!!card.querySelector('[data-reattach]'),'return from file recovery works');
update({status:'running',needsSourceReattach:false});card.querySelector('[data-cancel]').click();await tick();
check(confirms===1&&card.textContent.includes('Draining'),'cancel still confirms and stays visible');
mount.dispose();check(card.innerHTML===''&&timers.size===0&&listeners.size===1,'unmount clears UI, timer and scoped listener');
mount=intake.mountIntakeForJob(card,'job');user={id:'different'};for(const fn of authListeners)fn(user);
check(card.innerHTML===''&&timers.size===0,'account change clears private review');
user={id:'owner'};mount=intake.mountIntakeForJob(card,'job');intake.openIntakeForJob('job');
check(!calls.includes('navigate'),'reopening same inline job does not discard UI');
mount.dispose();intake.openIntakeForJob('other');check(calls.includes('navigate'),'workspace recovery opens page, not modal');
document.body.dataset.experience='legacy';intake.openIntakeForJob('job');check(!!document.querySelector('[role="dialog"] .intake-close'),'legacy modal remains supported');
document.querySelector('.intake-close').click();

// Exercise the actual home controller with the actual shared mount.
Object.assign(globalThis,{window,document,location,history:context.history});Object.defineProperty(globalThis,'navigator',{value:navigator,configurable:true});
const home = await import('../web/js/home.js');
// For packaged tests compile home with the same known pure dependencies.
let createHomeController=home.createHomeController;
if(process.env.INLINE_JS_ROOT){const model=await import('../web/js/home-model.js'), author=await import('../web/js/public-author.js'), draft=await import('../web/js/home-draft.js'),setup=await import('../web/js/setup-model.js'),ready=await import('../web/js/course-readiness.js'),view=await import('../web/js/course-readiness-view.js');
 Object.assign(context,{...model,esc:model.escapeHome,...author,...draft,...setup,...ready,...view});vm.runInContext(strip(readFileSync(resolve(root,'home.js'),'utf8'))+'\nglobalThis.homeTest=createHomeController;',context);createHomeController=context.homeTest;}
document.body.dataset.experience='workspace';update({status:'review_curriculum',stage:'intake',review:{brief},needsSourceReattach:false});
const host=document.getElementById('content');
const controller=createHomeController({getUser:()=>user,listJobs:()=>[job],getJob:()=>job,getSavedCourse:()=>null,loadLibrary:async()=>({courses:[]}),listDrafts:async()=>({drafts:[]}),onJobsChange:context.onJobsChange,mountJobProgress:intake.mountIntakeForJob,wireJobs(){},wireCourses(){},refreshCloud:async()=>{},jobControls:()=>'<button>Existing completed controls</button>'});
await controller.render(host,'job');
check(!host.textContent.includes('Open review')&&!host.querySelector('.home-timeline'),'workspace removes launch step and duplicate tracker');
const stable=host.querySelector('[data-workspace-inline]');input=stable.querySelector('[data-review-feedback]');input.value='Survive library refresh';
await controller.refresh();
check(host.querySelector('[data-workspace-inline]')===stable&&stable.querySelector('[data-review-feedback]').value==='Survive library refresh','home refresh keeps renderer and unsent input');
stable.querySelector('[data-review-feedback]').focus();update({status:'completed',stage:'done',courseInstalled:true});await tick();
check(!host.querySelector('[data-workspace-inline]')&&host.textContent.includes('Existing completed controls'),'completion returns to existing saved-course UI');
controller.dispose();check(timers.size===0&&listeners.size===1,'route cleanup leaves only existing global listener');
console.log(JSON.stringify({suite:'workspace-inline',assertions,passed:true,providerCalls:0}));
