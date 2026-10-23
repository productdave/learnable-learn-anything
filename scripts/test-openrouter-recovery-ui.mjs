// Exercise the actual recovery renderer; surrounding page services are inert.
import test from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {readFileSync} from 'node:fs';
import {parseHTML} from 'linkedom';
const source=readFileSync(process.env.INTAKE_SOURCE || new URL('../web/js/intake.js',import.meta.url),'utf8');
const begin=source.indexOf('function progressHTML(job) {'),end=source.indexOf('\nfunction hasVisualDesignerPass(',begin);
assert(begin>=0&&end>begin);
for(const managed of [false,true])for(const status of ['failed','partial','interrupted','timed_out'])test(`${managed?'managed':'legacy'} image ${status} keeps the correct recovery controls`,()=>{
 const context=vm.createContext({config:{MANAGED_COURSE_GENERATION:managed},inlineCard:true,escape:String,briefTitle:v=>v,
  hasVisualDesignerPass:()=>true,hasCloudCheckpoint:()=>true,needsSourceReattach:()=>false,needsApiKey:()=>false,pendingRestart:()=>false,
  computeProgressPct:()=>0,COURSE_AGENT_SEQUENCE:[],generationActivityHTML:()=>'',stageHTML:()=>'',outlineHTML:()=>''});
 vm.runInContext(source.slice(begin,end)+'\nthis.render=progressHTML;',context);
 const{document}=parseHTML(context.render({status,stage:'images',runner:'cloud',title:'Saved course',message:'Saved draft retained',topicsDone:4,topicsTotal:4}));
 assert.equal(!!document.querySelector('[data-image-reconnect]'),!managed);
 assert.equal(!!document.querySelector('input[type="password"]'),!managed);
 assert.match(document.querySelector('[data-resume]').textContent,/Resume course creation/);
 assert(document.querySelector('[data-restart]'));assert(document.querySelector('[data-delete]'));
});
