// GENERATION-ACTIVITY-01: real row mapping + renderer, synthetic clock and DOM.
// Regression: a fresh poll must never make an old worker look alive. No APIs.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

const root = resolve(process.env.ACTIVITY_JS_ROOT || 'web/js');
const strip = source => source.replace(/^import[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, '').replace(/^export /gm, '');
let assertions = 0, now = Date.parse('2026-10-01T22:00:00Z');
const check = (condition, message) => { assert.ok(condition, message); assertions++; };
class Clock extends Date { static now() { return now; } }
const { document, window } = parseHTML('<html><body><main></main><button id="keep-focus">Keep focus</button></body></html>');
Object.defineProperty(document, 'activeElement', {value:document.body,writable:true});
window.HTMLElement.prototype.focus = function() { document.activeElement = this; };
const navigator = {onLine:true}, timers = new Set(), jobs = new Map();
const ui = vm.createContext({window,document,navigator,Date:Clock,console,getJob:id=>jobs.get(id),onUserChange(){},onJobsChange(){},
  setInterval:fn=>{timers.add(fn);return fn;},clearInterval:fn=>timers.delete(fn)});
vm.runInContext(strip(readFileSync(resolve(root,'intake.js'),'utf8'))+'\nglobalThis.uiTest={generationActivityModel,generationActivityHTML,updateGenerationActivity,computeProgressPct,startElapsedTimer,stopElapsedTimer,setCard:card=>inlineCard=card};',ui);
const cloud = vm.createContext({console,Date:Clock,getJob:id=>jobs.get(id),getUser:()=>({id:'owner'}),_readAllCourses:()=>({})});
vm.runInContext(strip(readFileSync(resolve(root,'cloud-gen-client.js'),'utf8'))+'\nglobalThis.cloudTest={jobPatchFromRow,generationActivityObservation};',cloud);
const {jobPatchFromRow} = cloud.cloudTest, {generationActivityModel:model,generationActivityHTML:html,updateGenerationActivity:update,computeProgressPct:pct} = ui.uiTest;
const stamp = ms=>new Date(ms).toISOString();
const results = Object.fromEntries(Array.from({length:11},(_,i)=>['m/t'+i,{title:'Saved lesson '+i}]));
const row = {id:'job',owner_id:'owner',run_id:'run-1',status:'running',stage:'topics',heartbeat_at:stamp(now-20_000),lease_expires_at:stamp(now+340_000),updated_at:stamp(now-20_000),topics_done:11,topics_total:15,brief:{title:'Course',modules:[]},topics_by_key:results};
let job={id:'job',...jobPatchFromRow(row,null,now)};
check(job.heartbeatAt===now-20_000,'server heartbeat mapped, not browser time');
check(job.leaseExpiresAt===now+340_000,'lease timestamp mapped');
check(job.cloudSeenAt===now,'browser observation kept separately');
check(job.activityObservation.changedAt===null,'initial read does not invent a save time');
check(model(job).state==='responding','fresh heartbeat is responding');
check(model(job).checked==='20 seconds ago','age uses generator signal');
check(model(job).saved==='11 of 15 lessons saved','successful checkpoint count displayed');
check(model(job).title==='Writing lessons','parallel work does not invent a lesson number');
check(model(job).observed==='','historical save time stays unavailable');
check(pct(job)===79,'existing weighted progress retained');
now+=5000;
const polled={id:'job',...jobPatchFromRow(row,job,now)};
check(polled.heartbeatAt===job.heartbeatAt && model(polled).checked==='25 seconds ago','poll does not refresh Last checked');
check(polled.activityObservation.since===job.activityObservation.since,'unchanged poll does not reset no-progress observation');
check(pct(polled)===79,'time alone does not increase percentage');
const beat={...row,heartbeat_at:stamp(now),updated_at:stamp(now)};
job={id:'job',...jobPatchFromRow(beat,polled,now)};
check(model(job).checked==='just now','real heartbeat renews check');
check(job.activityObservation.changedAt===null,'heartbeat does not count as saved work');
now+=5000;
const nextRow={...beat,topics_by_key:{...results,'m/t11':{title:'Next'}},topics_done:12};
const next={id:'job',...jobPatchFromRow(nextRow,job,now)};
check(next.activityObservation.changedAt===now,'new checkpoint has explicitly observed time');
check(model(next).observed==='Latest saved-result change seen just now','observation not mislabelled actual save time');
check(model(next).saved==='12 of 15 lessons saved','new success advances count');
check(pct(next)===83,'real result advances progress');
const visualRow = {...row,stage:'images',brief:{materials_policy:'integrated-visuals-v2'},image_progress:{version:1,planned:4,completed:1,omitted:11,items:{'m/t0':{status:'saved',operationId:'one'}}}};
const visualJob = {id:'job',...jobPatchFromRow(visualRow,null,now)};
check(visualJob.imageProgress===visualRow.image_progress&&visualJob.checkpoint.imageProgress===visualRow.image_progress,'image checkpoint maps to client and resume checkpoint');
check(model(visualJob).title==='Creating instructional images','integrated image stage has a meaningful task');
check(model(visualJob).saved.includes('1 of 4 planned images saved')&&model(visualJob).saved.includes('11 lessons need no image'),'only planned visuals appear in delivered denominator');
check(pct(visualJob)===80&&pct({...visualJob,cloudSeenAt:now+5000})===80,'image stage uses saved results, not clock animation');
const visualNext = {id:'job',...jobPatchFromRow({...visualRow,image_progress:{...visualRow.image_progress,completed:2}},visualJob,now+5000)};
check(visualNext.activityObservation.changedAt===now+5000&&pct(visualNext)===85,'new saved image advances observation and progress');
check(pct({...visualJob,imageProgress:{planned:0,completed:0,omitted:15}})===95,'purposeful zero-image plan finishes visual stage without division by zero');
check(pct({...job,brief:{materials_policy:'integrated-visuals-v2'},topicsDone:15})===75,'new lesson stage leaves truthful room for images');
const failedResult={...job,topicsDone:12,failures:[{topicId:'bad'}],checkpoint:{...job.checkpoint,topicsByKey:{...results,'m/bad':null}}};
check(model(failedResult).saved==='11 of 15 lessons saved','failed attempts/null checkpoint are not saved lessons');
check(!html(failedResult).includes('12 of 15 lessons saved'),'renderer also excludes failures');
check(model({...job,heartbeatAt:now-150_001,cloudSeenAt:now}).state==='stale','fresh browser poll cannot conceal stale worker');
check(model({...job,leaseExpiresAt:now,cloudSeenAt:now}).state==='stale','expired lease is uncertain, not responding');
check(model({...job,cloudSeenAt:now-30_001}).state==='disconnected','connection freshness is separate');
check(model(job,now,false).state==='offline','offline states do not diagnose server failure');
check(model({...job,heartbeatAt:null,cloudSeenAt:now}).state==='waiting','missing heartbeat is unknown');
check(model({...job,heartbeatAt:now+31_000,cloudSeenAt:now}).state==='waiting','future generator clock does not claim health');
check(model({...job,heartbeatAt:now,cloudSeenAt:now+31_000}).state==='disconnected','future browser observation is not trusted');
check(model({...job,serverStatus:'queued',cloudSeenAt:now}).state==='queued','queued does not say AI is working');
const slow={...job,cloudSeenAt:now,heartbeatAt:now,activityObservation:{since:now-300_001,changedAt:null}};
check(model(slow).state==='slow','responsive worker without new results gets a soft delay state');
check(!html(slow).includes('data-retry'),'no new retry or paid actions for slow worker');
for(const status of ['review_curriculum','review_research']) {
  check(model({...slow,status},now,false).state==='review',status+' is intentionally paused, not stalled');
}
for(const status of ['failed','timed_out','partial','interrupted']) {
  check(model({...job,status},now,false).state==='attention',status+' preserves confirmed recovery priority');
}
check(model({...job,status:'cancelling'}).state==='stopping','cancellation is not healthy work');
check(model({...job,status:'completed'})===null && model({...job,status:'cancelled'})===null,'terminal finished states remove panel');
check(model({...job,runner:'local'})===null,'no fabricated cloud health on local legacy job');
check(model({...job,stage:'intake',checkpoint:{}}).saved==='No results saved yet','empty checkpoint honest');
check(model({...job,stage:'research',checkpoint:{brief:{}}}).saved==='Course plan saved','saved curriculum label');
check(model({...job,stage:'research',checkpoint:{researchByModule:{m1:{},m2:null}}}).saved==='1 research module saved','research counts confirmed bundles');
check(model({...job,stage:'assemble'}).title==='Saving your course','assembly shows actual stage');
for(const changed of [{ownerId:'other'},{runId:'other'},{stage:'research'},{serverStatus:'review_research'},{cloudSeenAt:now-91_000}]) {
  const observed=jobPatchFromRow(nextRow,{...next,...changed},now).activityObservation;
  check(observed.changedAt===null && observed.since===now,'observation resets at identity/run/stage/status/connection boundary');
}
const invalid=jobPatchFromRow({...row,heartbeat_at:'not-a-date',lease_expires_at:null},null,now);
check(invalid.heartbeatAt===null && invalid.leaseExpiresAt===null,'invalid server timestamps remain unknown');
const card=document.querySelector('main');card.innerHTML=html({...job,cloudSeenAt:now});
check(card.querySelector('dt').textContent==='Last checked','approved plain label used');
check(!card.textContent.includes('Last worker signal'),'technical label removed');
check(card.querySelector('[data-activity-status]').getAttribute('role')==='status','state has accessible live feedback');
check(card.querySelector('[data-activity-checked]').getAttribute('aria-live')==='off','clock is not announced every second');
check(card.querySelector('[data-activity-observed]').hidden,'unknown save time not shown');
document.getElementById('keep-focus').focus();update(card,{...job,cloudSeenAt:now},now);
check(document.activeElement.id==='keep-focus','clock updates do not steal focus');
navigator.onLine=false;update(card,job);check(card.dataset.state!=='offline' && card.querySelector('[data-generation-activity]').dataset.state==='offline','only scoped panel changes on connectivity loss');
check(card.querySelector('[data-activity-status]').textContent==='Connection lost','offline copy appears');
navigator.onLine=true;update(card,{...next,cloudSeenAt:now});check(!card.querySelector('[data-activity-observed]').hidden,'new result observation becomes visible');
check(card.querySelector('[data-generation-activity]').dataset.state==='responding','reconnect uses actual heartbeat');
jobs.set('job',{...job,startedAt:now-720_000,cloudSeenAt:now});ui.uiTest.setCard(card);ui.uiTest.startElapsedTimer('job');
check(timers.size===1,'one existing timer serves activity, no extra poll');
now+=35_000;for(const timer of timers)timer();
check(card.querySelector('[data-generation-activity]').dataset.state==='disconnected','clock detects lost updates without a new job event');
ui.uiTest.stopElapsedTimer();check(timers.size===0,'activity clock cleans up');
const css=readFileSync(process.env.ACTIVITY_CSS || 'web/styles/home.css','utf8');
check(css.includes('prefers-reduced-motion: reduce') && css.includes('animation: none !important'),'reduced motion supported');
check(css.includes('.generation-activity-facts { grid-template-columns: 1fr;'),'facts stack on mobile');
console.log(JSON.stringify({suite:'generation-activity',assertions,passed:true,providerCalls:0}));
