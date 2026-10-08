// Local, installed Vercel Node-builder diagnostic. No project link, deploy,
// environment pull, package scripts, database access or provider requests.
import assert from 'node:assert/strict';
import { cpSync, existsSync, linkSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { tmpdir } from 'node:os';
import { createRequire, syncBuiltinESMExports } from 'node:module';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
import { verifyCandidate } from './assemble-workspace-candidate.mjs';
import { digest } from './plan-workspace-release.mjs';
import { pdfFixture, docxFixture } from './fixtures/source-documents.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const script = fileURLToPath(import.meta.url);
function cleanEnvironment() {
  return Object.fromEntries(['PATH', 'HOME', 'TMPDIR', 'LANG'].filter(key => process.env[key]).map(key => [key, process.env[key]]));
}
function blockNetwork() {
  const deny = () => { throw new Error('Network is disabled in the local function-packaging diagnostic.'); };
  globalThis.fetch = deny;
  http.request = http.get = https.request = https.get = net.connect = net.createConnection = deny;
  net.Socket.prototype.connect = deny;
  syncBuiltinESMExports();
}
function destination(directory, name) {
  assert.ok(name && !isAbsolute(name) && !name.includes('\\') && !name.split('/').some(part => !part || part === '..' || part === '.'), `Unsafe bundle path: ${name}`);
  const path = resolve(directory, name);
  assert.ok(relative(directory, path) && !relative(directory, path).startsWith('..' + sep));
  return path;
}
async function fileBytes(file) {
  assert.ok(typeof file.toStream === 'function', `Unsupported builder file type: ${file.type}`);
  // FileBlob's installed into-stream uses the pre-async-iterator stream API.
  return new Promise((resolve, reject) => {
    const chunks = [], stream = file.toStream();
    stream.on('data', chunk => chunks.push(Buffer.from(chunk)));
    stream.on('error', reject);
    stream.on('end', () => resolve(Buffer.concat(chunks)));
  });
}

// Invoked in a separate process from the bundle's own directory, with no
// dependency fallback to the workspace and no real environment variables.
const probe = String.raw`
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import { resolve, sep } from 'node:path';
import { syncBuiltinESMExports } from 'node:module';
import http from 'node:http';
import https from 'node:https';
import net from 'node:net';
const deny = () => { throw new Error('Probe network disabled.'); };
globalThis.fetch = deny;
http.request = http.get = https.request = https.get = net.connect = net.createConnection = deny;
net.Socket.prototype.connect = deny;
syncBuiltinESMExports();
const directory = process.cwd(), [entrypoint, readerFlag] = process.argv.slice(2);
const checks = [], failures = [];
async function check(name, run) {
  try { await run(); checks.push(name); }
  catch (error) { failures.push({ name, code: error.code, message: error.message }); }
}
await check('isolated-handler-import', async () => {
  const handler = await import(pathToFileURL(resolve(directory, entrypoint)));
  assert.equal(typeof handler.default, 'function', 'Packaged endpoint must export a handler');
});
if (readerFlag === 'reader') {
  await check('bundle-only-dependency-resolution', async () => {
    for (const name of ['mammoth', 'yauzl', 'pdfjs-dist/legacy/build/pdf.mjs']) {
      const url = import.meta.resolve(name);
      assert.ok(url.startsWith(pathToFileURL(directory + sep).href), 'Dependency escaped the bundle: ' + name);
    }
  });
  const { readDocument } = await import('./api/_lib/document-reader.mjs');
  await check('worker-pdf-two-pages', async () => {
    const pdf = await readDocument(await readFile('./__qa-fixtures/sample.pdf'), 'pdf');
    assert.equal(pdf.pages, 2); assert.match(pdf.text, /First packaged page/); assert.match(pdf.text, /Second packaged page/);
  });
  await check('worker-docx-unicode', async () => {
    const word = await readDocument(await readFile('./__qa-fixtures/sample.docx'), 'docx');
    assert.match(word.text, /Packaged Word café 日本語/);
  });
  await check('worker-txt-unicode', async () => {
    const text = await readDocument(await readFile('./__qa-fixtures/sample.txt'), 'txt');
    assert.equal(text.text, 'Packaged transcript café 日本語');
  });
  await check('scanned-pdf-actionable-rejection', async () => {
    await assert.rejects(readDocument(await readFile('./__qa-fixtures/scanned.pdf'), 'pdf'), error => error.code === 'no-selectable-text');
  });
}
console.log('FUNCTION_PROBE_RESULT=' + JSON.stringify({ checks, failures }));
if (failures.length) process.exitCode = 1;
`;

async function verifyBundles(candidateRoot, builderPackage, diagnosticOverride = '') {
  assert.ok(['', 'shared', 'shared-and-pdf'].includes(diagnosticOverride), 'Unknown diagnostic override');
  // Read only frozen source paths; never copy a linked project's .vercel/.env.
  const bundledScope = resolve(candidateRoot, '../scope.json');
  const plan = JSON.parse(readFileSync(existsSync(bundledScope) ? bundledScope : join(root, 'docs/upgrade/workspace-release-scope-2026-09-18.json')));
  const sourceFiles = verifyCandidate(candidateRoot, plan);
  const packageJson = JSON.parse(readFileSync(join(candidateRoot, 'package.json')));
  assert.equal(Object.keys(packageJson.scripts || {}).length, 0, 'Review package scripts before running the builder');
  assert.ok(existsSync(join(candidateRoot, 'node_modules')), 'Install candidate dependencies separately with scripts disabled first');
  const builderRequire = createRequire(join(builderPackage, 'package.json'));
  const builder = builderRequire(builderPackage);
  const { FileFsRef } = builderRequire('@vercel/build-utils');
  const version = JSON.parse(readFileSync(join(builderPackage, 'package.json'))).version;
  const directory = mkdtempSync(join(tmpdir(), 'learnable-function-bundles-'));
  const workPath = join(directory, 'work'), store = join(directory, 'content');
  mkdirSync(workPath); mkdirSync(store);
  const files = {};
  for (const name of Object.keys(plan.files)) {
    const path = destination(workPath, name); mkdirSync(dirname(path), { recursive: true });
    cpSync(join(candidateRoot, name), path, { errorOnExist: true, force: false });
    files[name] = await FileFsRef.fromFsPath({ fsPath: path });
  }
  cpSync(join(candidateRoot, 'node_modules'), join(workPath, 'node_modules'), { recursive: true, errorOnExist: true, force: false });
  const vercel = JSON.parse(readFileSync(join(workPath, 'vercel.json')));
  const entrypoints = Object.keys(plan.files).filter(path => path.startsWith('api/') && !path.includes('/_lib/') && path.endsWith('.js')).sort();
  assert.ok(entrypoints.length > 0);
  const report = {
    status: 'running-local-builder-diagnostic', createdAt: new Date().toISOString(), candidateRoot,
    sourceFiles, scopeSha256: digest(JSON.stringify(plan)), builder: { package: '@vercel/node', version, packageRoot: builderPackage },
    host: { node: process.version, platform: process.platform, architecture: process.arch },
    directory, diagnosticConfigOverride: diagnosticOverride || null, endpoints: [], failures: [],
    limitations: ['Not vercel build / deployment / hosted configuration acceptance.', 'Local macOS dependencies, not hosted Linux binaries.', 'Node runtime chosen by builder may differ from local probe runtime.', 'PDF resource files inventoried; fixtures do not exercise all fonts, CMaps or WASM paths.', 'No project settings, environment secrets, Auth, Storage, cron or real providers used.']
  };
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2));
  blockNetwork();
  for (const entrypoint of entrypoints) {
    const result = { entrypoint };
    console.log(`Packaging ${entrypoint}`);
    try {
      const endpointConfig = { ...(vercel.functions?.[entrypoint] || {}) };
      // Hypothesis testing only: change the builder inputs in this throwaway run,
      // never the candidate, manifest, source, or deploy configuration.
      if (diagnosticOverride && ['api/gen/review.js', 'api/gen/sources.js', 'api/setups/generate.js', 'api/setups/store.js'].includes(entrypoint)) {
        endpointConfig.includeFiles = [
          ...[endpointConfig.includeFiles].flat().filter(Boolean),
          `js-${plan.releaseName}/{setup-model,draft-store}.js`,
          ...(diagnosticOverride === 'shared-and-pdf' ? ['node_modules/pdfjs-dist/{legacy/build,cmaps,standard_fonts,wasm}/**'] : [])
        ];
      }
      const { output } = await builder.build({ files, entrypoint, workPath, repoRootPath: workPath,
        meta: { skipDownload: true }, considerBuildCommand: true,
        config: { zeroConfig: true, nodeVersion: '22.x', ...endpointConfig, projectSettings: { installCommand: '', buildCommand: null } }
      });
      result.runtime = output.runtime; result.handler = output.handler; result.files = Object.keys(output.files).length;
      assert.equal(output.runtime, 'nodejs22.x', 'Packaged runtime must match the reviewed and tested Node major');
      result.bytes = 0; result.maxDuration = output.maxDuration ?? null;
      const bundle = join(directory, 'bundles', entrypoint.replaceAll('/', '_') + '.func'); mkdirSync(bundle, { recursive: true });
      const inventory = {};
      for (const [name, file] of Object.entries(output.files)) {
        assert.notEqual(file.mode & 0o170000, 0o120000, `Unexpected bundle symlink: ${name}`);
        const bytes = await fileBytes(file), hash = digest(bytes), mode = file.mode & 0o777;
        const content = join(store, `${hash}-${mode}`);
        if (!existsSync(content)) writeFileSync(content, bytes, { flag: 'wx', mode });
        const path = destination(bundle, name); mkdirSync(dirname(path), { recursive: true }); linkSync(content, path);
        inventory[name] = { sha256: hash, bytes: bytes.length }; result.bytes += bytes.length;
      }
      writeFileSync(join(bundle, '__qa-inventory.json'), JSON.stringify(inventory, null, 2));
      const hasReader = !!output.files['api/_lib/document-reader.mjs']; result.documentReader = hasReader;
      if (hasReader) {
        result.pdfResources = Object.fromEntries(['legacy/build', 'cmaps', 'standard_fonts', 'wasm'].map(folder => [folder, Object.keys(output.files).filter(path => path.startsWith(`node_modules/pdfjs-dist/${folder}/`)).length]));
        mkdirSync(join(bundle, '__qa-fixtures'));
        writeFileSync(join(bundle, '__qa-fixtures/sample.pdf'), pdfFixture(['First packaged page', 'Second packaged page']));
        writeFileSync(join(bundle, '__qa-fixtures/sample.docx'), docxFixture(['Packaged Word café 日本語']));
        writeFileSync(join(bundle, '__qa-fixtures/sample.txt'), 'Packaged transcript café 日本語');
        writeFileSync(join(bundle, '__qa-fixtures/scanned.pdf'), pdfFixture(['']));
      }
      writeFileSync(join(bundle, '__qa-probe.mjs'), probe, { flag: 'wx' });
      const check = spawnSync(process.execPath, ['__qa-probe.mjs', entrypoint, hasReader ? 'reader' : 'no-reader'], { cwd: bundle, env: cleanEnvironment(), encoding: 'utf8', timeout: 60000, maxBuffer: 1024 * 1024 });
      const marker = check.stdout?.split('\n').find(line => line.startsWith('FUNCTION_PROBE_RESULT='));
      result.probe = { status: check.status, signal: check.signal, ...(marker ? JSON.parse(marker.slice('FUNCTION_PROBE_RESULT='.length)) : { checks: [], failures: [] }), diagnostic: check.status === 0 ? '' : (check.stderr || check.error?.message || 'Probe failed').slice(-4000) };
      assert.equal(check.status, 0, `Isolated function probe failed: ${JSON.stringify(result.probe.failures)} ${result.probe.diagnostic}`);
      assert.ok(marker, 'Probe did not report completion');
      result.status = 'passed';
    } catch (error) {
      result.status = 'failed'; result.error = error.message;
      report.failures.push({ entrypoint, error: error.message });
    }
    report.endpoints.push(result);
    writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
    console.log(`${result.status}: ${entrypoint} (${result.files || 0} files, ${result.runtime || 'no runtime'})`);
  }
  report.sourceFilesReverified = verifyCandidate(candidateRoot, plan);
  report.status = report.failures.length ? 'failed-local-builder-diagnostic' : 'passed-local-builder-diagnostic-not-release-approval';
  report.completedAt = new Date().toISOString();
  writeFileSync(join(directory, 'report.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, endpoints: report.endpoints.length, failures: report.failures.length, report: join(directory, 'report.json') }, null, 2));
  if (report.failures.length) process.exitCode = 1;
}

if (process.argv[2] === '--isolated-worker') {
  await verifyBundles(resolve(process.argv[3]), resolve(process.argv[4]), process.argv[5]);
} else {
  assert.ok([4, 5].includes(process.argv.length), 'Usage: node scripts/verify-candidate-function-bundles.mjs <frozen-candidate-web> <installed-@vercel/node-package-directory> [shared|shared-and-pdf]');
  const run = spawnSync(process.execPath, [script, '--isolated-worker', resolve(process.argv[2]), resolve(process.argv[3]), process.argv[4] || ''], { env: cleanEnvironment(), stdio: 'inherit' });
  process.exitCode = run.status ?? 1;
}
