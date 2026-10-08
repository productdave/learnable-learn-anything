import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertModuleVersion, minimumBrowserVersions as versions } from './browser-contract.mjs';

const root = process.cwd();
const intake = readFileSync(join(root, 'web/js/intake.js'), 'utf8');
const sync = readFileSync(join(root, 'web/js/sync.js'), 'utf8');

assert.ok(sync.includes('export async function pullSyncNow()'));
assert.ok(sync.includes('await pull();'));
assert.match(intake, /import \{ flushSync, kickSync, pullSyncNow \} from '\.\/sync\.js\?v=\d+';/);
assertModuleVersion(intake, './sync.js', versions['js/sync.js']);

const submitBlock = intake.slice(
  intake.indexOf('async function onSubmit'),
  intake.indexOf('async function startReviewableGeneration')
);
const pullIndex = submitBlock.indexOf('await pullSyncNow();');
const missingKeyIndex = submitBlock.indexOf("err.textContent = 'An Anthropic API key is required.'");
const flushIndex = submitBlock.indexOf('await flushSync();');

assert.ok(pullIndex > -1, 'intake should pull account sync before rejecting a missing API key.');
assert.ok(missingKeyIndex > -1, 'intake should still show a clear missing-key error.');
assert.ok(pullIndex < missingKeyIndex, 'remote API key pull should happen before missing-key rejection.');
assert.ok(missingKeyIndex < flushIndex, 'flushSync should still only run after an API key exists.');

console.log('intake API key sync tests passed');
