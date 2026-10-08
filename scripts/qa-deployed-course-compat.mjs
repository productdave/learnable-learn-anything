// Actual recovered course writer + current editor. Disposable local Auth/DB only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { once } from 'node:events';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig, createPreviewServer } from './dev-setup-server.mjs';
import { readTree, digest } from './plan-workspace-release.mjs';
import { readBrowserGraph } from './browser-contract.mjs';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';
import { assembleCourse } from '../web/js/generator/assemble-course.js';

const cli=process.env.PLAYWRIGHT_CLI;assert.ok(cli,'Set PLAYWRIGHT_CLI');
const baselineRoot=process.argv[2];assert.ok(baselineRoot,'Pass recovered production release directory');
const baseline=JSON.parse(readFileSync(new URL('../docs/upgrade/production-baseline-2026-09-17.json',import.meta.url)));
const files=readTree(baselineRoot);assert.deepEqual([...files.keys()].sort(),Object.keys(baseline.files).sort());
for(const[path,sha1]of Object.entries(baseline.files))assert.equal(digest(files.get(path),'sha1'),sha1,path);
const config=await loadPreviewConfig(new URL('../.env.preview.local',import.meta.url));
assert.equal(config.mode,'local');assert.equal(config.url,'http://127.0.0.1:54321');
Object.assign(config,{creationImages:false,images:false,generation:false,publishing:false,moderation:false});
Object.assign(process.env,{SUPABASE_URL:config.url,SUPABASE_ANON_KEY:config.publicKey,SUPABASE_SECRET_KEY:config.secretKey});
const {createRefinementHandler}=await import('../web/api/courses/refine.js');
const {default:courseGet}=await import('../web/api/courses/get.js');
const {saveGeneratedCourse}=await import('../web/api/_lib/course-save.mjs');
const scenario=process.argv.includes('--mirror')?'mirror':process.argv.includes('--new-run')?'new-run':'refinement';
const admin=createClient(config.url,config.secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
const account={email:`course-compat-${randomUUID()}@example.test`,password:`${randomUUID()}Aa9!`};
const servers=[],session='deployed-course-compat',courseId='qa-deployed-course-compat';
const components=['lessons','practice','checklists','quizzes','flashcards'];
const brief=curriculumFixture();brief.id=courseId;brief.components=components;
const course=assembleCourse(brief,brief.modules.flatMap(mod=>mod.topics.map(topic=>({moduleId:mod.id,topicId:topic.id,content:lessonFixture(components,topic)}))));
course.config.components=components;
const graph=readBrowserGraph(),modules={};
for(const name of ['auth','course-sync','user-courses'])modules[name]=`/js/${name}.js?${graph.imports.get(resolve(graph.web,`js/${name}.js`))[0].query}`;
const legacyModules=Object.fromEntries(['auth','course-sync','user-courses'].map(name=>[name,`/js-matching-release/${name}.js?v=dinner-release-2`]));
async function command(args){return new Promise((resolve,reject)=>{const child=spawn(cli,['--session',session,...args]);let output='';child.stdout.on('data',part=>output+=part);child.stderr.on('data',part=>output+=part);child.on('error',reject);child.on('close',code=>{const result=output.split('### Ran Playwright code')[0];code||output.includes('### Error')?reject(Error(result)):resolve(result);});});}
try{
  const made=await admin.auth.admin.createUser({...account,email_confirm:true});assert.ifError(made.error);account.owner=made.data.user.id;
  const timestamp=Date.now()-10000;
  Object.assign(course,{createdByUserId:account.owner,createdBy:account.email,createdAt:timestamp,updatedAt:timestamp,_generationJobId:`job-${randomUUID()}`,_generationRunId:randomUUID()});
  assert.ifError((await admin.from('user_courses').insert({id:courseId,owner_id:account.owner,payload:course,updated_at:new Date(timestamp).toISOString()})).error);
  assert.ifError((await admin.from('generation_jobs').insert({id:course._generationJobId,owner_id:account.owner,status:'completed',stage:'done',completed_at:new Date().toISOString(),run_id:course._generationRunId,saved_course_id:courseId})).error);
  const localConfig=async(_req,res)=>{res.setHeader('Content-Type','text/javascript');res.end(`export const SUPABASE_URL=${JSON.stringify(config.url)};export const SUPABASE_ANON_KEY=${JSON.stringify(config.publicKey)};`);};
  const legacy=createPreviewServer({config,directory:resolve(baselineRoot),extraHandlers:{'/js-matching-release/config.js':localConfig}});
  const modern=createPreviewServer({config,extraHandlers:{
    '/api/courses/refine':createRefinementHandler({enabled:()=>true}),'/api/courses/get':courseGet,
    // Test-only loopback handler; executes the real saved-course writer, not a
    // substitute SQL update. It can only touch this disposable owner/job.
    '/__qa/new-run':async(_req,res)=>{
      const runId=randomUUID();
      assert.ifError((await admin.from('generation_jobs').update({status:'running',completed_at:null,run_id:runId}).eq('owner_id',account.owner).eq('id',course._generationJobId)).error);
      const next=structuredClone(course);next.modules[1]['lesson-1'].title='Newer generated lesson';
      const saved=await saveGeneratedCourse({supabase:admin,ownerId:account.owner,jobId:course._generationJobId,runId,baseCourseId:courseId,course:next,brief,researchByModule:{},ownerEmail:account.email});
      assert.ifError((await admin.from('generation_jobs').update({status:'completed',completed_at:new Date().toISOString()}).eq('owner_id',account.owner).eq('id',course._generationJobId)).error);
      res.status(200).json({courseId:saved.courseId,runId});
    }
  }});
  for(const server of[legacy,modern]){servers.push(server);server.listen(0,'127.0.0.1');await once(server,'listening');}
  const urls={legacy:`http://127.0.0.1:${legacy.address().port}`,modern:`http://127.0.0.1:${modern.address().port}`};
  console.log(`Verified ${files.size} production sources; real old course sync and current editor; no providers.`);
  await command(['open',urls.modern+'/?experience=workspace']);await command(['snapshot']);
  const code=readFileSync(new URL('./qa-deployed-course-compat.browser.js',import.meta.url),'utf8').replace('__COURSE_COMPAT_QA__',JSON.stringify({urls,account,modules,legacyModules,courseId,scenario,backend:config.url}));
  console.log(await command(['run-code',code]));
  await command(['run-code','async page=>{await page.waitForFunction(()=>!!window.__courseCompatReport,null,{timeout:30000});}']);
  const report=await command(['eval','window.__courseCompatReport']);assert.ok(report.includes('"checks"'));console.log(report);
}catch(error){
  console.log(await command(['snapshot']).catch(()=> 'Snapshot unavailable'));
  throw error;
}finally{
  await command(['close']).catch(()=>{});
  for(const server of servers){server.closeAllConnections();await new Promise(done=>server.close(done));}
  if(account.owner){
    assert.ifError((await admin.from('user_courses').delete().eq('owner_id',account.owner)).error);
    assert.ifError((await admin.from('generation_jobs').delete().eq('owner_id',account.owner)).error);
    assert.ifError((await admin.auth.admin.deleteUser(account.owner)).error);
  }
  console.log('Removed only the disposable course/account fixtures; ordinary preview and production unchanged.');
}
