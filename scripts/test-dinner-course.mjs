import assert from 'node:assert/strict';
import {readFile,access} from 'node:fs/promises';
import {TopicContentSchema} from '../web/js/generator/schema.mjs';
const root=new URL('../web/data/courses/agentic-ai-dinner/',import.meta.url);
const curriculum=JSON.parse(await readFile(new URL('curriculum.json',root)));
const catalog=JSON.parse(await readFile(new URL('../index.json',root)));
assert.equal(curriculum.modules.length,6);assert.equal(catalog.courses.find(c=>c.id==='agentic-ai-dinner').topics,24);
const ids=new Set();let topicCount=0,quizCount=0,cardCount=0,firstPractice;
for(const mod of curriculum.modules){
 const topics=JSON.parse(await readFile(new URL(`modules/module-${mod.number}.json`,root)));
 assert.deepEqual(Object.keys(topics),mod.topics.map(t=>t.id));
 for(const meta of mod.topics){
  const t=topics[meta.id];TopicContentSchema.parse(t);assert.equal(t.moduleId,mod.id);
  const quizzes=t.sections.filter(s=>s.type==='quiz');assert.deepEqual(quizzes.map(q=>q.variant),meta.quiz_plan);
  assert.equal(new Set(meta.quiz_plan).size,3);assert.equal(t.flashcards.length,5);
  assert(t.sections.some(s=>s.type==='exercise'));const practice=t.sections.find(s=>s.type==='practice');assert.equal(practice.context,'learning');firstPractice ||= practice;
  for(const s of t.sections){
   if(s.id){assert(!ids.has(s.id),`Duplicate ${s.id}`);ids.add(s.id);}
   if(s.type==='image')await access(new URL('../'+s.src.replace('data/courses/',''),root));
   if(s.type==='quiz'&&s.variant==='multiple-choice')assert(s.options.some(o=>o.id===s.correct));
  }
  topicCount++;quizCount+=quizzes.length;cardCount+=t.flashcards.length;
 }
}
assert.equal(topicCount,24);assert.equal(quizCount,72);assert.equal(cardCount,120);
globalThis.localStorage={getItem(){return null},setItem(){}};
const {renderPractice}=await import('../web/js/components/practice.js');
assert(renderPractice(firstPractice,{courseId:'agentic-ai-dinner'}).includes('Guided practice'));
assert(renderPractice({...firstPractice,context:undefined},{courseId:'little-swimmer'}).includes("Stay within arm's reach."));
console.log('Course checks passed: 6 modules, 24 topics, 72 quizzes, 120 flashcards, linked assets, unique IDs, and practice compatibility.');
