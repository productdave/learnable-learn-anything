// Run every packaged entrypoint in its own dependency sandbox with network off.
// Does not emulate Vercel's hosted launcher or claim hosted URL/cron acceptance.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, mkdtempSync, cpSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { syncBuiltinESMExports } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { pdfFixture, docxFixture } from './fixtures/source-documents.mjs';

const sha = bytes => createHash('sha256').update(bytes).digest('hex');
function blockNetwork() {
  const deny = () => { throw Error('Network disabled in grouped runtime QA.'); };
  globalThis.fetch = deny; http.get = http.request = https.get = https.request = net.connect = net.createConnection = deny;
  net.Socket.prototype.connect = deny; syncBuiltinESMExports();
}
function inventory(directory, prefix = '') {
  return readdirSync(join(directory, prefix), { withFileTypes: true }).flatMap(entry => {
    assert.ok(!entry.isSymbolicLink(), 'No external dependency fallback symlinks.');
    const path = prefix + entry.name;
    return entry.isDirectory() ? inventory(directory, path + '/') : [path];
  }).sort();
}
function response() {
  return { statusCode: 200, headers: {}, setHeader(k,v) { this.headers[k.toLowerCase()] = v; }, status(code) { this.statusCode = code; return this; }, json(body) { this.body = body; return this; }, end(body) { this.body = body; return this; } };
}
function request(url, method, body = {}) {
  return { url, method, headers: {}, body, query: {}, async *[Symbol.asyncIterator]() { yield Buffer.from(JSON.stringify(body)); } };
}
async function snapshot(handler, req) {
  const res = response();
  try { await handler(req, res); }
  catch (error) { return { thrown: error.message, code: error.statusCode }; }
  return { status: res.statusCode, headers: res.headers, body: res.body };
}

async function worker(bundle, group) {
  blockNetwork();
  const checks = [], check = async (label, run) => { await run(); checks.push(label); };
  const runtime = JSON.parse(readFileSync(join(bundle, '.vc-config.json')));
  const grouped = (await import(pathToFileURL(join(bundle, runtime.handler)))).default;
  await check('Node launcher helpers and timeout retained', () => {
    assert.equal(runtime.runtime,'nodejs22.x');assert.equal(runtime.launcherType,'Nodejs');assert.equal(runtime.shouldAddHelpers,true);assert.equal(runtime.maxDuration,group.maxDuration);
  });
  for (const route of group.routes) {
    const direct = (await import(pathToFileURL(join(bundle, `api/${route}.js`)))).default;
    for (const method of ['GET','POST','PUT','PATCH','DELETE','HEAD','OPTIONS']) await check(`${route} ${method}: original response contract`, async () => {
      const url = `/api/${route}?id=example&tag=one&tag=two`;
      assert.deepEqual(await snapshot(grouped,request(url,method)),await snapshot(direct,request(url,method)));
    });
  }
  await check('private implementation path denied', async () => assert.equal((await snapshot(grouped,request('/api/_lib/supabase-server.mjs','GET'))).status,404));
  await check('physical function path denied', async () => assert.equal((await snapshot(grouped,request(`/_functions/${group.id}`,'GET'))).status,404));
  await check('unknown route denied', async () => assert.equal((await snapshot(grouped,request('/api/unknown/path','GET'))).status,404));
  if (group.id === 'images' && group.files['api/_lib/image-execution.mjs']) {
    const { createImageExecution, IMAGE_EXECUTION_MS, IMAGE_FOREGROUND_MS, IMAGE_IO_MS } = await import(pathToFileURL(join(bundle,'api/_lib/image-execution.mjs')));
    await check('actual packaged image budgets fit Hobby', () => {
      assert.equal(runtime.maxDuration,300); assert.equal(IMAGE_EXECUTION_MS,270000); assert.equal(IMAGE_FOREGROUND_MS,25000); assert.equal(IMAGE_IO_MS,30000);
    });
    await check('actual packaged deadline stops a stalled background operation', async () => {
      let expire; const budget = createImageExecution({ schedule: callback => { expire = callback; return 1; }, unschedule: () => {} });
      const pending = budget.wait(() => new Promise(() => {})), rejection = assert.rejects(pending,{name:'ImageExecutionTimeout'});
      expire(); await rejection; assert.equal(budget.signal.aborted,true); budget.close();
    });
    await check('actual packaged cancelled work cannot dispatch network I/O', () => {
      let calls=0; const budget=createImageExecution({fetcher:()=>{calls++;}});budget.close();
      assert.throws(()=>budget.fetch('https://never-contacted.invalid'));assert.equal(calls,0);
    });
  }
  if (group.files['api/_lib/document-reader.mjs']) {
    const { readDocument } = await import(pathToFileURL(join(bundle,'api/_lib/document-reader.mjs')));
    await check('PDF worker reads both pages',async()=>{const value=await readDocument(pdfFixture(['First grouped page','Second grouped page']),'pdf');assert.equal(value.pages,2);assert.match(value.text,/First grouped page/);assert.match(value.text,/Second grouped page/);});
    await check('DOCX worker preserves Unicode',async()=>assert.match((await readDocument(docxFixture(['Grouped Word café 日本語']),'docx')).text,/Grouped Word café 日本語/));
    await check('TXT worker preserves Unicode',async()=>assert.equal((await readDocument(Buffer.from('Transcript café 日本語'),'txt')).text,'Transcript café 日本語'));
    await check('scanned PDF gives actionable rejection',async()=>assert.rejects(readDocument(pdfFixture(['']),'pdf'),error=>error.code==='no-selectable-text'));
  }
  console.log('GROUPED_QA=' + JSON.stringify({group:group.id,checks}));
}

