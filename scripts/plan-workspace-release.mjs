// Offline release planning only: no copies, builds, credentials, network or deploy.
// Freeze stdout with --json; --check detects subsequent source/scope drift.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { resolve, join, posix } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { moduleReferences, htmlAssets } from './browser-contract.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
export const releaseName = 'workspace-20260918-candidate3';
const jsRoot = `js-${releaseName}/`, cssRoot = `styles-${releaseName}/`;
const oldCatalog = 'data/courses/catalog-dinner-release.json';
const newCatalog = `data/courses/catalog-${releaseName}.json`;
const replacements = new Set(['index.html', 'package.json', 'package-lock.json', 'vercel.json']);
export const digest = (bytes, algorithm = 'sha256') => createHash(algorithm).update(bytes).digest('hex');

export function assertSafePath(path) {
  assert.ok(typeof path === 'string' && path && !path.includes('\\') && !path.startsWith('/'), `Unsafe path: ${path}`);
  assert.ok(path.split('/').every(p => p && p !== '..' && !p.startsWith('.') && !['node_modules', 'output', 'tmp'].includes(p)), `Excluded path: ${path}`);
  assert.ok(!/\.(?:log|pem|key)$/.test(path), `Excluded file: ${path}`);
}

export function readTree(directory, prefix = '') {
  const result = new Map();
  for (const item of readdirSync(join(directory, prefix), { withFileTypes: true })) {
    // Local tooling/config is never read or included, including Vercel env files.
    if (item.name.startsWith('.') || ['node_modules', 'output', 'tmp'].includes(item.name)) continue;
    const path = prefix + item.name;
    assertSafePath(path);
    assert.ok(!item.isSymbolicLink(), `Refusing symlink: ${path}`);
    if (item.isDirectory()) for (const [key, value] of readTree(directory, path + '/')) result.set(key, value);
    else { assert.ok(item.isFile(), `Not a regular file: ${path}`); result.set(path, readFileSync(join(directory, path))); }
  }
  return result;
}

