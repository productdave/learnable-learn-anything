// Fresh derivative of the accepted staging build. No deploy, migration or AI.
import assert from 'node:assert/strict';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve,join,dirname,posix} from 'node:path';
import {execFileSync} from 'node:child_process';
import {baseInventory,digest,tree} from './packaging/grounding-release.mjs';
const root=resolve(import.meta.dirname,'..');
const parent='/Users/davidwang/Learnable/output/staging/2026-10-11-agent-dashboard/release-wimJ14';
const parentHash='fcc7a6bab887b6919c6aeb2e76a55ac378c99691c8cdf2ef252333706f8a3d1a';
const directory=join(root,'output/staging/2026-10-11-openrouter');
const namespace='js-openrouter-staging-20261011';
const apiFiles=['course-refinement.mjs','gen-runner.mjs','gen-request-budget.mjs','gen-continuation.mjs','generation-provider.mjs','generation-observability.mjs','image-acceptance.mjs','image-request.mjs','integrated-course-images.mjs','openai-image.mjs','openrouter-client.mjs','openrouter-policy.mjs','openrouter-native.mjs','openrouter-image.mjs','openrouter-receipt.mjs','openrouter-admission.mjs','ai-spend-ledger.mjs','publication-images.mjs','visual-designer.mjs','setup-generation.mjs'].map(p=>'api/_lib/'+p).concat(['api/gen/start.js','api/gen/review.js','api/gen/resume.js','api/gen/restart.js','api/gen/sweep.js','api/gen/credentials-ready.js','api/gen/watchdog.js','api/providers/connection.js','api/setups/generate.js']);
const browserFiles=['intake.js','course-readiness-view.js','setup-components.js','workspace-account.js','setup-create.js','image-progress.js','generator/assemble-course.js','generator/schema.mjs','generator/stages/research.mjs','generator/stages/topic.mjs','generator/stages/visual-design.mjs'];
const refs=s=>[...s.matchAll(/\b(?:from\s*|import\s*\(\s*|import\s*)["']([^"']+)["']/g)].map(m=>m[1]);
const read=p=>JSON.parse(readFileSync(p));
function baseline(){const bytes=readFileSync(join(parent,'packaging-report.json'));assert.equal(digest(bytes),parentHash);const report=JSON.parse(bytes),inventory=baseInventory(report),output=join(parent,'.vercel/output');assert.deepEqual(tree(output),Object.keys(inventory).sort());for(const[p,h]of Object.entries(inventory))assert.equal(digest(readFileSync(join(output,p))),h,'Frozen parent drift: '+p);return {report,inventory,output};}
export function verifyOpenRouterPackage(artifact){
 assert.equal(dirname(resolve(artifact)),directory);
 const report=read(join(artifact,'packaging-report.json')),out=join(artifact,'.vercel/output'),inventory=baseInventory(report);
 assert.equal(report.parentHash,parentHash);assert.equal(report.stagingRef,'dmnwkrybgggbpqpetuub');assert.equal(report.groups.length,8);
 assert.deepEqual(tree(out),Object.keys(inventory).sort());for(const[p,h]of Object.entries(inventory))assert.equal(digest(readFileSync(join(out,p))),h,p);
 const base=baseline();for(const[p,h]of Object.entries(base.inventory))if(!report.changed.includes(p))assert.equal(inventory[p],h,'Unexpected parent edit '+p);
 assert.equal(read(join(artifact,'.vercel/project.json')).projectId,'prj_nphig6i4hA9E8o9Wg3nhzxyP1krB');
 const index=readFileSync(join(out,'static/index.html'),'utf8');assert(index.includes(namespace));
 assert(readFileSync(join(out,'static',namespace,'config.js'),'utf8').includes(report.stagingRef));
 for(const group of report.groups){const prefix=`functions/_functions/${group.id}.func/`;for(const p of Object.keys(group.files)){
  if(p.endsWith('/generator/anthropic-fetch.js'))assert(readFileSync(join(out,prefix,p),'utf8').includes('OPENROUTER_STAGING_DIRECT_PROVIDER_DISABLED'));
  if(p.endsWith('/api/_lib/openai-image.mjs')||p==='api/_lib/openai-image.mjs')assert(readFileSync(join(out,prefix,p),'utf8').includes('OPENROUTER_STAGING_DIRECT_PROVIDER_DISABLED'));
 }}
 return {artifact,reportHash:digest(readFileSync(join(artifact,'packaging-report.json'))),files:Object.keys(inventory).length,functions:8,legacyPaidDispatchDisabled:true,hostedChanges:0,providerCalls:0};
}
export function prepareOpenRouterPackage(){
 const base=baseline();mkdirSync(directory,{recursive:true});const artifact=mkdtempSync(join(directory,'release-'));cpSync(join(parent,'.vercel'),join(artifact,'.vercel'),{recursive:true,force:false,errorOnExist:true});
 const out=join(artifact,'.vercel/output'),changes=new Set(),sourcePins={};
 const write=(path,bytes)=>{mkdirSync(dirname(join(out,path)),{recursive:true});writeFileSync(join(out,path),bytes);changes.add(path);};
 const source=(path,server=false)=>{const bytes=readFileSync(join(root,'web',path));sourcePins[path]=digest(bytes);return server?bytes.toString().replaceAll('/js/',`/${base.report.serverNamespace}/`):bytes;};
 // A fresh browser namespace preserves the accepted UI and avoids old cached modules.
 cpSync(join(out,'static',base.report.namespace),join(out,'static',namespace),{recursive:true,force:false,errorOnExist:true});
 for(const p of tree(join(out,'static',namespace)))changes.add(`static/${namespace}/${p}`);
 for(const p of browserFiles)write(`static/${namespace}/${p}`,source('js/'+p));
 for(const p of Object.keys(base.report.staticFiles).filter(p=>p.endsWith('.html'))){const old=readFileSync(join(out,'static',p),'utf8'),next=old.replaceAll(base.report.namespace,namespace);if(next!==old)write('static/'+p,next);}
 for(const group of base.report.groups){
  const prefix=`functions/_functions/${group.id}.func/`,dir=join(out,prefix),changed=[];
  for(const p of apiFiles)if(existsSync(join(dir,p))){write(prefix+p,source(p,true));changed.push(p);}
  for(const p of browserFiles.filter(p=>p.startsWith('generator/'))){const dest=base.report.serverNamespace+'/'+p;if(existsSync(join(dir,dest))){write(prefix+dest,source('js/'+p,true));changed.push(dest);}}
  // Trace only new relative dependencies of the changed modules. Frozen Linux
  // node_modules and the accepted grouped entrypoints remain byte-identical.
  for(let i=0;i<changed.length;i++){const p=changed[i];for(const spec of refs(readFileSync(join(dir,p),'utf8'))){if(!spec.startsWith('.'))continue;const target=posix.normalize(posix.join(posix.dirname(p),spec.split('?')[0]));assert(!target.startsWith('../'));if(existsSync(join(dir,target)))continue;const path=target.replace(base.report.serverNamespace+'/','js/');assert(path.startsWith('api/')||path.startsWith('js/'));write(prefix+target,source(path,true));changed.push(target);}}
  for(const p of tree(dir)){
   if(p.endsWith('/generator/anthropic-fetch.js')){const s=readFileSync(join(dir,p),'utf8'),needle='      async create(opts) {';assert.equal(s.split(needle).length,2);write(prefix+p,s.replace(needle,needle+"\n        // OPENROUTER_STAGING_DIRECT_PROVIDER_DISABLED\n        throw Object.assign(new Error('This staging build uses the Learnable connection. Direct Claude generation is paused.'), { code: 'configuration' });"));}
   if(p==='api/_lib/openai-image.mjs'){const s=readFileSync(join(dir,p),'utf8'),needle='  const policy = imagePolicy(env);\n  requireImagePolicy(policy);';assert.equal(s.split(needle).length,2);write(prefix+p,s.replace(needle,"  // OPENROUTER_STAGING_DIRECT_PROVIDER_DISABLED\n  throw new ImageGenerationError('disabled');\n"+needle));}
  }
 }
 const configPath='static/'+namespace+'/config.js';
 write(configPath,Buffer.from(readFileSync(join(out,configPath),'utf8')+'\n// UI display mode; server authorization remains authoritative.\nexport const MANAGED_COURSE_GENERATION = true;\n'));
 const report={...base.report,status:'OPENROUTER_STAGING_CANDIDATE_UNTESTED_HOSTED',at:new Date().toISOString(),artifact,parent,parentHash,namespace,sourcePins,
 changed:[...changes].sort(),stagingRef:'dmnwkrybgggbpqpetuub',deploymentEligible:false,
 openrouter:{policy:'openrouter-native-v2',personalProviderDispatch:false,productionAuthorized:false,paidQaVerified:false,keyConfigured:false,creditFeatures:false}};
 report.staticFiles=Object.fromEntries(tree(join(out,'static')).map(p=>[p,digest(readFileSync(join(out,'static',p)))]));
 report.groups=base.report.groups.map(g=>({...g,files:Object.fromEntries(tree(join(out,`functions/_functions/${g.id}.func`)).map(p=>[p,digest(readFileSync(join(out,`functions/_functions/${g.id}.func`,p)))]))}));
 report.configSha256=digest(readFileSync(join(out,'config.json')));assert.equal(report.configSha256,base.report.configSha256);
 for(const p of report.changed.filter(p=>/\.(mjs|js)$/.test(p)))execFileSync(process.execPath,['--check',join(out,p)],{stdio:'pipe'});
 mkdirSync(join(artifact,'migration'));for(const p of ['27-platform-ai-spend.sql','28-openrouter-pilot-admission.sql'])cpSync(join(root,'db',p),join(artifact,'migration',p),{errorOnExist:true,force:false});
 writeFileSync(join(artifact,'packaging-report.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
 const result=verifyOpenRouterPackage(artifact);writeFileSync(join(directory,'prepared-'+Date.now()+'.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});return result;
}
if(process.argv[1]===new URL(import.meta.url).pathname)console.log(JSON.stringify(process.argv[2]==='verify'?verifyOpenRouterPackage(process.argv[3]):prepareOpenRouterPackage()));
