// Verify actual packaged static files, not just the sources selected for build.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { moduleReferences, htmlAssets } from './browser-contract.mjs';
const artifact = resolve(process.argv[2]), report = JSON.parse(readFileSync(artifact+'/packaging-report.json'));
assert.equal(report.accountFrontendOverlay?.scope.purpose, 'workspace-account-connection');
const scope = report.groundingOverlay || report.sourceRecoveryOverlay?.scope || report.accountFrontendOverlay.scope;
if(report.groundingOverlay)assert.equal(scope.purpose,'mvp-grounding-five-file');
else if(report.sourceRecoveryOverlay)assert.equal(scope.purpose,'source-original-notice');
const namespace = `js-${scope.namespace}/`, styles = `styles-${scope.namespace}/`;
const read = p => {
  const bytes = readFileSync(artifact+'/.vercel/output/static/'+p);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), report.staticFiles[p], 'Packaged bytes changed: '+p);
  return bytes.toString();
};
const html = read('index.html');
assert.ok(html.includes(namespace+'app.js') && html.includes(styles+'components.css'));
assert.ok(!html.includes(scope.baseNamespace));
for (const ref of htmlAssets(html)) if (ref.startsWith(namespace) || ref.startsWith(styles)) read(ref.split('?')[0]);
const pending = [namespace+'app.js'], visited = new Set(), references = new Map();
while (pending.length) {
  const path = pending.pop(); if (visited.has(path)) continue; visited.add(path);
  for (const ref of moduleReferences(read(path))) if (ref.startsWith('.')) {
    const url = new URL(ref, 'https://qa.invalid/'+path), target = url.pathname.slice(1);
    assert.ok(target.startsWith(namespace), 'Stale or escaped browser graph: '+target);
    if (references.has(target)) assert.equal(url.search, references.get(target), 'Duplicate module instance: '+target);
    references.set(target,url.search); pending.push(target);
  }
}
assert.equal(visited.size,79); assert.ok(visited.has(namespace+'workspace-account.js'));
assert.ok(read(namespace+'auth.js').includes('openWorkspaceAccount'));
assert.ok(read(namespace+'setup-generation-client.js').includes("connection: owner => request(owner, '/api/providers/connection', 'GET')"));
assert.ok(read(namespace+'setup-create.js').includes('learnable-provider-connection-changed'));
assert.ok(read(namespace+'app.js').includes('refreshWorkspaceCredentialWaits'));
assert.ok(read(namespace+'setup-generation-client.js').includes("refreshCredentials: owner => request(owner, '/api/gen/credentials-ready', 'POST', {})"));
assert.ok(!/setProviderKey|localStorage|client\.start\(/.test(read(namespace+'workspace-account.js')));
assert.ok(read(namespace+'config.js').includes('dmnwkrybgggbpqpetuub.supabase.co'));
if(report.sourceRecoveryOverlay){
  const source=read(namespace+'course-setup.js');
  assert.equal(createHash('sha256').update(source).digest('hex'),report.sourceRecoveryOverlay.scope.sources['js/course-setup.js']);
  assert.ok(source.includes('data-original-notice')&&source.includes('originals.hidden = !session.draft.sources.files.some(file => !file.blob)'));
}
for(const flag of ['CREATION_IMAGES_ENABLED','SELF_PUBLISH_ENABLED','MODERATION_ENABLED']) assert.match(read(namespace+'config.js'),new RegExp(`${flag}\\s*=\\s*false`));
const result = { at:new Date().toISOString(),status:'passed-packaged-account-frontend',modules:visited.size,namespace,realBrowser:false,paidCalls:0 };
writeFileSync(artifact+'/account-frontend-qa.json',JSON.stringify(result,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify(result));
