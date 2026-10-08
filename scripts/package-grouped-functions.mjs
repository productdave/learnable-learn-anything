// Offline packaging of the verified staging overlay. No deploy, SQL, credentials,
// npm scripts, provider calls or production changes. Always creates a fresh output.
import assert from 'node:assert/strict';
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { digest, readTree, assertSafePath } from './plan-workspace-release.mjs';
import { verifyCandidate } from './assemble-workspace-candidate.mjs';
import { functionGroups, validateEndpoints, groupEntrypoint, buildOutputConfig, staticFile } from './packaging/grouped-manifest.mjs';
import { applyImageBudgetOverlay, imageBudgetPaths } from './packaging/image-budget-overlay.mjs';
import { applyAccountFrontendOverlay, accountSourcePaths } from './packaging/account-frontend-overlay.mjs';
import { applySourceRecoveryOverlay, recoverySource } from './packaging/source-recovery-overlay.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
export function verifiedStagingFiles(stagingRoot, imageBudgetScope, accountScope, recoveryScope) {
  const overlay = JSON.parse(readFileSync(join(stagingRoot, 'artifact-receipt.json')));
  assert.equal(overlay.ref, 'dmnwkrybgggbpqpetuub', 'Only the approved isolated staging target is supported.');
  assert.equal(resolve(overlay.web), join(stagingRoot, 'web'));
  const scope = JSON.parse(readFileSync(resolve(overlay.candidate, '../scope.json')));
  verifyCandidate(overlay.candidate, scope);
  const files = readTree(overlay.web), changes = new Map(overlay.changes.map(change => [change.path, change]));
  assert.equal(changes.size, overlay.changes.length);
  assert.deepEqual([...files.keys()].sort(), Object.keys(scope.files).sort());
  for (const [path, entry] of Object.entries(scope.files)) {
    const change = changes.get(path);
    if (change) {
      assert.ok(/^js[^/]*\/(?:config|auth)\.js$/.test(path) || path === 'vercel.json', 'Unexpected staging overlay.');
      assert.equal(change.from, entry.sha256);
    }
    assert.equal(digest(files.get(path)), change?.to || entry.sha256, `Staging input drift: ${path}`);
  }
  assert.ok([...changes.keys()].every(path => files.has(path)));
  const source = imageBudgetScope ? new Map(imageBudgetPaths.map(path => [path, readFileSync(join(root, 'web', path))])) : null;
  let derived = imageBudgetScope ? applyImageBudgetOverlay(files, source, imageBudgetScope) : files;
  if (accountScope) derived = applyAccountFrontendOverlay(derived, new Map(accountSourcePaths.map(path => [path, readFileSync(join(root, 'web', path))])), accountScope);
  if (recoveryScope) { assert.ok(accountScope,'Recovery requires the verified Account overlay'); derived = applySourceRecoveryOverlay(derived,readFileSync(join(root,'web',recoverySource)),recoveryScope); }
  validateEndpoints(derived);
  return { files: derived, overlay, scope };
}

