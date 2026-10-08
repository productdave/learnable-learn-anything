// Local-only, disposable public metadata fixtures. No real user or AI writes.
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {spawn} from 'node:child_process';
import {createClient} from '@supabase/supabase-js';
import {loadPreviewConfig,createPreviewServer} from './dev-setup-server.mjs';
import {publicPreviewFixture} from './fixtures/public-preview.mjs';
import {makePublication} from '../web/api/_lib/course-publication.mjs';
const config=await loadPreviewConfig('.env.preview.local');assert.equal(config.mode,'local');assert.equal(config.url,'http://127.0.0.1:54321');
config.publishing=true;Object.assign(process.env,{SUPABASE_URL:config.url,SUPABASE_ANON_KEY:config.publicKey,SUPABASE_SECRET_KEY:config.secretKey,LEARNABLE_SELF_PUBLISH:'1'});
const db=createClient(config.url,config.secretKey,{auth:{persistSession:false,autoRefreshToken:false}}),tag='CatalogQA-'+randomUUID().slice(0,8),cli=process.env.PLAYWRIGHT_CLI,session='community-discovery-'+randomUUID().slice(0,8);
let owner,server,checks=0;const check=(v,label)=>{assert.ok(v,label);checks++;};
const command=args=>new Promise((resolve,reject)=>{const child=spawn(cli,['--session',session,...args]);let output='';child.stdout.on('data',c=>output+=c);child.stderr.on('data',c=>output+=c);child.on('error',reject);child.on('close',code=>{const text=output.split('### Ran Playwright code')[0];code||output.includes('### Error')?reject(new Error(text)):resolve(text);});});
try{
 const account=await db.auth.admin.createUser({email:`catalog-${randomUUID()}@example.test`,password:randomUUID()+'Aa9!',email_confirm:true});assert.ok(!account.error);owner=account.data.user.id;
 const course=publicPreviewFixture();for(const m of Object.values(course.modules))for(const t of Object.values(m))t.sections=t.sections.filter(s=>s.type!=='image');
 const snapshot=makePublication(course,'Public Catalog Teacher'),now=new Date(Date.now()-3600000).toISOString();
 const sources=Array.from({length:216},(_,i)=>({id:`${tag}-${i}`,owner_id:owner,payload:course}));assert.ok(!(await db.from('user_courses').insert(sources)).error);
 const listings=sources.slice(0,215).map((c,i)=>({id:randomUUID(),owner_id:owner,source_course_id:c.id,status:i===214?'unpublished':'published',version:1,snapshot:{...snapshot,title:`${tag} Course ${String(i).padStart(3,'0')}`,subtitle:i===211?'Needle beyond the old cap':i===212?'Literal 100%_\\ (a,b) "quoted"':'Browse and learn',publicAuthor:{displayName:i===213?`${tag} Distinct Teacher`:'Public Catalog Teacher'}},source_revision:now,last_operation:randomUUID(),last_hash:'qa',updated_at:now}));
 assert.ok(!(await db.from('course_publications').insert(listings)).error);
 const privateBefore=await db.from('user_courses').select('id,payload,updated_at').eq('owner_id',owner).order('id');assert.ok(!privateBefore.error);
 const {default:community}=await import('../web/api/courses/community.js');server=createPreviewServer({config,extraHandlers:{'/api/courses/community':community}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin=`http://127.0.0.1:${server.address().port}`;
 const get=async(q=tag,cursor=null)=>{const p=new URLSearchParams({q});if(cursor)p.set('cursor',cursor);const r=await fetch(origin+'/api/courses/community?'+p);return {status:r.status,body:await r.json()};};
 let first=await get();check(first.status===200&&first.body.courses.length===12&&first.body.nextCursor,'guest first page bounded');
 check(!JSON.stringify(first.body).includes(owner)&&!JSON.stringify(first.body).includes('PRIVATE-')&&!JSON.stringify(first.body).includes('source_course_id'),'no private metadata in listing');
 const gathered=[...first.body.courses];let cursor=first.body.nextCursor,pages=1;
 while(cursor){const page=await get(tag,cursor);assert.equal(page.status,200);assert.ok(page.body.courses.length<=12);gathered.push(...page.body.courses);cursor=page.body.nextCursor;if(++pages>30)throw new Error('unbounded cursor');}
 check(gathered.length===214&&new Set(gathered.map(c=>c.id)).size===214,'all 214 publications reachable beyond old 200 cap with no duplicates');
 check(gathered.map(c=>c.id.slice(7)).join(',')===listings.filter(c=>c.status==='published').map(c=>c.id).sort().reverse().join(','),'equal timestamp ties preserve descending UUID order across pages');
 check(!gathered.some(c=>c.id==='public-'+listings[214].id),'unpublished excluded');
 check((await get('Needle beyond the old cap')).body.courses[0]?.title.endsWith('211'),'subtitle search spans entire catalog');
 check((await get(`${tag} Distinct Teacher`)).body.courses.length===1,'full catalog author search');
 for(const term of ['100%_\\','(a,b)','"quoted"','%_'])check((await get(term)).body.courses.some(c=>c.id==='public-'+listings[212].id),'literal special-character search '+term);
 check((await get(tag+' absent')).body.courses.length===0,'no matches returns empty success');
 check((await get('different',first.body.nextCursor)).status===400,'cursor cannot cross search');
 check((await get('x'.repeat(121))).status===400,'oversized search rejected');
 check((await get(tag,'e30')).status===400,'malformed cursor rejected');
 // Concurrent writes affect only the disposable fixture; cursor anchor excludes new updates.
 assert.ok(!(await db.from('course_publications').update({updated_at:new Date().toISOString()}).eq('id',listings[0].id).eq('owner_id',owner)).error);
 const next=await get(tag,first.body.nextCursor);check(!next.body.courses.some(c=>c.id==='public-'+listings[0].id),'cursor anchor excludes publication updated after first page');
 check((await get()).body.courses[0].id==='public-'+listings[0].id,'refresh surfaces newly updated publication');
 assert.ok(!(await db.from('course_publications').update({status:'unpublished'}).eq('id',listings[0].id).eq('owner_id',owner)).error);
 check(!(await get()).body.courses.some(c=>c.id==='public-'+listings[0].id),'fresh listing removes revoked publication');
 check((await fetch(origin+'/api/courses/community?courseId=public-'+listings[0].id)).status===404,'course entry rechecks public access');
 if(cli){
   await command(['open',origin+'/?experience=workspace&filter=community&q='+tag]);await command(['snapshot']);
   const code=readFileSync(new URL('./qa-community-discovery.browser.js',import.meta.url),'utf8').replace('__COMMUNITY_QA__',JSON.stringify({origin,tag}));
   console.log(await command(['run-code',code]));check((await command(['eval','window.__communityReport'])).includes('"total"'),'browser report completed');
 }
 const after=await db.from('user_courses').select('id,payload,updated_at').eq('owner_id',owner).order('id');assert.deepEqual(after.data,privateBefore.data);checks++;
 console.log(`Community discovery: ${checks} actual local API/Postgres checks passed; private courses unchanged. No paid calls.`);
}finally{if(cli)await command(['close']).catch(()=>{});if(server)await new Promise(r=>server.close(r));if(owner)assert.ok(!(await db.auth.admin.deleteUser(owner)).error);console.log('Removed only the disposable local catalog account and its fixture courses/publications.');}
