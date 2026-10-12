// Real runner and HTTP handlers; all database/provider I/O is synthetic.
// No provider keys, network calls or learner-credit schema are needed.
import assert from 'node:assert/strict';
import test, { afterEach } from 'node:test';
import { randomUUID } from 'node:crypto';
import { createOpenRouterPolicy } from '../web/api/_lib/openrouter-policy.mjs';
import { generationProvider, generationModels, requireGenerationCapabilities, readGenerationApiKey, requireNewGenerationProvider } from '../web/api/_lib/generation-provider.mjs';
import { runGeneration } from '../web/api/_lib/gen-runner.mjs';
import { createReviewHandler } from '../web/api/gen/review.js';
import { createResumeHandler } from '../web/api/gen/resume.js';
import { createRestartHandler } from '../web/api/gen/restart.js';
import { createStartHandler } from '../web/api/gen/start.js';
import { createCredentialsReadyHandler, recoverCredentialWaitsForUser } from '../web/api/gen/credentials-ready.js';
import { createSweepHandler } from '../web/api/gen/sweep.js';
import { createSetupGenerationHandler } from '../web/api/setups/generate.js';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';

const originalFetch = globalThis.fetch;
const environment = { ...process.env };
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const key of Object.keys(process.env)) if (!(key in environment)) delete process.env[key];
  Object.assign(process.env, environment);
});
const now = Date.now();
const policy = createOpenRouterPolicy({ reviewedAt: new Date(now).toISOString(), validUntil: new Date(now + 3600000).toISOString(), now });
const env = { LEARNABLE_OPENROUTER_ENABLED: '1', OPENROUTER_API_KEY: 'synthetic-server-key' };
function fixture(extra = {}) {
  return { id: 'job-openrouter-lifecycle-test', owner_id: randomUUID(), run_id: randomUUID(),
    status: 'running', stage: 'intake', ai_policy: policy, ai_budget_ids: [randomUUID(), randomUUID(), randomUUID()],
    user_brief: { topic: 'Photography', source_text: 'Start with observation.', components: ['lessons', 'quizzes', 'flashcards'] },
    ...extra };
}
function setup(f = fixture()) {
  Object.assign(process.env, env);
  const updates = [], tables = [], receipts = [], holds = [], reservations = [], calls = [], runs = [], background = [];
  const row = structuredClone(f);
  const courses = new Map();
  const field = (r,k) => { const [column,member]=k.split('->>'); return member ? r[column]?.[member] : r[column]; };
  const client = {
    from(table) {
      tables.push(table);
      assert.ok(['generation_jobs', 'course_setups', 'user_courses'].includes(table), `Unexpected database/key read: ${table}`);
      const filters = []; let patch = null, many = true;
      const q = { select() { return this; }, eq(k,v) { filters.push(r => field(r,k) === v); return this; },
        neq(k,v) { filters.push(r => r[k] != null && r[k] !== v); return this; },
        is(k,v) { filters.push(r => (r[k] ?? null) === v); return this; },
        in(k,v) { filters.push(r => v.includes(r[k])); return this; },
        lt(k,v) { filters.push(r => r[k] != null && r[k] < v); return this; },
        gte(k,v) { filters.push(r => r[k] != null && r[k] >= v); return this; }, limit() { return this; }, order() { return this; },
        maybeSingle() { many = false; return this; },
        update(fields) { patch = fields; return this; },
        insert() { throw new Error('New public OpenRouter jobs must stay off'); },
        delete() { throw new Error('Provider integration must not delete a job'); },
        then(resolve,reject) { return Promise.resolve().then(() => {
          let record = table === 'user_courses' ? [...courses.values()].find(r=>filters.every(fn=>fn(r))) || null : table === 'generation_jobs' ? row : { id: 'setup_test', revision: 1, content_hash: 'hash', owner_id: row.owner_id, deleted: false, payload: {} };
          if (record && !filters.every(fn => fn(record))) record = null;
          if (record && patch) { updates.push(structuredClone(patch)); Object.assign(record, patch); }
          return { data: many ? (record ? [structuredClone(record)] : []) : record ? structuredClone(record) : null, error: null };
        }).then(resolve,reject); }
      }; return q;
    },
    async rpc(name,args) {
      if (name === 'commit_user_course') {
        assert.equal(args.p_action,'save');assert.equal(args.p_owner,row.owner_id);
        const payload={...args.p_payload,_courseRevision:randomUUID()},updatedAt=new Date().toISOString();
        courses.set(args.p_id,{id:args.p_id,owner_id:row.owner_id,payload,updated_at:updatedAt});
        return {data:{saved:true,payload,updatedAt}};
      }
      if (name === 'reserve_learnable_ai_spend') { reservations.push(args); return { data: { ok: true } }; }
      if (name === 'settle_learnable_ai_spend') { receipts.push(args); return { data: { ok: true } }; }
      if (name === 'halt_learnable_ai_spend') { holds.push(args); return { data: { ok: true } }; }
      throw new Error('Unexpected RPC: ' + name);
    },
    storage: { from() { return { async list() { return {data:[]}; } }; } },
    auth: { admin: { async getUserById() { return { data: { user: { email: null } } }; } } }
  };
  globalThis.fetch = async (url, options) => {
    assert.equal(url, 'https://openrouter.ai/api/v1/chat/completions');
    assert.equal(options.headers.authorization, 'Bearer synthetic-server-key');
    const request = JSON.parse(options.body); calls.push(request);
    let output=curriculumFixture();
    if(request.response_format.json_schema.name === 'submit_topic') {
      const id=request.messages[1].content.match(/and id "([^"]+)"/)?.[1];
      const topic=row.brief.modules.flatMap(m=>m.topics).find(t=>t.id===id);
      assert.ok(topic);output=lessonFixture(row.user_brief.components,topic);
    }
    return new Response(JSON.stringify({ id: 'gen-synthetic-' + calls.length, model: request.model, provider: request.provider.only[0],
      usage: { prompt_tokens: 100, completion_tokens: 100, cost: .001 },
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }] }));
  };
  const dependencies = { authenticate: async () => ({ user: { id: row.owner_id } }), admin: () => client,
    background: p => background.push(p), runGeneration: async args => runs.push(args), run: async args => runs.push(args) };
  const request = body => ({ method: 'POST', headers: {}, body: { jobId: row.id, expected: { status: row.status, runId: row.run_id }, ...body } });
  const response = () => ({ statusCode: null, body: null, setHeader() {}, status(n) { this.statusCode=n; return this; }, json(v) { this.body=v; return this; }, end() { return this; } });
  return { row, courses, client, calls, updates, tables, receipts, holds, reservations, runs, background, dependencies, request, response };
}

