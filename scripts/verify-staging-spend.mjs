// Run in the fresh Linux kit using --network none; provider functions are fakes.
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {digest,readJSON} from './packaging/grounding-release.mjs';
import {verifySpendArtifact} from './packaging/staging-spend-release.mjs';
assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');assert.equal(process.cwd(),'/work');
const input=readJSON('/work/spend-input.json'),artifact=resolve('/work',input.artifact);
for(const [p,h]of Object.entries(input.scriptHashes))assert.equal(digest(readFileSync('/work/'+p)),h);
const expected=verifySpendArtifact('/work',artifact);
for(const name of ['verify-grouped-functions','verify-account-frontend','verify-packaged-document-contract'])execFileSync(process.execPath,[`/work/scripts/${name}.mjs`,artifact],{stdio:'inherit',env:{PATH:process.env.PATH},timeout:300000});
mkdirSync('/work/qa');const guards=[];
for(const group of ['generation','sources']){
  const guard=join(artifact,`.vercel/output/functions/_functions/${group}.func/js-workspace-20260918-candidate3/generator/anthropic-fetch.js`);
  const log=execFileSync(process.execPath,['--test','/work/scripts/test-staging-spend-guard.mjs'],{encoding:'utf8',env:{PATH:process.env.PATH,GUARD_MODULE:guard},timeout:60000});
  writeFileSync('/work/qa/'+group+'-guard.log',log,{flag:'wx'});assert.match(log,/# tests 11/);assert.match(log,/# fail 0/);guards.push({group,checks:11});
}
// Defense in depth: accidental feature flag changes cannot bypass the text guard.
for(const group of ['courses','images','providers']){
  const module=await import(pathToFileURL(join(artifact,`.vercel/output/functions/_functions/${group}.func/api/_lib/openai-image.mjs`)));
  let fetched=false;await assert.rejects(()=>module.generateCreatorImage({}, {env:{LEARNABLE_GPT_IMAGES:'1'},fetcher:()=>{fetched=true;throw Error('No network');}}),e=>e.code==='disabled');assert.equal(fetched,false);
}
const refinement=await import(pathToFileURL(join(artifact,'.vercel/output/functions/_functions/courses.func/api/_lib/refinement-proposal.mjs')));
let fetched=false;await assert.rejects(()=>refinement.generateRefinementProposal({fetcher:()=>{fetched=true;throw Error('No network');}}),e=>e.code==='disabled');assert.equal(fetched,false);
verifySpendArtifact('/work',artifact);
const base=readJSON('/work/prior/linux-release-receipt.json'),qa=readJSON(artifact+'/qa-report.json');assert.equal(qa.checks.length,227);
const receipt={...base,at:new Date().toISOString(),artifact:input.artifact,stagingSpendOverlay:expected.overlay,
  accountFrontend:readJSON(artifact+'/account-frontend-qa.json'),documentContract:readJSON(artifact+'/document-contract-qa.json'),
  groundingEvidence:'Prior reviewed grounding code unchanged; 28 regressions inherited, not rerun.',
  stagingSpendChecks:{guards,disabledPaidPaths:4},spendInputSha256:digest(readFileSync('/work/spend-input.json')),
  derivation:'Eight server files only; frozen Linux dependencies and browser assets reused',paidCalls:0,
  limitations:['Application-level reservations, not a provider invoice guarantee. Hosted acceptance pending. No grant or paid test authorized.']};
writeFileSync('/work/linux-release-receipt.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:receipt.status,checks:227,guards,disabledPaidPaths:4,browserChanges:0,paidCalls:0}));
