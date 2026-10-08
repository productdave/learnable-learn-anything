import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { minimumBrowserVersions, assertReferenceVersion, assertModuleVersion, htmlAssets, readBrowserGraph, assertGraphConsistency } from './browser-contract.mjs';

const root = process.cwd(), graph = readBrowserGraph(root, ['js/app.js', 'js/openai-connection.js']);
const index = readFileSync(resolve(root, 'web/index.html'), 'utf8');
const connection = readFileSync(resolve(root, 'web/connect-openai.html'), 'utf8');
assertReferenceVersion(htmlAssets(connection), '/js/openai-connection.js', minimumBrowserVersions['js/openai-connection.js']);
for (const asset of ['js/app.js', 'styles/components.css', 'styles/course-editor.css', 'styles/course-images.css']) {
  assertReferenceVersion(htmlAssets(index), asset, minimumBrowserVersions[asset]);
}
// Check all reachable static and literal dynamic imports. Different URLs
// instantiate separate stateful modules, even when they serve the same file.
assertGraphConsistency(graph);
// The independent key-connection screen shares auth/client modules with the
// course viewer. Include its entry point rather than checking only app imports.
assert.ok(graph.sources.has(resolve(graph.web, 'js/openai-connection.js')));
const imageConsumers = graph.imports.get(resolve(graph.web, 'js/course-image-client.js')).map(entry => entry.from);
for (const consumer of ['js/openai-connection.js', 'js/course-images.js', 'js/setup-create.js', 'js/intake.js']) assert.ok(imageConsumers.includes(consumer), `image client is reachable from ${consumer}`);
const staleConnection = new Map(graph.imports);
staleConnection.set(resolve(graph.web, 'js/course-image-client.js'),
  graph.imports.get(resolve(graph.web, 'js/course-image-client.js')).map(entry =>
    entry.from === 'js/openai-connection.js' ? { ...entry, query: 'v=2' } : entry));
assert.throws(() => assertGraphConsistency({ ...graph, imports: staleConnection }), /conflicting URLs/);
for (const [parent, child] of [
  ['app.js', './intake.js'], ['app.js', './cloud-gen-client.js'],
  ['intake.js', './cloud-gen-client.js'], ['app.js', './auth.js'],
  ['app.js', './sync.js'], ['app.js', './course-loader.js'],
  ['app.js', './course-sync.js'], ['app.js', './components/topic-view.js'],
  ['components/topic-view.js', './diagram.js'],
]) {
  const parentPath = resolve(graph.web, 'js', parent);
  const childPath = new URL(child, 'https://qa.test/js/' + parent).pathname.slice(1);
  assertModuleVersion(graph.sources.get(parentPath), child, minimumBrowserVersions[childPath]);
}
// Future versions are valid; stale, missing, unversioned and inconsistent
// references must fail instead of silently weakening the gate.
assertModuleVersion("import('./sync.js?v=21')", './sync.js', 20);
for (const source of ["import('./sync.js?v=19')", "import('./sync.js')", '',
  "import('./sync.js?v=20'); import('./sync.js?v=21')"]) {
  assert.throws(() => assertModuleVersion(source, './sync.js', 20));
}
assert.throws(() => assertGraphConsistency({ web: '/web', imports: new Map([
  ['/web/js/sync.js', [{ query: 'v=20', from: 'app.js' }, { query: 'v=21', from: 'auth.js' }]],
]) }));
const pkg = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
assert.ok(pkg.scripts['test:browser-cache-versions']);
assert.ok(pkg.scripts['verify:cloud-architecture'].includes('test:browser-cache-versions'));
console.log('browser cache contracts passed (' + graph.sources.size + ' reachable modules; minimum versions and singleton consistency)');
