import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const cloud = readFileSync(join(root, 'web/js/cloud-gen-client.js'), 'utf8');
const app = readFileSync(join(root, 'web/js/app.js'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

assert.ok(
  readFileSync(join(root, 'web/api/_lib/gen-state.mjs'), 'utf8').includes('export const API_KEY_WAITING_STATUSES'),
  'partial cloud rows should be able to hydrate as missing API key recovery jobs.'
);

const partialBranch = app.slice(
  app.indexOf('} else if (isPartial && j.savedCourseId) {'),
  app.indexOf('} else if (isFailed || isInterrupted)', app.indexOf('} else if (isPartial && j.savedCourseId) {'))
);

assert.ok(partialBranch.includes('const needsApiKey = !!j.needsApiKey;'));
assert.ok(partialBranch.includes('data-job-action="api-key"'));
assert.ok(partialBranch.includes('Add API key</button>'));
assert.ok(partialBranch.includes('Retry missing topics'));
assert.ok(partialBranch.includes('needsApiKey || pendingRestart ? \'\''));
assert.ok(app.includes("openAccount({ intent: 'course-generation', jobId: id })"));
assert.ok(packageJson.scripts['verify:cloud-architecture'].includes('test:cloud-partial-api-key-recovery'));

console.log('cloud partial API key recovery tests passed');
