// Non-production workspace server. Never falls back to the app's live config.
import http from 'node:http';
import { readFile, realpath, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseEnv } from 'node:util';
import { createClient } from '@supabase/supabase-js';

const root = fileURLToPath(new URL('../', import.meta.url));
const webRoot = path.join(root, 'web');
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8', '.pdf': 'application/pdf', '.mp3': 'audio/mpeg', '.mp4': 'video/mp4' };

// Explicit allowlist: generation needs its authenticated read-after-save route.
// Self-publishing has a separate local-only boundary; raw API sources/cron stay off.
export const previewGenerationRoutes = ['providers/connection', 'providers/openai', 'setups/generate', 'gen/sources', 'gen/review', 'gen/resume', 'gen/cancel', 'gen/watchdog', 'gen/restart', 'gen/delete', 'gen/credentials-ready', 'courses/get', 'courses/refine', 'courses/proposal', 'courses/images', 'courses/public-preview'];

function jwtRole(key) {
  try { return JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString()).role; }
  catch { return ''; }
}

export function validatePreviewConfig(values, liveURL) {
  const mode = values.LEARNABLE_PREVIEW_ENV;
  if (!['local', 'staging'].includes(mode)) throw new Error('Set LEARNABLE_PREVIEW_ENV to local or staging. Production is not supported.');
  let url;
  try { url = new URL(values.SUPABASE_URL); }
  catch { throw new Error('Set SUPABASE_URL in the dedicated preview environment file.'); }
  if (url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error('SUPABASE_URL must be a bare project origin without credentials or a path.');
  if (url.origin === new URL(liveURL).origin) throw new Error('Refusing the app’s existing live Supabase project. Use an isolated local or staging project.');
  if (mode === 'local' && (url.hostname !== '127.0.0.1' || url.protocol !== 'http:')) throw new Error('Local mode requires an explicit http://127.0.0.1 port for local Supabase.');
  if (mode === 'staging' && (url.protocol !== 'https:' || url.port || !/^[a-z0-9]+\.supabase\.co$/.test(url.hostname))) throw new Error('Staging mode requires a separate hosted https Supabase project.');
  const publicKey = values.SUPABASE_ANON_KEY || '';
  const secretKey = values.SUPABASE_SECRET_KEY || values.SUPABASE_SERVICE_ROLE_KEY || '';
  if (!(publicKey.startsWith('sb_publishable_') || jwtRole(publicKey) === 'anon')) throw new Error('SUPABASE_ANON_KEY must be a publishable/anon key, never a secret or service-role key.');
  if (!(secretKey.startsWith('sb_secret_') || jwtRole(secretKey) === 'service_role')) throw new Error('Supply the test project’s secret/service-role key in the preview environment file.');
  if (secretKey === publicKey) throw new Error('Public and server keys must be different.');
  const vaultKey = values.LEARNABLE_PROVIDER_VAULT_KEY || '';
  if (vaultKey && !/^[0-9a-f]{64}$/i.test(vaultKey)) throw new Error('The provider vault key must contain 64 hexadecimal characters.');
  const generation = values.LEARNABLE_SETUP_GENERATION === '1';
  if (generation && !vaultKey) throw new Error('Set a server-only provider vault key before enabling generation.');
  const aiRefinement = values.LEARNABLE_AI_REFINEMENT === '1';
  if (aiRefinement && !generation) throw new Error('Enable setup generation before enabling AI refinement.');
  const images = values.LEARNABLE_GPT_IMAGES === '1' && values.LEARNABLE_IMAGE_REQUESTS === '1';
  if (images && !generation) throw new Error('Enable setup generation before enabling course images.');
  const creationImages = values.LEARNABLE_CREATION_IMAGES === '1';
  if(creationImages&&!images)throw new Error('Enable course images before enabling initial-creation image choices.');
  return { mode, url: url.origin, publicKey, secretKey, vaultKey, generation, aiRefinement, images, creationImages };
}

export async function loadPreviewConfig(filename) {
  let raw;
  try { raw = await readFile(filename, 'utf8'); }
  catch { throw new Error('Preview configuration is missing. Create .env.preview.local using .env.preview.example; do not use the live project.'); }
  const liveConfig = await readFile(path.join(webRoot, 'js/config.js'), 'utf8');
  const liveURL = liveConfig.match(/export const SUPABASE_URL\s*=\s*['"]([^'"]+)['"]/)?.[1];
  if (!liveURL) throw new Error('Cannot identify the app’s live project; refusing to start without the production guard.');
  return validatePreviewConfig(parseEnv(raw), liveURL);
}

// Read-only readiness check. It is not a substitute for real auth/RLS/save QA.
export async function checkSetupBackend(config, makeClient = createClient) {
  const client = makeClient(config.url, config.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: (url, options) => fetch(url, { ...options, signal: AbortSignal.timeout(10000) }) }
  });
  const [table, bucket] = await Promise.all([
    client.from('course_setups').select('owner_id,id,revision,payload,content_hash,updated_at,deleted').limit(0),
    client.storage.getBucket('setup-sources')
  ]);
  const mimeTypes = bucket.data?.allowed_mime_types || [];
  const checks = {
    setupTable: !table.error,
    privateSourceBucket: !bucket.error && bucket.data?.public === false,
    sourceLimits: Number(bucket.data?.file_size_limit) === 10485760 && ['application/pdf', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'text/plain'].every(type => mimeTypes.includes(type)) && mimeTypes.length === 3
  };
  return { ok: Object.values(checks).every(Boolean), checks };
}

