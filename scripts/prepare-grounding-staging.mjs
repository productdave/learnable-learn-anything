import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { groundingBaseKit, groundingBaseArtifact, groundingManifestPath, expectedGrounding, verifyGroundingArtifact, digest, readJSON } from './packaging/grounding-release.mjs';
const root = resolve(new URL('..',import.meta.url).pathname);
const kit = mkdtempSync(join(root,'output/linux-staging/build-grounding-'));
const put = (p,bytes) => {const path=join(kit,p);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes,{flag:'wx'});};
cpSync(join(root,groundingBaseArtifact,'.vercel/output'),join(kit,'base/.vercel/output'),{recursive:true});
put('base/packaging-report.json',readFileSync(join(root,groundingBaseArtifact,'packaging-report.json')));
put('base-release.json',readFileSync(join(root,groundingBaseKit,'linux-release-receipt.json')));
put('reviewed-delta.json',readFileSync(join(root,groundingManifestPath)));
for(const file of readJSON(join(kit,'reviewed-delta.json')).files)put('source/'+file.path,readFileSync(join(root,file.path)));
const { changes, inventory, overlay, baseReport } = expectedGrounding(kit);
const parent=join(kit,'output/grouped-staging');mkdirSync(parent,{recursive:true});
const artifact=mkdtempSync(join(parent,'package-'));
cpSync(join(kit,'base/.vercel/output'),join(artifact,'.vercel/output'),{recursive:true});
for(const [p,bytes] of changes){const path=join(artifact,'.vercel/output',p);mkdirSync(dirname(path),{recursive:true});writeFileSync(path,bytes);}
const report=structuredClone(baseReport);
report.artifact=artifact;report.work=null;report.status='prepared-grounding-derivative-not-verified';report.groundingOverlay=overlay;
report.staticFiles=Object.fromEntries(Object.entries(inventory).filter(([p])=>p.startsWith('static/')).map(([p,h])=>[p.slice(7),h]));
for(const group of report.groups)group.files=Object.fromEntries(Object.entries(inventory).filter(([p])=>p.startsWith(`functions/_functions/${group.id}.func/`)).map(([p,h])=>[p.slice(`functions/_functions/${group.id}.func/`.length),h]));
put(artifact.slice(kit.length+1)+'/packaging-report.json',JSON.stringify(report,null,2)+'\n');
verifyGroundingArtifact(kit,artifact);
const scripts=['scripts/verify-grounding-staging.mjs','scripts/packaging/grounding-release.mjs','scripts/verify-grouped-functions.mjs','scripts/verify-account-frontend.mjs','scripts/verify-packaged-document-contract.mjs','scripts/browser-contract.mjs','scripts/fixtures/source-documents.mjs','scripts/test-document-sources.mjs','scripts/test-mvp-grounding.mjs','scripts/test-mvp-lesson-constraints.mjs','scripts/fixtures/component-course.mjs'];
const scriptHashes={};for(const path of scripts){const bytes=readFileSync(join(root,path));put(path,bytes);scriptHashes[path]=digest(bytes);}
put('grounding-input.json',JSON.stringify({at:new Date().toISOString(),artifact:artifact.slice(kit.length+1),overlay,scriptHashes,paidCalls:0,reusedLinuxDependencies:true},null,2)+'\n');
assert.ok(!Object.keys(inventory).some(p=>/(?:^|\/)(?:\.env|secrets\.json)(?:$|\.)/.test(p)));
console.log(JSON.stringify({kit,artifact,outputFiles:Object.keys(inventory).length,serverCopies:9,reviewedFiles:5,secretsIncluded:false}));
