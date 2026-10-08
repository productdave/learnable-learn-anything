import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {verifiedStagingFiles} from './package-grouped-functions.mjs';
import {applySourceRecoveryOverlay,recoveryNamespace,recoveryBaseNamespace} from './packaging/source-recovery-overlay.mjs';
import {moduleReferences} from './browser-contract.mjs';
const read=p=>JSON.parse(readFileSync('docs/upgrade/'+p));
const budget=read('hobby-image-budget-scope-2026-09-18.json'),account=read('account-frontend-scope-2026-09-19.json'),scope=read('source-recovery-scope-2026-09-19.json');
const base=verifiedStagingFiles(process.cwd()+'/output/staging/2026-09-18',budget,account).files;
const source=readFileSync('web/js/course-setup.js'),result=applySourceRecoveryOverlay(base,source,scope);
let checks=0;const check=(ok,label)=>{assert.ok(ok,label);checks++;};
for(const[p,b]of base)if(p!=='index.html')assert.equal(result.get(p),b,'Prior bytes preserved: '+p);
checks++;
check(result.get('index.html').toString().includes('js-'+recoveryNamespace+'/app.js'),'HTML selects fresh graph');
check(result.get('js-'+recoveryNamespace+'/course-setup.js').equals(source),'Only selected runtime source replaced');
for(const [p,b]of result)if(!base.has(p)&&!p.endsWith('/course-setup.js')){
  assert.equal(b.toString(),base.get(p.replace(recoveryNamespace,recoveryBaseNamespace)).toString().replaceAll(`js-${recoveryBaseNamespace}/`,`js-${recoveryNamespace}/`).replaceAll(`styles-${recoveryBaseNamespace}/`,`styles-${recoveryNamespace}/`));
}
checks++;
const pending=['js-'+recoveryNamespace+'/app.js'],seen=new Set(),refs=new Map();
while(pending.length){const p=pending.pop();if(seen.has(p))continue;seen.add(p);
 for(const ref of moduleReferences(result.get(p).toString()))if(ref.startsWith('.')){
  const url=new URL(ref,'https://qa.invalid/'+p),target=url.pathname.slice(1);
  assert.ok(target.startsWith('js-'+recoveryNamespace+'/'));
  if(refs.has(target))assert.equal(refs.get(target),url.search,'Singleton URL');
  refs.set(target,url.search);pending.push(target);
 }
}
check(seen.size===79,'Complete 79-module graph');
for(const mutate of [
 ()=>applySourceRecoveryOverlay(new Map([...base,['drift.txt',Buffer.from('x')]]),source,scope),
 ()=>applySourceRecoveryOverlay(base,Buffer.from('drift'),scope),
 ()=>applySourceRecoveryOverlay(base,source,{...scope,sources:{...scope.sources,'api/gen/start.js':'x'}}),
 ()=>applySourceRecoveryOverlay(base,source,{...scope,purpose:'anything'}),
 ()=>applySourceRecoveryOverlay(base,source,{...scope,namespace:recoveryBaseNamespace}),
 ()=>applySourceRecoveryOverlay(result,source,scope)
]){assert.throws(mutate);checks++;}
check(![...result.keys()].some(p=>/secrets\.json|\.env/.test(p)),'No secret files');
console.log(`${checks} source-recovery overlay checks passed; prior namespaces and server inputs unchanged; 79 modules.`);
