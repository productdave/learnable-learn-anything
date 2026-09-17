import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { parseHTML } from 'linkedom';
const { renderMatchQuiz, initMatchQuiz } = await import(process.env.MATCH_QUIZ_MODULE || '../web/js/components/match-quiz.js');
const sections=[];
function scan(value,file){if(value?.variant==='drag-match') sections.push({section:value,file}); if(Array.isArray(value))value.forEach(v=>scan(v,file));else if(value&&typeof value==='object')Object.values(value).forEach(v=>scan(v,file));}
function walk(dir){for(const entry of readdirSync(dir,{withFileTypes:true})){const file=join(dir,entry.name);if(entry.isDirectory())walk(file);else if(file.endsWith('.json'))scan(JSON.parse(readFileSync(file,'utf8')),file);}}
walk(process.env.MATCH_COURSES_DIR || 'web/data/courses');
let saves=[],current=true;
function mount(section,saved){
 const {document,window}=parseHTML('<html><body>'+renderMatchQuiz(section)+'</body></html>');
 globalThis.document=document;
 globalThis.ResizeObserver=class {observe(){}disconnect(){}};
 globalThis.MutationObserver=class {observe(){}disconnect(){}};
 window.HTMLElement.prototype.getBoundingClientRect=()=>({left:0,top:0,width:100,height:80});
 const root=document.querySelector('.drag-match');
 const cleanup=initMatchQuiz(root,{saved,isCurrent:()=>current,save:value=>saves.push(value)});
 const click=(side,index)=>root.querySelector(`[data-side="${side}"][data-index="${index}"]`).click();
 return {root,click,cleanup};
}
for(const {section,file} of sections){
 const {root,click,cleanup}=mount(section);
 assert.equal(root.querySelectorAll('.match-card').length,section.pairs.length*2,file);
 section.pairs.forEach((p,i)=>{click('left',i);click('right',i);});
 root.querySelector('.quiz-check-btn').click();
 assert.match(root.querySelector('.match-status').textContent,/All matches correct/,file);
 assert.equal(root.querySelectorAll('.match-line').length,section.pairs.length,file);
 cleanup();
}
const section={id:'quotes',question:'Match',pairs:[{left:`A's "term" [x]`,right:'First <literal>'},{left:'Second',right:'Other & value'}]};
saves=[];
let fixture=mount(section);
fixture.root.querySelector('.quiz-check-btn').click();
assert.match(fixture.root.querySelector('.match-status').textContent,/2 still need/);
fixture.click('left',0);fixture.click('right',1);fixture.click('left',1);fixture.click('right',0);
fixture.root.querySelector('.quiz-check-btn').click();
assert.equal(fixture.root.querySelectorAll('.match-feedback.is-incorrect').length,2);
assert.equal(saves.at(-1).checked,true);
const wrong=saves.at(-1);fixture.cleanup();
fixture=mount(section,wrong);
assert.equal(fixture.root.querySelectorAll('.match-feedback.is-incorrect').length,2,'restored feedback');
fixture.click('left',0);fixture.click('right',0);
assert.match(fixture.root.querySelector('.match-count').textContent,/1 of 2/,'displaced answer removed');
assert.equal(saves.at(-1).checked,false,'edits invalidate previous grade');
fixture.click('right',1);fixture.click('left',1);
fixture.root.querySelector('.quiz-check-btn').click();
assert.match(fixture.root.querySelector('.match-status').textContent,/All matches correct/);
const before=saves.length;current=false;fixture.click('left',0);fixture.click('right',1);assert.equal(saves.length,before,'stale course cannot write');
fixture.cleanup();
current=true;fixture=mount(section);
const left=fixture.root.querySelector('[data-side="left"][data-index="0"]');
const right=fixture.root.querySelector('[data-side="right"][data-index="0"]');
const dot=left.querySelector('.match-dot');dot.setPointerCapture=()=>{};
const fire=(type,props={})=>{const event=new document.defaultView.Event(type,{bubbles:true});Object.assign(event,{button:0,pointerId:1,clientX:10,clientY:10,...props});dot.dispatchEvent(event);};
document.elementFromPoint=()=>right;
fire('pointerdown');fire('pointermove',{clientX:50});
assert.equal(fixture.root.querySelectorAll('.is-pending').length,1,'drag preview');
fire('pointerup');assert.equal(saves.at(-1).pairs[section.pairs[0].left],section.pairs[0].right,'pointer drop saved');
// Keyboard click has detail=0, including immediately after the pointer release.
for(const side of ['left','right']){const e=new document.defaultView.Event('click',{bubbles:true});e.detail=0;fixture.root.querySelector(`[data-side="${side}"][data-index="1"]`).dispatchEvent(e);}
assert.equal(fixture.root.querySelectorAll('.match-line').length,2,'keyboard after drag');
fire('pointerdown');fire('pointercancel');assert.equal(fixture.root.querySelectorAll('.is-pending').length,0,'cancel clears preview');
fixture.cleanup();
console.log(`Matching quiz checks passed: ${sections.length} bundled quizzes, special characters, saved answers, retry, displacement, reverse click, and stale-context protection.`);
