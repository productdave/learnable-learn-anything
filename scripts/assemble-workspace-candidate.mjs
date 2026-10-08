// Local build artifact only. Never executes deploy, SQL, npm scripts or providers.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { assertSafePath, createPlan, digest, readTree, transform } from './plan-workspace-release.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
export function candidatePayloads(plan, sources) {
  assert.equal(plan.status, 'planning-only-not-deployable');
  const payloads = new Map();
  for (const [target, entry] of Object.entries(plan.files)) {
    assertSafePath(target); assertSafePath(entry.source);
    assert.ok(['baseline','workspace'].includes(entry.origin), `Unknown source: ${entry.origin}`);
    const source = sources[entry.origin]?.get(entry.source);
    assert.ok(Buffer.isBuffer(source), `Missing source: ${entry.source}`);
    const bytes = entry.origin === 'workspace' ? transform(entry.source, source) : source;
    assert.equal(digest(bytes), entry.sha256, `Frozen output mismatch: ${target}`);
    assert.equal(bytes.length, entry.bytes, `Frozen size mismatch: ${target}`);
    payloads.set(target, bytes);
  }
  return payloads;
}
export function verifyCandidate(directory, plan) {
  const files = readTree(directory);
  assert.deepEqual([...files.keys()].sort(), Object.keys(plan.files).sort(), 'Candidate file inventory differs from frozen scope');
  for (const [path, entry] of Object.entries(plan.files)) {
    assert.equal(digest(files.get(path)), entry.sha256, `Candidate hash changed: ${path}`);
    assert.equal(files.get(path).length, entry.bytes, `Candidate size changed: ${path}`);
  }
  return files.size;
}
export function assembleCandidate({ baselineRoot, scopePath = join(root,'docs/upgrade/workspace-release-scope-2026-09-18-candidate3.json') }) {
  const plan = JSON.parse(readFileSync(scopePath));
  assert.deepEqual(createPlan({ baselineRoot }), plan, 'Release inputs changed: review the scope before packaging');
  const payloads = candidatePayloads(plan, { baseline:readTree(baselineRoot), workspace:readTree(join(root,'web')) });
  const parent = join(root,'output/release-candidates'); mkdirSync(parent,{recursive:true});
  // Always create a fresh directory. There is no overwrite or deletion option.
  const artifactRoot = mkdtempSync(join(parent,plan.releaseName+'-'));
  const directory = join(artifactRoot,'web'); mkdirSync(directory);
  for (const [target, bytes] of payloads) {
    const destination = join(directory,target); mkdirSync(dirname(destination),{recursive:true});
    writeFileSync(destination,bytes,{flag:'wx'});
  }
  const files = verifyCandidate(directory,plan);
  writeFileSync(join(artifactRoot,'scope.json'),JSON.stringify(plan,null,2)+'\n',{flag:'wx'});
  const receipt = {status:'local-candidate-not-approved-for-deployment',createdAt:new Date().toISOString(),baselineDeployment:plan.baselineDeployment,scopeSha256:digest(JSON.stringify(plan)),files,webRoot:directory,unresolvedGates:plan.unresolvedGates,warning:'Public config still names the existing project. Serve only through the local QA configuration override. No hosted environment, migration, provider or deploy has been enabled.'};
  writeFileSync(join(artifactRoot,'receipt.json'),JSON.stringify(receipt,null,2)+'\n',{flag:'wx'});
  return receipt;
}
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length,3,'Usage: node scripts/assemble-workspace-candidate.mjs <recovered-production-root>');
  console.log(JSON.stringify(assembleCandidate({baselineRoot:process.argv[2]}),null,2));
}
