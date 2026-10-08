// Run inside the prepared kit at /work, after script-disabled npm installs.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { packageGroups } from './package-grouped-functions.mjs';
import { verifyStagingMigrations } from './packaging/staging-migrations.mjs';
const sha=b=>createHash('sha256').update(b).digest('hex');
assert.equal(process.platform,'linux');assert.equal(process.arch,'x64');
assert.equal(process.cwd(),'/work');
const input=JSON.parse(readFileSync('/work/input-receipt.json'));
assert.equal(input.stagingRef,'dmnwkrybgggbpqpetuub');
for(const [path,hash]of Object.entries(input.inventory))assert.equal(sha(readFileSync('/work/'+path)),hash,`Portable input drift: ${path}`);
const migrations=JSON.parse(readFileSync('/work/docs/upgrade/staging-migrations-2026-09-18.json'));
verifyStagingMigrations(migrations,new Map(migrations.migrations.map(r=>[r.path,readFileSync('/work/'+r.path)])),JSON.parse(readFileSync('/work/base/scope.json')));
const result=await packageGroups('/work/staging','/work/builder/node_modules/@vercel/node','/work/docs/upgrade/hobby-image-budget-scope-2026-09-18.json','/work/docs/upgrade/account-frontend-scope-2026-09-19.json',input.sourceRecoveryScopePath&&'/work/'+input.sourceRecoveryScopePath);
execFileSync(process.execPath,['/work/scripts/verify-grouped-functions.mjs',result.artifact],{stdio:'inherit',env:{PATH:process.env.PATH},timeout:300000});
execFileSync(process.execPath,['/work/scripts/verify-account-frontend.mjs',result.artifact],{stdio:'inherit',env:{PATH:process.env.PATH},timeout:60000});
execFileSync(process.execPath,['/work/scripts/verify-packaged-document-contract.mjs',result.artifact],{stdio:'inherit',env:{PATH:process.env.PATH},timeout:240000});
const qa=JSON.parse(readFileSync(result.artifact+'/qa-report.json'));
writeFileSync('/work/linux-release-receipt.json',JSON.stringify({status:'linux-verified-not-deployed',at:new Date().toISOString(),
  artifact:result.artifact.replace('/work/',''),stagingRef:input.stagingRef,platform:result.host,
  image:input.image,inputReceiptSha256:sha(readFileSync('/work/input-receipt.json')),
  builderLockSha256:sha(readFileSync('/work/builder/package-lock.json')),
  appLockSha256:sha(readFileSync('/work/base/web/package-lock.json')),
  migrationInventory:migrations,checks:qa.checks.length,paidCalls:0,
  accountFrontend:JSON.parse(readFileSync(result.artifact+'/account-frontend-qa.json')),
  ...(result.sourceRecoveryOverlay?{sourceRecoveryOverlay:result.sourceRecoveryOverlay}:{}),
  documentContract:JSON.parse(readFileSync(result.artifact+'/document-contract-qa.json')),
  limitations:['Hosted platform/API/browser acceptance pending.','Production and paid provider tests not authorized.']},null,2)+'\n',{flag:'wx'});
console.log('LINUX_RELEASE='+JSON.stringify({artifact:result.artifact,checks:qa.checks.length,migrations:migrations.migrations.length}));
