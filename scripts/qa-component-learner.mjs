// CLI wrapper for deterministic learner QA. Requires a Playwright CLI session
// that is isolated from the user's browser. It creates no account or AI job.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { curriculumFixture, lessonFixture, componentCombinations } from './fixtures/component-course.mjs';
import { retainComponentChoices } from '../web/js/generator/component-policy.mjs';
import { assembleCourse } from '../web/js/generator/assemble-course.js';
const fixtures={},runId=randomUUID();
for(const [index,components] of [...componentCombinations,null].entries()) {
  const id=`qa-components-${index}`, brief=components?retainComponentChoices(curriculumFixture(),{components}):curriculumFixture();brief.id=id;
  for(const mod of brief.modules)for(const topic of mod.topics)topic.title=`${id} · ${topic.title}`;
  const course=assembleCourse(brief,brief.modules.flatMap(m=>m.topics.map(t=>({moduleId:m.id,topicId:t.id,content:lessonFixture(components||undefined,t)}))));
  for(const topics of Object.values(course.modules))for(const topic of Object.values(topics))for(const section of topic.sections)if(section.type==='quiz')section.id=`${runId}-${section.id}`;
  course.config.documentTitle=`${id} | Learnable`;fixtures[id]=course;
}
const cli=process.env.PLAYWRIGHT_CLI;
if(!cli)throw new Error('Set PLAYWRIGHT_CLI to the installed Playwright skill wrapper.');
const script=readFileSync(new URL('./qa-component-learner.browser.js',import.meta.url),'utf8').replace('__COMPONENT_COURSE_FIXTURES__',JSON.stringify(fixtures));
const result=spawnSync(cli,[`-s=${process.argv[2]||'components-learner-final'}`,'run-code',script],{encoding:'utf8'});
console.log(result.stdout.split('### Ran Playwright code')[0]);console.error(result.stderr);
process.exitCode=result.status||(!result.stdout.includes('### Result')||result.stdout.includes('### Error')?1:0);
