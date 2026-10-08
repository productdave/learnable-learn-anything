import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertReferenceVersion, htmlAssets, minimumBrowserVersions as versions } from './browser-contract.mjs';

const root = process.cwd();
const app = readFileSync(join(root, 'web/js/app.js'), 'utf8');
const index = readFileSync(join(root, 'web/index.html'), 'utf8');

const body = app.slice(
  app.indexOf('async function retireLegacyServiceWorker'),
  app.indexOf('async function init()')
);

assert.ok(body.includes('const hadController = !!navigator.serviceWorker.controller;'));
assert.ok(body.includes('const regs = await navigator.serviceWorker.getRegistrations();'));
assert.ok(body.includes('const removed = (await Promise.all(regs.map(reg => reg.unregister()))).some(Boolean);'));
assert.ok(body.includes("const reloadKey = 'learnable-sw-retired-reload';"));
assert.ok(body.includes('hadController && removed && !sessionStorage.getItem(reloadKey)'));
assert.ok(body.includes("sessionStorage.setItem(reloadKey, '1');"));
assert.ok(body.includes('window.location.reload();'));
assert.ok(body.includes('return true;'));
assert.ok(body.includes('return false;'));
assert.ok(body.includes('sessionStorage.removeItem(reloadKey);'));
assert.ok(
  body.indexOf('await navigator.serviceWorker.getRegistrations()') <
  body.indexOf('window.location.reload();'),
  'service worker unregister should happen before the one-time reload'
);
assert.ok(app.includes('if (await retireLegacyServiceWorker()) return;'));

assertReferenceVersion(htmlAssets(index), 'js/app.js', versions['js/app.js']);

console.log('legacy service worker retirement tests passed');
