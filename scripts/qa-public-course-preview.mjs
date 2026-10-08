// Actual local Auth/API/Postgres. Optional publishing mode uses disposable fixtures only.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawn } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig, createPreviewServer } from './dev-setup-server.mjs';
import { readBrowserGraph } from './browser-contract.mjs';
import { publicPreviewFixture } from './fixtures/public-preview.mjs';
import { seedAcceptedPublicationImage,cleanupPublicationImageFixtures } from './fixtures/publication-image.mjs';

const cli=process.env.PLAYWRIGHT_CLI,session=process.argv[2]||'public-preview';assert.ok(cli);
const management=process.argv[3]==='management',images=process.argv[3]==='images',publishing=management||images||process.argv[3]==='publishing';
const config=await loadPreviewConfig(new URL('../.env.preview.local',import.meta.url));assert.equal(config.mode,'local');assert.equal(config.url,'http://127.0.0.1:54321');
Object.assign(process.env,{SUPABASE_URL:config.url,SUPABASE_ANON_KEY:config.publicKey,SUPABASE_SECRET_KEY:config.secretKey,LEARNABLE_SETUP_GENERATION:'1'});
config.publishing=publishing;process.env.LEARNABLE_SELF_PUBLISH=publishing?'1':'0';
process.env.LEARNABLE_PUBLIC_IMAGES=images?'1':'0';
const graph=readBrowserGraph(),modules={};for(const name of ['auth','store'])modules[name]=`/js/${name}.js?${graph.imports.get(resolve(graph.web,`js/${name}.js`))[0].query}`;
const admin=createClient(config.url,config.secretKey,{auth:{persistSession:false,autoRefreshToken:false}}),accounts=[],course=publicPreviewFixture();
let server;
const command=args=>new Promise((resolve,reject)=>{const child=spawn(cli,['--session',session,...args]);let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);child.on('error',reject);child.on('close',code=>{const text=output.split('### Ran Playwright code')[0];code||output.includes('### Error')?reject(new Error(text)):resolve(text);});});
try {
  for(let i=0;i<2;i++) { const a={email:`preview-${randomUUID()}@example.test`,password:`${randomUUID()}Aa9!`};const made=await admin.auth.admin.createUser({...a,email_confirm:true});assert.ok(!made.error);a.owner=made.data.user.id;accounts.push(a); }
  course.createdByUserId=accounts[0].owner;
  course.config.id+='-'+randomUUID();
  if(publishing)for(const module of Object.values(course.modules))for(const topic of Object.values(module))topic.sections=topic.sections.filter(s=>s.type!=='image');
  assert.ok(!(await admin.from('user_courses').insert({id:course.config.id,owner_id:accounts[0].owner,payload:course})).error);
  if(images)await seedAcceptedPublicationImage(admin,accounts[0].owner,course.config.id);
  if(publishing){const saved=(await admin.from('user_courses').select('payload').eq('id',course.config.id).eq('owner_id',accounts[0].owner).single()).data.payload;const topic=saved.modules[1]['lesson-1'],probe='<img src=x onerror="window.publicationProbe=true">';topic.sections.find(s=>s.variant==='multiple-choice').question='What does this rendering-probe '+probe+' mean?';topic.sections.find(s=>s.variant==='fill-in-blank').acceptable_answers=[probe];topic.flashcards[0].front='A rendering-probe '+probe;assert.ok(!(await admin.from('user_courses').update({payload:saved,updated_at:new Date().toISOString()}).eq('id',course.config.id).eq('owner_id',accounts[0].owner)).error);}
  const before=(await admin.from('user_courses').select('payload,updated_at').eq('id',course.config.id).eq('owner_id',accounts[0].owner).single()).data;
  const {default:previewHandler}=await import('../web/api/courses/public-preview.js');
  const {default:getCourse}=await import('../web/api/courses/get.js');
  const {default:setupHandler}=await import('../web/api/setups/store.js');
  const extraHandlers={'/api/courses/public-preview':previewHandler,'/api/courses/get':getCourse};
  if(publishing)for(const route of ['courses/publish','courses/community','courses/public-image','courses/publication-status'])extraHandlers['/api/'+route]=(await import('../web/api/'+route+'.js')).default;
  server=createPreviewServer({config,setupHandler,extraHandlers});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const origin=`http://127.0.0.1:${server.address().port}`;
  await command(['open',origin+'/?experience=workspace&filter=mine']);await command(['snapshot']);
  const code=readFileSync(new URL(management?'./qa-publication-management.browser.js':publishing?'./qa-self-publishing.browser.js':'./qa-public-course-preview.browser.js',import.meta.url),'utf8').replace('__PUBLIC_PREVIEW_QA__',JSON.stringify({origin,accounts,modules,courseId:course.config.id,images}));
  console.log(await command(['run-code',code]));assert.ok((await command(['eval','window.__publicPreviewReport'])).includes('"total"'));
  const after=(await admin.from('user_courses').select('payload,updated_at').eq('id',course.config.id).eq('owner_id',accounts[0].owner).single()).data;
  assert.deepEqual(after,before,'private account copy and revision unchanged');
  console.log('Actual local ownership/API and unchanged private course verified. No paid generation. '+(publishing?'Only the disposable QA course was published.':'No public writes.'));
} catch(error) { console.log(await command(['snapshot']).catch(()=>''));throw error; }
finally { await command(['close']).catch(()=>{});if(server)await new Promise(resolve=>server.close(resolve));for(const a of accounts){if(images)await cleanupPublicationImageFixtures(admin,a.owner);assert.ok(!(await admin.auth.admin.deleteUser(a.owner)).error);}console.log('Removed only disposable local preview QA accounts, fixture courses and synthetic image objects.'); }
