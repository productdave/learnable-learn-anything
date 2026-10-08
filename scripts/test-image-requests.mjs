import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { curriculumFixture, lessonFixture } from './fixtures/component-course.mjs';
import { assembleCourse } from '../web/js/generator/assemble-course.js';
import { syntheticImageResponse } from './fixtures/generated-image.mjs';
import { decodeImagePNG } from '../web/api/_lib/openai-image.mjs';
import { ImageGenerationError } from '../web/api/_lib/image-policy.mjs';
import { ImageRequestError, imageAssetPath } from '../web/api/_lib/image-request-store.mjs';
import { startImageRequest, runImageRequest, getImageRequest, listImageRequests, inspectImageLesson, reconcileImageRequest,
  cancelImageRequest, discardImageRequest, cleanupImageCandidate, readImageAsset, IMAGE_REQUEST_LEASE_MS } from '../web/api/_lib/image-request.mjs';
import { createCourseImageHandler } from '../web/api/courses/images.js';
import { executionClock, deferred, flush } from './fixtures/image-execution-clock.mjs';

let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
const reject = async (task, code) => { await assert.rejects(task, e => e.code === code); checks++; };
const clone = value => structuredClone(value);
function fixture() {
  const owner = randomUUID(), courseId = 'image-qa', target = { moduleId: 'foundations', topicId: 'lesson-1' };
  const brief = curriculumFixture(), payload = assembleCourse(brief, brief.modules.flatMap(mod => mod.topics.map(topic => ({ moduleId: mod.id, topicId: topic.id, content: lessonFixture(['lessons'], topic) }))));
  payload.config.id = courseId;
  let course = { id: courseId, created_at: '2026-09-17T00:00:00Z', payload };
  const rows = new Map(), objects = new Map(), hooks = {}, env = { LEARNABLE_GPT_IMAGES: '1' };
  let time = Date.now(), calls = 0, puts = 0, removes = 0;
  const store = {
    course: async (o,c) => o === owner && c === courseId ? clone(course) : null,
    get: async (o,id) => o === owner ? clone(rows.get(id) || null) : null,
    list: async (o,c,after) => o===owner&&c===courseId ? clone([...rows.values()].filter(r=>r.is_current&&(!after||r.id>after)).sort((a,b)=>a.id.localeCompare(b.id)).slice(0,51)) : [],
    async begin(row, expected, ack) {
      const existing = rows.get(row.id);
      if (existing) {
        if (existing.payload.requestHash !== row.payload.requestHash) throw new ImageRequestError('conflict');
        return { row: clone(existing), replayed: true };
      }
      const prior = [...rows.values()].find(r => r.slot_key === row.slot_key && r.is_current);
      if ((prior?.id || null) !== expected) throw new ImageRequestError('conflict');
      if (['queued','running','persisting'].includes(prior?.payload.status)) throw new ImageRequestError('busy');
      if (prior?.payload.mayHaveCharged && ack !== true) throw new ImageRequestError('charge_ack');
      if (prior) prior.is_current = false;
      const current = { ...clone(row), status: row.payload.status, revision: 1, is_current: true };
      rows.set(row.id, current);
      if (hooks.lostBegin) { hooks.lostBegin = false; throw new ImageRequestError('unavailable'); }
      return { row: clone(current), replayed: false };
    },
    async update(row, patch) {
      const stored = rows.get(row.id);
      if (stored.revision !== row.revision) return null;
      if (hooks.rejectUpdate && hooks.rejectUpdate === patch.status) { hooks.rejectUpdate = null; throw new ImageRequestError('unavailable'); }
      const next = { ...stored, revision: stored.revision + 1, status: patch.status || stored.status, payload: { ...stored.payload, ...clone(patch) } };
      rows.set(row.id, next);
      if (hooks.lostUpdate && hooks.lostUpdate === patch.status) { hooks.lostUpdate = null; throw new ImageRequestError('unavailable'); }
      return clone(next);
    },
  };
  const assets = {
    async put(row, bytes) { puts++; if (hooks.skipPut) return false; objects.set(imageAssetPath(row), Buffer.from(bytes)); if (hooks.afterPut) await hooks.afterPut(row); if (hooks.lostPut) throw new Error('lost storage reply'); return true; },
    async read(row) { if (hooks.readFailure) throw new ImageRequestError('asset',503); const b = objects.get(imageAssetPath(row)); return b ? decodeImagePNG(b.toString('base64')) : null; },
    async remove(row) { removes++; objects.delete(imageAssetPath(row)); },
  };
  const args = { ownerId: owner, courseId, operationId: randomUUID(), expectedRequestId: null, target, slot: 'instruction',
    prompt: 'A simple photography lighting diagram.', alt: 'Window light falling on a subject.', consent: true, env, store, assets, now: () => time,
    generate: async request => { calls++; if (hooks.generate) return hooks.generate(request); return output(); } };
  function output() { const raw = syntheticImageResponse(); return { asset: decodeImagePNG(raw.data[0].b64_json), provenance: {
    funding:'creator',provider:'openai',model:'gpt-image-2.5-flare-2026-09-08',n:1,size:'1024x1024',quality:'medium',outputFormat:'png',usage:raw.usage,requestId:'req_test_image',
  } }; }
  return { args, rows, objects, hooks, output, stats: () => ({ calls,puts,removes }), advance: () => { time += IMAGE_REQUEST_LEASE_MS + 1; },
    course: () => course, deleteCourse: () => { course = null; },
    async prepare() { const ready = await inspectImageLesson(args); Object.assign(args,{ baseHash: ready.baseHash, fundingHash: ready.funding.hash }); return args; } };
}

