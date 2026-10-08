import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertModuleVersion, assertReferenceVersion, htmlAssets, minimumBrowserVersions as versions } from './browser-contract.mjs';
// Account-boundary behavior is exercised with the real store and sync module,
// including stale pulls, sign-out, keys, practice and retry. No source-string
// expectations for the old flat merge implementation.
await import('./test-sync-learning.mjs');
const root = process.cwd();
const app = readFileSync(join(root, 'web/js/app.js'), 'utf8');
const auth = readFileSync(join(root, 'web/js/auth.js'), 'utf8');
const intake = readFileSync(join(root, 'web/js/intake.js'), 'utf8');
const index = readFileSync(join(root, 'web/index.html'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
for (const [source, specifier] of [[app, './sync.js'], [intake, './sync.js'],
  [auth, './sync.js'], [app, './auth.js'], [app, './course-sync.js']]) {
  assertModuleVersion(source, specifier, versions[`js/${specifier.slice(2)}`]);
}
assert.match(auth, /import\('\.\/sync\.js\?v=\d+'\)/, 'auth retains lazy account sync');
assertReferenceVersion(htmlAssets(index), 'js/app.js', versions['js/app.js']);

assert.ok(packageJson.scripts['test:sync-account-boundary'], 'package script should expose sync account-boundary test.');
assert.ok(packageJson.scripts['verify:cloud-architecture'].includes('test:sync-account-boundary'), 'cloud architecture verify should run sync account-boundary test.');

console.log('sync account boundary tests passed');
