// Fresh derivative of the accepted image-loading staging build. No deployment here.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,cpSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync,spawnSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {baseInventory,digest,tree} from '../packaging/grounding-release.mjs';
import {readBrowserGraph,assertGraphConsistency} from '../browser-contract.mjs';
const root=resolve(import.meta.dirname,'../..'),dir=join(root,'output/staging/2026-10-17-owner-funded');
const prior=JSON.parse(readFileSync(join(root,'output/staging/2026-10-17-image-loading/prepared.json')));
const reportBytes=readFileSync(join(prior.artifact,'packaging-report.json')),base=JSON.parse(reportBytes),oldInventory=baseInventory(base),oldOut=join(prior.artifact,'.vercel/output');
assert.equal(digest(reportBytes),prior.reportSha256);assert.deepEqual(tree(oldOut),Object.keys(oldInventory).sort());
for(const[p,h]of Object.entries(oldInventory))assert.equal(digest(readFileSync(join(oldOut,p))),h,p);
mkdirSync(dir,{recursive:true});const artifact=mkdtempSync(join(dir,'release-'));cpSync(join(prior.artifact,'.vercel'),join(artifact,'.vercel'),{recursive:true});
const out=join(artifact,'.vercel/output'),staticDir=join(out,'static'),ns='js-owner-funded-20261017',changed=[];
const files=['api/_lib/openrouter-policy.mjs','api/_lib/openrouter-admission.mjs','api/_lib/generation-provider.mjs','api/setups/generate.js'];
for(const file of files){
 const old=execFileSync('git',['show','ae24f9a:web/'+file],{cwd:root,encoding:'utf8'}).replaceAll('../../js/','../../'+base.serverNamespace+'/');
 const next=readFileSync(join(root,'web',file),'utf8').replaceAll('../../js/','../../'+base.serverNamespace+'/');
 for(const g of base.groups.filter(g=>g.files[file])){const path='functions/_functions/'+g.id+'.func/'+file;assert.equal(readFileSync(join(out,path),'utf8'),old);writeFileSync(join(out,path),next);changed.push(path);}
}
cpSync(join(staticDir,base.namespace),join(staticDir,ns),{recursive:true});
const ui=join(staticDir,ns,'setup-create.js'),oldUi=readFileSync(ui,'utf8');assert.equal(oldUi.split('This staging test uses the testing allowance.').length,2);
writeFileSync(ui,oldUi.replace('This staging test uses the testing allowance.','Usage is charged to Learnable’s connected OpenRouter account.'));
for(const p of Object.keys(base.staticFiles).filter(p=>p.endsWith('.html'))){const path=join(staticDir,p),old=readFileSync(path,'utf8');if(old.includes(base.namespace)){writeFileSync(path,old.replaceAll(base.namespace,ns));changed.push('static/'+p);}}
const report={...base,at:new Date().toISOString(),artifact,namespace:ns,status:'OWNER_FUNDED_STAGING_PREPARED',derivedFrom:prior.artifact,derivedFromHash:prior.reportSha256,ownerFunded:{changed,scope:'Explicit owner-funded mode, genuine managed readiness and consent wording; old capped mode retained.'}};
report.staticFiles=Object.fromEntries(tree(staticDir).map(p=>[p,digest(readFileSync(join(staticDir,p)))]));
report.groups=base.groups.map(g=>({...g,files:Object.fromEntries(tree(join(out,'functions/_functions/'+g.id+'.func')).map(p=>[p,digest(readFileSync(join(out,'functions/_functions/'+g.id+'.func',p)))]))}));
const inventory=baseInventory(report);assert.deepEqual(tree(out),Object.keys(inventory).sort());for(const[p,h]of Object.entries(oldInventory))if(!changed.includes(p))assert.equal(inventory[p],h,p);
for(const p of tree(join(staticDir,base.namespace)))if(p!=='setup-create.js')assert.equal(report.staticFiles[ns+'/'+p],base.staticFiles[base.namespace+'/'+p],p);
const graphRoot=mkdtempSync(join(dir,'browser-check-'));symlinkSync(staticDir,join(graphRoot,'web'));const graph=readBrowserGraph(graphRoot,[ns+'/app.js']);assertGraphConsistency(graph);
let tests=0;
for(const name of ['test-openrouter-admission.mjs','test-openrouter-generation.mjs','test-openrouter-client.mjs','test-openrouter-native.mjs','test-openrouter-image.mjs']){
 let source=readFileSync(join(root,'scripts',name),'utf8').replaceAll(/from '([^']+)'/g,(whole,spec)=>{
  if(spec.startsWith('../web/')){const target=spec.slice(7).replace(/^js\//,base.serverNamespace+'/'),g=report.groups.find(g=>g.files[target]);assert(g,spec);return "from '"+pathToFileURL(join(out,'functions/_functions/'+g.id+'.func',target)).href+"'";}
  if(spec.startsWith('./fixtures/'))return "from '"+pathToFileURL(join(root,'scripts',spec)).href+"'";return whole;
 });
 const path=join(artifact,name);writeFileSync(path,source);const r=spawnSync(process.execPath,['--test',path],{cwd:root,encoding:'utf8',timeout:45000,maxBuffer:5e6,env:{PATH:process.env.PATH,SUPABASE_URL:'https://synthetic.supabase.invalid',SUPABASE_ANON_KEY:'synthetic',SUPABASE_SERVICE_ROLE_KEY:'synthetic'}});
 const log=r.stdout+r.stderr;writeFileSync(path+'.log',log);assert.equal(r.status,0,'Actual-package '+name);tests+=Number(log.match(/^# tests (\d+)/m)?.[1]||0);
}
let imports=0;globalThis.fetch=()=>assert.fail('Offline import accessed network');
for(const g of report.groups)for(const p of Object.keys(g.files).filter(p=>(p.startsWith('api/')||p.startsWith(report.serverNamespace+'/generator/'))&&/\.(mjs|js)$/.test(p))){await import(pathToFileURL(join(out,'functions/_functions/'+g.id+'.func',p)).href);imports++;}
writeFileSync(join(artifact,'packaging-report.json'),JSON.stringify(report,null,2)+'\n');
const result={at:report.at,artifact,reportSha256:digest(readFileSync(join(artifact,'packaging-report.json'))),sourceDeployment:'dpl_6sHVyzoakQRKZN2PvT4GCVmN2j4W',namespace:ns,changed,functions:report.groups.length,files:Object.keys(inventory).length,actualPackageTests:tests,imports,browserModules:graph.sources.size,providerCalls:0};
writeFileSync(join(dir,'prepared.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
