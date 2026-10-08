// Real local Auth/API/DB/Storage and actual app UI; synthetic image provider only.
import assert from 'node:assert/strict';
import { commitCourseRow } from '../web/api/_lib/course-commit.mjs';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig,createPreviewServer } from './dev-setup-server.mjs';
import { readBrowserGraph } from './browser-contract.mjs';
import { curriculumFixture,lessonFixture } from './fixtures/component-course.mjs';
import { retainComponentChoices } from '../web/js/generator/component-policy.mjs';
import { assembleCourse } from '../web/js/generator/assemble-course.js';
import { syntheticImageResponse } from './fixtures/generated-image.mjs';
import { imageAssetPath,IMAGE_BUCKET } from '../web/api/_lib/image-request-store.mjs';

const cli=process.env.PLAYWRIGHT_CLI,session=process.argv[2]||'course-images';assert.ok(cli);
const config=await loadPreviewConfig(new URL('../.env.preview.local',import.meta.url));assert.equal(config.mode,'local');assert.equal(config.url,'http://127.0.0.1:54321');
Object.assign(process.env,{SUPABASE_URL:config.url,SUPABASE_ANON_KEY:config.publicKey,SUPABASE_SECRET_KEY:config.secretKey,LEARNABLE_PROVIDER_VAULT_KEY:config.vaultKey,LEARNABLE_SETUP_GENERATION:'1',LEARNABLE_GPT_IMAGES:'1',LEARNABLE_IMAGE_REQUESTS:'1'});
const graph=readBrowserGraph(),authModule=`/js/auth.js?${graph.imports.get(resolve(graph.web,'js/auth.js'))[0].query}`;
const admin=createClient(config.url,config.secretKey,{auth:{persistSession:false,autoRefreshToken:false}}),accounts=[],pending=[];
const courseId='image-studio-qa',title='Image Studio Photography QA',secret='sk-proj-synthetic-image-studio-test-123456789';
let server,calls=0,release,delay=false,outcome='ok',metadataCalls=0;
const command=args=>new Promise((resolve,reject)=>{const child=spawn(cli,['--session',session,...args]);let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);child.on('error',reject);child.on('close',code=>{const result=output.split('### Ran Playwright code')[0];code||output.includes('### Error')?reject(new Error(result)):resolve(result);});});
try{
  const components=['lessons','practice','checklists','quizzes','flashcards'],brief=retainComponentChoices(curriculumFixture(),{components});
  for(let i=0;i<2;i++){
    const account={email:`image-ui-${randomUUID()}@example.test`,password:`${randomUUID()}Aa9!`};
    const made=await admin.auth.admin.createUser({...account,email_confirm:true});assert.ok(!made.error);account.owner=made.data.user.id;accounts.push(account);
    const course=assembleCourse(brief,brief.modules.flatMap(mod=>mod.topics.map(topic=>({moduleId:mod.id,topicId:topic.id,content:lessonFixture(components,topic)}))));
    Object.assign(course.config,{id:courseId,title});Object.assign(course,{_brief:brief,_generationJobId:`image-qa-${randomUUID()}`,createdByUserId:account.owner});
    assert.ok(!(await admin.from('user_courses').insert({id:courseId,owner_id:account.owner,payload:course})).error);
  }
  const {createCourseImageHandler}=await import('../web/api/courses/images.js');
  const {createOpenAIConnectionHandler}=await import('../web/api/providers/openai.js');
  const {generateCreatorImage}=await import('../web/api/_lib/openai-image.mjs');
  const {default:refine}=await import('../web/api/courses/refine.js');
  const {default:getCourse}=await import('../web/api/courses/get.js');
  const {default:setupHandler}=await import('../web/api/setups/store.js');
  const connection=createOpenAIConnectionHandler({validate:async key=>{assert.equal(key,secret);metadataCalls++;}});
  const images=createCourseImageHandler({enabled:()=>true,background:work=>pending.push(work),generate:async args=>{
    calls++;const thisOutcome=outcome;
    if(delay)await new Promise(resolve=>{const timer=setTimeout(resolve,45000);release=()=>{clearTimeout(timer);resolve();};});
    return generateCreatorImage(args,{fetcher:async()=>thisOutcome==='quota'?new Response(JSON.stringify({error:{code:'insufficient_quota'}}),{status:429}):new Response(JSON.stringify(syntheticImageResponse()),{headers:{'x-request-id':'req_ui_synthetic'}})});
  }});
  const control=async(req,res)=>{
    if(req.method==='POST'){
      const chunks=[];for await(const c of req)chunks.push(c);const body=JSON.parse(Buffer.concat(chunks).toString());
      if('delay'in body)delay=body.delay;if(body.outcome)outcome=body.outcome;if(body.release){release?.();release=null;}
      if(body.edit){const row=await admin.from('user_courses').select('payload,updated_at').eq('owner_id',accounts[0].owner).eq('id',courseId).single();row.data.payload.modules[1]['lesson-1'].title='Newer saved lesson';assert.ok(await commitCourseRow({supabase:admin,ownerId:accounts[0].owner,courseId,row:row.data,payload:row.data.payload}));}
    }
    const row=await admin.from('user_courses').select('payload').eq('owner_id',accounts[0].owner).eq('id',courseId).single();
    return res.status(200).json({calls,metadataCalls,image:row.data?.payload.modules[1]['lesson-1'].sections.find(s=>s.asset_id),title:row.data?.payload.modules[1]['lesson-1'].title});
  };
  server=createPreviewServer({config,setupHandler,extraHandlers:{'/api/courses/images':images,'/api/providers/openai':connection,'/api/courses/refine':refine,'/api/courses/get':getCourse,'/api/qa/image-control':control}});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  await command(['open',origin+'/?experience=workspace&filter=mine']);await command(['snapshot']);
  const script=readFileSync(new URL('./qa-course-images.browser.js',import.meta.url),'utf8').replace('__IMAGE_UI_QA__',JSON.stringify({origin,accounts,authModule,title,secret}));
  console.log(await command(['run-code',script]));
  assert.ok((await command(['eval','window.__imageUIReport'])).includes('"total"'));
  console.log(`Image studio browser QA complete: ${calls} synthetic images, ${metadataCalls} synthetic metadata checks. No paid calls.`);
}catch(error){console.log(await command(['snapshot']).catch(()=>'Snapshot unavailable'));throw error;}
finally{
  release?.();await Promise.allSettled(pending);await command(['close']).catch(()=>{});if(server)await new Promise(resolve=>server.close(resolve));
  for(const account of accounts){const rows=await admin.from('course_image_requests').select('*').eq('owner_id',account.owner);assert.ok(!rows.error);const paths=rows.data.filter(row=>row.payload.asset).map(imageAssetPath);if(paths.length)assert.ok(!(await admin.storage.from(IMAGE_BUCKET).remove(paths)).error);assert.ok(!(await admin.auth.admin.deleteUser(account.owner)).error);}
  console.log('Removed only disposable image-studio QA accounts, courses, receipts and synthetic images.');
}
