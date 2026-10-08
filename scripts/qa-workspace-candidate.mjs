// Executes the assembled candidate, not workspace APIs. Full local connected
// browser journey reused with candidate static/API routing and synthetic AI.
import assert from 'node:assert/strict';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { once } from 'node:events';
import { spawn, spawnSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig, createPreviewServer, previewGenerationRoutes } from './dev-setup-server.mjs';
import { verifyCandidate } from './assemble-workspace-candidate.mjs';
import { readBrowserGraph } from './browser-contract.mjs';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';
import { pdfFixture, docxFixture } from './fixtures/source-documents.mjs';

const candidate = resolve(process.argv[2] || 'missing-candidate');
const bundledScope = resolve(candidate,'../scope.json');
const plan = JSON.parse(readFileSync(existsSync(bundledScope) ? bundledScope : new URL('../docs/upgrade/workspace-release-scope-2026-09-18.json',import.meta.url)));
const curriculumRecovery = process.argv.includes('--curriculum-recovery'), nonce = randomUUID();
const cli=process.env.PLAYWRIGHT_CLI; assert.ok(cli,'Set PLAYWRIGHT_CLI');
verifyCandidate(candidate,plan);
let syntax=0;
for(const path of Object.keys(plan.files).filter(p=>/\.m?js$/.test(p))){const checked=spawnSync(process.execPath,['--check',join(candidate,path)],{encoding:'utf8'});assert.equal(checked.status,0,`${path}: ${checked.stderr}`);syntax++;}
const config=await loadPreviewConfig(new URL('../.env.preview.local',import.meta.url));
assert.equal(config.mode,'local');assert.equal(config.url,'http://127.0.0.1:54321');
Object.assign(config,{generation:true,creationImages:false,images:false,publishing:false,moderation:false});
Object.assign(process.env,{SUPABASE_URL:config.url,SUPABASE_ANON_KEY:config.publicKey,SUPABASE_SECRET_KEY:config.secretKey,LEARNABLE_PROVIDER_VAULT_KEY:config.vaultKey,LEARNABLE_SETUP_GENERATION:'1',LEARNABLE_AI_REFINEMENT:'0',LEARNABLE_GPT_IMAGES:'0',LEARNABLE_IMAGE_REQUESTS:'0',LEARNABLE_CREATION_IMAGES:'0',LEARNABLE_SELF_PUBLISH:'0',LEARNABLE_MODERATION:'0'});
const imported=new Map(), load=async path=>{if(!imported.has(path))imported.set(path,await import(pathToFileURL(join(candidate,path))));return imported.get(path);};
// Auth already allowlists localhost:4173. Its IPv6 loopback listener is separate
// from the user's IPv4 127.0.0.1 preview, so redirects reach this actual candidate.
const base='http://localhost:4173',session=curriculumRecovery?'candidate-curriculum-recovery':'workspace-candidate',pending=[],owners=[],calls=[];
let proxy='',server,failures=curriculumRecovery?0:2, curriculumFailures=curriculumRecovery?2:0;
const components=['lessons','practice','checklists','quizzes','flashcards'];
const originalFetch=globalThis.fetch;
globalThis.fetch=async(input,init)=>{
  const url=new URL(typeof input==='string'?input:input instanceof URL?input.href:input.url);
  if(url.origin==='https://api.anthropic.com'&&url.pathname==='/v1/messages'){
    const body=JSON.parse(init.body),name=body.tool_choice?.name||body.tools?.find(t=>t.name==='submit_research_bundle')?.name;calls.push(name);
    let value;
    if(name==='submit_course_brief'){
      value=curriculumFixture();value.id='candidate-photography';value.title='Connected Photography QA';
      if(curriculumFailures>0){curriculumFailures--;value.modules=[];}
      if(curriculumRecovery)assert.ok(JSON.stringify(body.messages).includes('Private workshop notes: compare soft window light from two angles.'),'Candidate retries retain original notes');
    }
    else if(name==='submit_research_bundle')value={module_id:'foundations',key_concepts:['Natural light','Clear composition'],examples:['Window portrait','A single subject'],misconceptions:[],sources:[{title:'Synthetic reference',url:'https://example.com/photography'}],experts:[],images:[]};
    else if(name==='submit_topic'){
      const id=body.messages[0].content.match(/Topic id: ([a-z0-9-]+)/)?.[1];assert.ok(id);
      value=lessonFixture(components,{id,title:`Photography ${id}`});
      if(id==='lesson-2'&&failures>0){failures--;value.sections=value.sections.filter(s=>s.type!=='checklist');}
    }else throw Error('Unexpected synthetic model request');
    return new Response(JSON.stringify({content:[{type:'tool_use',name,input:value}],usage:{input_tokens:10,output_tokens:10}}),{headers:{'Content-Type':'application/json'}});
  }
  assert.ok([config.url,base,proxy].includes(url.origin),'Candidate QA forbids other backend/provider requests');
  return originalFetch(input,init);
};
const admin=createClient(config.url,config.secretKey,{auth:{persistSession:false,autoRefreshToken:false}});
async function command(args){return new Promise((resolve,reject)=>{const child=spawn(cli,['--session',session,...args]);let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);child.on('error',reject);child.on('close',code=>{const result=output.split('### Ran Playwright code')[0];code||output.includes('### Error')?reject(Error(result)):resolve(result);});});}
try{
  for(const path of Object.keys(plan.files).filter(p=>p.startsWith('api/')&&/\.m?js$/.test(p)))await load(path);
  const {readDocument}=await load('api/_lib/document-reader.mjs');
  assert.equal((await readDocument(pdfFixture(['Candidate PDF page one','Candidate PDF page two']),'pdf')).text,'Candidate PDF page one\n\nCandidate PDF page two');
  assert.ok((await readDocument(docxFixture(['Candidate Word text 中文']),'docx')).text.includes('Candidate Word text 中文'));
  assert.equal((await readDocument(Buffer.from('Candidate transcript 🏊'),'txt')).text,'Candidate transcript 🏊');
  console.log(`Candidate: ${Object.keys(plan.files).length} hashes, ${syntax} syntax checks, ${imported.size} API module imports and PDF/DOCX/TXT worker reads passed.`);
  const email=`candidate-${randomUUID()}@example.test`;
  const made=await admin.auth.admin.createUser({email,email_confirm:true});assert.ifError(made.error);owners.push(made.data.user.id);
  const {sealProviderKey}=await load('api/_lib/provider-vault.mjs');
  assert.ifError((await admin.from('provider_connections').insert({owner_id:owners[0],provider:'anthropic',encrypted_key:sealProviderKey('sk-ant-synthetic-candidate-QA',owners[0])})).error);
  const handlers={};
  for(const route of previewGenerationRoutes)handlers[`/api/${route}`]=(await load(`api/${route}.js`)).default;
  handlers['/api/setups/generate']=(await load('api/setups/generate.js')).createSetupGenerationHandler({validate:async()=>{},background:p=>pending.push(p)});
  handlers['/api/gen/review']=(await load('api/gen/review.js')).createReviewHandler({background:p=>pending.push(p)});
  if(curriculumRecovery)handlers['/api/qa/curriculum']=async(req,res)=>{
    if(req.headers['x-qa-key']!==nonce)return res.status(404).json({error:'Missing'});
    if(req.method==='POST'){
      let raw='';for await(const chunk of req)raw+=chunk;
      const action=JSON.parse(raw||'{}').action;assert.ok(['disconnect','reconnect'].includes(action));
      if(action==='disconnect')assert.ifError((await admin.from('provider_connections').delete().eq('owner_id',owners[0]).eq('provider','anthropic')).error);
      else assert.ifError((await admin.from('provider_connections').insert({owner_id:owners[0],provider:'anthropic',encrypted_key:sealProviderKey('sk-ant-synthetic-candidate-QA',owners[0])})).error);
    }
    const jobs=await admin.from('generation_jobs').select('id,status,stage,run_id,brief,user_brief,error,review_history').eq('owner_id',owners[0]);assert.ifError(jobs.error);
    const courses=await admin.from('user_courses').select('id').eq('owner_id',owners[0]);assert.ifError(courses.error);
    return res.status(200).json({jobs:jobs.data,courses:courses.data,calls});
  };
  const {checkSchema}=await load('api/health/cloud.js');
  handlers['/api/health/cloud']=async(_req,res)=>{const schema=await checkSchema();res.status(schema.ok?200:503).json({ok:schema.ok,schema,missing:schema.missing});};
  // Override every preserved browser config path; no old or new app can connect
  // to production when this artifact is served by this QA harness.
  for(const path of Object.keys(plan.files).filter(p=>/^js[^/]*\/config\.js$/.test(p)))handlers['/'+path]=async(_req,res)=>{res.setHeader('Content-Type','text/javascript');res.end(`export const SUPABASE_URL=${JSON.stringify(config.url)}; export const SUPABASE_ANON_KEY=${JSON.stringify(config.publicKey)}; export const CREATION_IMAGES_ENABLED=false; export const SELF_PUBLISH_ENABLED=false; export const MODERATION_ENABLED=false;`);};
  server=createPreviewServer({config,directory:candidate,setupHandler:(await load('api/setups/store.js')).default,extraHandlers:handlers});
  server.listen(4173,'::1');await once(server,'listening');proxy=base;
  await command(['open',base+'/?experience=workspace']);await command(['snapshot']);
  const entry=await command(['eval',`Array.from(document.scripts).some(s=>s.src.includes('/js-${plan.releaseName}/app.js'))`]);
  assert.ok(entry.includes('true'),'localhost must resolve to the candidate listener, not the ordinary IPv4 preview');
  // No main-document interception: both navigation and the real email redirect
  // hit the candidate server. This preserves normal browser network semantics.
  await command(['run-code',`async page=>{
    await page.context().route('**/*',route=>{
      const request=route.request(),url=request.url();
      if(['${base}/','${config.url}/'].some(origin=>url.startsWith(origin)) || request.method()==='GET' && /^https:\\/\\/(?:esm\\.sh|fonts\\.googleapis\\.com|fonts\\.gstatic\\.com|cdn\\.jsdelivr\\.net)\\//.test(url))return route.continue();
      return route.abort('blockedbyclient');
    });
  }`]);
  const graph=readBrowserGraph(),storeQuery=graph.imports.get(resolve(graph.web,'js/store.js'))[0].query;
  const artifactPrefix=plan.releaseName+(curriculumRecovery?'-curriculum-recovery':'-all-partial');
  const script=readFileSync(new URL('./qa-connected-course.browser.js',import.meta.url),'utf8').replaceAll('output/playwright/refinement-',`output/playwright/${plan.releaseName}-refinement-`).replaceAll('output/playwright/curriculum-',`output/playwright/${plan.releaseName}-curriculum-`).replace('__CONNECTED_QA__',JSON.stringify({base,proxy,email,owner:owners[0],partial:!curriculumRecovery,components,artifactPrefix,refinement:!curriculumRecovery,viewportCaptures:true,storeModule:`/js-${plan.releaseName}/store.js?${storeQuery}`,curriculumRecovery,nonce}));
  await command(['run-code',script]);
  await command(['run-code','async page=>{await page.waitForFunction(()=>!!window.__connectedQAReport,null,{timeout:30000});}']);
  const report=await command(['eval','window.__connectedQAReport']);assert.ok(report.includes('"checks"'),'Browser journey must finish');
  const reportPath=new URL(`../output/playwright/${artifactPrefix}-report.txt`,import.meta.url);
  writeFileSync(reportPath,report);
  console.log('Candidate connected journey: '+report.match(/"checks":\s*\d+/)?.[0]+'. Detailed report: '+reportPath.pathname);
  console.log(await command(['run-code',`async page=>{const resources=await page.evaluate(()=>performance.getEntriesByType('resource').map(r=>r.name));if(!resources.some(r=>r.includes('/js-${plan.releaseName}/app.js')))throw Error('Candidate entry not loaded');if(resources.some(r=>/\\/js\\//.test(r)))throw Error('Workspace browser modules leaked into candidate test');return {candidateEntry:true,legacyActiveImports:false};}`]));
  console.log(await command(['run-code',`async page=>{
    const checks=[],check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
    const catalog=await(await page.request.get('${base}/data/courses/catalog-${plan.releaseName}.json')).json();
    check(catalog.courses.length===9,'All nine existing catalog entries remain');
    await page.goto('${base}/?experience=workspace&course=little-swimmer#/foundations/pool-safety-agreement');
    await page.getByRole('heading',{name:'The Pool Safety Agreement',exact:true}).waitFor();
    check(true,'Existing Little Swimmer lesson deep link opens');
    await page.goto('${base}/?experience=workspace&course=agentic-ai-dinner#/dinner-foundations/define-a-useful-request');
    await page.getByRole('heading',{name:'What does “help me order dinner” mean?',exact:true}).waitFor();
    const quiz=page.locator('.drag-match').first();await quiz.waitFor();
    const count=await quiz.locator('[data-side="left"]').count();
    for(let index=0;index<count;index++){
      await quiz.locator('[data-side="left"][data-index="'+index+'"]').click();
      await quiz.locator('[data-side="right"][data-index="'+index+'"]').click();
    }
    await quiz.getByRole('button',{name:'Check Matches'}).click();
    check(await quiz.locator('.match-status').textContent()==='All matches correct.','Existing matching quiz works in new package');
    await page.reload();await page.getByRole('heading',{name:'What does “help me order dinner” mean?',exact:true}).waitFor();
    await page.waitForFunction(()=>document.querySelector('.drag-match .match-status')?.textContent==='All matches correct.');
    check(true,'Bundled quiz answer survives reload');
    for(const width of [390,320]){
      await page.setViewportSize({width,height:900});
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'Bundled lesson fits '+width+'px');
      await page.locator('.drag-match').first().screenshot({path:'output/playwright/${plan.releaseName}-bundled-match-'+width+'.png'});
    }
    return {checks:checks.length,passed:checks};
  }`]));
  await Promise.all(pending);
  const jobs=await admin.from('generation_jobs').select('id,status,saved_course_id').eq('owner_id',owners[0]);assert.ifError(jobs.error);assert.equal(jobs.data.length,1);assert.equal(jobs.data[0].status,'completed');
  const courses=await admin.from('user_courses').select('id,payload').eq('owner_id',owners[0]);assert.ifError(courses.error);assert.equal(courses.data.length,1);assert.equal(courses.data[0].id,jobs.data[0].saved_course_id);assert.deepEqual(courses.data[0].payload.config.components,components);assert.equal(calls.length,curriculumRecovery?8:7);
  if(!curriculumRecovery)assert.ok(courses.data[0].payload.modules[1]['lesson-1'].sections.some(s=>s.type==='checklist'&&s.items[0].label==='The surface is stable, clear, and ready for this comparison.'));
  verifyCandidate(candidate,plan);
  console.log(`Candidate full runner: one completed job/course, ${calls.length} synthetic calls, ${curriculumRecovery?'curriculum recovery verified':'direct refinement saved'}, artifact hashes unchanged. No deploy or paid requests.`);
}catch(error){
  console.log(await command(['snapshot']).catch(()=> 'Snapshot unavailable'));
  console.log(await command(['run-code',"async page=>{await page.screenshot({path:'output/playwright/candidate-failure.png',animations:'disabled'});return {url:page.url().split('#')[0].split('?')[0],alerts:await page.locator('[role=alert]').allTextContents()};}"]).catch(()=> 'Failure capture unavailable'));
  throw error;
}finally{
  await Promise.allSettled(pending);await command(['close']).catch(()=>{});
  if(server){server.closeAllConnections();await new Promise(done=>server.close(done));}
  for(const owner of owners){for(const table of ['generation_jobs','user_courses'])assert.ifError((await admin.from(table).delete().eq('owner_id',owner)).error);assert.ifError((await admin.auth.admin.deleteUser(owner)).error);}
  globalThis.fetch=originalFetch;
  console.log('Removed only this run’s disposable local accounts/jobs/courses. Candidate artifact retained; main preview unchanged.');
}
