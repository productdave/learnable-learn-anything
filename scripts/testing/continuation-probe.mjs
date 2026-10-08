// Temporary diagnostic only. Not imported by the app or any release builder.
// The real sweep, continuation CAS, request budget and waitUntil are injected
// from a verified release. Only the lesson runner is synthetic. No AI is called.
import { randomUUID } from 'node:crypto';

export const PROBE_PROJECT = 'prj_nphig6i4hA9E8o9Wg3nhzxyP1krB';
export const PROBE_DATABASE = 'https://dmnwkrybgggbpqpetuub.supabase.co';
export const PROBE_CASES = ['chain', 'delivery_unavailable', 'lost_ack', 'stall', 'hop_limit', 'review', 'cancelled'];
export const PROBE_CLOSED_FLAGS = ['LEARNABLE_SETUP_GENERATION', 'LEARNABLE_CREATION_IMAGES',
  'LEARNABLE_SELF_PUBLISH', 'LEARNABLE_PUBLIC_IMAGES', 'LEARNABLE_MODERATION',
  'LEARNABLE_GPT_IMAGES', 'LEARNABLE_IMAGE_REQUESTS', 'LEARNABLE_STAGING_IMAGE_SPEND'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const fail = () => { throw Error('Diagnostic scope refused'); };

export function validateProbe(manifest, env, now = Date.now()) {
  if (manifest?.version !== 1 || !UUID.test(manifest.id) || !UUID.test(manifest.ownerId)
    || !Number.isFinite(manifest.createdAt) || !Number.isFinite(manifest.expiresAt)
    || manifest.createdAt > now || manifest.expiresAt <= now
    || manifest.expiresAt - manifest.createdAt > 3_600_000
    || manifest.expiresAt <= manifest.createdAt) fail();
  if (!Array.isArray(manifest.jobs) || manifest.jobs.length !== PROBE_CASES.length
    || new Set(manifest.jobs.map(j => j.scenario)).size !== PROBE_CASES.length) fail();
  for (const job of manifest.jobs) {
    if (!PROBE_CASES.includes(job.scenario) || job.id !== `continuation-probe-${manifest.id}-${job.scenario}`
      || !UUID.test(job.initialRunId)) fail();
  }
  if (env.VERCEL_ENV !== 'preview' || env.VERCEL_PROJECT_ID !== PROBE_PROJECT
    || env.SUPABASE_URL !== PROBE_DATABASE
    || !/^learnable-staging-[a-z0-9-]+\.vercel\.app$/.test(env.VERCEL_URL || '')
    || !env.VERCEL_AUTOMATION_BYPASS_SECRET
    || !(env.GEN_SWEEP_SECRET || env.CRON_SECRET || env.GEN_WATCHDOG_SECRET)
    || PROBE_CLOSED_FLAGS.some(name => env[name] !== '0')
    || ![undefined, '0'].includes(env.LEARNABLE_AI_REFINEMENT)) fail();
  const origin = `https://${env.VERCEL_URL}`;
  if (![undefined, '0', '1'].includes(env.LEARNABLE_GENERATION_CONTINUATION)
    || (env.LEARNABLE_GENERATION_CONTINUATION === '1' && env.LEARNABLE_GENERATION_ORIGIN !== origin)) fail();
  return { origin, secret: env.GEN_SWEEP_SECRET || env.CRON_SECRET || env.GEN_WATCHDOG_SECRET };
}

export function scopedProbeBody(manifest, body) {
  return body && Object.keys(body).length === 3 && body.ownerId === manifest.ownerId
    && UUID.test(body.runId) && manifest.jobs.some(job => job.id === body.jobId);
}

// Supabase service-role requests are restricted at the network boundary too.
// No table-wide reads/writes, RPC, storage, real-owner credentials or redirects.
export function createProbeFetch({ manifest, env, nativeFetch, now = Date.now }) {
  return async (input, options = {}) => {
    const { origin, secret } = validateProbe(manifest, env, now());
    // Our verified clients use URL/string + init, never opaque Request bodies.
    if (typeof input !== 'string' && !(input instanceof URL)) fail();
    const url = new URL(input), method = (options.method || 'GET').toUpperCase();
    if (url.username || url.password || url.hash || url.port) fail();
    const headers = new Headers(options.headers);
    const one = (name, expected) => url.searchParams.getAll(name).length === 1
      && url.searchParams.get(name) === expected;
    if (url.origin === origin) {
      let body;
      try { body = JSON.parse(options.body); } catch { fail(); }
      if (method !== 'POST' || url.pathname !== '/api/gen/sweep' || url.search
        || !scopedProbeBody(manifest, body) || headers.get('authorization') !== `Bearer ${secret}`
        || headers.get('x-learnable-continuation') !== '1') fail();
      headers.set('x-vercel-protection-bypass', env.VERCEL_AUTOMATION_BYPASS_SECRET);
    } else if (url.origin === PROBE_DATABASE) {
      if (headers.has('x-vercel-protection-bypass')) fail();
      // PostgREST logical filters could widen an otherwise valid equality.
      if ([...url.searchParams.keys()].some(key => /(^|\.)(or|and|not)$/.test(key))) fail();
      const jobId = (url.searchParams.get('id') || '').replace(/^eq\./, '');
      const job = manifest.jobs.some(j => j.id === jobId) && one('id', `eq.${jobId}`)
        && one('owner_id', `eq.${manifest.ownerId}`);
      const jobs = url.pathname === '/rest/v1/generation_jobs' && job && ['GET', 'PATCH'].includes(method);
      if (jobs && method === 'PATCH') {
        const run = (url.searchParams.get('run_id') || '').replace(/^eq\./, '');
        const status = (url.searchParams.get('status') || '').replace(/^eq\./, '');
        if (!UUID.test(run) || !one('run_id', `eq.${run}`) || !['running', 'queued'].includes(status)
          || !one('status', `eq.${status}`)) fail();
        let fields;
        try { fields = JSON.parse(options.body); } catch { fail(); }
        const allowed = ['outline', 'topics_by_key', 'topics_done', 'status', 'completed_at', 'message',
          'heartbeat_at', 'lease_expires_at', 'updated_at', 'run_id', 'continuation', 'error'];
        if (!fields || Array.isArray(fields) || Object.keys(fields).some(key => !allowed.includes(key))) fail();
      }
      const state = method === 'GET' && url.pathname === '/rest/v1/user_state' && one('user_id', `eq.${manifest.ownerId}`);
      const vault = method === 'GET' && url.pathname === '/rest/v1/provider_connections'
        && one('owner_id', `eq.${manifest.ownerId}`) && one('provider', 'eq.anthropic');
      const email = method === 'GET' && url.pathname === `/auth/v1/admin/users/${manifest.ownerId}` && !url.search;
      if (!jobs && !state && !vault && !email) fail();
    } else fail();
    const deadline = AbortSignal.timeout(Math.max(1, Math.min(15_000, manifest.expiresAt - now())));
    const signal = options.signal ? AbortSignal.any([options.signal, deadline]) : deadline;
    return nativeFetch(input, { ...options, signal, headers, redirect: 'error' });
  };
}

export function activateProbe({ manifest, env, nativeFetch, now = Date.now }) {
  const { origin } = validateProbe(manifest, env, now());
  // Only this single-purpose preview process is enabled, never project settings.
  env.LEARNABLE_GENERATION_CONTINUATION = '1';
  env.LEARNABLE_GENERATION_ORIGIN = origin;
  return createProbeFetch({ manifest, env, nativeFetch, now });
}

export function createProbeHandler({ manifest, env, now = Date.now, client,
  createSweepHandler, createBudget, bindClient, pauseForContinuation,
  continuationAuthorized, boundedJson, background, leaseFields,
  fetchImpl, delay = ms => new Promise(resolve => setTimeout(resolve, ms)),
  log = value => console.info(JSON.stringify(value)) }) {
  const scoped = (body, db = client) => db.from('generation_jobs').select('*')
    .eq('id', body.jobId).eq('owner_id', manifest.ownerId).eq('run_id', body.runId).maybeSingle();
  const update = (db, row, fields) => db.from('generation_jobs').update(fields)
    .eq('id', row.id).eq('owner_id', manifest.ownerId).eq('run_id', row.run_id).eq('status', row.status)
    .select('id').maybeSingle();
  const run = async ({ supabase, jobId, ownerId, runId, requestBudget }) => {
    validateProbe(manifest, env, now());
    if (!scopedProbeBody(manifest, { jobId, ownerId, runId })) fail();
    // Makes background persistence observable after the initiating HTTP response.
    await delay(1_000);
    validateProbe(manifest, env, now());
    const db = bindClient(supabase, requestBudget);
    const { data: row, error } = await scoped({ jobId, runId }, db);
    if (error) throw error;
    if (!row || row.status !== 'running') return;
    const scenario = manifest.jobs.find(j => j.id === jobId).scenario;
    const previous = row.outline?.probeRuns || [];
    if (previous.some(event => event.runId === runId) || previous.length >= 4) fail();
    const runs = [...previous, { runId, at: new Date(now()).toISOString(), deployment: env.VERCEL_DEPLOYMENT_ID || null }];
    const topics = { ...(row.topics_by_key || {}) };
    if (scenario !== 'stall') topics[`synthetic/${Object.keys(topics).length + 1}`] = { diagnostic: true, runId };
    const done = Object.keys(topics).length;
    const finished = ['chain', 'lost_ack'].includes(scenario) && done === 3;
    const saved = await update(db, row, { outline: { diagnostic: true, probeRuns: runs }, topics_by_key: topics,
      topics_done: done, status: finished ? 'review_research' : 'running', completed_at: null,
      message: finished ? 'Diagnostic complete; not a real course.' : 'Synthetic diagnostic checkpoint.', ...leaseFields() });
    if (saved.error) throw saved.error;
    if (!saved.data || finished) return;
    await pauseForContinuation({ supabase: db, jobId, ownerId, runId, requestBudget, fetchImpl: async (...args) => {
      const response = await fetchImpl(...args);
      log({ diagnostic: manifest.id, jobId, runId, deliveryStatus: response.status });
      return response;
    } });
  };
  const sweep = createSweepHandler({ runGeneration: run, admin: () => client, background, createBudget });
  return async (req, res) => {
    let runtime;
    try { runtime = validateProbe(manifest, env, now()); }
    catch { return res.status(503).json({ error: 'Diagnostic unavailable.' }); }
    if (req.method !== 'POST') return res.status(405).json({ error: 'POST only.' });
    // Incoming Host/forwarded headers never influence the self-request target.
    const path = String(req.url || '').split('?')[0];
    if (!['/api/diagnostic/start', '/api/gen/sweep'].includes(path)) return res.status(404).json({ error: 'Not found.' });
    if (!continuationAuthorized(req, { secret: runtime.secret })) return res.status(401).json({ error: 'Unauthorized.' });
    if (path === '/api/gen/sweep' && req.headers?.['x-learnable-continuation'] !== '1') return res.status(400).json({ error: 'Targeted requests only.' });
    const budget = createBudget({ request: req });
    let body;
    try { body = await budget.runOperation(() => boundedJson(req, 1024), { timeoutMs: 5_000 }); }
    catch { return res.status(400).json({ error: 'Invalid request.' }); }
    if (!scopedProbeBody(manifest, body)) return res.status(404).json({ error: 'Fixture not found.' });
    const fixture = manifest.jobs.find(job => job.id === body.jobId);
    req.body = body;
    if (path === '/api/gen/sweep') {
      if (fixture.scenario === 'delivery_unavailable') return res.status(503).json({ error: 'Synthetic delivery failure.' });
      if (fixture.scenario !== 'lost_ack') return sweep(req, res);
      let code = 200;
      return sweep(req, { status(value) { code = value; return this; }, json(value) {
        const lost = code === 200 && value.accepted === true;
        return res.status(lost ? 503 : code).json(lost ? { error: 'Synthetic lost acknowledgement.' } : value);
      } });
    }
    if (body.runId !== fixture.initialRunId) return res.status(409).json({ error: 'Already started.' });
    const { data: row, error } = await scoped(body, bindClient(client, budget));
    if (error) return res.status(503).json({ error: 'Fixture read unconfirmed.' });
    if (!row || row.status !== 'queued' || row.outline?.probeRuns?.length) return res.status(409).json({ error: 'Already started or paused.' });
    const runId = randomUUID();
    const claimed = await update(bindClient(client, budget), row, { status: 'running', run_id: runId,
      ...(row.continuation ? { continuation: { ...row.continuation, runId } } : {}), ...leaseFields() });
    if (claimed.error) return res.status(503).json({ error: 'Fixture claim unconfirmed.' });
    if (!claimed.data) return res.status(409).json({ error: 'Already started.' });
    background(run({ supabase: client, jobId: body.jobId, ownerId: body.ownerId, runId, requestBudget: budget.fork() }));
    return res.status(202).json({ ok: true, accepted: true });
  };
}
