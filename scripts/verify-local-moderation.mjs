// All mutations are isolated disposable local fixtures, never real user publications.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {execFileSync,spawn} from 'node:child_process';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {readBrowserGraph} from './browser-contract.mjs';
import {createClient} from '@supabase/supabase-js';
import {loadPreviewConfig,createPreviewServer} from './dev-setup-server.mjs';
import {publicPreviewFixture} from './fixtures/public-preview.mjs';
import {seedAcceptedPublicationImage,cleanupPublicationImageFixtures} from './fixtures/publication-image.mjs';
const config=await loadPreviewConfig('.env.preview.local');assert.equal(config.mode,'local');assert.equal(config.url,'http://127.0.0.1:54321');
config.publishing=true;config.moderation=true;
Object.assign(process.env,{SUPABASE_URL:config.url,SUPABASE_ANON_KEY:config.publicKey,SUPABASE_SECRET_KEY:config.secretKey,LEARNABLE_SELF_PUBLISH:'1',LEARNABLE_MODERATION:'1',LEARNABLE_PUBLIC_IMAGES:'1',LEARNABLE_SETUP_GENERATION:'1'});
const db=createClient(config.url,config.secretKey,{auth:{persistSession:false,autoRefreshToken:false}}),accounts=[];let server,checks=0,imagePaths=[];
const check=(v,label)=>{assert.ok(v,label);checks++;};
const cli=process.env.PLAYWRIGHT_CLI,session='moderation-qa-'+randomUUID().slice(0,8);
const command=args=>new Promise((resolve,reject)=>{const child=spawn(cli,['--session',session,...args]);let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);child.on('error',reject);child.on('close',code=>{const text=output.split('### Ran Playwright code')[0];code||output.includes('### Error')?reject(new Error(text)):resolve(text);});});
try{
 for(let i=0;i<3;i++){const a={email:`moderation-${randomUUID()}@example.test`,password:randomUUID()+'Aa9!'};const made=await db.auth.admin.createUser({...a,email_confirm:true});assert.ok(!made.error);a.id=made.data.user.id;accounts.push(a);a.client=createClient(config.url,config.publicKey,{auth:{persistSession:false,autoRefreshToken:false}});const login=await a.client.auth.signInWithPassword(a);assert.ok(!login.error);a.token=login.data.session.access_token;}
 const [creator,reader,moderator]=accounts;
 const course=publicPreviewFixture();course.config.id='moderation-qa-'+randomUUID();course.createdByUserId=creator.id;
 for(const mod of Object.values(course.modules))for(const topic of Object.values(mod))topic.sections=topic.sections.filter(s=>s.type!=='image');
 assert.ok(!(await db.from('user_courses').insert({id:course.config.id,owner_id:creator.id,payload:course})).error);
 await seedAcceptedPublicationImage(db,creator.id,course.config.id);
 const original=(await db.from('user_courses').select('payload,updated_at').eq('id',course.config.id).single()).data;
 const handlers={};for(const name of ['publish','community','publication-status','public-image','moderation'])handlers['/api/courses/'+name]=(await import('../web/api/courses/'+name+'.js')).default;
 server=createPreviewServer({config,extraHandlers:handlers});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const call=async(path,account,body)=>{const response=await fetch(origin+path,{method:body?'POST':'GET',headers:{...(account?{Authorization:'Bearer '+account.token}:{}),...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});return{status:response.status,body:response.headers.get('content-type')?.includes('application/json')?await response.json():await response.arrayBuffer()};};
 const manage='/api/courses/moderation';
 check((await call(manage)).status===401,'guest cannot read reports');check((await call(manage,creator)).status===403,'creator is not implicitly a moderator');
 check((await call(manage+'?access=1',moderator)).status===403,'no moderator until explicit membership');
 assert.ok(!(await db.from('course_moderators').insert({user_id:moderator.id})).error);
 check((await call(manage+'?access=1',moderator)).body.allowed,'assigned moderator access');
 check((await reader.client.from('course_moderators').insert({user_id:reader.id})).error,'browser cannot self-assign membership');
 for(const table of ['course_moderators','course_moderation_audit','course_publication_reports'])check((await moderator.client.from(table).select('*')).error,'even assigned browser cannot directly read '+table);
 check((await reader.client.rpc('decide_course_report',{})).error,'browser cannot call service-only decision RPC');
 const publishPath='/api/courses/publish?courseId='+course.config.id;
 const state=(await call(publishPath,creator)).body;
 const publish={courseId:course.config.id,action:'publish',version:0,reviewToken:state.reviewToken,authorName:'Moderation QA Author',confirmReviewed:true,confirmRights:true,confirmImages:true,operationId:randomUUID()};
 const first=await call(publishPath,creator,publish);assert.equal(first.status,200);const publicId=first.body.publication.id;
 const publicPath='/api/courses/community?courseId='+publicId,learner=(await call(publicPath)).body.course;
 check(learner.config.communityVersion===1,'reader receives exact public version');const sharedImage=Object.values(learner.modules[1]).flatMap(t=>t.sections).find(s=>s.type==='image');imagePaths.push(new URL(sharedImage.src,origin).searchParams.get('imageId')+'.png');
 const report={courseId:publicId,version:1,reason:'unsafe',detail:'Review the synthetic safety statement in lesson one.'};
 check((await call('/api/courses/community',reader,{...report,version:99})).status===409,'stale report does not capture wrong evidence');
 check((await call('/api/courses/community',reader,report)).body.received,'report submitted');await call('/api/courses/community',reader,report);
 const rows=await db.from('course_publication_reports').select('*').eq('publication_id',publicId.slice(7));assert.ok(!rows.error);check(rows.data.length===1,'repeat report once per reader/version');const caseId=rows.data[0].id;
 check(rows.data[0].reported_version===1&&!JSON.stringify(rows.data[0].evidence).includes('PRIVATE-'),'captured public-only evidence');
 const detailPath=manage+'?reportId='+caseId;let detail=(await call(detailPath,moderator)).body;
 check(detail.report.evidence.title===course.config.title&&!JSON.stringify(detail).includes(reader.id)&&!JSON.stringify(detail).includes(creator.id),'review gets public evidence without private owner/reporter identity');
 check((await call(detailPath+'&imageId='+imagePaths[0].slice(0,-4),reader)).status===403,'ordinary reporter cannot read protected evidence image');
 const beforeUpdate=structuredClone(detail.report.evidence);
 const updated=await call(publishPath,creator,{...publish,version:1,operationId:randomUUID(),authorName:'Revised QA Author'});assert.equal(updated.status,200);
 const latestImage=Object.values((await call(publicPath)).body.course.modules[1]).flatMap(t=>t.sections).find(s=>s.type==='image');imagePaths.push(new URL(latestImage.src,origin).searchParams.get('imageId')+'.png');
 detail=(await call(detailPath,moderator)).body;assert.deepEqual(detail.report.evidence,beforeUpdate);check(detail.publication.version===2&&detail.report.reported_version===1,'updated public version does not rewrite captured evidence');
 check((await call(detailPath+'&imageId='+imagePaths[0].slice(0,-4),moderator)).status===200,'moderator can review old evidence image after public replacement');
 check((await call(sharedImage.src)).status===404,'old image no longer public');
 const remove={reportId:caseId,operationId:randomUUID(),action:'remove',note:'Synthetic review: restrict this test publication.',revision:1,version:2,confirm:true};
 check((await call(manage,reader,remove)).status===403,'reader cannot remove a course');
 check((await call(manage,moderator,{...remove,version:1})).status===409,'stale decision cannot remove updated publication');
 const decisions=await Promise.all([call(manage,moderator,remove),call(manage,moderator,remove)]);
 check(decisions.every(d=>d.body.applied)&&decisions.some(d=>d.body.replayed),'concurrent/lost-response decision safely replayed');
 check((await db.from('course_moderation_audit').select('*').eq('operation_id',remove.operationId)).data.length===1,'one immutable audit decision');
 check((await db.from('course_moderation_audit').update({note:'forged update'}).eq('operation_id',remove.operationId)).error,'service client cannot rewrite audit');
 check((await call(publicPath)).status===404&&(await call(latestImage.src)).status===404,'removal revokes public course and images');
 check(!(await call('/api/courses/community?q=Publishing+Preview+Photography+QA')).body.courses.some(c=>c.id===publicId),'removal clears listing');
 const removed=(await call(publishPath,creator)).body;
 check(removed.publication.moderationRemoved&&removed.blockers.some(b=>b.code==='moderation'),'creator sees restriction without report details');
 const status=(await call('/api/courses/publication-status?courseIds='+course.config.id,creator)).body.courses[0];check(status.state==='restricted','owner card distinguishes restriction from ordinary unpublish');
 check((await call(publishPath,creator,{...publish,version:removed.publication.version,operationId:randomUUID()})).status===409,'creator republish blocked');
 const forbidden=await db.rpc('commit_course_publication',{p_owner:creator.id,p_course:course.config.id,p_action:'publish',p_version:removed.publication.version,p_source:original.payload,p_updated_at:original.updated_at,p_snapshot:beforeUpdate,p_operation:randomUUID(),p_hash:'race'});
 check(forbidden.error?.code==='23514','database constraint blocks publish/removal race independently of API');
 check((await call(manage,moderator,{...remove,note:'Changed confirmation with the old operation ID.'})).status===409,'operation replay cannot change decision');
 detail=(await call(detailPath,moderator)).body;
 const restore={...remove,action:'restore',revision:detail.report.revision,version:detail.publication.version,operationId:randomUUID(),note:'Synthetic review: allow the creator to publish again.'};
 check((await call(manage,moderator,restore)).body.applied,'explicit restore permission');
 const restored=(await call(publishPath,creator)).body;
 check(!restored.publication.moderationRemoved&&restored.publication.status==='unpublished'&&(await call(publicPath)).status===404,'restoration never auto-publishes');
 const republished=await call(publishPath,creator,{...publish,version:restored.publication.version,operationId:randomUUID()});check(republished.status===200,'creator can explicitly publish after restoration');
 const again=(await call(publicPath)).body.course;imagePaths.push(new URL(Object.values(again.modules[1]).flatMap(t=>t.sections).find(s=>s.type==='image').src,origin).searchParams.get('imageId')+'.png');
 check((await call('/api/courses/community',reader,{...report,version:again.config.communityVersion})).body.received,'new public version may be reported separately');
 const nextCase=(await db.from('course_publication_reports').select('id').eq('publication_id',publicId.slice(7)).eq('reported_version',again.config.communityVersion).single()).data.id;
 const noAction={reportId:nextCase,action:'dismiss',note:'Synthetic review: no access change is needed.',confirm:true,revision:1,version:again.config.communityVersion,operationId:randomUUID()};
 check((await call(manage,moderator,noAction)).body.applied&&(await call(publicPath)).status===200,'close without action leaves public version intact');
 if(cli){
   const next=await call(publishPath,creator,{...publish,version:again.config.communityVersion,operationId:randomUUID()});assert.equal(next.status,200);
   assert.ok((await call('/api/courses/community',reader,{...report,version:next.body.publication.version,detail:'Synthetic <img src=x onerror="window.reportAttack=true"> concern for browser QA.'})).body.received);
   const reportId=(await db.from('course_publication_reports').select('id').eq('publication_id',publicId.slice(7)).eq('reported_version',next.body.publication.version).single()).data.id;
   // Synthetic historical cases exercise queue pages without involving any real report.
   const queueFixtures=Array.from({length:21},(_,i)=>({id:randomUUID(),publication_id:publicId.slice(7),reporter_id:reader.id,reported_version:100+i,reason:'other',detail:'Synthetic historical queue fixture; no real moderation finding.',status:'closed',created_at:new Date(Date.now()-86400000).toISOString(),evidence:{...beforeUpdate,title:'Historical QA case '+i}}));
   assert.ok(!(await db.from('course_publication_reports').insert(queueFixtures)).error);
   const queuePage=(await call(manage+'?status=closed',moderator)).body;check(queuePage.reports.length===20&&queuePage.nextCursor,'reviewed queue is bounded with continuation');
   const queueNext=(await call(manage+'?status=closed&cursor='+queuePage.nextCursor,moderator)).body;check(queueNext.reports.length>0&&!queueNext.reports.some(r=>queuePage.reports.some(p=>p.id===r.id)),'queue pages do not repeat cases');
   check((await call(manage+'?status=open&cursor='+queuePage.nextCursor,moderator)).status===400,'queue cursor is bound to status');
   check(!JSON.stringify(queuePage).includes(reader.id)&&!JSON.stringify(queuePage).includes('PRIVATE-'),'queue excludes reporter identity and private source fields');
   const graph=readBrowserGraph(),authModule='/js/auth.js?'+graph.imports.get(resolve(graph.web,'js/auth.js'))[0].query;
   await command(['open',origin+'/?experience=workspace&moderation=reports']);await command(['snapshot']);
   const code=readFileSync(new URL('./qa-moderation.browser.js',import.meta.url),'utf8').replace('__MODERATION_QA__',JSON.stringify({origin,reportId,courseId:course.config.id,publicId,accounts:accounts.map(({email,password})=>({email,password})),authModule}));
   console.log(await command(['run-code',code]));check((await command(['eval','window.__moderationReport'])).includes('"total"'),'moderation browser report completed');
 }
 // Browser sign-out revokes its sessions globally. Use a fresh authenticated
 // session here so the following check proves role revocation (403), not login expiry.
 const freshModerator=await moderator.client.auth.signInWithPassword({email:moderator.email,password:moderator.password});assert.ok(!freshModerator.error);moderator.token=freshModerator.data.session.access_token;
 assert.ok(!(await db.from('course_moderators').update({active:false}).eq('user_id',moderator.id)).error);
 check((await call(detailPath,moderator)).status===403&&(await call(manage,moderator,restore)).status===403,'revoked moderator cannot read or replay decisions');
 const revoked=await db.rpc('decide_course_report',{p_moderator:moderator.id,p_report:caseId,p_action:'restore',p_note:restore.note,p_revision:2,p_version:3,p_operation:restore.operationId,p_hash:'a'.repeat(64)});check(revoked.data.error==='forbidden','transaction independently rejects revoked membership');
 assert.deepEqual((await db.from('user_courses').select('payload,updated_at').eq('id',course.config.id).single()).data,original);checks++;
 console.log(`Report moderation: ${checks} actual local Auth/API/Postgres/Storage checks passed. Private course unchanged; no paid calls.`);
}finally{
 if(cli)await command(['close']).catch(()=>{});if(server)await new Promise(r=>server.close(r));if(accounts[0])await cleanupPublicationImageFixtures(db,accounts[0].id,imagePaths);
 for(const a of accounts)assert.ok(!(await db.auth.admin.deleteUser(a.id)).error);
 // Audit intentionally survives course/account deletion. Only generated QA actor IDs are removed via the local operator connection.
 if(accounts[2]){assert.match(accounts[2].id,/^[a-f0-9-]{36}$/);execFileSync('docker',['exec','-i','--user','postgres','supabase_db_learnable-setup-local','psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:`delete from public.course_moderation_audit where moderator_id='${accounts[2].id}';`,stdio:['pipe','pipe','pipe']});}
 console.log('Removed only disposable local moderation accounts, fixture courses/publications/reports/images and their synthetic audit entries.');
}