function json(res, code, body) {
  if (res.writableEnded) return;
  res.writeHead(code, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  res.end(JSON.stringify(body));
}

export function createPreviewServer({ config, setupHandler, extraHandlers = {}, directory = webRoot }) {
  const serveConfig = (req, res) => {
    const content = `// ${config.mode} preview only; live config file is unchanged.\nexport const SUPABASE_URL = ${JSON.stringify(config.url)};\nexport const SUPABASE_ANON_KEY = ${JSON.stringify(config.publicKey)};\nexport const CREATION_IMAGES_ENABLED = ${!!(config.creationImages && config.images && config.generation)};\nexport const SELF_PUBLISH_ENABLED = ${!!config.publishing};\nexport const MODERATION_ENABLED = ${!!config.moderation};\n`;
    res.writeHead(200, { 'Content-Type': types['.js'] });
    res.end(req.method === 'HEAD' ? '' : content);
  };
  return http.createServer(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    const host = req.headers.host || '';
    const port = req.socket.localPort;
    if (![`127.0.0.1:${port}`, `localhost:${port}`].includes(host)) return json(res, 403, { code: 'host', error: 'This preview only accepts local browser requests.' });
    if ((req.headers.origin && req.headers.origin !== `http://${host}`) || req.headers['sec-fetch-site'] === 'cross-site') return json(res, 403, { code: 'origin', error: 'Cross-site preview requests are not allowed.' });
    let pathname;
    try { pathname = decodeURIComponent(new URL(req.url, `http://${host}`).pathname); }
    catch { return json(res, 400, { code: 'path', error: 'Invalid path.' }); }
    if (pathname.includes('\\') || pathname.includes('\0') || pathname.split('/').some(part => part.startsWith('.'))) return json(res, 404, { code: 'missing' });
    pathname = path.posix.normalize(pathname);
    const handler = pathname === '/api/setups/store' ? setupHandler : Object.hasOwn(extraHandlers, pathname) ? extraHandlers[pathname] : null;
    if (handler) {
      res.status = code => { res.statusCode = code; return res; };
      res.json = body => { res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(body)); return res; };
      try { await handler(req, res); }
      catch { json(res, 503, { code: 'unavailable', error: 'The test setup service is unavailable. Your device copy is unchanged.' }); }
      return;
    }
    // Only explicitly registered routes run. Publishing/cron remain disabled.
    if (pathname.startsWith('/api/')) return json(res, 503, { code: 'preview-disabled', error: 'This endpoint is not enabled in the local preview server.' });
    if (!['GET', 'HEAD'].includes(req.method)) return json(res, 405, { code: 'method' });
    if (pathname === '/js/config.js') {
      serveConfig(req, res);
      return;
    }
    try {
      const file = path.resolve(directory, `.${pathname === '/' ? '/index.html' : pathname}`);
      const [resolvedRoot, resolved] = await Promise.all([realpath(directory), realpath(file)]);
      if (!resolved.startsWith(`${resolvedRoot}${path.sep}`) || resolved.startsWith(path.join(resolvedRoot, 'api') + path.sep) || /^(package(?:-lock)?|vercel)\.json$/.test(path.basename(resolved))) return json(res, 404, { code: 'missing' });
      if (resolved === path.join(resolvedRoot, 'js/config.js')) return serveConfig(req, res);
      if (!types[path.extname(resolved)] || !(await stat(resolved)).isFile()) return json(res, 404, { code: 'missing' });
      const bytes = await readFile(resolved);
      res.writeHead(200, { 'Content-Type': types[path.extname(resolved)], 'Content-Length': bytes.length });
      res.end(req.method === 'HEAD' ? '' : bytes);
    } catch { json(res, 404, { code: 'missing' }); }
  });
}