test('saved policy selects frontier curriculum and open-weight lessons independent of model env', () => {
  const job = fixture(); process.env.LEARNABLE_AI_TEXT_MODEL = 'different-model';
  const p = generationProvider(job, job.owner_id, { env, now });
  assert.equal(p.apiKey, env.OPENROUTER_API_KEY);
  assert.equal(generationModels(p).curriculum.model, policy.routes.curriculum.model);
  assert.equal(generationModels(p).lesson.model, policy.routes.lesson.model);
});

test('legacy jobs retain the direct provider even after global OpenRouter selection', () => {
  assert.equal(generationProvider({}, 'owner', { env: { ...env, LEARNABLE_GENERATION_PROVIDER: 'openrouter' } }).gateway, 'anthropic');
});

for (const [name,edit] of [
  ['wrong owner', j => { j.owner_id = randomUUID(); }],
  ['missing policy', j => { j.ai_policy = null; }],
  ['missing budgets', j => { j.ai_budget_ids = null; }],
  ['duplicate budgets', j => { j.ai_budget_ids[1] = j.ai_budget_ids[0]; }],
  ['corrupt snapshot', j => { j.ai_policy.routes.lesson.model = 'unapproved-model'; }]
]) test(`${name} stops without reading a personal provider key`, async () => {
  const job = structuredClone(fixture()), owner = job.owner_id; edit(job);
  await assert.rejects(readGenerationApiKey({ from() { throw new Error('legacy key read'); } }, owner, job, { env, now, mode: 'curriculum' }), { name: 'OpenRouterError' });
});

