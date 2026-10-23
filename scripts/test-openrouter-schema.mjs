import test from 'node:test';
import assert from 'node:assert/strict';
import { claudeOutputSchema } from '../web/api/_lib/openrouter-schema.mjs';
import { runIntake } from '../web/js/generator/stages/intake.mjs';
import { runResearch } from '../web/js/generator/stages/research.mjs';
import { courseVisualReviewTool, lessonVisualDesignTool } from '../web/js/generator/stages/visual-design.mjs';
function compatible(s) {
 for (const k of ['oneOf','minimum','maximum','minLength','maxLength','maxItems','pattern']) assert.equal(s[k],undefined);
 if (s.type==='object'||s.properties) assert.equal(s.additionalProperties,false);
 if(s.minItems!==undefined) assert([0,1].includes(s.minItems));
 for(const child of Object.values(s.properties||{})) compatible(child);
 for(const child of [...(s.anyOf||[]),...(s.allOf||[])]) compatible(child);
 if(s.items)compatible(s.items);
}
test('moves unsupported constraints into descriptions without mutating the app contract',()=>{
 const source={type:'object',properties:{count:{type:'integer',minimum:2,maximum:12},names:{type:'array',minItems:3,maxItems:6,items:{type:'string',maxLength:20}},decision:{oneOf:[{const:'yes'},{const:'no'}]}}};
 const frozen=structuredClone(source),out=claudeOutputSchema(source);compatible(out);assert.deepEqual(source,frozen);
 assert.match(out.properties.count.description,/minimum: 2/);assert.match(out.properties.names.description,/minItems: 3/);assert(out.properties.decision.anyOf);
});
for(const tool of [courseVisualReviewTool,lessonVisualDesignTool])test('actual frontier Designer schema is transport-compatible: '+tool.name,()=>{const out=claudeOutputSchema(tool.input_schema);compatible(out);assert.deepEqual(out.required,tool.input_schema.required);});
for(const stage of ['curriculum','research'])test('actual '+stage+' schema converts without removing source or lesson fields',async()=>{
 let captured;
 const client={messages:{async create(opts){captured=opts.tools.find(t=>t.input_schema).input_schema;throw Error('capture');}}};
 await assert.rejects(stage==='curriculum'?runIntake(client,{topic:'Photography',components:['lessons','quizzes','flashcards']}):runResearch(client,{title:'Photography'},{id:'m',topics:[{title:'Light'}]}),/capture/);
 const out=claudeOutputSchema(captured);compatible(out);assert.deepEqual(Object.keys(out.properties),Object.keys(captured.properties));
});
for(const source of [{type:'object',additionalProperties:{type:'string'}},{not:{type:'string'}},{$ref:'https://example.test/schema'}])test('unsupported arbitrary schema fails before dispatch',()=>assert.throws(()=>claudeOutputSchema(source),{code:'unsupported'}));
