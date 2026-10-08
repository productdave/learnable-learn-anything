import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const auth = readFileSync(join(root, 'web/js/auth.js'), 'utf8');

assert.ok(auth.includes('data-auth-submit-msg'));
assert.ok(auth.includes("const msg = body.querySelector('[data-auth-submit-msg]');"));
assert.equal(auth.includes("const msg = body.querySelector('.auth-msg');"), false);

const signedOutBlock = auth.slice(
  auth.indexOf('const intentNote = intent ==='),
  auth.indexOf('function localCourseTransferHTML')
);

assert.ok(signedOutBlock.includes('Sign in first so generated courses can save to your account.'));
assert.ok(signedOutBlock.includes('data-auth-submit-msg'));
assert.ok(
  signedOutBlock.indexOf('data-auth-submit-msg') >
  signedOutBlock.indexOf('${intentNote}')
);

console.log('auth login message target tests passed');
