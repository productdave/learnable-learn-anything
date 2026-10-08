import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const chat = readFileSync(join(root, 'web/js/chat.js'), 'utf8');
const apiKeys = readFileSync(join(root, 'web/js/api-keys.js'), 'utf8');
const auth = readFileSync(join(root, 'web/js/auth.js'), 'utf8');
const css = readFileSync(join(root, 'web/styles/components.css'), 'utf8');
const userCourses = readFileSync(join(root, 'web/js/user-courses.js'), 'utf8');
const packageJson = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));

const combined = `${chat}\n${apiKeys}\n${auth}\n${userCourses}`;

assert.ok(
  chat.includes('Saved to your account so the tutor and cloud course-generation agents can use it across devices.'),
  'chat API-key prompt should describe the account/cloud agent model.'
);
assert.ok(
  auth.includes('Your progress and bring-your-own model keys sync across every device you sign in on.'),
  'account modal should describe cross-device provider-key sync.'
);
assert.ok(
  auth.includes('Temporary testing setup: you bring your own provider keys.') &&
    auth.includes('Later, Learnable can move to platform credits and hide this from learners.'),
  'account modal should explain BYOK is a temporary development/testing setup.'
);
assert.ok(
  auth.includes('Dashboard') &&
    auth.includes('How to create a key') &&
    apiKeys.includes('https://console.anthropic.com/settings/keys') &&
    apiKeys.includes('https://platform.openai.com/api-keys') &&
    apiKeys.includes('https://aistudio.google.com/apikey'),
  'account modal should link directly to provider dashboards and setup guides.'
);
assert.ok(
  apiKeys.includes('Future image + multimodal adapter') &&
    apiKeys.includes('Future search + multimodal adapter'),
  'future provider slots should describe their intended architecture role.'
);
assert.ok(
  css.includes('.auth-modal') &&
    css.includes('overflow-y: auto;') &&
    css.includes('100dvh') &&
    css.includes('.auth-keyform .auth-input') &&
    css.includes('flex-basis: 100%;'),
  'account API-key modal should stay scrollable and usable on mobile.'
);
assert.ok(
  userCourses.includes('Supabase `user_courses` is the durable account store'),
  'user course storage comments should describe durable account storage.'
);

for (const stale of [
  'Stored locally in your browser. Sent directly to Anthropic',
  'never anywhere else',
  'local-only version',
  'Phase 2 #3 ships local-only',
  'Supabase backend follow-up'
]) {
  assert.equal(combined.includes(stale), false, `stale local-only API/course storage copy remains: ${stale}`);
}

assert.ok(packageJson.scripts['test:api-key-copy']);
assert.ok(packageJson.scripts['verify:cloud-architecture'].includes('test:api-key-copy'));

console.log('API key copy tests passed');
