import assert from 'node:assert/strict';
import http from 'node:http';
import { once } from 'node:events';
import { readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { validatePreviewConfig, loadPreviewConfig, checkSetupBackend, createPreviewServer, previewGenerationRoutes } from './dev-setup-server.mjs';

let checks = 0;
const check = (condition, message) => { assert.ok(condition, message); checks++; };
const live = 'https://live-example.supabase.co';
const values = { LEARNABLE_PREVIEW_ENV: 'local', SUPABASE_URL: 'http://127.0.0.1:54321', SUPABASE_ANON_KEY: 'sb_publishable_test', SUPABASE_SECRET_KEY: 'sb_secret_test' };
const config = validatePreviewConfig(values, live);
check(config.mode === 'local' && config.url === values.SUPABASE_URL, 'explicit loopback configuration accepted');
check(config.aiRefinement === false, 'AI refinement defaults off');
check(config.creationImages === false, 'initial image selection defaults off');
const reject = (changed, reason) => { assert.throws(() => validatePreviewConfig({ ...values, ...changed }, live), reason); checks++; };
reject({ LEARNABLE_AI_REFINEMENT: '1' }, /Enable setup generation/);
reject({ LEARNABLE_CREATION_IMAGES: '1' }, /Enable course images/);
check(validatePreviewConfig({...values,LEARNABLE_SETUP_GENERATION:'1',LEARNABLE_PROVIDER_VAULT_KEY:'a'.repeat(64),LEARNABLE_GPT_IMAGES:'1',LEARNABLE_IMAGE_REQUESTS:'1',LEARNABLE_CREATION_IMAGES:'1'},live).creationImages,'creation image flag requires supported dependencies');
reject({ LEARNABLE_AI_REFINEMENT: '1', LEARNABLE_SETUP_GENERATION: '1' }, /vault key/);
check(validatePreviewConfig({ ...values, LEARNABLE_AI_REFINEMENT: '1', LEARNABLE_SETUP_GENERATION: '1', LEARNABLE_PROVIDER_VAULT_KEY: 'a'.repeat(64) }, live).aiRefinement, 'AI refinement requires explicit generation and protected credential configuration');
reject({ LEARNABLE_PREVIEW_ENV: 'production' }, /Production/);
reject({ LEARNABLE_PREVIEW_ENV: '' }, /local or staging/);
reject({ SUPABASE_URL: 'http://192.168.1.1:54321' }, /127.0.0.1/);
reject({ LEARNABLE_PREVIEW_ENV: 'staging', SUPABASE_URL: live }, /existing live/);
reject({ LEARNABLE_PREVIEW_ENV: 'staging', SUPABASE_URL: 'http://staging-example.supabase.co' }, /https/);
reject({ LEARNABLE_PREVIEW_ENV: 'staging', SUPABASE_URL: 'https://example.com' }, /separate hosted/);
reject({ SUPABASE_URL: 'http://user:secret@127.0.0.1:54321' }, /credentials/);
reject({ SUPABASE_URL: 'http://127.0.0.1:54321/rest/v1' }, /bare project origin/);
reject({ SUPABASE_ANON_KEY: 'sb_secret_accident' }, /never a secret/);
reject({ SUPABASE_SECRET_KEY: '' }, /secret\/service-role/);
const jwt = role => `test.${Buffer.from(JSON.stringify({ role })).toString('base64url')}.test`;
reject({ SUPABASE_ANON_KEY: jwt('service_role') }, /never a secret/);
check(validatePreviewConfig({ ...values, SUPABASE_ANON_KEY: jwt('anon'), SUPABASE_SECRET_KEY: jwt('service_role') }, live).publicKey === jwt('anon'), 'local legacy anon/service-role keys accepted');
check(validatePreviewConfig({ ...values, LEARNABLE_PREVIEW_ENV: 'staging', SUPABASE_URL: 'https://separateexample.supabase.co' }, live).mode === 'staging', 'separate explicitly selected hosted staging accepted');
await assert.rejects(loadPreviewConfig('/nonexistent-learnable-test-preview.env'), /configuration is missing/); checks++;
const missingConfig = spawnSync(process.execPath, ['scripts/dev-setup-server.mjs', '--config', '/nonexistent-learnable-test-preview.env'], { encoding: 'utf8', env: { ...process.env, SUPABASE_URL: live, SUPABASE_ANON_KEY: 'sb_publishable_live', SUPABASE_SECRET_KEY: 'sb_secret_live' } });
check(missingConfig.status === 1 && missingConfig.stderr.includes('configuration is missing'), 'startup refuses inherited credentials instead of falling back');
check(!missingConfig.stderr.includes('sb_secret_live'), 'startup diagnostics do not print inherited keys');
const badPort = spawnSync(process.execPath, ['scripts/dev-setup-server.mjs', '--port', '80'], { encoding: 'utf8' });
check(badPort.status === 1 && badPort.stderr.includes('unprivileged'), 'unsafe port refused before connecting');

let tableError = null;
const bucket = { public: false, file_size_limit: 10485760, allowed_mime_types: ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'] };
const calls = [];
const factory = () => ({
  from(name) { calls.push(name); return { select(columns) { calls.push(columns); return { async limit(count) { calls.push(count); return { error: tableError }; } }; } }; },
  storage: { async getBucket(name) { calls.push(name); return { data: bucket }; } }
});
check((await checkSetupBackend(config, factory)).ok, 'readiness fixture accepts schema and private bounded bucket');
check(calls.includes(0) && !calls.includes('rpc'), 'readiness fetches no private records and performs no RPC/write');
tableError = { message: 'missing table' };
check(!(await checkSetupBackend(config, factory)).ok, 'readiness refuses missing migration');
tableError = null; bucket.public = true;
check(!(await checkSetupBackend(config, factory)).checks.privateSourceBucket, 'readiness refuses public source bucket');
bucket.public = false; bucket.file_size_limit = null;
check(!(await checkSetupBackend(config, factory)).checks.sourceLimits, 'readiness refuses unbounded files');
bucket.file_size_limit = 10485760; bucket.allowed_mime_types.push('*/*');
check(!(await checkSetupBackend(config, factory)).checks.sourceLimits, 'readiness refuses overbroad MIME types');

// A real Node HTTP server and the actual setup route, without an external backend.
// Unauthenticated requests must reach the route and return JSON 401, not static 404.
process.env.SUPABASE_URL = config.url;
process.env.SUPABASE_ANON_KEY = config.publicKey;
process.env.SUPABASE_SECRET_KEY = config.secretKey;
const { default: setupHandler } = await import('../web/api/setups/store.js');
const before = await readFile('web/js/config.js', 'utf8');
const server = createPreviewServer({ config, setupHandler });
server.listen(0, '127.0.0.1'); await once(server, 'listening');
const base = `http://127.0.0.1:${server.address().port}`;
try {
  for (const method of ['GET', 'POST', 'DELETE']) {
    const response = await fetch(`${base}/api/setups/store`, { method });
    check(response.status === 401 && (await response.json()).code === 'auth', `${method} executes actual setup handler, no static 404`);
    check(response.headers.get('cache-control') === 'no-store', `${method} authenticated response is never cached`);
  }
  const unsupported = await fetch(`${base}/api/setups/store`, { method: 'PUT' });
  check(unsupported.status === 405, 'route refuses unsupported method');
  for (const file of ['/js/config.js', '/js/config.js?v=old', '/js//config.js', '/js%2fconfig.js']) {
    const response = await fetch(`${base}${file}`); const content = await response.text();
    check(response.status === 200 && content.includes(config.url) && !content.includes(config.secretKey) && !content.includes('olzardlkaxgjqvwnjzil'), `public configuration isolated at ${file}`);
  }
  for (const file of ['/api/gen/start', '/api/gen/sweep', '/api/courses/get', '/api/setups/store.js', '/api/_lib/supabase-server.mjs']) {
    const response = await fetch(`${base}${file}`);
    check(response.status === 503 && (await response.json()).code === 'preview-disabled', `unapproved endpoint/source blocked: ${file}`);
  }
  for (const file of ['/.env', '/package.json', '/vercel.json', '/js/%2e%2e/%2e%2e/.env', '/missing.html']) {
    const response = await fetch(`${base}${file}`);
    check(response.status === 404 && !(await response.text()).includes(config.secretKey), `private/missing file blocked: ${file}`);
  }
  const crossSite = await fetch(`${base}/api/setups/store`, { method: 'POST', headers: { Origin: 'https://untrusted.example' } });
  check(crossSite.status === 403 && (await crossSite.json()).code === 'origin', 'cross-origin API request blocked before authentication');
  const rebind = await new Promise((resolve, reject) => {
    const request = http.get(`${base}/api/setups/store`, { headers: { Host: `attacker.example:${server.address().port}` } }, response => { response.resume(); resolve(response.statusCode); }); request.on('error', reject);
  });
  check(rebind === 403, 'DNS rebinding host refused');
  const home = await fetch(`${base}/?experience=workspace`);
  check(home.status === 200 && (await home.text()).includes('app.js'), 'real frontend still served');
  const module = await fetch(`${base}/js/setup-account-client.js`);
  check(module.status === 200 && module.headers.get('content-type').includes('javascript'), 'browser modules get correct MIME type');
  const head = await fetch(`${base}/index.html`, { method: 'HEAD' });
  check(head.status === 200 && (await head.text()) === '', 'HEAD returns metadata without body');
  check((await readFile('web/js/config.js', 'utf8')) === before, 'live configuration file unchanged');
} finally { await new Promise(resolve => server.close(resolve)); }
check(previewGenerationRoutes.includes('courses/get'), 'generation allowlist includes the authenticated saved-course handoff');
check(previewGenerationRoutes.includes('courses/proposal'), 'AI editor allowlist supports the separately gated authenticated endpoint');
check(!previewGenerationRoutes.some(route => /publish|sweep|_lib/.test(route)), 'generation allowlist excludes publication, cron and raw API sources');
const { default: courseHandler } = await import('../web/api/courses/get.js');
const generationServer = createPreviewServer({ config, setupHandler, extraHandlers: { '/api/courses/get': courseHandler } });
generationServer.listen(0, '127.0.0.1'); await once(generationServer, 'listening');
try {
  const origin = `http://127.0.0.1:${generationServer.address().port}`;
  check((await fetch(`${origin}/api/courses/get?id=qa`)).status === 401, 'enabled course handoff executes real auth guard instead of preview-disabled');
  check((await fetch(`${origin}/api/courses/get?id=qa`, { method: 'POST' })).status === 405, 'read-only handoff rejects mutation');
  check((await fetch(`${origin}/api/gen/sweep`)).status === 503, 'cron remains disabled with saved-course handoff enabled');
} finally { await new Promise(resolve => generationServer.close(resolve)); }
console.log(`Setup test server: ${checks} checks passed. HTTP and actual unauthenticated routes verified; backend readiness uses fixtures. No live Supabase or provider requests.`);
