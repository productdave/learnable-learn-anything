import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { assertModuleVersion, assertReferenceVersion, htmlAssets, minimumBrowserVersions as versions } from './browser-contract.mjs';

const root = process.cwd();
const intake = readFileSync(join(root, 'web/js/intake.js'), 'utf8');
const app = readFileSync(join(root, 'web/js/app.js'), 'utf8');
const index = readFileSync(join(root, 'web/index.html'), 'utf8');

assert.match(intake, /import \{ getUser, onUserChange, openAccount \} from '\.\/auth\.js\?v=\d+';/);
assertModuleVersion(intake, './auth.js', versions['js/auth.js']);
assert.ok(intake.includes("const PENDING_COURSE_CREATION_KEY = 'learnable-pending-course-creation';"));
assert.ok(intake.includes('function savePendingCourseCreation(draft = {}, options = {})'));
assert.ok(intake.includes('localStorage.setItem(PENDING_COURSE_CREATION_KEY, payload);'));
assert.ok(intake.includes('sessionStorage.setItem(PENDING_COURSE_CREATION_KEY, payload);'));
assert.ok(intake.includes('function readPendingCourseCreation()'));
assert.ok(intake.includes('function readPendingCourseCreationRaw()'));
assert.ok(intake.includes('function clearPendingCourseCreation()'));
assert.ok(intake.includes('function hideAccountModal()'));
assert.ok(intake.includes('localStorage.getItem(PENDING_COURSE_CREATION_KEY)'));
assert.ok(intake.includes('sessionStorage.getItem(PENDING_COURSE_CREATION_KEY)'));
assert.ok(
  intake.indexOf('try { raw = localStorage.getItem(PENDING_COURSE_CREATION_KEY); } catch {}') <
  intake.indexOf('try { raw = sessionStorage.getItem(PENDING_COURSE_CREATION_KEY); } catch {}'),
  'pending course creation should fall back to sessionStorage when localStorage reads fail.'
);
assert.ok(intake.includes('localStorage.removeItem(PENDING_COURSE_CREATION_KEY);'));
assert.ok(intake.includes('sessionStorage.removeItem(PENDING_COURSE_CREATION_KEY);'));

const requireBlock = intake.slice(
  intake.indexOf('function requireSignedInForCourseCreation'),
  intake.indexOf('/** Open the form to start a new generation. */')
);
assert.ok(requireBlock.includes('savePendingCourseCreation(draft, options);'));
assert.ok(requireBlock.includes("openAccount({ intent: 'course-generation' });"));
assert.ok(
  requireBlock.indexOf('savePendingCourseCreation(draft, options);') <
  requireBlock.indexOf("openAccount({ intent: 'course-generation' });")
);

const draftOpenBlock = intake.slice(
  intake.indexOf('export function openIntakeWithDraft'),
  intake.indexOf('/** Open the progress view')
);
assert.ok(draftOpenBlock.includes('requireSignedInForCourseCreation(draft, options)'));

const submitBlock = intake.slice(
  intake.indexOf('async function onSubmit'),
  intake.indexOf('async function startReviewableGeneration')
);
assert.ok(submitBlock.includes('savePendingCourseCreation(formDraft(e.target), { reuseJobId: reuseJobIdForSubmit, expected: reuseExpectation });'));

const authListenerBlock = intake.slice(
  intake.indexOf('onUserChange((user) => {'),
  intake.indexOf('// Watch the rendered job')
);
assert.ok(authListenerBlock.includes('readPendingCourseCreation()'));
assert.ok(authListenerBlock.includes('clearPendingCourseCreation();'));
assert.ok(authListenerBlock.includes('hideAccountModal();'));
assert.ok(authListenerBlock.includes('openIntakeWithDraft(pending.draft || {}, pending.options || {});'));
assert.ok(
  authListenerBlock.indexOf('clearPendingCourseCreation();') <
  authListenerBlock.indexOf('openIntakeWithDraft(pending.draft || {}, pending.options || {});')
);

assertModuleVersion(app, './intake.js', versions['js/intake.js']);
assertReferenceVersion(htmlAssets(index), 'js/app.js', versions['js/app.js']);

console.log('auth pending intake tests passed');
