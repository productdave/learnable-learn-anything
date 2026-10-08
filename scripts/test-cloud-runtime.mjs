import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_ANON_KEY ||= 'test-anon-key';

await import('@supabase/supabase-js');
await import('@vercel/functions');

const modules = [
  '../web/api/health/cloud.js',
  '../web/api/courses/get.js',
  '../web/api/gen/start.js',
  '../web/api/gen/resume.js',
  '../web/api/gen/restart.js',
  '../web/api/gen/review.js',
  '../web/api/gen/credentials-ready.js',
  '../web/api/gen/cancel.js',
  '../web/api/gen/delete.js',
  '../web/api/gen/watchdog.js',
  '../web/api/gen/sweep.js'
];

for (const specifier of modules) {
  const mod = await import(specifier);
  assert.equal(typeof mod.default, 'function', `${specifier} should export a default handler`);
}

console.log('cloud runtime import tests passed');
