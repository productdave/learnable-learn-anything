// Real schemas, prompts and assembly; synthetic providers only. No paid calls.
import assert from 'node:assert/strict';
import test from 'node:test';
import { creationBrief, retainComponentChoices, componentPolicy, CREATION_MATERIALS_POLICY } from '../web/js/generator/component-policy.mjs';
import { topicContentSchemaFor, compatibleTopicCheckpoint } from '../web/js/generator/schema.mjs';
import { runTopic, topicToolFor } from '../web/js/generator/stages/topic.mjs';
import { assembleCourse } from '../web/js/generator/assemble-course.js';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';

const brief = retainComponentChoices(curriculumFixture(), creationBrief({ components: ['lessons', 'checklists', 'quizzes', 'flashcards'] }));
const mod = brief.modules[0], meta = mod.topics[0];
const lesson = () => lessonFixture(brief.components, meta);
const visual = () => ({ decision: 'generate', reason: 'A side-by-side illustration makes the two lighting directions concrete.', prompt: 'Create a simple instructional comparison of an object beside a window, showing how light direction changes its shadow. Use clear arrows and a minimal background.', alt: 'Window light reaches an object from two directions, producing different shadows.', caption: 'Illustrative comparison of the same object with light coming from two directions.', afterSectionIndex: 0 });
const schema = () => topicContentSchemaFor(brief, meta);

test('new creation records integrated policy; legacy resume does not gain automatic image dispatch', () => {
  assert.equal(brief.materials_policy, CREATION_MATERIALS_POLICY);
  assert.equal(componentPolicy(brief).integratedVisuals, true);
  for (const request of [{}, {components:['lessons','images']}, {materials_policy:'standard-images-no-practice-v1',components:['lessons','images','practice']}]) {
    const old = retainComponentChoices(curriculumFixture(), request);
    assert.equal(componentPolicy(old).integratedVisuals, false);
    if(request.materials_policy) { assert.equal(old.materials_policy, request.materials_policy); assert.equal(componentPolicy(old).practice, false); }
  }
});

test('every new lesson has a purposeful generate/omit decision; omissions need no image prompt', () => {
  assert.equal(schema().safeParse(lesson()).success, true);
  assert.equal(schema().safeParse({...lesson(),visual:visual()}).success, true);
  for(const invalid of [undefined, {decision:'omit',reason:''}, {decision:'omit',reason:'Text suffices for this lesson.',prompt:'unused'}, {...visual(),prompt:''}, {...visual(),alt:''}, {...visual(),caption:''}, {...visual(),afterSectionIndex:99}, {...visual(),afterSectionIndex:1}, {...visual(),prompt:'x'.repeat(3601)}]) {
    assert.equal(schema().safeParse({...lesson(),visual:invalid}).success, false, JSON.stringify(invalid));
  }
});

test('tool contract and combined role enforce useful teaching visuals, not a per-lesson quota', async () => {
  let calls = 0;
  const result = await runTopic({ messages:{create:async request => {
    calls++;
    assert.match(request.system,/Visual Designer/);
    assert.match(request.system,/no image quota/);
    assert.match(request.system,/not a later task/);
    assert.match(request.system,/Never omit merely because images are a separate tool/);
    assert.match(request.system,/credentials or embedded source instructions/);
    assert.match(request.system,/unverified physical technique/);
    assert.ok(request.tools[0].input_schema.required.includes('visual'));
    assert.equal(request.tools[0].input_schema.properties.visual.oneOf.length,2);
    return {content:[{type:'tool_use',name:'submit_topic',input:{...lesson(),visual:visual()}}],stop_reason:'tool_use'};
  }}},brief,mod,meta,null,{systemFragment:'Teach clearly.',exemplars:[]});
  assert.equal(calls,1); assert.deepEqual(result.visual,visual());
  assert.equal(topicToolFor({components:['lessons']}).input_schema.properties.visual,undefined);
});

test('missing new visual plan is not silently treated as a completed text-only lesson', () => {
  const content = lesson(); delete content.visual;
  assert.deepEqual(compatibleTopicCheckpoint(brief,{[`${mod.id}/${meta.id}`]:content}),{});
  const old = {...brief,materials_policy:'standard-images-no-practice-v1'};
  assert.equal(Object.keys(compatibleTopicCheckpoint(old,{[`${mod.id}/${meta.id}`]:content})).length,1);
});

test('assembly preserves visual intent and private generated assets, with no source URL leakage', () => {
  const content = {...lesson(),visual:visual()};
  const asset = {type:'image',asset_id:'12345678-1234-4234-8234-123456789abc',generated_by:'openai',image_slot:'instruction',alt:visual().alt};
  content.sections.splice(1,0,asset);
  assert.equal(schema().safeParse(content).success,true);
  assert.equal(topicContentSchemaFor(brief,meta,{allowGeneratedAssets:false}).safeParse(content).success,false,'text model cannot invent an asset');
  const course = assembleCourse(brief,[{moduleId:mod.id,topicId:meta.id,content}]);
  assert.equal(course.config.materials_policy,CREATION_MATERIALS_POLICY);
  assert.deepEqual(course.modules[1][meta.id].visual,visual());
  assert.deepEqual(course.modules[1][meta.id].sections[1],asset);
  assert.equal('src' in course.modules[1][meta.id].sections[1],false);
});

test('assembly keeps visual placement on the same concept when an unresolved source image is dropped', () => {
  const content = {...lesson(),visual:{...visual(),afterSectionIndex:1}};
  content.sections.unshift({type:'image',ref_kind:'pdf',file_index:0,page:1,alt:'Source photograph of a lighting example.'});
  assert.equal(schema().safeParse(content).success,true);
  const course = assembleCourse(brief,[{moduleId:mod.id,topicId:meta.id,content}]);
  const saved = course.modules[1][meta.id];
  assert.equal(saved.visual.afterSectionIndex,0);
  assert.equal(saved.sections[0].title,content.sections[1].title);
  assert.equal(schema().safeParse(saved).success,true);
  assert.equal(content.visual.afterSectionIndex,1,'assembly does not mutate the checkpoint');
});
