// Offline derivative only. No deployment, credentials, SQL, provider or env pull.
// Preserve the frozen parent; copy only its output plus this explicit delta.
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { baseInventory, digest, tree } from './packaging/grounding-release.mjs';
import { assertGraphConsistency, htmlAssets, assertReferenceVersion, moduleReferences } from './browser-contract.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
export const continuationParent = join(root, 'output/staging/2026-09-30-learner-retry/release-uGK19F');
const parentHash = '969e6671a1455ddf25f61342ff221572323b2515a9858d441bd1dacb5f1be676';
const oldNamespace = 'js-workspace-grounding-20260922', namespace = 'js-workspace-recovery-20260930';
const serverNamespace = 'js-workspace-20260918-candidate3';
const serverSources = [
  'api/gen/start.js', 'api/gen/resume.js', 'api/gen/restart.js', 'api/gen/review.js',
  'api/gen/credentials-ready.js', 'api/gen/sweep.js', 'api/gen/watchdog.js',
  'api/setups/generate.js', 'api/_lib/gen-runner.mjs', 'api/_lib/gen-recovery.mjs',
  'api/_lib/course-save.mjs', 'api/_lib/media-resolve.mjs', 'api/health/cloud.js'
];
const browserSources = ['app.js', 'components/quiz.js', 'components/topic-view.js',
  'home.js', 'course-images.js', 'course-image-client.js', 'private-course-images.js',
  'generator/stages/topic.mjs', 'generator/anthropic-fetch.js', 'openai-connection.js'];
const prefix = group => `functions/_functions/${group}.func/`;
function replaceOnce(source, from, to) {
  assert.equal(source.split(from).length, 2, `Expected one anchor: ${from}`);
  return source.replace(from, to);
}

export function expectedContinuationRelease() {
  const reportBytes = readFileSync(join(continuationParent, 'packaging-report.json'));
  assert.equal(digest(reportBytes), parentHash, 'Frozen parent report changed');
  const report = JSON.parse(reportBytes), original = baseInventory(report);
  const output = join(continuationParent, '.vercel/output');
  assert.equal(Object.keys(original).length, 4230); assert.equal(report.groups.length, 8);
  assert.deepEqual(tree(output), Object.keys(original).sort());
  for (const [p, h] of Object.entries(original)) assert.equal(digest(readFileSync(join(output, p))), h, p);
  const changes = new Map(), sourcePins = {};
  const source = p => { const b = readFileSync(join(root, p)); sourcePins[p] = digest(b); return b.toString(); };
  const serverText = p => source('web/' + p).replaceAll('../../js/', `../../${serverNamespace}/`);
  for (const p of serverSources) {
    let text = serverText(p), count = 0;
    if (p === 'api/_lib/gen-runner.mjs') text = replaceOnce(text,
      'client = createAnthropic({ apiKey, requestBudget, beforeDispatch: assertRunnerWritable });',
      'client = createAnthropic({ apiKey, supabase, ownerId, jobId, runId, requestBudget, beforeDispatch: assertRunnerWritable });');
    for (const g of report.groups) if (g.files[p]) { changes.set(prefix(g.id) + p, text); count++; }
    assert.ok(count, `Missing existing server destination: ${p}`);
  }
  for (const g of report.groups) changes.set(prefix(g.id) + 'api/_lib/grouped-router.mjs', source('scripts/packaging/grouped-router.mjs'));
  for (const id of ['generation', 'sources']) {
    changes.set(prefix(id) + 'api/_lib/gen-request-budget.mjs', source('web/api/_lib/gen-request-budget.mjs'));
    changes.set(prefix(id) + `${serverNamespace}/generator/anthropic-fetch.js`, source('scripts/staging-safeguard/client.mjs'));
  }
  for (const id of ['generation', 'generation-controls', 'sources']) {
    changes.set(prefix(id) + 'api/_lib/gen-continuation.mjs', source('web/api/_lib/gen-continuation.mjs'));
  }
  for (const g of report.groups) {
    const p = `${serverNamespace}/generator/stages/topic.mjs`;
    if (g.files[p]) changes.set(prefix(g.id) + p, source('web/js/generator/stages/topic.mjs'));
  }

  // Clone the active browser tree, retaining staging config, Auth and course-data
  // paths. Only these known source changes replace files in the fresh namespace.
  for (const p of Object.keys(report.staticFiles).filter(p => p.startsWith(oldNamespace + '/'))) {
    const target = 'static/' + p.replace(oldNamespace, namespace);
    assert.ok(!original[target], 'Fresh browser namespace required');
    changes.set(target, readFileSync(join(output, 'static', p), 'utf8').replaceAll(oldNamespace, namespace));
  }
  for (const p of browserSources) changes.set(`static/${namespace}/${p}`, source('web/js/' + p));
  changes.set('static/index.html', replaceOnce(readFileSync(join(output, 'static/index.html'), 'utf8'),
    `${oldNamespace}/app-learner-retry.js?v=1`, `${namespace}/app.js?v=169`));
  changes.set('static/connect-openai.html', replaceOnce(readFileSync(join(output, 'static/connect-openai.html'), 'utf8'),
    '/js-openai-connect-20260929/openai-connection.js', `/${namespace}/openai-connection.js?v=1`));

  const inventory = { ...original };
  for (const [p, b] of changes) {
    assert.ok(/^(static\/|functions\/_functions\/)/.test(p));
    assert.ok(!/(?:^|\/)(?:\.env|secrets\.json)(?:$|\.)/.test(p));
    inventory[p] = digest(b);
  }
  const read = p => changes.get(p) ?? readFileSync(join(output, p), 'utf8');
  // Check actual, transformed import URLs across app and connection entry pages.
  const pending = [`/${namespace}/app.js`, `/${namespace}/openai-connection.js`], sources = new Map(), imports = new Map();
  const logical = p => '/web/' + p.replace('/' + namespace + '/', 'js/');
  while (pending.length) {
    const p = pending.pop(); if (sources.has(p)) continue;
    assert.ok(inventory['static' + p], `Missing browser module: ${p}`);
    const text = read('static' + p); sources.set(p, text);
    for (const specifier of moduleReferences(text)) {
      if (!specifier.startsWith('.') && !specifier.startsWith('/')) continue;
      const target = new URL(specifier, 'https://local.invalid' + p);
      const entries = imports.get(logical(target.pathname)) || [];
      entries.push({ query: target.search.slice(1), from: logical(p), specifier });
      imports.set(logical(target.pathname), entries);
      if (/\.m?js$/.test(target.pathname)) pending.push(target.pathname);
    }
  }
  assertGraphConsistency({ web: '/web', imports });
  assertReferenceVersion(htmlAssets(read('static/index.html')), `${namespace}/app.js`, 169);
  assertReferenceVersion(htmlAssets(read('static/connect-openai.html')), `/${namespace}/openai-connection.js`, 1);
  const imageParents = imports.get('/web/js/course-image-client.js');
  assert.equal(imageParents.length, 3); assert.ok(imageParents.every(p => p.query === 'v=3'));
  // Paid image/refinement protections, routing, native dependencies and runtime
  // launchers stay byte-identical. The new code never supplies an allowance.
  for (const p of Object.keys(original).filter(p => /api\/_lib\/(?:openai-image|image-policy|image-request|refinement-proposal|staging-image-spend)\.mjs$|node_modules\/|\.vc-config\.json$/.test(p))) {
    assert.equal(inventory[p], original[p], `Protected release path changed: ${p}`);
  }
  assert.equal(inventory['config.json'], original['config.json']);
  return { report, original, changes, inventory, sourcePins, browserModules: sources.size };
}

