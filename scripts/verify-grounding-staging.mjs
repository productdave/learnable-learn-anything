// Run inside the secret-free kit with Docker --network none, at /work.
import assert from 'node:assert/strict';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { digest, readJSON, verifyGroundingArtifact } from './packaging/grounding-release.mjs';
assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');assert.equal(process.cwd(),'/work');
const input=readJSON('/work/grounding-input.json'),artifact=resolve('/work',input.artifact);
assert.ok(artifact.startsWith('/work/output/grouped-staging/package-'));
for(const[p,h]of Object.entries(input.scriptHashes))assert.equal(digest(readFileSync('/work/'+p)),h,'Verification script drift');
verifyGroundingArtifact('/work',artifact);
for(const name of ['verify-grouped-functions','verify-account-frontend','verify-packaged-document-contract'])execFileSync(process.execPath,[`/work/scripts/${name}.mjs`,artifact],{stdio:'inherit',env:{PATH:process.env.PATH},timeout:300000});
// Same assertions, actual bundled generation and sources runtime modules.
const regressions=[];mkdirSync('/work/qa');
for(const group of ['generation','sources'])for(const name of ['test-mvp-grounding','test-mvp-lesson-constraints']) {
  let test=readFileSync(`/work/scripts/${name}.mjs`,'utf8');
  test=test.replace(/'\.\.\/web\/js\/([^']+)'/g,(_,p)=>JSON.stringify(pathToFileURL(join(artifact,`.vercel/output/functions/_functions/${group}.func/js-workspace-20260918-candidate3`,p)).href));
  test=test.replaceAll("'./fixtures/component-course.mjs'",JSON.stringify('file:///work/scripts/fixtures/component-course.mjs'));
  const file=`/work/qa/${group}-${name}.mjs`;writeFileSync(file,test,{flag:'wx'});
  const output=execFileSync(process.execPath,[file],{encoding:'utf8',env:{PATH:process.env.PATH},timeout:60000});
  writeFileSync(file+'.log',output,{flag:'wx'});
  assert.match(output,/# fail 0/);const count=Number(output.match(/# tests (\d+)/)?.[1]);assert.ok(count>0);
  regressions.push({group,name,checks:count});console.log(`${group} ${name}: ${count} passed (mocked provider)`);
}
verifyGroundingArtifact('/work',artifact);
const base=readJSON('/work/base-release.json'),qa=readJSON(artifact+'/qa-report.json');assert.equal(qa.checks.length,227);
const receipt={...base,at:new Date().toISOString(),artifact:input.artifact,groundingOverlay:input.overlay,
  accountFrontend:readJSON(artifact+'/account-frontend-qa.json'),documentContract:readJSON(artifact+'/document-contract-qa.json'),
  groundingRegressions:regressions,derivation:'exact five-file JavaScript overlay; reused frozen Linux dependencies; no dependency rebuild',
  inputReceiptSha256:digest(readFileSync('/work/grounding-input.json')),paidCalls:0,
  limitations:['Fresh Linux offline checks only. No paid model-output evaluation. Hosted derivative acceptance pending. Production unchanged.']};
writeFileSync('/work/linux-release-receipt.json',JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({status:receipt.status,checks:qa.checks.length,regressions,namespace:receipt.accountFrontend.namespace,paidCalls:0}));
