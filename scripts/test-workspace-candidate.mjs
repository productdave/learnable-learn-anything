import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { candidatePayloads, verifyCandidate } from './assemble-workspace-candidate.mjs';
import { digest, transform, releaseName } from './plan-workspace-release.mjs';

const old=Buffer.from([137,80,78,71,255,0]), source=Buffer.from('<script src="js/app.js?v=167"></script>'), html=transform('index.html',source);
const record=(origin,source,bytes)=>({origin,source,sha256:digest(bytes),bytes:bytes.length});
const plan={status:'planning-only-not-deployable',files:{'data/courses/old/assets/image.png':record('baseline','data/courses/old/assets/image.png',old),'index.html':record('workspace','index.html',html)}};
const sources={baseline:new Map([['data/courses/old/assets/image.png',old]]),workspace:new Map([['index.html',source]])};
let checks=0;const check=fn=>{fn();checks++;};
const payloads=candidatePayloads(plan,sources);
check(()=>assert.deepEqual(payloads.get('data/courses/old/assets/image.png'),old));
check(()=>assert.equal(payloads.get('index.html').toString(),`<script src="js-${releaseName}/app.js?v=167"></script>`));
check(()=>assert.throws(()=>candidatePayloads({...plan,status:'approved'},sources),/planning-only/));
check(()=>assert.throws(()=>candidatePayloads(plan,{...sources,workspace:new Map()}),/Missing source/));
check(()=>assert.throws(()=>candidatePayloads(plan,{...sources,workspace:new Map([['index.html',Buffer.from('changed')]])}),/mismatch/));
check(()=>assert.throws(()=>candidatePayloads({...plan,files:{'../escape':plan.files['index.html']}},sources),/Excluded path/));
check(()=>assert.throws(()=>candidatePayloads({...plan,files:{'file':{...plan.files['index.html'],source:'.env'}}},sources),/Excluded path/));
check(()=>assert.throws(()=>candidatePayloads({...plan,files:{'file':{...plan.files['index.html'],origin:'secret'}}},sources),/Unknown source/));
check(()=>assert.throws(()=>candidatePayloads({...plan,files:{'index.html':{...plan.files['index.html'],bytes:0}}},sources),/size mismatch/));
const dir=mkdtempSync(join(tmpdir(),'learnable-candidate-test-'));
try{
  mkdirSync(join(dir,'data/courses/old/assets'),{recursive:true});
  for(const[path,bytes]of payloads)writeFileSync(join(dir,path),bytes);
  check(()=>assert.equal(verifyCandidate(dir,plan),2));
  writeFileSync(join(dir,'index.html'),'altered');
  check(()=>assert.throws(()=>verifyCandidate(dir,plan),/hash changed/));
  writeFileSync(join(dir,'index.html'),html);writeFileSync(join(dir,'unexpected.txt'),'extra');
  check(()=>assert.throws(()=>verifyCandidate(dir,plan),/inventory/));
}finally{rmSync(dir,{recursive:true,force:true});}
console.log(`workspace candidate contracts passed (${checks} checks; binary preservation, frozen scope, no deploy)`);
