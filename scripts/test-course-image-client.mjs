import assert from 'node:assert/strict';
import { createCourseImageClient } from '../web/js/course-image-client.js';
let checks=0,owner='account-a',calls=[],mode='ok',phase='',pages=0;
const check=(value,label)=>{assert.ok(value,label);checks++;};
const client=createCourseImageClient({
  getIdentity:()=>owner?{id:owner}:null,
  getClient:async()=>({auth:{getSession:async()=>{const session={user:{id:owner},access_token:'synthetic-token'};if(phase==='session')owner='account-b';return{data:{session}};}}}),
  fetcher:async(url,options)=>{
    calls.push({url,options});if(mode==='network')throw new Error('private transport details');
    if(phase==='fetch')owner='account-b';
    return{ok:mode!=='error',headers:new Headers({'Content-Type':'image/png'}),blob:async()=>{if(phase==='blob')owner='account-b';return new Blob(['synthetic']);},json:async()=>{
      if(phase==='json')owner='account-b';
      if(mode==='error')return{code:'quota',error:'Check OpenAI API credits.'};
      if(url.includes('action=list')){pages++;return{requests:[{id:pages}],nextCursor:pages===1?'next-page':null};}
      return{connected:true,request:{id:'same-attempt',status:'ready'}};
    }};
  }
});
const requests=await client.list(owner,'a/b');check(requests.length===2&&calls.length===2,'all account inventory pages fetched');
check(calls[0].url.includes('courseId=a%2Fb')&&calls[1].url.includes('after=next-page'),'course and cursor encoded');
check(calls.every(c=>c.options.cache==='no-store'&&c.options.headers.Authorization==='Bearer synthetic-token'),'all reads private and authenticated');
await client.inspect(owner,'c',{moduleId:'m',topicId:'t'});check(calls.at(-1).url.includes('action=inspect'),'inspect is a read, not generation');
await client.loadCourse(owner,'saved/course');
check(calls.at(-1).url==='/api/courses/get?id=saved%2Fcourse','image workspace reads saved courses without enabling text editing');
check(calls.at(-1).options.method==='GET'&&calls.at(-1).options.cache==='no-store','course load is read-only and uncached');
const data={courseId:'c',operationId:'stable-operation',action:'start',consent:true};
await client.action(owner,data);assert.deepEqual(JSON.parse(calls.at(-1).options.body),data);checks++;
check(calls.at(-1).options.method==='POST','writes explicit POST');
await client.connection(owner);check(calls.at(-1).url==='/api/providers/openai'&&calls.at(-1).options.method==='GET','connection status does not submit key');
await client.connect(owner,'synthetic-key');check(JSON.parse(calls.at(-1).options.body).key==='synthetic-key','key only submitted to secure connection endpoint');
await client.disconnect(owner);check(calls.at(-1).options.method==='DELETE','disconnect explicit');
check((await client.asset(owner,'c','image-id'))instanceof Blob,'binary asset returned without persisting object URL');
const before=calls.length;mode='network';await assert.rejects(client.action(owner,data),e=>e.code==='unavailable'&&!e.message.includes('private transport'));checks++;
check(calls.length===before+1,'transport failure never automatically retries a paid action');
mode='error';await assert.rejects(client.action(owner,data),e=>e.code==='quota');checks++;
mode='ok';
for(const checkpoint of ['session','fetch','json','blob']){
  owner='account-a';phase=checkpoint;
  await assert.rejects(checkpoint==='blob'?client.asset('account-a','c','id'):client.connection('account-a'),e=>e.code==='account');checks++;
}
phase='';const count=calls.length;await assert.rejects(client.action('account-a',data),e=>e.code==='account');checks++;
check(calls.length===count,'foreign account rejected before network');
await assert.rejects(client.loadCourse('account-a','c'),e=>e.code==='account');checks++;
check(calls.length===count,'foreign account course load rejected before network');
console.log(`Course image client: ${checks} checks passed; no network, real credentials or storage.`);