for (const [name,config] of [['gate disabled', { ...env, LEARNABLE_OPENROUTER_ENABLED: '0' }], ['missing server key', { ...env, OPENROUTER_API_KEY: '' }]])
  test(`${name} does not fall back to Claude`, () => { const j=fixture(); assert.throws(() => generationProvider(j,j.owner_id,{ env: config, now }), { name: 'OpenRouterError' }); });

test('expired job policy is not renewed from current environment', () => {
  const j=fixture(); assert.throws(() => generationProvider(j,j.owner_id,{ env, now: now+7200000 }), { code: 'approval' });
});

for (const [label,options] of [
  ['PDF curriculum', { mode:'curriculum', pdfRefs: [{}] }],
  ['research without evidence', { mode:'research', checkpoint:{ brief: curriculumFixture(), research:{} } }],
  ['complete with missing research', { mode:'complete', checkpoint:{ brief: curriculumFixture(), research:{} } }]
]) test(`${label} fails before provider dispatch`, () => {
  const j=fixture(), p=generationProvider(j,j.owner_id,{env,now}); assert.throws(() => requireGenerationCapabilities(p,options), {code:'unsupported'});
});

test('actual runner creates and saves an OpenRouter curriculum review without any owner API keys', async () => {
  const h=setup();
  await runGeneration({ supabase:h.client, jobId:h.row.id, ownerId:h.row.owner_id, runId:h.row.run_id,
    apiKey:'unused-claude-sentinel', userBrief:h.row.user_brief, pdfRefs:[], mode:'curriculum' });
  assert.equal(h.row.status,'review_curriculum'); assert.equal(h.row.brief.title,curriculumFixture().title);
  assert.equal(h.calls.length,1); assert.equal(h.receipts.length,1); assert.equal(h.reservations.length,1);
  assert.equal(h.reservations[0].p_policy_hash,policy.fingerprint);
  assert.equal(h.calls[0].model,policy.routes.curriculum.model);
  assert.ok(!JSON.stringify(h.row).includes('synthetic-server-key'));
  assert.ok(!JSON.stringify(h.calls).includes('unused-claude-sentinel'));
});

test('actual runner independently blocks unsupported image recovery instead of using OpenAI', async () => {
  const brief=curriculumFixture();
  const research=Object.fromEntries(brief.modules.map(m=>[m.id,{module_id:m.id,key_concepts:['a','b'],examples:['c','d'],sources:[]} ]));
  const h=setup(fixture({user_brief:{topic:'Photography',materials_policy:'integrated-visuals-v2',components:['lessons','images']}}));
  const log=console.error;console.error=()=>{};
  try { await assert.rejects(runGeneration({supabase:h.client,jobId:h.row.id,ownerId:h.row.owner_id,runId:h.row.run_id,userBrief:h.row.user_brief,
    checkpoint:{brief,research,saved_course_id:'saved',stage:'images'},pdfRefs:[],mode:'complete'}), {code:'unsupported'}); }
  finally {console.error=log;}
  assert.equal(h.calls.length,0);assert.equal(h.reservations.length,0);assert.match(h.row.error,/illustration/);
});

