import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { componentCombinations, curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';
import { componentPolicy, retainComponentChoices } from '../web/js/generator/component-policy.mjs';
import { courseBriefSchemaFor, topicContentSchemaFor, compatibleTopicCheckpoint } from '../web/js/generator/schema.mjs';
import { runIntake } from '../web/js/generator/stages/intake.mjs';
import { runTopic, topicToolFor } from '../web/js/generator/stages/topic.mjs';
import { assembleCourse } from '../web/js/generator/assemble-course.js';
import { setupDraft } from '../web/js/setup-model.js';
import { prepareAccountPayload } from '../web/js/setup-account-model.js';
import { setupGenerationIssues, setupToGenerationBrief, setupJobId } from '../web/api/_lib/setup-generation.mjs';
import { componentSummaryHTML, componentSetupIssues } from '../web/js/setup-components.js';
import { courseHasFlashcards, flashcardEmptyCopy } from '../web/js/course-features.js';

let checks=0;
const check=(value,label)=>{assert.ok(value,label);checks++;};
const tone={systemFragment:'Teach clearly.',exemplars:[]};
const hashes=new Set(), jobs=new Set();
// Injected providers only; make the independent server capability available.
process.env.LEARNABLE_CREATION_IMAGES = process.env.LEARNABLE_GPT_IMAGES = process.env.LEARNABLE_IMAGE_REQUESTS = '1';
for (const components of componentCombinations) {
  const draft=setupDraft('A photography course');draft.brief.audience='New photographers';draft.components=components;
  const prepared=await prepareAccountPayload(draft);hashes.add(prepared.hash);
  const row={id:'setup-components',revision:1,content_hash:prepared.hash,payload:prepared.payload};
  jobs.add(setupJobId('owner',row.id,prepared.hash));
  check(!setupGenerationIssues(prepared.payload).length, `${components}: accepted without all-tools gate`);
  const request=await setupToGenerationBrief(row,'owner',{}), policy=componentPolicy(request);
  const intakeClient={messages:{create:async payload=>{
    const quizPlan=payload.tools[0].input_schema.properties.modules.items.properties.topics.items.properties.quiz_plan;
    check(quizPlan.minItems===(policy.quizzes?3:0)&&quizPlan.maxItems===(policy.quizzes?5:0),'intake tool schema follows quiz selection');
    check(policy.quizzes || !payload.system.includes('Every topic must include a quiz_plan: an array of 3-5'),'disabled quizzes have no contradictory planning instruction');
    return {content:[{type:'tool_use',name:'submit_course_brief',input:{...curriculumFixture(),components:['lessons','quizzes','flashcards','practice']}}]};
  }}};
  const brief=await runIntake(intakeClient,request);
  check(JSON.stringify(brief.components)===JSON.stringify(policy.components),'model cannot override saved component choices');
  check(brief.modules[0].topics.every(t=>t.quiz_plan.length===(policy.quizzes?3:0)),'quiz plan only exists when selected');
  check(courseBriefSchemaFor(request).safeParse(brief).success,'selected curriculum schema accepts the plan');
  const mod=brief.modules[0], meta=mod.topics[0];let calls=0;
  const content=await runTopic({messages:{create:async payload=>{
    calls++;
    const fields=payload.tools[0].input_schema.properties;
    check(fields.sections.items.oneOf.some(s=>s.properties.type.const==='quiz')===policy.quizzes,'lesson tool excludes disabled quiz shapes');
    check(fields.flashcards.maxItems===(policy.flashcards?6:0),'lesson tool bounds selected flashcards');
    check(!fields.sections.items.oneOf.some(s=>['practice','exercise'].includes(s.properties.type.const)),'unselected practice is not generated');
    check(policy.quizzes || (!payload.system.includes('Place a quiz immediately after')&&!payload.messages[0].content.includes('QUIZ PLAN for this topic')),'disabled quizzes have no contradictory lesson prompt');
    check(policy.flashcards || !payload.system.includes('Provide 4–6 flashcards'),'disabled flashcards have no contradictory lesson prompt');
    check(!payload.system.includes('interleaved quizzes, optional exercises, and flashcards'),'legacy practice role cannot reintroduce omitted tools');
    return {content:[{type:'tool_use',name:'submit_topic',input:lessonFixture(components,meta)}]};
  }}},brief,mod,meta,null,tone);
  check(calls===1&&content.sections.some(s=>s.type==='quiz')===policy.quizzes&&!!content.flashcards.length===policy.flashcards,'valid selected lesson generated in one call');
  const course=assembleCourse(brief,mod.topics.map(t=>({moduleId:mod.id,topicId:t.id,content:lessonFixture(components,t)})));
  check(JSON.stringify(course.config.components)===JSON.stringify(policy.components),'assembled course retains feature metadata');
  check(Object.values(course.modules[1]).every(t=>t.sections.some(s=>s.type==='quiz')===policy.quizzes&&!!t.flashcards.length===policy.flashcards),'all rendered course topics match selections');
  check(courseHasFlashcards(course.config)===policy.flashcards,'learner flashcard control follows course config');
  const saved={'foundations/lesson-1':content};
  check(compatibleTopicCheckpoint(brief,saved)['foundations/lesson-1']===content,'valid checkpoint reused without another model call');
  const restored=retainComponentChoices({...brief,components:['lessons','quizzes','flashcards']},request);
  check(JSON.stringify(restored.components)===JSON.stringify(policy.components),'resume reapplies canonical request choices');
  check(componentSummaryHTML(components).includes('Included:'),'Review and readiness summary available');
}
check(hashes.size===4&&jobs.size===4,'different choices have distinct canonical hashes and job identities');
check(!componentSetupIssues(['lessons','images']).length,'required images are not an unavailable frontend option');
check(!componentSetupIssues(['lessons']).length,'old setup can be adapted to current required materials');
assert.throws(()=>componentPolicy({components:['lessons','unknown']}),/unsupported/);checks++;
check(componentPolicy({}).quizzes&&componentPolicy({}).flashcards&&!componentPolicy({}).explicit,'old jobs retain all-tools defaults');
check(topicToolFor({}).input_schema.properties.sections.minItems===5,'legacy topic tool stays unchanged');
check(flashcardEmptyCopy({components:['lessons']}).title==='Flashcards aren’t included','no false caught-up message for intentionally omitted flashcards');
check(flashcardEmptyCopy({}).title==='No flashcards available','empty legacy course does not promise nonexistent cards');
await runIntake({messages:{create:async payload=>{
  const prompt=payload.messages[0].content.find(c=>c.type==='text').text;
  check(prompt.includes('Quizzes not included')&&!prompt.includes('with a structured practice checklist'),'explicit choices override legacy hands-on experience preset');
  return {content:[{type:'tool_use',name:'submit_course_brief',input:curriculumFixture()}]};
}}},{components:['lessons'],experience:'hands_on_interactive',topic:'Photography'});
const brief={...curriculumFixture(),components:['lessons']};const mod=brief.modules[0],meta=mod.topics[0];
const bad=lessonFixture(['lessons','quizzes','flashcards']);
check(!topicContentSchemaFor(brief,meta).safeParse(bad).success,'extra quizzes and flashcards fail validation');
check(!topicContentSchemaFor({...brief,components:['lessons','quizzes','flashcards']},meta).safeParse(lessonFixture(['lessons'])).success,'missing selected tools fail validation');
const cached={'foundations/lesson-1':bad};
check(!Object.keys(compatibleTopicCheckpoint(brief,cached)).length&&cached['foundations/lesson-1']===bad,'incompatible checkpoint is not reused or mutated');
assert.throws(()=>assembleCourse(brief,[{moduleId:mod.id,topicId:meta.id,content:bad}]));checks++;
let calls=0;const originalError=console.error;console.error=()=>{};
try {
  const result=await runTopic({messages:{create:async()=>({content:[{type:'tool_use',name:'submit_topic',input:++calls===1?structuredClone(bad):lessonFixture(['lessons'])}]})}},brief,mod,meta,null,tone);
  check(calls===2&&!result.flashcards.length&&!result.sections.some(s=>s.type==='quiz'),'unexpected tools trigger bounded retry, not silent output stripping');
  calls=0;
  await assert.rejects(runTopic({messages:{create:async()=>{calls++;return {content:[{type:'tool_use',name:'submit_topic',input:structuredClone(bad)}]};}}},brief,mod,meta,null,tone),error=>error.kind==='schema'&&error.attempts.length===2);checks++;
  check(calls===2,'repeated violations stop after two attempts');
} finally {console.error=originalError;}
check(readFileSync('web/api/_lib/gen-runner.mjs','utf8').includes('retainComponentChoices(checkpoint.brief, userBrief)'),'runner uses canonical choices on checkpoint resume');
console.log(`Optional components: ${checks} checks passed. Real stages/schemas/assembly with synthetic provider responses; no paid calls.`);
