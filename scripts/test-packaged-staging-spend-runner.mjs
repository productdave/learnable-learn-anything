// No-network integration check of the deployed runner and guard together.
// Database/provider are simulated; this is not hosted or paid-course acceptance.
import test from 'node:test';
import assert from 'node:assert/strict';
import {pathToFileURL} from 'node:url';
import {join} from 'node:path';
import {curriculumFixture} from './fixtures/component-course.mjs';

const artifact=process.env.GUARD_ARTIFACT;
assert.ok(artifact?.startsWith('/work/output/grouped-staging/package-'));
const owner='11111111-1111-4111-8111-111111111111',runId='22222222-2222-4222-8222-222222222222';
const job='job-33333333-3333-4333-8333-333333333333';
const source='Synthetic planning notes, retained when generation stops.';
function fixture({approved=false,uncertain=false}={}){
  const row={id:job,owner_id:owner,run_id:runId,status:'queued',user_brief:{goal:'Compare photographs',source_text:source}};
  const state={row,dispatches:0,charged:0,pending:null,halted:false,events:[]};
  const supabase={
    from(table){
      assert.equal(table,'generation_jobs');let update=null;const filters=[];
      const finish=()=>{
        if(!filters.every(f=>f()))return {data:null,error:null};
        if(update)Object.assign(row,structuredClone(update));
        return {data:structuredClone(row),error:null};
      };
      return {select(){return this;},update(value){update=value;return this;},
        eq(k,v){filters.push(()=>row[k]===v);return this;},in(k,v){filters.push(()=>v.includes(row[k]));return this;},
        async maybeSingle(){return finish();},then(resolve,reject){return Promise.resolve(finish()).then(resolve,reject);}};
    },
    async rpc(name,args){
      assert.equal(args.p_owner_id,owner);assert.equal(args.p_job_id,job);assert.equal(args.p_run_id,runId);
      state.events.push(name);
      if(name==='reserve_learnable_staging_spend'){
        if(!approved)return {data:{ok:false,reason:'approval'}};
        if(state.halted||state.pending)return {data:{ok:false,reason:'pending'}};
        state.pending=args;state.charged+=args.p_reserved_microusd;return {data:{ok:true}};
      }
      if(name==='halt_learnable_staging_spend'){state.halted=true;return {data:{ok:true}};}
      assert.equal(name,'settle_learnable_staging_spend');assert.equal(args.p_request_id,state.pending.p_request_id);
      state.charged-=state.pending.p_reserved_microusd-args.p_actual_microusd;state.pending=null;return {data:{ok:true}};
    }
  };
  globalThis.fetch=async(url,options)=>{
    assert.equal(url,'https://api.anthropic.com/v1/messages');assert.ok(state.pending,'reservation must precede dispatch');
    state.dispatches++;state.events.push('provider');
    if(uncertain)throw new Error('Synthetic transport uncertainty; no real request');
    const body=JSON.parse(options.body);assert.match(JSON.stringify(body.messages),/Synthetic planning notes/);
    return {ok:true,headers:new Headers({'request-id':'synthetic-only'}),json:async()=>({model:'claude-sonnet-4-5-20250929',usage:{input_tokens:100,output_tokens:10},stop_reason:'tool_use',content:[{type:'tool_use',id:'synthetic',name:'submit_course_brief',input:curriculumFixture()}]})};
  };
  return {state,args:{supabase,jobId:job,ownerId:owner,runId,apiKey:'synthetic-no-network',userBrief:row.user_brief,pdfRefs:[],mode:'curriculum'}};
}

for(const group of ['generation','sources']){
  const {runGeneration}=await import(pathToFileURL(join(artifact,`.vercel/output/functions/_functions/${group}.func/api/_lib/gen-runner.mjs`)));
  const setup=()=>{process.env.SUPABASE_URL='https://dmnwkrybgggbpqpetuub.supabase.co';process.env.LEARNABLE_SETUP_GENERATION='1';};
  test(group+': disabled generation persists a safe failure before any ledger/provider call',async()=>{
    setup();process.env.LEARNABLE_SETUP_GENERATION='0';const f=fixture();
    await assert.rejects(()=>runGeneration(f.args),/generation is disabled/i);
    assert.equal(f.state.row.status,'failed');assert.match(f.state.row.error,/No AI request was sent/);
    assert.deepEqual(f.state.events,[]);assert.equal(f.state.row.user_brief.source_text,source);
  });
  test(group+': missing allowance reaches the guard with exact course/run identity',async()=>{
    setup();const f=fixture();await assert.rejects(()=>runGeneration(f.args),/active approved test budget/);
    assert.equal(f.state.dispatches,0);assert.equal(f.state.row.status,'failed');
    assert.match(f.state.row.error,/No AI request was sent/);assert.equal(f.state.row.user_brief.source_text,source);
    assert.deepEqual(f.state.events,['reserve_learnable_staging_spend']);
  });
  test(group+': a settled synthetic response reaches curriculum review with sources intact',async()=>{
    setup();const f=fixture({approved:true});await runGeneration(f.args);
    assert.equal(f.state.row.status,'review_curriculum');assert.equal(f.state.row.topics_total,3);
    assert.equal(f.state.row.brief.source_text,source);assert.equal(f.state.dispatches,1);
    assert.equal(f.state.charged,450);assert.equal(f.state.pending,null);
    assert.deepEqual(f.state.events,['reserve_learnable_staging_spend','provider','settle_learnable_staging_spend']);
  });
  test(group+': a resumed runner cannot redispatch after an uncertain request',async()=>{
    setup();const f=fixture({approved:true,uncertain:true});
    await assert.rejects(()=>runGeneration(f.args),/reservation is held/);
    assert.equal(f.state.row.status,'failed');assert.ok(f.state.pending);assert.ok(f.state.halted);
    const charged=f.state.charged;f.state.row.status='queued';
    await assert.rejects(()=>runGeneration(f.args),/previous AI request/);
    assert.equal(f.state.dispatches,1);assert.equal(f.state.charged,charged);assert.equal(f.state.row.user_brief.source_text,source);
  });
}
