import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createGroupedHandler } from './packaging/grouped-router.mjs';
import { functionGroups, endpointPaths, validateEndpoints, groupEntrypoint, buildOutputConfig, staticFile } from './packaging/grouped-manifest.mjs';

let checks = 0;
async function check(name, test) { await test(); checks++; }
function response() { return { headers: {}, setHeader(k,v) { this.headers[k] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end(body) { this.body = body; return this; } }; }
const files = new Map(endpointPaths.map(path => [path, readFileSync(new URL('../web/' + path, import.meta.url))]));
const config = buildOutputConfig(JSON.parse(readFileSync(new URL('../web/vercel.json', import.meta.url))));
await check('26 routes, 8 groups', () => { assert.equal(endpointPaths.length, 26); assert.equal(functionGroups.length, 8); validateEndpoints(files); });
await check('unknown route fails closed at build', () => assert.throws(() => validateEndpoints(new Map([...files, ['api/new/action.js', Buffer.from('')]])), /inventory changed/));
await check('root, nested and mjs endpoints cannot disappear silently', () => {
  for (const path of ['api/new.js','api/new/nested/action.js','api/new/action.mjs']) assert.throws(() => validateEndpoints(new Map([...files,[path,Buffer.from('')]])),/inventory changed/);
});
await check('missing route fails closed at build', () => { const changed = new Map(files); changed.delete(endpointPaths[0]); assert.throws(() => validateEndpoints(changed), /inventory changed/); });
await check('longer timeout requires review', () => { const changed = new Map(files); changed.set('api/courses/images.js', Buffer.from('export const config = { maxDuration: 500 };')); assert.throws(() => validateEndpoints(changed), /shortens/); });
await check('Hobby image ceiling', () => assert.equal(functionGroups.find(g => g.id === 'images').maxDuration, 300));

for (const group of functionGroups) for (const route of group.routes) {
  await check(`${route}: exact dispatch and untouched request/response`, async () => {
    let imports = 0, calls = 0;
    const req = { method: 'POST', url: `/api/${route}?tag=one&tag=two&action=other`, headers: { authorization: 'Bearer test-only' }, body: { text: 'café 日本語' }, query: { tag: ['one', 'two'] } };
    const res = response(), original = JSON.stringify(req);
    const handler = createGroupedHandler({ [`/api/${route}`]: async () => { imports++; return { default: (request, reply) => { assert.equal(request, req); assert.equal(reply, res); calls++; return 'original-result'; } }; } });
    assert.equal(await handler(req, res), 'original-result'); assert.equal(await handler(req, res), 'original-result');
    assert.equal(imports, 1); assert.equal(calls, 2); assert.equal(JSON.stringify(req), original);
    const rule = config.routes.find(rule => rule.dest && new RegExp(rule.src).test(`/api/${route}`));
    assert.equal(rule.dest, `/_functions/${group.id}`);
    assert.match(groupEntrypoint(group), new RegExp(`import\\(['"]\\.\\./${route}\\.js`));
  });
}
await check('aliases preserve request path', async () => {
  const router = createGroupedHandler({ '/api/courses/get': async () => ({ default: req => req.url }) });
  for (const url of ['/api/courses/get/', '/api/courses/get.js', '/api/courses/get.js/?id=one']) assert.equal(await router({url},response()),url);
});
for (const url of ['/api/unknown', '/api/courses/get/extra', '/api/courses/%67et', '/api/courses/../courses/get', '/api/courses/get//', '/api/courses/GET', '/_functions/courses', '/api/_lib/grouped-router.mjs', '/api/__proto__', '/api/courses/get%2f']) {
  await check(`reject ${url} without importing`, async () => {
    let imports = 0; const router = createGroupedHandler({ '/api/courses/get': () => { imports++; throw Error('must not import'); } });
    const res = response(); await router({ url, headers: { 'x-matched-path': '/api/courses/get' }, query: { route: '/api/courses/get' } }, res);
    assert.equal(res.statusCode, 404); assert.equal(imports, 0); assert.equal(res.headers['Cache-Control'], 'no-store');
  });
}
await check('all methods remain handler-owned', async () => {
  const router = createGroupedHandler({ '/api/courses/get': async () => ({ default: req => req.method }) });
  for (const method of ['GET','POST','PATCH','PUT','DELETE','HEAD','OPTIONS']) assert.equal(await router({ url: '/api/courses/get', method }, response()), method);
});
await check('raw stream remains untouched', async () => {
  const chunks = [Buffer.from('{"a":'),Buffer.from('1}')];
  const req = {url:'/api/setups/store', async *[Symbol.asyncIterator]() { yield* chunks; }};
  const router = createGroupedHandler({ '/api/setups/store': async () => ({ default: async request => { const got = []; for await (const c of request) got.push(c); return Buffer.concat(got).toString(); } }) });
  assert.equal(await router(req,response()),'{"a":1}');
});
await check('binary image responses stay binary', async () => {
  const bytes=Buffer.from([0,137,255,12]), res=response();
  const router=createGroupedHandler({'/api/courses/public-image':async()=>({default:(_req,r)=>{r.setHeader('Content-Type','image/png');return r.status(200).end(bytes);}})});
  await router({url:'/api/courses/public-image'},res); assert.equal(res.body,bytes); assert.equal(res.headers['Content-Type'],'image/png');
});
await check('concurrent imports share module, never account data', async () => {
  let imports=0; const router=createGroupedHandler({'/api/courses/get':async()=>{imports++;return{default:async req=>req.headers.authorization};}});
  assert.deepEqual(await Promise.all(['a','b'].map(authorization=>router({url:'/api/courses/get',headers:{authorization}},response()))),['a','b']); assert.equal(imports,1);
});
await check('failed import can recover', async () => {
  let attempts=0;const router=createGroupedHandler({'/api/courses/get':async()=>{if(!attempts++)throw Error('temporary');return{default:()=>42};}});
  await assert.rejects(router({url:'/api/courses/get'},response()),/temporary/);assert.equal(await router({url:'/api/courses/get'},response()),42);
});
await check('handler errors propagate unchanged', async () => {
  const error=Error('original'); const router=createGroupedHandler({'/api/courses/get':async()=>({default:()=>{throw error;}})});
  await assert.rejects(router({url:'/api/courses/get'},response()),candidate=>candidate===error);
});
await check('cron path and cadence unchanged', () => assert.deepEqual(config.crons,[{path:'/api/gen/sweep',schedule:'0 0 * * *'}]));
await check('routing never changes query parameters', () => { for (const r of config.routes) if(r.dest)assert.ok(!r.dest.includes('?')); });
await check('no API source in static files', () => { for(const p of [...endpointPaths,'api/_lib/supabase-server.mjs','package.json','package-lock.json','vercel.json','.env','.vercel/project.json','secrets.json','README.md'])assert.equal(staticFile(p),false,p); });
await check('old and new assets remain public', () => { for(const p of ['index.html','favicon.svg','js/app.js','js-dinner-release/app.js','styles/theme.css','data/courses/test/course.json','assets/icon.png'])assert.equal(staticFile(p),true,p); });
await check('favicon exception does not expose other root files', () => { for(const p of ['favicon.svg.bak','secret.svg','secrets.json'])assert.equal(staticFile(p),false,p); });
await check('unexpected routing is not silently discarded',()=>assert.throws(()=>buildOutputConfig({...JSON.parse(readFileSync(new URL('../web/vercel.json',import.meta.url))),rewrites:[]}),/additional routing/));
console.log(`Grouped function contracts passed (${checks} checks; no network or deployment).`);
