// Import and guard checks against the actual immutable prebuilt artifact.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';
import {pathToFileURL} from 'node:url';
import {verifyOpenRouterPackage} from './prepare-openrouter-staging.mjs';
const artifact=process.argv[2],verified=verifyOpenRouterPackage(artifact),report=JSON.parse(readFileSync(join(artifact,'packaging-report.json')));
let imported=0,guards=0;const failures=[],originalFetch=globalThis.fetch;
globalThis.fetch=()=>assert.fail('Package import and guard checks cannot access a network');
try{
 for(const group of report.groups){const dir=join(artifact,'.vercel/output/functions/_functions/'+group.id+'.func');
  for(const p of Object.keys(group.files).filter(p=>(p.startsWith('api/')||p.startsWith(report.serverNamespace+'/generator/'))&&/\.(mjs|js)$/.test(p))){
   try{const mod=await import(pathToFileURL(join(dir,p)).href);imported++;
    if(p.endsWith('/generator/anthropic-fetch.js')){await assert.rejects(mod.createClient({apiKey:'synthetic'}).messages.create({}),/Direct Claude generation is paused/);guards++;}
    if(p==='api/_lib/openai-image.mjs'){await assert.rejects(mod.generateCreatorImage(),{code:'disabled'});guards++;}
   }catch(error){failures.push({group:group.id,path:p,error:error.message?.slice(0,250)});}
  }
 }
}finally{globalThis.fetch=originalFetch;}
const result={at:new Date().toISOString(),...verified,passed:failures.length===0,imported,guards,failures,networkCalls:0,paidUsd:0};
writeFileSync(join(artifact,'package-tests.json'),JSON.stringify(result,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({passed:result.passed,imported,guards,failures}));if(failures.length)process.exitCode=1;