function blockNetwork() {
  const deny = () => { throw new Error('Network disabled during grouped packaging.'); };
  globalThis.fetch = deny;
  http.get = http.request = https.get = https.request = net.connect = net.createConnection = deny;
  net.Socket.prototype.connect = deny;
  syncBuiltinESMExports();
}
async function bytesFrom(file) {
  return new Promise((resolve, reject) => {
    const chunks = [], stream = file.toStream();
    stream.on('data', data => chunks.push(Buffer.from(data)));
    stream.on('end', () => resolve(Buffer.concat(chunks))); stream.on('error', reject);
  });
}
function put(directory, path, bytes) {
  // Dependency metadata contains dotfiles; still reject traversal, absolute paths
  // and secret/config files rather than blindly copying a directory to the web.
  assert.ok(path && !path.startsWith('/') && !path.includes('\\') && path.split('/').every(part => part && part !== '..' && part !== '.'));
  assert.ok(!/(?:^|\/)\.env(?:\.|$)|(?:^|\/)secrets\.json$/.test(path));
  const target = join(directory, path); mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, bytes, { flag: 'wx' });
}
export async function packageGroups(stagingRoot, builderPackage, imageBudgetScopePath, accountScopePath, recoveryScopePath) {
  const imageBudgetScope = imageBudgetScopePath ? JSON.parse(readFileSync(imageBudgetScopePath)) : null;
  const accountScope = accountScopePath ? JSON.parse(readFileSync(accountScopePath)) : null;
  const recoveryScope = recoveryScopePath ? JSON.parse(readFileSync(recoveryScopePath)) : null;
  const { files: input, overlay, scope } = verifiedStagingFiles(stagingRoot, imageBudgetScope, accountScope, recoveryScope);
  const packageJson = JSON.parse(input.get('package.json'));
  assert.equal(Object.keys(packageJson.scripts || {}).length, 0, 'Package scripts need review.');
  assert.equal(packageJson.engines.node, '^22.13.0');
  const dependencyRoot = join(overlay.candidate, 'node_modules');
  assert.ok(existsSync(dependencyRoot), 'Install frozen candidate dependencies with scripts disabled first.');
  const installed = JSON.parse(readFileSync(join(dependencyRoot, '.package-lock.json')));
  const locked = JSON.parse(input.get('package-lock.json'));
  for (const [name, pkg] of Object.entries(installed.packages)) {
    assert.equal(pkg.version, locked.packages[name]?.version, `Unreviewed dependency: ${name}`);
    assert.equal(pkg.integrity, locked.packages[name]?.integrity, `Dependency integrity drift: ${name}`);
  }
  const require = createRequire(join(builderPackage, 'package.json'));
  const version = require('./package.json').version;
  assert.equal(version, '5.8.8', 'Re-review a changed Node builder version.');
  const builder = require(builderPackage), { FileFsRef } = require('@vercel/build-utils');
  const parent = join(root, 'output/grouped-staging'); mkdirSync(parent, { recursive: true });
  const artifact = mkdtempSync(join(parent, 'package-'));
  // Work is outside the deploy root. Only .vercel/output is eligible for upload.
  const work = mkdtempSync(join(tmpdir(), 'learnable-grouped-work-'));
  for (const [path, bytes] of input) put(work, path, bytes);
  cpSync(dependencyRoot, join(work, 'node_modules'), { recursive: true, errorOnExist: true, force: false });
  const router = readFileSync(join(root, 'scripts/packaging/grouped-router.mjs'));
  put(work, 'api/_lib/grouped-router.mjs', router);
  for (const group of functionGroups) put(work, `api/_grouped/${group.id}.js`, groupEntrypoint(group));
  const files = {};
  for (const path of [...input.keys(), 'api/_lib/grouped-router.mjs', ...functionGroups.map(group => `api/_grouped/${group.id}.js`)]) {
    files[path] = await FileFsRef.fromFsPath({ fsPath: join(work, path) });
  }
  const outputRoot = join(artifact, '.vercel/output'); mkdirSync(outputRoot, { recursive: true });
  const vercel = JSON.parse(input.get('vercel.json'));
  const config = buildOutputConfig(vercel);
  const report = { status: 'building-not-deployed', artifact, work, stagingRef: overlay.ref,
    sourceFiles: input.size, sourceScope: digest(JSON.stringify(scope)), overlaySha256: digest(JSON.stringify(overlay)),
    imageBudgetOverlay: imageBudgetScope ? { scope: imageBudgetScope, sha256: digest(JSON.stringify(imageBudgetScope)) } : null,
    accountFrontendOverlay: accountScope ? { scope: accountScope, sha256: digest(JSON.stringify(accountScope)) } : null,
    sourceRecoveryOverlay: recoveryScope ? { scope: recoveryScope, sha256: digest(JSON.stringify(recoveryScope)) } : null,
    packagingSources: Object.fromEntries(['scripts/package-grouped-functions.mjs', 'scripts/packaging/grouped-manifest.mjs', 'scripts/packaging/grouped-router.mjs', 'scripts/packaging/image-budget-overlay.mjs', 'scripts/packaging/account-frontend-overlay.mjs'].map(path => [path, digest(readFileSync(join(root, path)))])),
    builder: { version, runtime: 'nodejs22.x' }, host: { platform: process.platform, architecture: process.arch, node: process.version },
    groups: [], staticFiles: {}, limitations: ['Not deployed. Non-commercial Hobby target; hosted Fluid Compute and runtime limits must be verified.', process.platform === 'linux' && process.arch === 'x64' ? 'Linux/x64 build; hosted execution is still unverified.' : 'Local dependency binaries require a Linux build before deployment.', 'Hosted original-URL rewrite, launcher helpers, waitUntil and cron acceptance remain required.', 'This scoped application derivative uses the separately reviewed migration inventory in the release receipt.'] };
  const reportPath = join(artifact, 'packaging-report.json');
  const save = () => writeFileSync(reportPath, JSON.stringify(report, null, 2) + '\n');
  save();
  for (const [path, bytes] of input) if (staticFile(path)) {
    assertSafePath(path); put(join(outputRoot, 'static'), path, bytes);
    report.staticFiles[path] = digest(bytes);
  }
  blockNetwork();
  for (const group of functionGroups) {
    const entrypoint = `api/_grouped/${group.id}.js`;
    const includes = [...new Set(group.routes.flatMap(route => [vercel.functions?.[`api/${route}.js`]?.includeFiles].filter(Boolean)))];
    console.log(`Building ${group.id}: ${group.routes.length} routes`);
    const { output } = await builder.build({ files, entrypoint, workPath: work, repoRootPath: work, meta: { skipDownload: true }, considerBuildCommand: true,
      config: { zeroConfig: true, nodeVersion: '22.x', includeFiles: includes, projectSettings: { installCommand: '', buildCommand: null } } });
    assert.equal(output.runtime, 'nodejs22.x'); assert.equal(output.launcherType, 'Nodejs'); assert.equal(output.shouldAddHelpers, true);
    assert.equal(output.maxDuration, group.maxDuration);
    const directory = join(outputRoot, `functions/_functions/${group.id}.func`), inventory = {};
    let bytes = 0;
    for (const [path, file] of Object.entries(output.files)) {
      assert.notEqual(file.mode & 0o170000, 0o120000, `Unexpected function symlink: ${path}`);
      const content = await bytesFrom(file); bytes += content.length;
      put(directory, path, content); inventory[path] = digest(content);
    }
    assert.ok(bytes < 250 * 1024 * 1024, `Function bundle exceeds 250 MiB: ${group.id}`);
    for (const route of group.routes) assert.ok(inventory[`api/${route}.js`], `Missing handler ${route}`);
    if (inventory['api/_lib/document-reader.mjs']) for (const folder of ['legacy/build', 'cmaps', 'standard_fonts', 'wasm']) {
      assert.ok(Object.keys(inventory).some(path => path.startsWith(`node_modules/pdfjs-dist/${folder}/`)), `Missing PDF resources in ${group.id}: ${folder}`);
    }
    // Match Vercel CLI's standalone Lambda serialization, without source blobs.
    const { files: ignoredFiles, type: ignoredType, zipBuffer: ignoredZip, ...runtime } = output;
    assert.ok(!runtime.environment || Object.keys(runtime.environment).length === 0, 'Do not bake environment credentials into a bundle.');
    put(directory, '.vc-config.json', JSON.stringify(runtime, null, 2) + '\n');
    inventory['.vc-config.json'] = digest(readFileSync(join(directory, '.vc-config.json')));
    report.groups.push({ ...group, handler: output.handler, bytes, files: inventory }); save();
  }
  put(outputRoot, 'config.json', JSON.stringify(config, null, 2) + '\n');
  report.configSha256 = digest(readFileSync(join(outputRoot, 'config.json')));
  verifiedStagingFiles(stagingRoot, imageBudgetScope, accountScope, recoveryScope);
  report.status = 'packaged-locally-not-deployed'; report.completedAt = new Date().toISOString(); save();
  console.log(JSON.stringify({ status: report.status, routes: 26, functions: report.groups.length, report: reportPath }));
  return report;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const worker = process.argv[2] === '--worker', args = process.argv.slice(worker ? 3 : 2);
  assert.ok([2,3,4,5].includes(args.length), 'Usage: node scripts/package-grouped-functions.mjs <staging-root> <installed-@vercel/node-directory> [reviewed-image-budget-scope] [reviewed-account-frontend-scope] [reviewed-source-recovery-scope]');
  if (worker) await packageGroups(resolve(args[0]), resolve(args[1]), args[2] && resolve(args[2]), args[3] && resolve(args[3]), args[4] && resolve(args[4]));
  else {
    const env = Object.fromEntries(['PATH','HOME','TMPDIR','LANG'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
    const result = spawnSync(process.execPath, [fileURLToPath(import.meta.url), '--worker', ...args.map(path => resolve(path))], { env, stdio: 'inherit' });
    process.exitCode = result.status ?? 1;
  }
}
