// Exact staging-only derivative. No loose web/ files or production configuration.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { digest, readJSON, tree, baseInventory, verifyGroundingArtifact } from './grounding-release.mjs';
export const priorKit = 'output/linux-staging/build-grounding-1r3yXY';
export const priorArtifact = 'output/grouped-staging/package-kdID2w';
export function expectedSpend(kit) {
  const prior = join(kit,'prior'), artifact = join(prior,priorArtifact);
  const bytes = readFileSync(join(artifact,'packaging-report.json'));
  assert.equal(digest(bytes),'7aa8b4bf8b52574efa5f9afe71e8f964a1a1df679bea24b9f9e9b2a318962c6f');
  assert.equal(digest(readFileSync(join(prior,'linux-release-receipt.json'))),'b929c693bc0d7bd8ba59039a400a2ee94afb3d3e858a376e0b3fe2e6652ba474');
  verifyGroundingArtifact(prior,artifact);
  const report=JSON.parse(bytes), inventory=baseInventory(report), changes=new Map();
  const input=readJSON(join(kit,'spend-input.json'));
  for(const [p,h] of Object.entries(input.sourceHashes)) assert.equal(digest(readFileSync(join(kit,p))),h,'Safeguard source drift');
  const replace=(path,old,value)=>{
    const text=readFileSync(join(artifact,'.vercel/output',path),'utf8');
    assert.equal(text.split(old).length,2,'Exact single insertion required: '+path);
    changes.set(path,Buffer.from(text.replace(old,value)));
  };
  const prefix=group=>`functions/_functions/${group}.func/`;
  for(const group of ['generation','sources']) {
    changes.set(prefix(group)+'js-workspace-20260918-candidate3/generator/anthropic-fetch.js',readFileSync(join(kit,'scripts/staging-safeguard/client.mjs')));
    replace(prefix(group)+'api/_lib/gen-runner.mjs','client = createAnthropic({ apiKey });','client = createAnthropic({ apiKey, supabase, ownerId, jobId, runId });');
  }
  for(const group of ['courses','images','providers'])replace(prefix(group)+'api/_lib/openai-image.mjs',
    '  const policy = imagePolicy(env);\n  requireImagePolicy(policy);',
    "  throw new ImageGenerationError('disabled'); // Staging text-test safeguard; no paid image bypass.\n  const policy = imagePolicy(env);\n  requireImagePolicy(policy);");
  replace(prefix('courses')+'api/_lib/refinement-proposal.mjs',
    '  const request = buildRefinementProposalRequest({ course, target, instructions, workingReplacement, model });',
    "  fail('disabled', 'Paid refinement is disabled for this staging test.', { providerAttempted: false });\n  const request = buildRefinementProposalRequest({ course, target, instructions, workingReplacement, model });");
  assert.equal(changes.size,8);
  for(const [p,b] of changes){assert.ok(inventory[p]);inventory[p]=digest(b);}
  const overlay={purpose:'staging-only-spending-safeguard',stagingRef:'dmnwkrybgggbpqpetuub',baseReportSha256:digest(bytes),sourceHashes:input.sourceHashes,changedFiles:Object.fromEntries([...changes].map(([p,b])=>[p,digest(b)])),allowanceCreated:false};
  return {report,inventory,changes,overlay};
}
export function verifySpendArtifact(kit,artifact){
  const expected=expectedSpend(kit), report=readJSON(join(artifact,'packaging-report.json')), output=join(artifact,'.vercel/output');
  assert.deepEqual(tree(output),Object.keys(expected.inventory).sort());
  for(const [p,h] of Object.entries(expected.inventory))assert.equal(digest(readFileSync(join(output,p))),h,'Unexpected staging bytes: '+p);
  assert.deepEqual(baseInventory(report),expected.inventory);assert.deepEqual(report.stagingSpendOverlay,expected.overlay);
  const normalized=structuredClone(report);delete normalized.stagingSpendOverlay;
  for(const key of ['artifact','status','work'])normalized[key]=expected.report[key];
  normalized.groups.forEach((g,i)=>{g.files=expected.report.groups[i].files;});
  assert.deepEqual(normalized,expected.report);
  return expected;
}
