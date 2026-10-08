// Create a portable, secret-free kit. Only pinned release files and named tools
// cross into Docker; never mount the checkout, HOME or the staging secrets folder.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifiedStagingFiles } from './package-grouped-functions.mjs';
import { readTree, digest } from './plan-workspace-release.mjs';
import { imageBudgetPaths } from './packaging/image-budget-overlay.mjs';
import { accountSourcePaths } from './packaging/account-frontend-overlay.mjs';
import { verifyStagingMigrations } from './packaging/staging-migrations.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const staging = join(root, 'output/staging/2026-09-18');
const budgetPath = 'docs/upgrade/hobby-image-budget-scope-2026-09-18.json';
const migrationPath = 'docs/upgrade/staging-migrations-2026-09-18.json';
const accountPath = 'docs/upgrade/account-frontend-scope-2026-09-19.json';
const budget = JSON.parse(readFileSync(join(root,budgetPath)));
const account = JSON.parse(readFileSync(join(root,accountPath)));
const recoveryPath = process.argv[2];
assert.ok(!recoveryPath || recoveryPath === 'docs/upgrade/source-recovery-scope-2026-09-19.json','Only the reviewed recovery scope is supported');
const recovery = recoveryPath ? JSON.parse(readFileSync(join(root,recoveryPath))) : null;
const verified = verifiedStagingFiles(staging, budget, account, recovery);
const migrations = JSON.parse(readFileSync(join(root,migrationPath)));
verifyStagingMigrations(migrations,new Map(migrations.migrations.map(r=>[r.path,readFileSync(join(root,r.path))])),verified.scope);
const parent=join(root,'output/linux-staging');mkdirSync(parent,{recursive:true});
const kit=mkdtempSync(join(parent,'build-')), inventory={};
function put(path,bytes) {
  assert.ok(!path.startsWith('/')&&!path.includes('..')&&!path.includes('\\'));
  assert.ok(!/(?:^|\/)(?:\.env|secrets\.json|\.vercel)(?:$|[/.])/.test(path));
  const target=join(kit,path);mkdirSync(dirname(target),{recursive:true});writeFileSync(target,bytes,{flag:'wx'});inventory[path]=digest(bytes);
}
for(const [path,bytes]of readTree(verified.overlay.candidate))put('base/web/'+path,bytes);
put('base/scope.json',readFileSync(resolve(verified.overlay.candidate,'../scope.json')));
for(const [path,bytes]of readTree(verified.overlay.web))put('staging/web/'+path,bytes);
// Rebase only filesystem pointers in this NEW kit, never source or prior receipts.
put('staging/artifact-receipt.json',JSON.stringify({...verified.overlay,candidate:'/work/base/web',web:'/work/staging/web'}));
for(const path of [...imageBudgetPaths,...accountSourcePaths,...(recovery?['js/course-setup.js']:[])])put('web/'+path,readFileSync(join(root,'web',path)));
for(const path of [budgetPath,migrationPath,accountPath,...migrations.migrations.map(r=>r.path),
  'scripts/package-grouped-functions.mjs','scripts/plan-workspace-release.mjs','scripts/assemble-workspace-candidate.mjs',
  'scripts/browser-contract.mjs','scripts/verify-grouped-functions.mjs','scripts/build-linux-staging.mjs',
  'scripts/fixtures/source-documents.mjs','scripts/packaging/grouped-manifest.mjs','scripts/packaging/grouped-router.mjs',
  'scripts/packaging/image-budget-overlay.mjs','scripts/packaging/account-frontend-overlay.mjs','scripts/verify-account-frontend.mjs',
  'scripts/verify-packaged-document-contract.mjs','scripts/test-document-sources.mjs','scripts/packaging/staging-migrations.mjs',
  'scripts/packaging/source-recovery-overlay.mjs',...(recovery?[recoveryPath]:[])])put(path,readFileSync(join(root,path)));
put('builder/package.json',JSON.stringify({private:true,dependencies:{'@vercel/node':'5.8.8'}}));
writeFileSync(join(kit,'input-receipt.json'),JSON.stringify({version:1,at:new Date().toISOString(),stagingRef:verified.overlay.ref,
  originalOverlaySha256:digest(JSON.stringify(verified.overlay)),budgetScopeSha256:digest(JSON.stringify(budget)),
  accountScopeSha256:digest(JSON.stringify(account)),
  ...(recovery?{sourceRecoveryScopePath:recoveryPath,sourceRecoveryScopeSha256:digest(JSON.stringify(recovery))}:{}),
  image:'node:22.17.1-bookworm-slim@sha256:2fa754a9ba4d7adbd2a51d182eaabbe355c82b673624035a38c0d42b08724854',
  platform:'linux/amd64',inventory},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({kit,inputs:Object.keys(inventory).length,applicationFiles:verified.files.size,migrations:migrations.migrations.length,secretsIncluded:false}));
