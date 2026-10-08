import assert from 'node:assert/strict';
import {parseHTML} from 'linkedom';
import {publicationCourseIds,createPublicationStatusHandler} from '../web/api/courses/publication-status.js';
import {createPublicationStatusClient} from '../web/js/publication-status-client.js';
import {publicationCardHTML} from '../web/js/publication-card.js';
import {homeCourseHTML} from '../web/js/home.js';
let checks=0;const check=(value,label)=>{assert.ok(value,label);checks++;};
check(publicationCourseIds('one,two').length===2,'bounded batch accepted');
for(const input of [null,'','one,one',' one','../secret',Array.from({length:26},(_,i)=>'c'+i).join(','),'a'.repeat(161)]){assert.throws(()=>publicationCourseIds(input));checks++;}
const selections=[],filters=[];let reads=0;
function database(rows,error=null){return {from(table){return {select(fields){selections.push({table,fields});return this;},eq(k,v){filters.push([table,k,v]);return this;},in(){return this;},limit:async()=>{reads++;return{data:rows,error};}};}};}
const sources=[{id:'private',updated_at:'now'},{id:'live',updated_at:'later'},{id:'ended',updated_at:'before'}];
const pubId='aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',pub={id:pubId,source_course_id:'live',status:'published',version:2,source_revision:'before',updated_at:'now',author:{displayName:'Teacher'}};
const handler=createPublicationStatusHandler({enabled:()=>true,authenticate:async()=>({user:{id:'owner'},client:database(sources)}),admin:()=>database([pub,{...pub,source_course_id:'ended',status:'unpublished'}])});
const call=async(fn,method='GET',query='private,live,ended,unknown')=>{let status,body;const headers={};await fn({method,url:'/api/courses/publication-status?courseIds='+encodeURIComponent(query)},{setHeader:(k,v)=>headers[k]=v,status(n){status=n;return this;},json(v){body=v;}});return{status,body,headers};};
const result=await call(handler);
check(result.status===200&&result.headers['Cache-Control']==='private, no-store','owner-only status not cached');
check(result.body.courses.map(c=>c.state).join(',')==='private,published,unpublished,unavailable','missing course is unavailable, not falsely private');
check(result.body.courses[1].sourceChanged===true,'changed saved revision needs review');
check(result.body.courses[0].sourceChanged===false,'never-published copy has no false update flag');
check(!JSON.stringify(result.body).includes('source_revision')&&!JSON.stringify(result.body).includes('owner_id'),'private server fields excluded');
check(selections.every(s=>!s.fields.includes('*')&&!s.fields.includes('payload')&&!/(^|,)snapshot(,|$)/.test(s.fields)),'metadata-only queries, never full course bodies');
check(filters.filter(f=>f[1]==='owner_id').length===2,'both queries explicitly owner scoped');
const before=reads;check((await call(handler,'POST')).status===405&&reads===before,'endpoint cannot mutate');
check((await call(createPublicationStatusHandler({enabled:()=>false}))).status===503,'gated off');
check((await call(createPublicationStatusHandler({enabled:()=>true,authenticate:async()=>{throw Object.assign(new Error('private token'),{statusCode:401});}}))).status===401,'sign-in required');
const failed=await call(createPublicationStatusHandler({enabled:()=>true,authenticate:async()=>({user:{id:'owner'},client:database(null,{message:'PRIVATE-DATABASE-ERROR'})})}));check(failed.status===503&&!JSON.stringify(failed.body).includes('PRIVATE-'),'read failures do not become private or leak internals');
let owner='one',calls=0;
const client=createPublicationStatusClient({getIdentity:()=>({id:owner}),request:async path=>{calls++;const ids=new URL(path,'https://example.test').searchParams.get('courseIds').split(',');if(calls===2)throw new Error('offline');return {courses:ids.map(courseId=>({courseId,state:'private',publication:null}))};}});
const statuses=await client.load(owner,Array.from({length:51},(_,i)=>'course-'+i));
check(calls===3&&statuses.size===51,'large owner library split into batches of 25');
check(statuses.get('course-0').state==='private'&&statuses.get('course-30').state==='error'&&statuses.get('course-50').state==='private','one failed batch does not invent states or hide successful batches');
let release;const late=createPublicationStatusClient({getIdentity:()=>({id:owner}),request:()=>new Promise(r=>release=r)});const pending=late.load(owner,['one']);owner='two';release({courses:[{courseId:'one',state:'published'}]});await assert.rejects(pending,/account changed/);checks++;
const course={id:'course-1',title:'Title <img onerror=x>'};
for(const state of ['loading','error','unavailable','private','published','unpublished']){
 const html=publicationCardHTML(course,{state,publication:{id:'public-'+pubId},sourceChanged:true}),doc=parseHTML(html).document;
 check(!doc.querySelector('img')&&html.includes('&lt;img'),'title escaped for '+state);
 check(!!doc.querySelector('a')===(state==='published'),'public link only for confirmed published state '+state);
}
check(!publicationCardHTML(course,{state:'published',publication:{id:'javascript:attack()'}}).includes('href='),'unsafe returned URL identity cannot create a link');
check(publicationCardHTML(course,{state:'published',sourceChanged:true}).includes('Saved copy changed'),'change signal not misleading visible-content diff');
check(publicationCardHTML(course,{state:'unpublished'}).includes('Review and publish again'),'unpublished next action still requires review');
check(homeCourseHTML({...course,user:true},true,'',{state:'published',publication:{id:'public-'+pubId,author:'Confirmed Teacher'}}).includes('By Confirmed Teacher'),'confirmed publication byline appears on owned card without changing private profile');
console.log(`Publication management: ${checks} API, batched client, privacy and card rendering checks passed.`);