if (process.argv[2] === '--worker') await worker(resolve(process.argv[3]), JSON.parse(readFileSync(process.argv[4])));
else {
  const artifact = resolve(process.argv[2] || 'missing-artifact'), report = JSON.parse(readFileSync(join(artifact,'packaging-report.json')));
  const output = join(artifact,'.vercel/output'), checks = [];
  const config = JSON.parse(readFileSync(join(output,'config.json')));
  assert.equal(sha(readFileSync(join(output,'config.json'))),report.configSha256);
  assert.equal(readdirSync(join(output,'functions/_functions')).length,8);
  assert.deepEqual(inventory(join(output,'static')),Object.keys(report.staticFiles).sort());
  for(const[path,hash]of Object.entries(report.staticFiles))assert.equal(sha(readFileSync(join(output,'static',path))),hash);
  assert.ok(report.staticFiles['favicon.svg'], 'The HTML favicon must be included in the exact static inventory.');
  checks.push('eight functions, static inventory and exact preserved bytes');
  for(const path of ['/_functions/courses','/api/_lib/supabase-server.mjs','/api/unrecognized','.vercel/project.json'].map(p=>p.startsWith('/')?p:'/'+p)) {
    assert.equal(config.routes.find(r=>r.src&&new RegExp(r.src).test(path)&&!r.continue)?.status,404,path);
  }
  checks.push('private and unknown routes denied before filesystem fallback');
  const qa = mkdtempSync(join(tmpdir(),'learnable-grouped-qa-'));
  for (const group of report.groups) {
    const source=join(output,`functions/_functions/${group.id}.func`);
    assert.deepEqual(inventory(source),Object.keys(group.files).sort());
    for(const[path,hash]of Object.entries(group.files))assert.equal(sha(readFileSync(join(source,path))),hash);
    // Copy outside the workspace so missing modules cannot resolve from it.
    const bundle=join(qa,group.id);mkdirSync(bundle);cpSync(source,bundle,{recursive:true});
    const groupPath=join(qa,group.id+'.json');writeFileSync(groupPath,JSON.stringify(group),{flag:'wx'});
    const env=Object.fromEntries(['PATH','HOME','TMPDIR','LANG'].filter(key=>process.env[key]).map(key=>[key,process.env[key]]));
    const result=spawnSync(process.execPath,[fileURLToPath(import.meta.url),'--worker',bundle,groupPath],{cwd:bundle,env,encoding:'utf8',timeout:60000,maxBuffer:1024*1024});
    const marker=result.stdout?.split('\n').find(line=>line.startsWith('GROUPED_QA='));
    assert.equal(result.status,0,`${group.id}: ${result.stderr?.slice(-3000)}`);assert.ok(marker,`${group.id} probe did not finish`);
    const resultChecks=JSON.parse(marker.slice(11)).checks;checks.push(...resultChecks.map(label=>group.id+': '+label));
    console.log(`${group.id}: ${resultChecks.length} packaged runtime checks passed`);
  }
  const result={status:'passed-local-grouped-runtime-not-hosted-acceptance',at:new Date().toISOString(),checks,artifact,qa,network:'blocked',production:'unchanged',limitations:report.limitations};
  writeFileSync(join(artifact,'qa-report.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({status:result.status,checks:checks.length,report:join(artifact,'qa-report.json')}));
}
