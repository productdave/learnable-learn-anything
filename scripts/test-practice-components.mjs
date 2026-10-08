import assert from 'node:assert/strict';
import { richComponentCombinations, curriculumFixture, lessonFixture, practiceFixture, checklistFixture } from './fixtures/component-course.mjs';
import { componentPolicy, retainComponentChoices, SUPPORTED_COMPONENTS } from '../web/js/generator/component-policy.mjs';
import { topicContentSchemaFor, compatibleTopicCheckpoint } from '../web/js/generator/schema.mjs';
import { runIntake } from '../web/js/generator/stages/intake.mjs';
import { runTopic, topicToolFor } from '../web/js/generator/stages/topic.mjs';
import { assembleCourse } from '../web/js/generator/assemble-course.js';
import { setupDraft } from '../web/js/setup-model.js';
import { prepareAccountPayload } from '../web/js/setup-account-model.js';
import { setupJobId, setupGenerationIssues } from '../web/api/_lib/setup-generation.mjs';
import { componentSummaryHTML, componentSetupIssues } from '../web/js/setup-components.js';
import { homeMaterialsHTML } from '../web/js/home.js';

let checks = 0;
const check = (condition, label) => { assert.ok(condition, label); checks++; };
const tone = { systemFragment: 'Teach clearly.', exemplars: [] };
const hashes = new Set(), jobs = new Set();
for (const components of richComponentCombinations) {
  const label = components.join(', '), policy = componentPolicy({ components });
  const draft = setupDraft('Learn practical photography');
  draft.brief.audience = 'A beginner photographer'; draft.components = components;
  const saved = await prepareAccountPayload(draft);
  hashes.add(saved.hash); jobs.add(setupJobId('test-owner', 'test-setup', saved.hash));
  check(JSON.stringify(componentPolicy(saved.payload).components) === JSON.stringify(components), `${label}: canonical account request retains choices`);
  check(!setupGenerationIssues(saved.payload).length, 'all supported combinations pass the server creation gate');
  check(!componentSetupIssues(components).length, 'supported choices have no setup issue');
  const summary = componentSummaryHTML(components), included = summary.split('</p>')[0];
  for (const [value, title] of [['practice', 'Practice activities'], ['checklists', 'Checklists'], ['quizzes', 'Quizzes'], ['flashcards', 'Flashcards']]) {
    check(included.includes(title) === components.includes(value), `${value}: Review/readiness included list matches selection`);
    check(summary.slice(summary.indexOf('</p>')).includes(title) === !components.includes(value), `${value}: omitted list is accurate`);
    check(homeMaterialsHTML(components).includes(title) === components.includes(value), `${value}: workspace summary matches selection`);
  }
  check(homeMaterialsHTML(components, true).includes('not a completion check'), 'partial material summary never certifies unfinished lessons');
  const request = { topic: draft.brief.topic, audience: draft.brief.audience, components: saved.payload.components };
  const brief = await runIntake({ messages: { create: async payload => {
    const prompt = payload.messages[0].content.find(part => part.type === 'text').text;
    check(prompt.includes(`Practice activities ${policy.practice ? 'included:' : 'not included'}`), 'curriculum knows practice selection');
    check(prompt.includes(`checklists ${policy.checklists ? 'included:' : 'not included'}`), 'curriculum knows checklist selection');
    return { content: [{ type: 'tool_use', name: 'submit_course_brief', input: { ...curriculumFixture(), components: ['lessons', 'images'] } }] };
  } } }, request);
  check(JSON.stringify(brief.components) === JSON.stringify(components), 'model cannot add or discard component choices');
  const mod = brief.modules[0], meta = mod.topics[0];
  let calls = 0;
  const content = await runTopic({ messages: { create: async payload => {
    calls++;
    const fields = payload.tools[0].input_schema.properties;
    for (const [type, enabled] of [['practice', policy.practice], ['checklist', policy.checklists], ['quiz', policy.quizzes]]) {
      check(fields.sections.items.oneOf.some(shape => shape.properties.type.const === type) === enabled, `${type}: tool shape matches selection`);
    }
    check(!fields.sections.items.oneOf.some(shape => shape.properties.type.const === 'exercise'), 'unrequested free-text exercises remain excluded');
    check(payload.system.includes(policy.practice ? 'PRACTICE ACTIVITIES — selected:' : 'Practice activities are not selected.'), 'lesson prompt follows practice choice');
    check(payload.system.includes(policy.checklists ? 'CHECKLISTS — selected:' : 'Checklists are not selected.'), 'lesson prompt follows checklist choice');
    if (policy.practice) {
      const shape = fields.sections.items.oneOf.find(shape => shape.properties.type.const === 'practice');
      check(shape.required.includes('context') && shape.required.includes('guidance') && shape.properties.context.const === 'general', 'generated practice requires non-pool context and specific guidance');
      check(!payload.system.includes('Practice activities are not selected.'), 'selected practice has no contradictory omission instruction');
    }
    return { content: [{ type: 'tool_use', name: 'submit_topic', input: lessonFixture(components, meta) }] };
  } } }, brief, mod, meta, null, tone);
  check(calls === 1, `${label}: valid lesson needs one provider response`);
  check(topicContentSchemaFor(brief, meta).safeParse(content).success, 'all selected content validates');
  check(compatibleTopicCheckpoint(brief, { 'foundations/lesson-1': content })['foundations/lesson-1'] === content, 'accepted checkpoint reused');
  const restored = retainComponentChoices({ ...brief, components: ['lessons'] }, request);
  check(JSON.stringify(restored.components) === JSON.stringify(components), 'checkpoint resume restores canonical choices');
  const course = assembleCourse(brief, mod.topics.map(topic => ({ moduleId: mod.id, topicId: topic.id, content: lessonFixture(components, topic) })));
  const reopened = JSON.parse(JSON.stringify(course));
  check(JSON.stringify(reopened.config.components) === JSON.stringify(components), 'serialized course retains selected components');
  check(Object.values(reopened.modules[1]).every(topic => topic.sections.some(s => s.type === 'practice') === policy.practice && topic.sections.some(s => s.type === 'checklist') === policy.checklists), 'saved topics retain exactly selected practice/checklists');
}
check(hashes.size === 16 && jobs.size === 16, 'all 16 combinations have distinct canonical identity');

