import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifiedStagingFiles } from './package-grouped-functions.mjs';
import { accountSourcePaths, accountBaseNamespace, accountNamespace, applyAccountFrontendOverlay, frontendTreeHash } from './packaging/account-frontend-overlay.mjs';
import { moduleReferences } from './browser-contract.mjs';
const scope = JSON.parse(readFileSync('docs/upgrade/account-frontend-scope-2026-09-19.json'));
const budget = JSON.parse(readFileSync('docs/upgrade/hobby-image-budget-scope-2026-09-18.json'));
const base = verifiedStagingFiles(process.cwd() + '/output/staging/2026-09-18', budget).files;
const sources = new Map(accountSourcePaths.map(p => [p, readFileSync('web/' + p)]));
const result = applyAccountFrontendOverlay(base, sources, scope);
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };
check(frontendTreeHash(base) === scope.baseTreeSha256, 'frozen base unchanged');
for (const [p,b] of base) if (p !== 'index.html') assert.equal(result.get(p), b);
checks++; // Reference equality proves original buffers were preserved, not rebuilt.
check(result.get('index.html').toString().includes(`js-${accountNamespace}/app.js`), 'HTML selects fresh graph');
check(!result.get('index.html').toString().includes(accountBaseNamespace), 'HTML no longer loads stale graph');
check(!result.get(`js-${accountNamespace}/auth.js`).toString().includes('olzardlkaxgjqvwnjzil'), 'legacy Account repair link stays staging-only');
check(result.get(`js-${accountNamespace}/auth.js`).toString().includes('openWorkspaceAccount'), 'secure entry is packaged');
const pending = [`js-${accountNamespace}/app.js`], seen = new Set(), refs = new Map();
while (pending.length) {
  const path = pending.pop(); if (seen.has(path)) continue; seen.add(path);
  assert.ok(result.has(path), `Missing browser module: ${path}`);
  for (const ref of moduleReferences(result.get(path).toString())) if (ref.startsWith('.')) {
    const url = new URL(ref, `https://qa.invalid/${path}`), target = url.pathname.slice(1);
    assert.ok(target.startsWith(`js-${accountNamespace}/`), 'browser imports stay inside fresh graph');
    if (refs.has(target)) assert.equal(refs.get(target), url.search, 'stateful module singleton URL');
    refs.set(target,url.search); pending.push(target);
  }
}
check(seen.has(`js-${accountNamespace}/workspace-account.js`) && seen.size === 79, '79 actual browser modules including Account resolve');
for (const mutation of [
  () => applyAccountFrontendOverlay(new Map([...base, ['extra.txt', Buffer.from('unreviewed')]]), sources, scope),
  () => applyAccountFrontendOverlay(base, new Map([...sources, ['api/gen/start.js', Buffer.from('unreviewed')]]), scope),
  () => applyAccountFrontendOverlay(base, new Map([...sources].map(([p,b]) => [p,p === 'js/auth.js' ? Buffer.from('drift') : b])), scope),
  () => applyAccountFrontendOverlay(base, sources, {...scope, namespace:accountBaseNamespace}),
  () => applyAccountFrontendOverlay(base, sources, {...scope, sources:{}}),
  () => applyAccountFrontendOverlay(base, sources, {...scope, purpose:'unchecked'}),
]) { assert.throws(mutation); checks++; }
check(![...result.keys()].some(p => /secrets\.json|\.env/.test(p)), 'no secret files in derivative');
console.log(`${checks} Account overlay guards passed; ${result.size} derived files, 79 browser modules.`);