{
  const f = fixture(), a = await f.prepare(), before = JSON.stringify(f.course());
  check((await startImageRequest(a)).request.status === 'queued' && f.stats().calls === 0, 'start records receipt without provider dispatch');
  check((await startImageRequest(a)).replayed && f.rows.size === 1, 'same operation reattaches');
  await reject(startImageRequest({ ...a, prompt: 'different' }), 'conflict');
  await reject(startImageRequest({ ...a, consent:false }), 'consent');
  const duplicate = await Promise.all([runImageRequest(a),runImageRequest(a)]);
  check(f.stats().calls === 1 && f.stats().puts === 1 && duplicate.some(r => r.request.status === 'ready'), 'concurrent runners dispatch once');
  const result = await getImageRequest(a);
  check(result.request.status === 'ready' && result.request.asset.id === a.operationId && !result.request.stale && result.request.usage.total_tokens === 42, 'reopen exposes stable asset and usage');
  check(!JSON.stringify(result).includes('requestHash') && !JSON.stringify(result).includes('/course-images/') && !JSON.stringify(result).includes('dispatchToken'), 'view excludes private transport fields');
  check((await readImageAsset(a)).bytes.length > 0 && f.stats().calls === 1, 'reopening bytes does not generate');
  check((await runImageRequest(a)).request.status === 'ready' && f.stats().calls === 1, 'ready resume never regenerates');
  check(JSON.stringify(f.course()) === before, 'candidate never changes accepted course');
  await reject(getImageRequest({...a,ownerId:randomUUID()}),'not_found');
  await reject(getImageRequest({...a,courseId:'other'}),'not_found');
  await reject(readImageAsset({...a,ownerId:randomUUID()}),'not_found');
  await reject(cleanupImageCandidate(a),'busy');
  const replacement = { ...a, operationId:randomUUID(),expectedRequestId:a.operationId };
  await reject(startImageRequest(replacement),'charge_ack');
  await startImageRequest({...replacement,acknowledgePossibleCharge:true});
  check(f.objects.size === 1 && (await getImageRequest(a)).request.current === false, 'replacement preserves original saved candidate');
  check((await startImageRequest(a)).replayed && f.stats().calls === 1, 'old operation replay cannot create another call');
  check((await listImageRequests(a)).requests.length===1 && (await listImageRequests(a)).requests[0].id===replacement.operationId,'fresh course listing discovers current requests without browser storage');
  await discardImageRequest(a);
  check((await cleanupImageCandidate(a)).removed && f.objects.size === 0, 'explicitly discarded settled candidate cleanup');
  f.objects.set(imageAssetPath(f.rows.get(a.operationId)), f.output().asset.bytes);
  await cleanupImageCandidate(a);
  check(f.objects.size === 0, 'repeat cleanup removes same-path late upload');
}
for (const input of [{consent:false},{fundingHash:'wrong'},{prompt:''},{prompt:'x'.repeat(4001)},{alt:'🏊'.repeat(301)},{slot:'../../x'},{target:{moduleId:'foundations',topicId:'missing'}},{operationId:'nope'},{expectedRequestId:undefined}]) {
  const f = fixture(), a = await f.prepare();
  await assert.rejects(startImageRequest({...a,...input})); checks++;
  check(f.stats().calls === 0 && f.rows.size === 0, 'invalid start has no receipt or charge');
}
{
  const f = fixture(), a = await f.prepare();
  const results = await Promise.allSettled([startImageRequest(a),startImageRequest({...a,operationId:randomUUID()})]);
  check(results.filter(r=>r.status==='fulfilled').length===1 && f.rows.size===1,'competing operation IDs share one current slot');
  await reject(startImageRequest({...a,operationId:randomUUID(),expectedRequestId:a.operationId}),'busy');
}
{
  const f=fixture(),a=await f.prepare(); f.hooks.lostBegin=true;
  await reject(startImageRequest(a),'unavailable');
  check((await startImageRequest(a)).replayed,'lost receipt reply recovers exact attempt');
  await runImageRequest(a); check(f.stats().calls===1,'recovered queued attempt admits one call');
}
for (const update of ['running','persisting','ready']) {
  const f=fixture(),a=await f.prepare(); await startImageRequest(a); f.hooks.lostUpdate=update;
  await reject(runImageRequest(a),'unavailable');
  check(f.stats().calls === (update==='running'?0:1),'ambiguous dispatch write never calls provider');
  if(update==='running') { f.advance(); check((await reconcileImageRequest(a)).request.status==='unknown','expired ambiguous running remains unknown'); }
  if(update==='persisting') { f.advance(); check((await reconcileImageRequest(a)).request.error==='asset_missing','lost receipt write before upload reported honestly'); }
  if(update==='ready') check((await getImageRequest(a)).request.status==='ready','lost final reply retains saved success');
  await runImageRequest(a); check(f.stats().calls === (update==='running'?0:1),'no automatic redispatch after ambiguous writes');
}
{
  const f=fixture(),a=await f.prepare(); await startImageRequest(a); f.hooks.lostPut=true;
  check((await runImageRequest(a)).request.status==='ready' && f.stats().calls===1,'lost upload reply recovered by exact-object read');
}
{
  const f=fixture(),a=await f.prepare(); await startImageRequest(a); f.hooks.skipPut=true;
  check((await runImageRequest(a)).request.status==='persisting','unconfirmed storage stays recoverable');
  await reconcileImageRequest(a); check(f.stats().calls===1,'checking unsaved asset never calls provider');
  f.advance(); check((await reconcileImageRequest(a)).request.error==='asset_missing','expired missing upload gives honest failure');
  const r=f.rows.get(a.operationId); f.objects.set(imageAssetPath(r),f.output().asset.bytes);
  check((await reconcileImageRequest(a)).request.status==='ready','late committed upload can still recover original image');
}
{
  const f=fixture(),a=await f.prepare(); await startImageRequest(a); f.hooks.readFailure=true;
  await reject(runImageRequest(a),'asset');
  check(f.objects.size===1 && f.rows.get(a.operationId).payload.status==='persisting','storage read failure retains descriptor and saved object');
  f.hooks.readFailure=false; check((await reconcileImageRequest(a)).request.status==='ready' && f.stats().calls===1,'storage service recovery needs no AI retry');
}
{
  const f=fixture(),a=await f.prepare(); await startImageRequest(a); await cancelImageRequest(a);
  check((await runImageRequest(a)).request.status==='cancelled' && f.stats().calls===0,'queued cancellation prevents dispatch');
  check(!(await getImageRequest(a)).request.mayHaveCharged,'queued cancellation honest no-charge flag');
}
{
  const f=fixture(),a=await f.prepare(); await startImageRequest(a);
  f.hooks.generate=async()=>{ await cancelImageRequest(a); return f.output(); };
  const result=await runImageRequest(a);
  check(result.request.status==='cancelled' && result.request.usage.total_tokens===42 && result.request.mayHaveCharged,'late result preserves cancellation plus usage');
  check(f.objects.size===0 && f.stats().puts===0,'cancelled late output not uploaded');
}
{
  const f=fixture(),a=await f.prepare(); await startImageRequest(a);
  f.hooks.afterPut=async()=>{await cancelImageRequest(a);};
  check((await runImageRequest(a)).request.status==='cancelled' && f.objects.size===1,'cancel/upload race remains cancelled with tracked candidate');
  await cleanupImageCandidate(a); check(f.objects.size===0,'settled cancelled upload safely cleaned');
}
{
  const f=fixture(),a=await f.prepare(); await startImageRequest(a); f.advance();
  check((await getImageRequest(a)).request.needsRecovery && (await getImageRequest(a)).request.status==='failed','expired status is honest before any recovery write');
  check((await runImageRequest(a)).request.error==='not_started' && f.stats().calls===0,'queued expiry never silently starts paid work');
}
for(const code of ['connection','quota','moderation','timeout','response']) {
  const f=fixture(),a=await f.prepare(); await startImageRequest(a);
  f.hooks.generate=()=>{throw new ImageGenerationError(code,{dispatched:code!=='connection'});};
  const result=await runImageRequest(a);
  check(result.request.status===(['timeout','response'].includes(code)?'unknown':'failed') && result.request.error===code,'typed failure retained without raw provider error');
  await runImageRequest(a); check(f.stats().calls===1,'failure never retries itself');
  const next={...a,operationId:randomUUID(),expectedRequestId:a.operationId};
  if(code!=='connection') await reject(startImageRequest(next),'charge_ack');
  f.hooks.generate=null;
  await startImageRequest({...next,acknowledgePossibleCharge:true});
  await runImageRequest(next); check(f.stats().calls===2,'new confirmed attempt explicitly dispatches once');
}
{
  const f=fixture(),a=await f.prepare(); await startImageRequest(a);
  f.hooks.generate=()=>{throw new Error('secret-key private provider text');};
  const result=await runImageRequest(a);check(!JSON.stringify(result).includes('secret-key')&&result.request.error==='outcome_unknown','raw provider failures sanitized');
}
for(const output of [null,{}, {asset:{bytes:Buffer.from('bad')},provenance:{} }]) {
  const f=fixture(),a=await f.prepare();await startImageRequest(a); f.hooks.generate=()=>output;
  check((await runImageRequest(a)).request.error==='response' && f.objects.size===0,'invalid output never uploaded');
}
{
  const f=fixture(),a=await f.prepare();await startImageRequest(a);
  f.course().payload.modules[1]['lesson-1'].title='Changed';
  check((await runImageRequest(a)).request.error==='stale' && f.stats().calls===0,'stale lesson prevents generation');
}
{
  const f=fixture(),a=await f.prepare();await startImageRequest(a);
  f.course().payload.modules[1]['lesson-2'].title='Unrelated change';
  check((await runImageRequest(a)).request.status==='ready','other lesson change does not stale target');
  f.course().payload.modules[1]['lesson-1'].title='Changed';
  check((await getImageRequest(a)).request.stale,'later target change marks retained candidate stale');
}
{
  const f=fixture(),a=await f.prepare();await startImageRequest(a);await runImageRequest(a);
  f.course().payload.testReference={assetId:a.operationId};
  await reject(discardImageRequest(a),'referenced');check((await getImageRequest(a)).request.status==='ready','referenced asset not hidden by discard');
  delete f.course().payload.testReference;await discardImageRequest(a);
  f.course().payload.testReference={assetId:a.operationId};
  await reject(cleanupImageCandidate(a),'referenced');check(f.objects.size===1,'referenced candidate never removed');
  delete f.course().payload.testReference;f.deleteCourse();
  await reject(readImageAsset(a),'not_found');
  await cleanupImageCandidate(a);check(f.objects.size===0,'deleted course does not lose tracked candidate cleanup');
}
{
  const f=fixture(),a=await f.prepare();await startImageRequest(a);a.env.LEARNABLE_GPT_IMAGES='0';
  check((await runImageRequest(a)).request.error==='configuration' && f.stats().calls===0,'configuration change before dispatch blocks charge');
}
{
  const f=fixture(),a=await f.prepare();await startImageRequest(a);
  const original=f.rows.get(a.operationId);
  for(let n=0;n<51;n++){const id=randomUUID();f.rows.set(id,{...clone(original),id});}
  const first=await listImageRequests(a),second=await listImageRequests({...a,after:first.nextCursor});
  check(first.requests.length===50&&first.nextCursor&&second.requests.length===2&&!second.nextCursor,'request discovery paginates at 50 records');
  check(new Set([...first.requests,...second.requests].map(r=>r.id)).size===52,'cursor pages do not duplicate requests');
  await reject(listImageRequests({...a,after:'bad'}),'request');
  await reject(listImageRequests({...a,ownerId:randomUUID()}),'not_found');
}
{
  let auth = true, enabled = false, adminCalls = 0;
  const handler = createCourseImageHandler({ authenticate: async () => { if(!auth)throw new Error('private auth reason');return {user:{id:randomUUID()}}; },
    admin: () => {adminCalls++;return {};},enabled:()=>enabled,background:()=>{throw new Error('Must not dispatch');} });
  async function call(method,url,body){
    const response={headers:{},code:0,setHeader(k,v){this.headers[k]=v;},status(value){this.code=value;return this;},json(value){this.body=value;return this;}};
    await handler({method,url,body},response);
    check(response.headers['Cache-Control']==='private, no-store' && response.headers['X-Content-Type-Options']==='nosniff','API defensive cache/type headers');return response;
  }
  check((await call('DELETE','/api/courses/images')).code===405,'API method allowlist');
  auth=false;check((await call('GET','/api/courses/images')).code===401,'API auth required');auth=true;
  for(const action of ['start','resume'])check((await call('POST','/api/courses/images',{action})).code===503,'paid action gated off');
  check((await call('GET','/api/courses/images?action=inspect')).code===503,'generation quote gated while UI not enabled');
  for(const action of ['start','cancel','discard','cleanup','reconcile','resume'])check((await call('GET',`/api/courses/images?action=${action}`)).code===400,'GET cannot mutate or dispatch');
  check(adminCalls===0,'denied requests never reach database');
  enabled=true;
  check((await call('POST','/api/courses/images','{invalid')).code===400,'invalid JSON rejected');
  check((await call('POST','/api/courses/images',{prompt:'x'.repeat(25000)})).code===400,'oversized body rejected');
  check((await call('POST','/api/courses/images',{action:'unrecognized'})).code===400,'unknown action rejected');
  const raw=await call('GET','/api/courses/images?courseId=test&operationId='+randomUUID());
  check(raw.code===503&&!raw.body.error.includes('from is not a function'),'unexpected internal failures sanitized');
}
// The application deadline must preserve uncertain receipts, not retry a charge.
for (const lateStage of ['provider', 'storage']) {
  const f = fixture(), a = await f.prepare(), before = JSON.stringify(f.course());
  await startImageRequest(a);
  const { budget, advance } = executionClock(), stalled = deferred();
  if (lateStage === 'provider') f.hooks.generate = request => {
    check(request.signal === budget.signal, 'provider receives invocation cancellation'); return stalled.promise;
  };
  else f.hooks.afterPut = () => stalled.promise;
  const worker = budget.wait(() => runImageRequest({ ...a, signal: budget.signal, remainingMs: budget.remainingMs }));
  const stopped = assert.rejects(worker, { name: 'ImageExecutionTimeout' });
  await flush();
  check(f.stats().calls === 1, 'one dispatch before deadline');
  advance(270000); await stopped; checks++;
  check(budget.signal.aborted, 'invocation aborts before platform ceiling');
  stalled.resolve(lateStage === 'provider' ? f.output() : true); await flush();
  check(f.stats().puts === (lateStage === 'provider' ? 0 : 1), 'late provider output cannot begin an upload');
  f.advance();
  const recovered = await reconcileImageRequest(a);
  check(recovered.request.status === (lateStage === 'provider' ? 'unknown' : 'ready'), 'uncertain call or committed exact asset recovers honestly');
  check(recovered.request.mayHaveCharged, 'deadline never claims dispatched work was free');
  await runImageRequest(a); await reconcileImageRequest(a);
  check(f.stats().calls === 1 && JSON.stringify(f.course()) === before, 'recovery never redispatches or changes accepted lesson');
  budget.close();
}
for (const afterClaim of [false, true]) {
  const f = fixture(), a = await f.prepare(); await startImageRequest(a);
  let reads = 0;
  const result = await runImageRequest({ ...a, remainingMs: () => afterClaim && ++reads === 1 ? 270000 : 209999 });
  check(result.request.status === 'failed' && result.request.error === 'not_started', 'insufficient dispatch window is a known not-started result');
  check(!result.request.mayHaveCharged && f.stats().calls === 0, 'time consumed before or during claim cannot start paid work');
}
console.log(`Durable image requests: ${checks} checks passed. Synthetic store/provider/storage only; no paid calls.`);