async function main() {
  if (process.argv.includes('--help')) {
    console.log('npm run dev:setup -- [--config .env.preview.local] [--port 4173]\nRuns the workspace against isolated local/staging Supabase. Generation routes require LEARNABLE_SETUP_GENERATION=1 and a server-only vault key in the dedicated config. Never migrates a database.');
    return;
  }
  const args = process.argv.slice(2), options = {};
  for (let index = 0; index < args.length; index += 2) {
    if (!['--config', '--port'].includes(args[index]) || !args[index + 1]) throw new Error('Use --config and/or --port. See --help.');
    options[args[index]] = args[index + 1];
  }
  const port = Number(options['--port'] || 4173);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Use an unprivileged port between 1024 and 65535.');
  const config = await loadPreviewConfig(path.resolve(root, options['--config'] || '.env.preview.local'));
  let readiness;
  try { readiness = await checkSetupBackend(config); }
  catch { throw new Error('Cannot reach the test Supabase service. Start it and verify the dedicated preview configuration.'); }
  if (!readiness.ok) throw new Error(`Test setup schema/storage is not ready (${Object.entries(readiness.checks).filter(([, ok]) => !ok).map(([key]) => key).join(', ')}). Apply db/06-course-setups.sql only to the selected test project.`);
  // Only the dedicated file is allowed to select this server's backend.
  process.env.SUPABASE_URL = config.url;
  process.env.SUPABASE_ANON_KEY = config.publicKey;
  process.env.SUPABASE_SECRET_KEY = config.secretKey;
  process.env.LEARNABLE_PROVIDER_VAULT_KEY = config.vaultKey;
  process.env.LEARNABLE_SETUP_GENERATION = config.generation ? '1' : '0';
  process.env.LEARNABLE_AI_REFINEMENT = config.aiRefinement ? '1' : '0';
  process.env.LEARNABLE_GPT_IMAGES = config.images ? '1' : '0';
  process.env.LEARNABLE_IMAGE_REQUESTS = config.images ? '1' : '0';
  process.env.LEARNABLE_CREATION_IMAGES = config.creationImages ? '1' : '0';
  process.env.LEARNABLE_IMAGE_FUNDING = 'creator';
  // Only the isolated Docker preview is enabled. No hosted flag is inferred.
  config.publishing = config.mode === 'local' && config.generation;
  process.env.LEARNABLE_SELF_PUBLISH = config.publishing ? '1' : '0';
  config.moderation=config.publishing;
  process.env.LEARNABLE_MODERATION=config.moderation?'1':'0';
  process.env.LEARNABLE_PUBLIC_IMAGES = config.publishing && config.images ? '1' : '0';
  const { default: setupHandler } = await import('../web/api/setups/store.js');
  const extraHandlers = {};
  if (config.generation) {
    const { serviceClient } = await import('../web/api/_lib/supabase-server.mjs');
    const table = await serviceClient().from('provider_connections').select('owner_id,provider,encrypted_key').limit(0);
    if (table.error) throw new Error('Provider storage is not ready. Apply db/07-provider-connections.sql to the selected test project.');
    if (config.images) {
      const images = await serviceClient().from('course_image_requests').select('accepted').limit(0);
      if (images.error) throw new Error('Image storage is not ready. Apply forward migrations through db/10-accept-course-image.sql to the selected test project.');
    }
    const { checkSchema } = await import('../web/api/health/cloud.js');
    const { publicAiModelRegistry } = await import('../web/api/_lib/ai-models.mjs');
    extraHandlers['/api/health/cloud'] = async (req, res) => {
      if (req.method !== 'GET') return res.status(405).json({ error: 'GET only.' });
      const schema = await checkSchema();
      return res.status(schema.ok ? 200 : 503).json({ ok: schema.ok, schema, missing: schema.missing, ai: publicAiModelRegistry(), local: true });
    };
    for (const route of previewGenerationRoutes) {
      extraHandlers[`/api/${route}`] = (await import(`../web/api/${route}.js`)).default;
    }
    if(config.publishing){
      const publications=await serviceClient().from('course_publications').select('id,moderation_removed').limit(0);
      if(publications.error)throw new Error('Apply forward migrations through db/16-moderation-audit-grants.sql to the isolated local database before enabling publication/report review.');
      if(process.env.LEARNABLE_PUBLIC_IMAGES==='1'){
        const bucket=await serviceClient().storage.getBucket('publication-images');
        if(bucket.error||bucket.data?.public!==false)throw new Error('Apply db/13-publication-images.sql to the isolated local database before sharing images. The bucket must remain private.');
      }
      for(const route of ['courses/publish','courses/community','courses/public-image','courses/publication-status','courses/moderation'])extraHandlers[`/api/${route}`]=(await import(`../web/api/${route}.js`)).default;
    }
  }
  const server = createPreviewServer({ config, setupHandler, extraHandlers });
  server.requestTimeout = 30000;
  server.on('error', error => { console.error(error.code === 'EADDRINUSE' ? 'Preview port is already occupied. Choose --port; no existing process was stopped.' : 'Preview server failed.'); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => {
    console.log(`${config.mode} test workspace: http://127.0.0.1:${port}/?experience=workspace`);
    console.log(`Separate test accounts only. Existing live accounts/courses are not connected. ${config.generation ? 'Generation is available only after connecting your Claude key and confirming Create course plan. Provider charges apply. Keep this server running during generation.' : 'AI generation is disabled.'} ${config.publishing?'Self-service publication is enabled only in this local test workspace.':'Publishing is disabled.'} Cron tasks are disabled.`);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