export function verifyContinuationRelease(artifact) {
  const expected = expectedContinuationRelease(), report = JSON.parse(readFileSync(join(artifact, 'packaging-report.json')));
  assert.deepEqual(baseInventory(report), expected.inventory);
  assert.deepEqual(tree(join(artifact, '.vercel/output')), Object.keys(expected.inventory).sort());
  for (const [p, h] of Object.entries(expected.inventory)) assert.equal(digest(readFileSync(join(artifact, '.vercel/output', p))), h, p);
  assert.deepEqual(report.continuationOverlay.sourcePins, expected.sourcePins);
  const normalized = structuredClone(report); delete normalized.continuationOverlay;
  for (const key of ['artifact', 'work', 'status', 'staticFiles']) normalized[key] = expected.report[key];
  normalized.groups.forEach((g, i) => { g.files = expected.report.groups[i].files; g.bytes = expected.report.groups[i].bytes; });
  assert.deepEqual(normalized, expected.report, 'Unreviewed metadata change');
  return { artifact, paths: Object.keys(expected.inventory).length, changedPaths: expected.changes.size,
    serverPaths: [...expected.changes.keys()].filter(p => p.startsWith('functions/')).length,
    browserModules: expected.browserModules, parentUnchanged: true, paidCalls: 0, deployed: false };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  if (process.argv[2] === '--verify') console.log(JSON.stringify(verifyContinuationRelease(resolve(process.argv[3])), null, 2));
  else {
    assert.equal(process.argv.length, 2, 'No deployment or other action is supported');
    const expected = expectedContinuationRelease();
    const directory = join(root, 'output/staging/2026-09-30-continuation'); mkdirSync(directory, { recursive: true });
    const artifact = mkdtempSync(join(directory, 'release-')); mkdirSync(join(artifact, '.vercel'));
    cpSync(join(continuationParent, '.vercel/output'), join(artifact, '.vercel/output'), { recursive: true });
    const report = structuredClone(expected.report); report.artifact = artifact; report.work = null; report.status = 'prepared-not-runtime-verified-not-deployed';
    for (const [p, b] of expected.changes) { const dest = join(artifact, '.vercel/output', p); mkdirSync(dirname(dest), { recursive: true }); writeFileSync(dest, b); }
    report.staticFiles = Object.fromEntries(Object.entries(expected.inventory).filter(([p]) => p.startsWith('static/')).map(([p, h]) => [p.slice(7), h]));
    for (const g of report.groups) {
      g.files = Object.fromEntries(Object.entries(expected.inventory).filter(([p]) => p.startsWith(prefix(g.id))).map(([p, h]) => [p.slice(prefix(g.id).length), h]));
      g.bytes = Object.keys(g.files).reduce((n, p) => n + readFileSync(join(artifact, '.vercel/output', prefix(g.id), p)).length, 0);
    }
    report.continuationOverlay = { parent: continuationParent, parentReportSha256: parentHash,
      namespace, sourcePins: expected.sourcePins, changedFiles: Object.fromEntries([...expected.changes].map(([p, b]) => [p, digest(b)])),
      migrationRequired: 'db/22-generation-continuation.sql', continuationEnabled: false,
      allowanceCreated: false, credentialsIncluded: false };
    writeFileSync(join(artifact, 'packaging-report.json'), JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
    const receipt = { at: new Date().toISOString(), ...verifyContinuationRelease(artifact), status: report.status };
    writeFileSync(join(artifact, 'preparation.json'), JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
    console.log(JSON.stringify(receipt, null, 2));
  }
}
