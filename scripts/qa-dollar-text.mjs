// Explicitly authorized $1 source-grounded quality trial. No app/runtime edits.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,chmodSync,renameSync,openSync,closeSync,unlinkSync,existsSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {resolve,join} from 'node:path';
import {parseEnv} from 'node:util';
import {runIntake} from '../web/js/generator/stages/intake.mjs';
import {runResearch} from '../web/js/generator/stages/research.mjs';
import {runTopic} from '../web/js/generator/stages/topic.mjs';
import {assembleCourse} from '../web/js/generator/assemble-course.js';
import {getTone} from '../web/js/generator/tones/conversational.mjs';
import {trialBudgetClient,TRIAL_MODEL} from './testing/text-trial-budget.mjs';

const action=process.argv[2],root=resolve('output/paid-tests');
const save=(dir,name,data)=>writeFileSync(join(dir,name),JSON.stringify(data,null,2),{flag:'wx',mode:0o600});
if(action==='prepare'){
  mkdirSync(root,{recursive:true});const dir=mkdtempSync(join(root,'one-dollar-'));chmodSync(dir,0o700);
  const sourceText=`Workshop notes written for this test: Use one ordinary household object on a stable table near a closed window. Make two photographs, changing one deliberate choice, and explain the difference. Do not introduce studio gear, portrait subjects, direct sun viewing, or advanced exposure mathematics. Exactly one module with three short lessons: notice light direction; simplify composition; compare and explain two pictures. Include practice activities, checklists, quizzes and flashcards. No images. Use three quiz variants per lesson. Explain that window light is not always soft and a composition guideline is not an absolute rule.
Verified primary-source summaries, read 19 September 2026:
Apple, Use iPhone camera tools to set up your shot: the camera selects focus/exposure automatically; users can tap the desired focus area and adjust exposure. Grid and Level are optional camera settings. Exact controls vary by phone/model. https://support.apple.com/en-ie/guide/iphone/iph3dc593597/ios
Nikon, 5 Easy Composition Guidelines: rule-of-thirds placement is one composition option; lines, foreground, framing and background can guide attention. These are tools for a chosen effect, not rules that every good photograph must obey. https://www.nikonusa.com/learn-and-explore/c/tips-and-techniques/5-easy-composition-guidelines
Nikon, Using Shadows and Light in Your Photographs: window light can create a contrast between lit areas and shadows; one example turns off overhead lights to emphasize that effect. Do not generalize this into a claim that all window light is diffuse or flattering. https://www.nikonusa.com/learn-and-explore/c/tips-and-techniques/using-shadows-and-light-in-your-photographs
Research restriction for this test: use only these source summaries and the original workshop notes. No external paid search, image calls or extra references. Do not fabricate quotations or claim you visited a page yourself.`;
  const brief={topic:'Photograph one household object using window light and simple composition; compare two shots and explain choices. Exactly one module and three short lessons.',audience:'Beginner using a phone camera',goal:'Take two intentional photos and explain a lighting or framing choice',level:'beginner',depth:'quick',time_budget:'Three short 10-minute lessons',context:'Stable indoor tabletop. No images, no advanced prerequisites. Exactly three lessons.',experience:'hands_on_interactive',components:['lessons','practice','checklists','quizzes','flashcards'],source_text:sourceText,source_urls:[],tone:'conversational'};
  save(dir,'input.json',brief);save(dir,'budget.json',{authorizedMicrousd:1000000,consent:'User: Yes, you can do the test for one dollar, but testing purpose only; not hard-coded in production.',model:TRIAL_MODEL,calls:[],halted:false,createdAt:new Date().toISOString()});
  console.log(JSON.stringify({directory:dir,authorizedUSD:1,testOnly:true}));
}else{
  const dir=resolve(process.argv[3]||'missing');assert.ok(dir.startsWith(root+'/one-dollar-')&&!dir.slice(root.length+1).includes('/'));
  const input=JSON.parse(readFileSync(join(dir,'input.json')));
  if(action==='close-research-rejected'){
    const file=join(dir,'budget.json'),lock=openSync(file+'.lock','wx',0o600);
    try{
      const budget=JSON.parse(readFileSync(file));assert.ok(!budget.closed&&!budget.halted);
      assert.equal(budget.calls.length,2);assert.ok(budget.calls.every(c=>c.status==='settled'));
      assert.ok(!existsSync(join(dir,'course.json')));
      budget.closed=true;budget.closedAt=new Date().toISOString();budget.closedReason='Research rejected at manual quality checkpoint; do not spend on lessons or retry this trial.';
      writeFileSync(file+'.next',JSON.stringify(budget,null,2),{mode:0o600});renameSync(file+'.next',file);
      const artifacts=['input.json','curriculum.json','research.json','response-1.json','response-2.json','budget.json'];
      const sourceFiles=['scripts/qa-dollar-text.mjs','scripts/testing/text-trial-budget.mjs','scripts/testing/text-trial-budget.test.mjs','web/js/generator/stages/intake.mjs','web/js/generator/stages/research.mjs','web/js/generator/stages/topic.mjs','web/js/generator/schema.mjs','web/js/generator/assemble-course.js'];
      const sha=path=>createHash('sha256').update(readFileSync(path)).digest('hex');
      const receipt={at:budget.closedAt,status:'stopped-at-research-quality-review',model:TRIAL_MODEL,authorizedUSD:1,paidCalls:2,estimatedAPICostUSD:budget.calls.reduce((n,c)=>n+c.actualMicrousd,0)/1e6,costBasis:'Returned token usage at standard published rates; not an independently verified invoice',lessonsGenerated:0,realResponses:true,providedSourcesOnly:true,productionChanged:false,artifacts:Object.fromEntries(artifacts.map(name=>[name,sha(join(dir,name))])),sourceHashes:Object.fromEntries(sourceFiles.map(path=>[path,sha(path)])),findings:['Unsupported expert names despite source-only restriction','Example changes viewpoint and relabels unchanged diffused source as hard light','Unqualified claim that proximity to window makes light harsh','Phone manual focus/exposure framed as mandatory rather than optional'],notTested:['lesson generation and selected-material quality','learner UI and persistence','live paid web search','hosted generation','images','physical device']};
      save(dir,'final-receipt.json',receipt);console.log(JSON.stringify(receipt));
    }finally{closeSync(lock);unlinkSync(file+'.lock');}
    process.exit(0);
  }
  const env=parseEnv(readFileSync('.env','utf8'));const key=env.ANTHROPIC_API_KEY||env.CLAUDE_API_KEY;
  assert.ok(key&&!/synthetic|placeholder/i.test(key));
  const client=trialBudgetClient({directory:dir,apiKey:key});
  if(action==='intake'){
    const brief=await runIntake(client,input,{model:TRIAL_MODEL});
    save(dir,'curriculum.json',brief);
    assert.equal(brief.modules.length,1,'Stop and review excess scope');assert.equal(brief.modules[0].topics.length,3);
    console.log(JSON.stringify({status:'curriculum-review',title:brief.title,modules:brief.modules.map(m=>({id:m.id,topics:m.topics.map(t=>({id:t.id,title:t.title}))}))}));
  }else if(action==='research'){
    const brief=JSON.parse(readFileSync(join(dir,'curriculum.json')));
    assert.equal(process.argv[4],'--reviewed-curriculum');
    const bundle=await runResearch(client,brief,brief.modules[0],{model:TRIAL_MODEL});
    save(dir,'research.json',bundle);console.log(JSON.stringify({status:'research-review',module:bundle.module_id,sources:bundle.sources}));
  }else if(action==='lessons'){
    assert.equal(process.argv[4],'--reviewed-research');
    const brief=JSON.parse(readFileSync(join(dir,'curriculum.json'))),research=JSON.parse(readFileSync(join(dir,'research.json'))),mod=brief.modules[0],results=[];
    for(const topic of mod.topics){
      const content=await runTopic(client,brief,mod,topic,research,getTone('conversational'),{model:TRIAL_MODEL});
      save(dir,'lesson-'+topic.id+'.json',content);results.push({moduleId:mod.id,topicId:topic.id,content});
    }
    const course=assembleCourse(brief,results);save(dir,'course.json',course);
    const budget=JSON.parse(readFileSync(join(dir,'budget.json')));const total=budget.calls.reduce((n,c)=>n+(c.actualMicrousd??c.reservedMicrousd),0);
    assert.ok(total<=1000000&&!budget.halted);save(dir,'generation-receipt.json',{at:new Date().toISOString(),paidCalls:budget.calls.length,estimatedAPICostUSD:total/1e6,authorizedUSD:1,lessons:results.length,realResponses:true,providedSourcesOnly:true,productionChanged:false,notTested:['live paid web search','hosted generation','email and account persistence','physical device','images']});
    console.log(JSON.stringify({status:'generated-for-content-review',lessons:results.length,costUSD:total/1e6,directory:dir}));
  }else throw Error('Unknown trial action');
}