const selected = ['lessons', 'practice', 'checklists'];
const brief = retainComponentChoices(curriculumFixture(), { components: selected });
const mod = brief.modules[0], meta = mod.topics[0], valid = lessonFixture(selected, meta);
const schema = topicContentSchemaFor(brief, meta);
const mutations = [
  ['missing activity', topic => { topic.sections = topic.sections.filter(s => s.type !== 'practice'); }],
  ['missing checklist', topic => { topic.sections = topic.sections.filter(s => s.type !== 'checklist'); }],
  ['duplicate activity', topic => { topic.sections.push(practiceFixture()); }],
  ['duplicate checklist', topic => { topic.sections.push(checklistFixture()); }],
  ['missing specific guidance', topic => { delete topic.sections.find(s => s.type === 'practice').guidance; }],
  ['blank specific guidance', topic => { topic.sections.find(s => s.type === 'practice').guidance = ' '.repeat(25); }],
  ['implicit pool context', topic => { delete topic.sections.find(s => s.type === 'practice').context; }],
  ['hardcoded pool context', topic => { topic.sections.find(s => s.type === 'practice').context = 'swimming'; }],
  ['no stop rules', topic => { topic.sections.find(s => s.type === 'practice').safetyStops = []; }],
  ['blank stop rules', topic => { topic.sections.find(s => s.type === 'practice').safetyStops = ['      ']; }],
  ['no steps', topic => { topic.sections.find(s => s.type === 'practice').steps = []; }],
  ['no readiness', topic => { topic.sections.find(s => s.type === 'practice').readinessChecks = []; }],
  ['duplicate readiness IDs', topic => { const s = topic.sections.find(s => s.type === 'practice'); s.readinessChecks.push({ ...s.readinessChecks[0] }); }],
  ['too few checks', topic => { topic.sections.find(s => s.type === 'checklist').items.pop(); }],
  ['duplicate item IDs', topic => { const s = topic.sections.find(s => s.type === 'checklist'); s.items[1].id = s.items[0].id; }],
  ['blank checklist label', topic => { topic.sections.find(s => s.type === 'checklist').items[0].label = '      '; }],
  ['oversized checklist label', topic => { topic.sections.find(s => s.type === 'checklist').items[0].label = 'a'.repeat(201); }],
  ['colliding section IDs', topic => { const p = topic.sections.find(s => s.type === 'practice'); topic.sections.find(s => s.type === 'checklist').id = p.id; }]
];
for (const [label, mutate] of mutations) {
  const bad = structuredClone(valid); mutate(bad);
  check(!schema.safeParse(bad).success, `${label}: rejected, never marked successful`);
  check(!Object.keys(compatibleTopicCheckpoint(brief, { 'foundations/lesson-1': bad })).length, `${label}: invalid checkpoint not reused`);
}
for (const components of [['lessons'], ['lessons', 'practice'], ['lessons', 'checklists']]) {
  check(!topicContentSchemaFor({ ...brief, components }, meta).safeParse(valid).success, 'unselected rich components rejected, not silently stripped');
}
assert.throws(() => assembleCourse(brief, [{ moduleId: mod.id, topicId: meta.id, content: lessonFixture(['lessons'], meta) }])); checks++;
const bad = lessonFixture(['lessons', 'practice'], meta);
let calls = 0;
const previousError = console.error; console.error = () => {};
try {
  const content = await runTopic({ messages: { create: async payload => {
    calls++;
    if (calls === 2) check(payload.messages[0].content.includes('previous attempt failed validation'), 'bounded retry requests correction');
    return { content: [{ type: 'tool_use', name: 'submit_topic', input: structuredClone(calls === 1 ? bad : valid) }] };
  } } }, brief, mod, meta, null, tone);
  check(calls === 2 && content.sections.some(s => s.type === 'checklist'), 'missing selected checklist repaired on bounded retry');
  calls = 0;
  await assert.rejects(runTopic({ messages: { create: async () => { calls++; return { content: [{ type: 'tool_use', name: 'submit_topic', input: structuredClone(bad) }] }; } } }, brief, mod, meta, null, tone), error => error.kind === 'schema' && error.attempts.length === 2 && error.message.includes('Checklists are selected')); checks++;
  check(calls === 2, 'repeated missing checklist stops after two attempts with component-specific error');
} finally { console.error = previousError; }
const legacy = componentPolicy({});
const stringified = structuredClone(valid);
for (const section of stringified.sections) {
  for (const key of ['steps', 'equipment', 'regressions', 'progressions', 'safetyStops', 'readinessChecks', 'items']) if (key in section) section[key] = JSON.stringify(section[key]);
}
const repaired = await runTopic({ messages: { create: async () => ({ content: [{ type: 'tool_use', name: 'submit_topic', input: stringified }] }) } }, brief, mod, meta, null, tone);
check(schema.safeParse(repaired).success, 'stringified activity/checklist arrays are repaired before validation without dropping content');
check(!legacy.explicit && !legacy.practice && !legacy.checklists && legacy.quizzes && legacy.flashcards, 'new support does not opt legacy jobs into extra generation');
check(!topicToolFor({}).input_schema.properties.sections.items.oneOf.some(shape => shape.properties.type.const === 'checklist'), 'legacy tool remains unchanged');
check(JSON.stringify(SUPPORTED_COMPONENTS) === JSON.stringify(['lessons', 'practice', 'checklists', 'quizzes', 'flashcards', 'images']), 'component metadata supports the separate guided image stage');
console.log(`Practice/checklist content contracts: ${checks} checks passed across 16 combinations; provider responses synthetic, no paid calls.`);
