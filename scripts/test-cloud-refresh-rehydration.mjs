import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const app = readFileSync(join(root, 'web/js/app.js'), 'utf8');

const refreshBody = app.slice(
  app.indexOf('async function refreshCloudGenerationState()'),
  app.indexOf('function installCloudGenerationRefreshTriggers()')
);
const triggersBody = app.slice(
  app.indexOf('function installCloudGenerationRefreshTriggers()'),
  app.indexOf('function escapeHTML')
);
const initBody = app.slice(
  app.indexOf('async function init()'),
  app.indexOf('init().catch')
);
const bridgeBody = app.slice(
  app.indexOf('function bridgeAuthIdentity()'),
  app.indexOf('async function refreshCloudGenerationState()')
);

assert.ok(app.includes('let cloudGenerationRefreshOwnerId = null;'));
assert.ok(refreshBody.includes('const ownerId = getUser()?.id || null;'));
assert.ok(refreshBody.includes('if (!ownerId) return;'));
assert.ok(refreshBody.includes('if (cloudGenerationRefresh && cloudGenerationRefreshOwnerId === ownerId) return cloudGenerationRefresh;'));
assert.ok(refreshBody.includes('cloudGenerationRefreshOwnerId = ownerId;'));
assert.ok(refreshBody.includes('const refreshOwnerId = ownerId;'));
assert.ok(refreshBody.includes('try { await markStaleCloudJobs(); } catch {}'));
assert.ok(refreshBody.includes('await markStaleCloudJobs();'));
assert.ok(refreshBody.includes('await rehydrateCloudSubscriptions();'));
assert.ok(
  refreshBody.indexOf('await markStaleCloudJobs();') < refreshBody.indexOf('await rehydrateCloudSubscriptions();'),
  'watchdog should mark expired jobs before rehydrating current rows.'
);
assert.ok(refreshBody.includes('if (cloudGenerationRefreshOwnerId === refreshOwnerId) {'));
assert.ok(refreshBody.includes('cloudGenerationRefresh = null;'));
assert.ok(refreshBody.includes('cloudGenerationRefreshOwnerId = null;'));

assert.ok(initBody.includes('refreshCloudGenerationState().catch(() => {});'));
assert.ok(initBody.includes('installCloudGenerationRefreshTriggers();'));
assert.ok(bridgeBody.includes('refreshCloudGenerationState().catch(() => {});'));
assert.ok(triggersBody.includes('setInterval(() => {'));
assert.ok(triggersBody.includes('60 * 1000'));
assert.ok(triggersBody.includes("window.addEventListener('online'"));
assert.ok(triggersBody.includes("window.addEventListener('focus'"));
assert.ok(triggersBody.includes("document.addEventListener('visibilitychange'"));
assert.ok(triggersBody.includes("document.visibilityState === 'visible'"));

console.log('cloud refresh rehydration tests passed');