for (const [name,handler,job,body] of [
  ['review revision',createReviewHandler,{status:'review_curriculum',brief:curriculumFixture()},{action:'revise_curriculum',feedback:'Focus on observation.'}],
  ['resume curriculum',createResumeHandler,{status:'failed'},{}],
  ['restart',createRestartHandler,{status:'failed'},{feedback:'Focus on observation.'}]
]) test(`actual ${name} handler selects the one server key and preserves binding`, async () => {
  const h=setup(fixture(job)),res=h.response(); await handler(h.dependencies)(h.request(body),res);await Promise.all(h.background);
  assert.equal(res.statusCode,200,JSON.stringify(res.body));assert.equal(h.runs.length,1);
  assert.equal(h.runs[0].apiKey,env.OPENROUTER_API_KEY);
  assert.ok(h.updates.every(p=>!('ai_policy' in p)&&!('ai_budget_ids' in p)));
  assert.ok(!JSON.stringify(res.body).includes(env.OPENROUTER_API_KEY));
});

test('actual research approval leaves review unchanged while native search is not accepted', async () => {
  const h=setup(fixture({status:'review_curriculum',brief:curriculumFixture()})),res=h.response();
  await createReviewHandler(h.dependencies)(h.request({action:'approve_curriculum'}),res);
  assert.equal(res.statusCode,409);assert.match(res.body.error,/research and citations/);assert.equal(h.updates.length,0);assert.equal(h.runs.length,0);
});

for (const [name,handler,job,body] of [
  ['review',createReviewHandler,{status:'review_curriculum',brief:curriculumFixture()},{action:'revise_curriculum',feedback:'Simplify'}],
  ['resume',createResumeHandler,{status:'failed'},{}],
  ['restart',createRestartHandler,{status:'failed'},{}]
]) test(`missing gateway key in ${name} keeps saved state and never asks for Claude`, async () => {
  const h=setup(fixture(job)),res=h.response();delete process.env.OPENROUTER_API_KEY;
  await handler(h.dependencies)(h.request(body),res);
  assert.equal(res.statusCode,409);assert.match(res.body.error,/OpenRouter connection/);assert.equal(h.updates.length,0);assert.equal(h.runs.length,0);
});

test('credential-save route does not read or replace an OpenRouter job with a Claude key', async () => {
  const h=setup(fixture({status:'failed',error:'No Anthropic API key'})),res=h.response();
  await createCredentialsReadyHandler(h.dependencies)(h.request({}),res);
  assert.equal(res.statusCode,409);assert.equal(res.body.code,'openrouter_connection');assert.equal(h.updates.length,0);
  const result=await recoverCredentialWaitsForUser(h.client,h.row.owner_id,'',{apiKey:'legacy-key',startRecoverable:true});
  assert.deepEqual(result.started,[]);assert.deepEqual(result.cleared,[]);
});

test('new starts in OpenRouter mode cannot silently use legacy connections', async () => {
  const h=setup(),res=h.response();process.env.LEARNABLE_GENERATION_PROVIDER='openrouter';
  await createStartHandler(h.dependencies)({method:'POST',headers:{},body:{brief:{topic:'Photography'}}},res);
  assert.equal(res.statusCode,409);assert.equal(h.tables.length,0);assert.equal(h.runs.length,0);
});

test('existing start reattaches without any provider key after rollout is paused', async () => {
  const h=setup(),res=h.response();process.env.LEARNABLE_GENERATION_PROVIDER='openrouter';delete process.env.OPENROUTER_API_KEY;
  await createStartHandler(h.dependencies)(h.request({brief:{topic:'Photography'}}),res);
  assert.equal(res.statusCode,200);assert.equal(res.body.existing,true);assert.equal(h.runs.length,0);
});

test('unknown new-provider configuration fails closed',()=>{
  assert.throws(()=>requireNewGenerationProvider({env:{LEARNABLE_GENERATION_PROVIDER:'typo'}}),{code:'configuration'});
});

test('actual automatic recovery uses OpenRouter without owner provider credentials',async()=>{
  const h=setup(fixture({status:'timed_out',recovery_attempts:0})),res=h.response();process.env.GEN_SWEEP_SECRET='synthetic-sweep';
  await createSweepHandler(h.dependencies)({method:'GET',headers:{authorization:'Bearer synthetic-sweep'}},res);await Promise.all(h.background);
  assert.equal(res.statusCode,200,JSON.stringify(res.body));assert.equal(h.runs.length,1);assert.equal(h.runs[0].apiKey,env.OPENROUTER_API_KEY);
});

