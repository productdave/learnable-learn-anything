import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const app = readFileSync('web/js/app.js', 'utf8');
const intake = readFileSync('web/js/intake.js', 'utf8');
const cloud = readFileSync('web/js/cloud-gen-client.js', 'utf8');

assert.ok(
  cloud.includes("status: 'timed_out'") &&
    !cloud.includes("if (s === 'timed_out') return 'interrupted';"),
  'cloud client should preserve timed_out rows instead of mapping them to interrupted.'
);

assert.ok(
  app.includes("['failed', 'interrupted', 'timed_out', 'partial']"),
  'dashboard workflow should treat timed_out jobs as actionable recoverable jobs.'
);
assert.ok(app.includes('const isTimedOut = j.status === \'timed_out\';'));
assert.ok(app.includes('Timed out — resume from saved checkpoint'));
assert.ok(app.includes('isFailed || isInterrupted || isTimedOut'));
assert.ok(app.includes("['partial', 'failed', 'interrupted', 'timed_out']"));

assert.ok(
  intake.includes("['failed', 'interrupted', 'timed_out', 'partial']"),
  'intake modal should treat timed_out jobs as actionable recoverable jobs.'
);
assert.ok(intake.includes('const isTimedOut = status === \'timed_out\';'));
assert.ok(intake.includes('Generation timed out in the cloud. Your checkpoint is saved'));
assert.ok(
  intake.includes("style=\"${needsKey || isFailed || isInterrupted || isTimedOut || isPartial || (isReview && job?.error) ? '' : 'display:none'}\""),
  'intake timeout recovery message should be visible, not rendered inside a hidden error panel.'
);
assert.ok(intake.includes('isFailed || isInterrupted || isTimedOut || isPartial'));

console.log('cloud timeout UI tests passed');