export function transform(path, bytes) {
  let source = bytes.toString('utf8');
  if (path === 'index.html') {
    source = source.replace(/\b(src|href)=(["'])(js|styles)\//g, (_, attr, quote, kind) => `${attr}=${quote}${kind === 'js' ? jsRoot : cssRoot}`);
  } else if (path.startsWith('api/')) {
    // Browser/server shared contracts must be from the same new release.
    source = source.replace(/(["'])(\.\.\/)+js\//g, match => match.replace('js/', jsRoot));
  } else if (path === 'vercel.json') {
    const config = JSON.parse(source);
    for (const value of Object.values(config.functions || {})) {
      if (typeof value.includeFiles === 'string') value.includeFiles = value.includeFiles.replaceAll('js/{setup-model,draft-store}.js', jsRoot + '{setup-model,draft-store}.js');
    }
    source = JSON.stringify(config, null, 2) + '\n';
  } else if (['js/course-loader.js', 'js/community-catalog.js'].includes(path)) {
    assert.ok(source.includes("'data/courses/index.json'"), `Catalog transform requires review: ${path}`);
    source = source.replaceAll("'data/courses/index.json'", `'${newCatalog}'`);
  }
  return Buffer.from(source);
}

export function planRelease({ baseline, baselineFiles, workspaceFiles, migrations }) {
  const records = new Map(), payloads = new Map();
  const put = (target, origin, source, bytes, action, transforms = []) => {
    assertSafePath(target); assertSafePath(source);
    payloads.set(target, bytes);
    records.set(target, { action, origin, source, sha256: digest(bytes), bytes: bytes.length, ...(transforms.length ? { transforms } : {}) });
  };
  assert.equal(baseline.schemaVersion, 1);
  assert.deepEqual([...baselineFiles.keys()].sort(), Object.keys(baseline.files).sort(), 'Recovered source inventory differs from verified deployment');
  for (const [path, uid] of Object.entries(baseline.files)) {
    assertSafePath(path);
    assert.match(uid, /^[a-f0-9]{40}$/);
    assert.equal(digest(baselineFiles.get(path), 'sha1'), uid, `Production baseline drift: ${path}`);
    assert.ok(!path.startsWith(jsRoot) && !path.startsWith(cssRoot) && path !== newCatalog, 'Release namespace already exists; choose a new one');
    if (path.startsWith('api/')) assert.ok(workspaceFiles.has(path), `Explicit retirement decision required for API: ${path}`);
    put(path, 'baseline', path, baselineFiles.get(path), 'preserve');
  }
  for (const [path, bytes] of workspaceFiles) {
    assertSafePath(path);
    if (path.startsWith('js/')) {
      assert.match(path, /\.m?js$/);
      put(jsRoot + path.slice(3), 'workspace', path, transform(path, bytes), 'add',
        ['js/course-loader.js', 'js/community-catalog.js'].includes(path) ? ['physical-catalog-url'] : []);
    } else if (path.startsWith('styles/')) {
      assert.match(path, /\.css$/);
      put(cssRoot + path.slice(7), 'workspace', path, bytes, 'add');
    } else if (path.startsWith('api/') || replacements.has(path)) {
      if (path.startsWith('api/')) assert.match(path, /\.m?js$/);
      const transformed = transform(path, bytes);
      put(path, 'workspace', path, transformed, baselineFiles.has(path) ? 'replace' : 'add',
        !transformed.equals(bytes) ? [path === 'index.html' ? 'physical-browser-assets' : path === 'vercel.json' ? 'namespaced-function-includes' : 'shared-server-module-paths'] : []);
    } else {
      // No new/static course edits, public author changes or arbitrary files ride along.
      assert.ok(baselineFiles.has(path) && bytes.equals(baselineFiles.get(path)), `Out-of-scope asset needs review: ${path}`);
    }
  }
  for (const path of replacements) assert.ok(workspaceFiles.has(path), `Missing release input: ${path}`);
  assert.ok(baselineFiles.has(oldCatalog), 'Verified active production catalog required');
  put(newCatalog, 'baseline', oldCatalog, baselineFiles.get(oldCatalog), 'add');
  const catalog = JSON.parse(baselineFiles.get(oldCatalog));
  assert.ok(Array.isArray(catalog.courses) && catalog.courses.length, 'Empty/invalid catalog');
  for (const course of catalog.courses) assert.ok(payloads.has(`data/courses/${course.id}/course.json`), `Missing bundled course: ${course.id}`);

  let relativeImports = 0;
  for (const [path, bytes] of payloads) {
    if (!path.startsWith(jsRoot) && !path.startsWith('api/')) continue;
    const text = bytes.toString('utf8');
    assert.ok(!/\bsk-(?:ant-|proj-)?[A-Za-z0-9_-]{24,}/.test(text), `Possible provider secret: ${path}`);
    for (const ref of moduleReferences(text)) {
      if (!ref.startsWith('.')) continue;
      const target = posix.normalize(posix.join(posix.dirname(path), ref.split('?')[0]));
      assert.ok(payloads.has(target), `Missing module: ${path} → ${ref}`);
      assert.ok(!target.startsWith('js/'), `New release imports legacy module: ${path} → ${ref}`);
      relativeImports++;
    }
  }
  // Some historical js/generator files are server-only shared modules. Check
  // the actual browser entry graph separately so it cannot import API internals.
  const browserModules = new Set(), browserQueries = new Map(), pending = [jsRoot + 'app.js'];
  while (pending.length) {
    const path = pending.pop();
    if (browserModules.has(path)) continue;
    assert.ok(payloads.has(path), `Missing browser entry/module: ${path}`);
    browserModules.add(path);
    for (const ref of moduleReferences(payloads.get(path).toString())) {
      if (!ref.startsWith('.')) continue;
      const target = posix.normalize(posix.join(posix.dirname(path), ref.split('?')[0]));
      assert.ok(target.startsWith(jsRoot), `Browser import leaves new graph: ${path} → ${ref}`);
      const query = ref.split('?')[1] || '';
      if (browserQueries.has(target)) assert.equal(query, browserQueries.get(target), `Conflicting browser singleton URL: ${target}`);
      browserQueries.set(target, query);
      pending.push(target);
    }
  }
  const entryAssets = htmlAssets(payloads.get('index.html').toString());
  assert.ok(entryAssets.some(ref => ref.split('?')[0] === jsRoot + 'app.js'), 'HTML must enter the new browser graph');
  for (const ref of entryAssets) {
    if (/^(?:https?:|#|\/)/.test(ref)) continue;
    assert.ok(payloads.has(ref.split('?')[0]), `Missing HTML asset: ${ref}`);
    assert.ok(!/^(js|styles)\//.test(ref), `HTML references legacy asset: ${ref}`);
  }
  const config = payloads.get(jsRoot + 'config.js')?.toString() || '';
  for (const flag of ['CREATION_IMAGES_ENABLED', 'SELF_PUBLISH_ENABLED', 'MODERATION_ENABLED']) {
    assert.ok(config.includes(`export const ${flag} = false;`), `Unapproved feature enablement: ${flag}`);
  }
  const vercel = JSON.parse(payloads.get('vercel.json')), cron = vercel.crons;
  assert.deepEqual(cron, [{ path: '/api/gen/sweep', schedule: '0 0 * * *' }], 'Cron scope/cadence changed');
  assert.equal(JSON.parse(payloads.get('package.json')).engines?.node, '^22.13.0', 'Runtime major requires re-review');
  for (const endpoint of ['api/setups/generate.js','api/setups/store.js','api/gen/sources.js','api/gen/review.js']) {
    if (!payloads.has(endpoint)) continue;
    const includes = vercel.functions?.[endpoint]?.includeFiles || '';
    assert.ok(includes.includes(jsRoot+'{setup-model,draft-store}.js'), `Missing namespaced shared includes: ${endpoint}`);
    for (const resource of ['legacy/build','cmaps','standard_fonts','wasm']) assert.ok(includes.includes(`node_modules/pdfjs-dist/${resource}/**`), `Missing PDF resources: ${endpoint}`);
  }
  const migrationEntries = [...migrations].sort(([a], [b]) => a.localeCompare(b));
  assert.equal(migrationEntries.length, 21, 'Migration order requires re-review');
  migrationEntries.forEach(([path], i) => assert.ok(path.startsWith(`${String(i + 1).padStart(2, '0')}-`) && path.endsWith('.sql'), `Unexpected migration: ${path}`));
  const files = Object.fromEntries([...records].sort(([a], [b]) => a.localeCompare(b)));
  const counts = { preserve: 0, replace: 0, add: 0 };
  for (const entry of Object.values(files)) counts[entry.action]++;
  return {
    schemaVersion: 1, status: 'planning-only-not-deployable', releaseName,
    baselineDeployment: baseline.deploymentId, baselineVerifiedAt: baseline.verifiedAt,
    baselineManifestSha256: digest(JSON.stringify(baseline)),
    counts, relativeImportsChecked: relativeImports, browserModulesChecked: browserModules.size, bundledCourses: catalog.courses.map(c => c.id),
    unresolvedGates: ['G1 legacy history and deployed-client compatibility', 'G2 real output and qualified swim review', 'G3 remaining connected edge cases', 'G4 operator and public operations policy', 'G5 isolated candidate build and mixed-client acceptance', 'G6 explicit hosted authority and physical-device acceptance'],
    requiredBeforeStaging: ['Isolated staging Supabase/Auth/Storage, never production credentials', 'Review public config replacement and matching server environment', 'Inventory remote migration history; apply only approved missing forward migrations', 'Review frozen sources and rebuild/test the transformed candidate', 'Retain old static paths; keep privileged feature flags off until separately accepted'],
    migrations: migrationEntries.map(([path, bytes]) => ({ path: `db/${path}`, sha256: digest(bytes), status: 'hosted-inventory-required-not-applied' })),
    files,
  };
}

export function createPlan({ baselineRoot, workspaceRoot = join(root, 'web'), baselinePath = join(root, 'docs/upgrade/production-baseline-2026-09-17.json'), dbRoot = join(root, 'db') }) {
  assert.ok(baselineRoot, '--baseline must identify the recovered source directory');
  const migrations = new Map(readdirSync(dbRoot).filter(n => /^\d\d-.*\.sql$/.test(n)).map(n => [n, readFileSync(join(dbRoot, n))]));
  return planRelease({ baseline: JSON.parse(readFileSync(baselinePath)), baselineFiles: readTree(baselineRoot), workspaceFiles: readTree(workspaceRoot), migrations });
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const args = process.argv.slice(2), options = {};
  while (args.length) {
    const arg = args.shift();
    if (arg === '--json') options.json = true;
    else if (['--baseline', '--check'].includes(arg)) { assert.ok(args[0] && !args[0].startsWith('--'), `Missing value for ${arg}`); options[arg.slice(2)] = args.shift(); }
    else throw Error(`Unknown argument: ${arg}`);
  }
  const plan = createPlan({ baselineRoot: options.baseline });
  if (options.check) assert.deepEqual(plan, JSON.parse(readFileSync(options.check)), 'Release scope/input hashes changed; review before refreshing the manifest');
  console.log(options.json ? JSON.stringify(plan, null, 2) : JSON.stringify({ status: plan.status, counts: plan.counts, imports: plan.relativeImportsChecked, courses: plan.bundledCourses.length, manifestCheck: options.check ? 'passed' : 'not-requested' }));
}
