import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const app = readFileSync(join(root, 'web/js/app.js'), 'utf8');

assert.ok(app.includes('const activeCourseId = getCurrentCourseId();'));
assert.ok(app.includes('invalidateCourseCache(activeCourseId);'));
assert.ok(app.includes('currentMode = null;'));
assert.ok(app.includes('currentCourseSlug = null;'));
assert.ok(app.includes('Re-render the current route so account-only courses are revalidated'));
assert.ok(app.includes('renderForCurrentURL();'));

const authChangeBlock = app.slice(
  app.indexOf('function bridgeAuthIdentity()'),
  app.indexOf('function escapeHTML')
);

assert.ok(authChangeBlock.includes('removeCloudJobs();'));
assert.ok(authChangeBlock.includes('invalidateCourseCache(activeCourseId);'));
assert.ok(authChangeBlock.includes('renderForCurrentURL();'));
assert.ok(
  authChangeBlock.indexOf('invalidateCourseCache(activeCourseId);') <
  authChangeBlock.indexOf('renderForCurrentURL();')
);

console.log('auth course boundary tests passed');