test('blocked automatic recovery keeps gateway-specific operator guidance',async()=>{
  const h=setup(fixture({status:'timed_out',recovery_attempts:0})),res=h.response();process.env.GEN_SWEEP_SECRET='synthetic-sweep';delete process.env.OPENROUTER_API_KEY;
  await createSweepHandler(h.dependencies)({method:'GET',headers:{authorization:'Bearer synthetic-sweep'}},res);await Promise.all(h.background);
  assert.equal(res.statusCode,200);assert.equal(h.runs.length,0);assert.match(h.row.message,/OpenRouter/);assert.doesNotMatch(h.row.message,/Anthropic|Add one/);
});

for (const action of ['check','start']) test(`actual setup ${action} blocks an unaccepted gateway before source or key access`,async()=>{
  const h=setup(),res=h.response();process.env.LEARNABLE_GENERATION_PROVIDER='openrouter';
  await createSetupGenerationHandler(h.dependencies)({method:'POST',headers:{},body:{id:'setup_test',revision:1,action}},res);
  assert.equal(res.statusCode,409,JSON.stringify(res.body));assert.equal(res.body.ready,false);assert.equal(h.runs.length,0);
  assert.ok(h.tables.every(t=>['generation_jobs','course_setups'].includes(t)));
});

test('actual runner saves all open-weight lessons using saved research and no personal keys',async()=>{
  const brief={...curriculumFixture(),components:['lessons','quizzes','flashcards']};
  const research=Object.fromEntries(brief.modules.map(m=>[m.id,{module_id:m.id,key_concepts:['Light','Composition'],examples:['Window','Frame'],experts:[],misconceptions:[],sources:[],images:[]} ]));
  const h=setup(fixture({stage:'topics',brief,research}));
  await runGeneration({supabase:h.client,jobId:h.row.id,ownerId:h.row.owner_id,runId:h.row.run_id,userBrief:h.row.user_brief,
    checkpoint:{brief,research},pdfRefs:[],mode:'complete'});
  assert.equal(h.row.status,'completed');assert.equal(h.calls.length,3);assert.equal(h.receipts.length,3);
  assert.ok(h.calls.every(c=>c.model===policy.routes.lesson.model));
  assert.equal(h.courses.size,1);const saved=h.courses.get(h.row.saved_course_id).payload;
  assert.equal(Object.keys(saved.modules[1]).length,3);assert.equal(saved._generationJobId,h.row.id);
  for(const lesson of Object.values(saved.modules[1])) { assert.ok(lesson.sections.some(s=>s.type==='quiz'));assert.ok(lesson.flashcards.length >= 3); }
});

test('actual continuation claims the saved OpenRouter job and preserves its allowance',async()=>{
  const h=setup(fixture({status:'queued'})),res=h.response();
  h.row.continuation={version:1,phase:'pending',runId:h.row.run_id,sequence:1,stalls:0,progress:'a'.repeat(64)};
  process.env.GEN_SWEEP_SECRET='synthetic-sweep';process.env.LEARNABLE_GENERATION_CONTINUATION='1';
  process.env.LEARNABLE_GENERATION_ORIGIN='https://learnable-staging.vercel.app';
  const before=h.row.ai_budget_ids;
  await createSweepHandler(h.dependencies)({method:'POST',headers:{authorization:'Bearer synthetic-sweep','x-learnable-continuation':'1'},
    body:{jobId:h.row.id,ownerId:h.row.owner_id,runId:h.row.run_id}},res);await Promise.all(h.background);
  assert.equal(res.statusCode,200);assert.equal(res.body.accepted,true);assert.equal(h.runs.length,1);
  assert.equal(h.runs[0].apiKey,env.OPENROUTER_API_KEY);assert.deepEqual(h.row.ai_budget_ids,before);
});
