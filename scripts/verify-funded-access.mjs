import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir,writeFile } from 'node:fs/promises';
const run=promisify(execFile),dir='output/qa/2026-10-11-funded-access';
await mkdir(dir,{recursive:true});
const suites={
 'funded-unit':['--test','scripts/test-funded-access.mjs','scripts/test-funded-account-ui.mjs'],
 'funded-database':['scripts/test-funded-access-database.mjs'],
 'legacy-account':['scripts/test-workspace-account.mjs'],
 'legacy-setup':['scripts/test-setup-generation.mjs'],
 'generation-deadline':['--test','scripts/test-generation-entry-deadline.mjs'],
 'grouped-functions':['scripts/test-grouped-functions.mjs'],
 'browser-cache':['scripts/test-browser-cache-versions.mjs'],
 'syntax':['scripts/test-module-syntax.mjs'],
 'openrouter':['--test','scripts/test-openrouter-client.mjs','scripts/test-openrouter-stages.mjs'],
 'provider-spend-database':['scripts/test-platform-ai-spend-database.mjs'],
};
if(process.argv[2])suites['real-local-auth']=['scripts/verify-local-funded-access.mjs',process.argv[2]];
const results=await Promise.all(Object.entries(suites).map(async([name,args])=>{try{const r=await run(process.execPath,args,{maxBuffer:2000000});await writeFile(`${dir}/${name}.log`,r.stdout+r.stderr);return{name,status:'passed',log:`${dir}/${name}.log`};}catch(e){await writeFile(`${dir}/${name}.log`,(e.stdout||'')+(e.stderr||''));return{name,status:'failed',log:`${dir}/${name}.log`};}}));
const result={status:results.every(r=>r.status==='passed')?'passed':'failed',providerCalls:0,providerCostUSD:0,hostedChanges:0,results};
await writeFile(`${dir}/automated-results.json`,JSON.stringify(result,null,2)+'\n');console.log(JSON.stringify(result,null,2));if(result.status==='failed')process.exitCode=1;
