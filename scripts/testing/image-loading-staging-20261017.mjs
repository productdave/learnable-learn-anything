// Browser-only derivative of the accepted OpenRouter staging deployment.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync,mkdtempSync,cpSync,symlinkSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {spawnSync} from 'node:child_process';
import {baseInventory,digest,tree} from '../packaging/grounding-release.mjs';
import {readBrowserGraph,assertGraphConsistency} from '../browser-contract.mjs';
const root=resolve(import.meta.dirname,'../..'),dir=join(root,'output/staging/2026-10-17-image-loading');
const parent=join(root,'output/staging/2026-10-13-openrouter-image-repair/release-2yNIvR');
const expected='b961b167613da862ebd75143a6dceb8b0cda5f1fd7b600a307330a876832415c';
const bytes=readFileSync(join(parent,'packaging-report.json')),base=JSON.parse(bytes),inventory=baseInventory(base),priorOut=join(parent,'.vercel/output');
assert.equal(digest(bytes),expected);assert.deepEqual(tree(priorOut),Object.keys(inventory).sort());
for(const[p,h]of Object.entries(inventory))assert.equal(digest(readFileSync(join(priorOut,p))),h,p);
mkdirSync(dir,{recursive:true});const artifact=mkdtempSync(join(dir,'release-'));cpSync(join(parent,'.vercel'),join(artifact,'.vercel'),{recursive:true});
const out=join(artifact,'.vercel/output'),ns='js-image-loading-20261017',staticDir=join(out,'static');
cpSync(join(staticDir,base.namespace),join(staticDir,ns),{recursive:true});
const topicFile=join(staticDir,ns,'components/topic-view.js'),oldTopic=readFileSync(topicFile,'utf8'),sourceTopic=readFileSync(join(root,'web/js/components/topic-view.js'),'utf8');
const render=s=>s.slice(s.indexOf('function renderImageSection('),s.indexOf('\nfunction renderConcept('));
assert(render(oldTopic).includes('Loading your saved image'));
writeFileSync(topicFile,oldTopic.replace(render(oldTopic),render(sourceTopic)));
const loaderFile=join(staticDir,ns,'private-course-images.js'),oldLoader=readFileSync(loaderFile,'utf8'),sourceLoader=readFileSync(join(root,'web/js/private-course-images.js'),'utf8');
const oldImports=oldLoader.match(/^import .*;$/gm).join('\n');
writeFileSync(loaderFile,oldImports+'\n'+sourceLoader.replace(/^import .*;\n/gm,''));
const css=readFileSync(join(root,'web/styles/components.css'),'utf8');
const cssFile='styles-image-loading-20261017.css',cssStart=css.indexOf('/* Generated course assets are square.');assert(cssStart>=0);
writeFileSync(join(staticDir,cssFile),css.slice(cssStart,css.indexOf('.topic-image-fallback {',cssStart)));
const changedExisting=[];
for(const p of Object.keys(base.staticFiles).filter(p=>p.endsWith('.html'))){const file=join(staticDir,p),old=readFileSync(file,'utf8');if(!old.includes(base.namespace))continue;const next=old.replaceAll(base.namespace,ns).replace('</head>',`  <link rel="stylesheet" href="${cssFile}">\n</head>`);writeFileSync(file,next);changedExisting.push('static/'+p);}
const report={...base,at:new Date().toISOString(),artifact,namespace:ns,status:'IMAGE_LOADING_STAGING_PREPARED',derivedFrom:parent,derivedFromHash:expected,
 imageLoading:{changedExisting,cssFile,scope:'Saved-image loading/loaded/error/account states only; all backend files unchanged.'},
 staticFiles:Object.fromEntries(tree(staticDir).map(p=>[p,digest(readFileSync(join(staticDir,p)))]))};
const next=baseInventory(report);assert.deepEqual(tree(out),Object.keys(next).sort());
for(const[p,h]of Object.entries(inventory))if(!changedExisting.includes(p))assert.equal(next[p],h,p);
for(const p of tree(join(staticDir,base.namespace)))if(!['private-course-images.js','components/topic-view.js'].includes(p))assert.equal(digest(readFileSync(join(staticDir,ns,p))),base.staticFiles[base.namespace+'/'+p],p);
const graphRoot=mkdtempSync(join(dir,'browser-check-'));symlinkSync(staticDir,join(graphRoot,'web'));
const graph=readBrowserGraph(graphRoot,[ns+'/app.js']);assertGraphConsistency(graph);
const run=spawnSync(process.execPath,['--test','scripts/test-private-image-loading.mjs'],{cwd:root,env:{...process.env,IMAGE_JS_ROOT:join(staticDir,ns)},encoding:'utf8',timeout:30000});
writeFileSync(join(artifact,'image-tests.log'),run.stdout+run.stderr);assert.equal(run.status,0,'Actual-package loading cases');
for(const p of ['components/topic-view.js','private-course-images.js'])assert.equal(spawnSync(process.execPath,['--check',join(staticDir,ns,p)],{encoding:'utf8'}).status,0);
writeFileSync(join(artifact,'packaging-report.json'),JSON.stringify(report,null,2)+'\n');
const result={at:report.at,artifact,reportSha256:digest(readFileSync(join(artifact,'packaging-report.json'))),sourceDeployment:'dpl_2Fv5qsGPcvxhu1Qac1wjRQoKSVcy',namespace:ns,cssFile,functions:report.groups.length,files:Object.keys(next).length,preservedOriginalFiles:Object.keys(inventory).length-changedExisting.length,changedExisting,browserModules:graph.sources.size,actualPackageCases:5,serverBytesUnchanged:true,providerCalls:0};
writeFileSync(join(dir,'prepared.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify(result));
