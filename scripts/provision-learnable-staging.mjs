// Explicitly authorized staging only. Never links the checkout or touches production.
// Secrets are generated output, outside any web/deployment artifact, and never logged.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { randomBytes, createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { verifyCandidate } from './assemble-workspace-candidate.mjs';
import { verifyStagingMigrations } from './packaging/staging-migrations.mjs';
import { createVaultKey, assertVaultKey } from './packaging/staging-vault.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const cli = '/Users/davidwang/.npm/_npx/6f1b058a4d9555af/node_modules/supabase/dist/supabase.js';
const org = 'zdghcycryytrnxopmfpv';
const name = 'Learnable Staging';
const production = 'olzardlkaxgjqvwnjzil';
const directory = join(root, 'output/staging/2026-09-18');
const candidate = join(root, 'output/release-candidates/workspace-20260918-candidate3-2eHUez/web');
const scope = JSON.parse(readFileSync(resolve(candidate, '../scope.json')));
const secretPath = join(directory, 'secrets.json');
const statePath = join(directory, 'state.json');
mkdirSync(directory, { recursive: true, mode: 0o700 });
chmodSync(directory, 0o700);
const state = existsSync(statePath) ? JSON.parse(readFileSync(statePath)) : { name, org, candidate, createdAt: new Date().toISOString() };
const secrets = existsSync(secretPath) ? JSON.parse(readFileSync(secretPath)) : {};
function save() {
  writeFileSync(secretPath, JSON.stringify(secrets), { mode: 0o600 });
  chmodSync(secretPath, 0o600);
  writeFileSync(statePath, JSON.stringify(state, null, 2) + '\n', { mode: 0o600 });
}
function supabase(args) {
  try {
    const output = execFileSync(process.execPath, [cli, ...args, '--output-format', 'json'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 240000, maxBuffer: 8 * 1024 * 1024,
    });
    return JSON.parse(output);
  } catch (err) {
    // Do not serialize child-process errors: they can include command credentials.
    const raw = String(err.stdout || '');
    let diagnostic;
    try { const parsed = JSON.parse(raw); diagnostic = parsed.error?.message || parsed.message; } catch {}
    const redacted = String(diagnostic || 'No safe structured diagnostic').replace(/sb[ps]_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_.-]+/g, '[redacted]');
    throw new Error(`Supabase ${args.slice(0, 2).join(' ')} failed (${err.status ?? 'timeout'}): ${redacted.slice(0, 1000)}`);
  }
}
function projects() { return supabase(['projects', 'list']).projects; }
function target() {
  assert.ok(state.ref && state.ref !== production, 'No pinned staging ref');
  const project = projects().find(item => item.id === state.ref);
  assert.equal(project?.name, name); assert.equal(project.organization_id, org);
  return project;
}
function query(sql) {
  assert.ok(state.ref && state.ref !== production);
  return supabase(['db', 'query', '--linked', '--project-ref', state.ref, sql]);
}
const action = process.argv[2];
if (action === 'create') {
  const existing = projects().filter(project => project.name === name && project.organization_id === org);
  if (existing.length) {
    assert.equal(existing.length, 1);
    assert.equal(existing[0].id, state.ref, 'Untracked staging project exists; inspect before adopting');
    console.log(JSON.stringify({ ref: state.ref, status: existing[0].status, existing: true }));
  } else {
    assert.ok(!state.ref, 'Pinned staging is missing; do not silently create a replacement');
    secrets.databasePassword ||= randomBytes(32).toString('base64url');
    secrets.vaultKey ||= createVaultKey();
    assertVaultKey(secrets.vaultKey);
    secrets.cronSecret ||= randomBytes(32).toString('hex');
    save();
    const result = supabase(['projects', 'create', name, '--org-id', org, '--region', 'us-west-1', '--size', 'micro', '--db-password', secrets.databasePassword]);
    const project = result.project || result;
    state.ref = project.id || project.ref;
    assert.match(state.ref || '', /^[a-z]{20}$/); assert.notEqual(state.ref, production);
    state.supabaseUrl = `https://${state.ref}.supabase.co`; save();
    console.log(JSON.stringify({ ref: state.ref, name, status: project.status, directory }));
  }
} else if (action === 'inventory') {
  const project = target();
  const inventory = query("select current_user, current_setting('server_version') as version, (select rolcreaterole from pg_roles where rolname=current_user) as can_create_role, (select json_agg(tablename) from pg_tables where schemaname='public') as public_tables, to_regclass('supabase_migrations.schema_migrations') as migration_history, (select json_agg(id) from storage.buckets) as buckets");
  writeFileSync(join(directory, 'initial-inventory.json'), JSON.stringify({ project: { ref: project.id, name: project.name, status: project.status }, inventory }, null, 2), { flag: 'wx' });
  console.log(JSON.stringify(inventory));
} else if (action === 'query') {
  target();
  // Deliberately read-only interactive inspection. Forward writes use migrate below.
  const sql = process.argv[3] || '';
  assert.match(sql, /^select\b/i); assert.ok(!/;|\b(insert|update|delete|drop|alter|create|grant|revoke|pg_sleep)\b/i.test(sql));
  console.log(JSON.stringify(query(sql)));
} else if (action === 'migrate') {
  target(); verifyCandidate(candidate, scope);
  const initial = JSON.parse(readFileSync(join(directory, 'initial-inventory.json')));
  assert.equal(initial.project.ref, state.ref);
  assert.equal(process.argv[3], '--confirmed-empty-staging');
  const first = initial.inventory.rows[0];
  assert.equal(first.public_tables, null); assert.equal(first.migration_history, null);
  assert.equal(first.buckets, null); assert.equal(first.can_create_role, true);
  const files = scope.migrations;
  assert.equal(files.length, 19);
  for (const file of files) {
    assert.match(file.path, /^db\/[0-9]{2}-[a-z-]+\.sql$/);
    assert.equal(createHash('sha256').update(readFileSync(join(root, file.path))).digest('hex'), file.sha256);
  }
  const ledger = query("select to_regclass('learnable_staging.applied_migrations') as ledger, (select count(*) from pg_tables where schemaname='public') as tables").rows[0];
  if (!ledger.ledger) {
    assert.equal(Number(ledger.tables), 0, 'Untracked app tables found; refusing migration');
    query('create schema learnable_staging; revoke all on schema learnable_staging from public,anon,authenticated,service_role; create table learnable_staging.applied_migrations (name text primary key, sha256 text not null, applied_at timestamptz not null default now());');
  }
  const applied = query('select name, sha256 from learnable_staging.applied_migrations order by name').rows;
  for (const row of applied) assert.ok(files.some(file => file.path === row.name && file.sha256 === row.sha256) || (state.hostedConflictMigration?.name === row.name && state.hostedConflictMigration.sha256 === row.sha256), 'Unrecognized applied migration');
  for (const file of files) {
    if (applied.some(row => row.name === file.path)) { console.log(`Already applied to staging: ${file.path}`); continue; }
    query(`begin;\n${readFileSync(join(root, file.path), 'utf8')}\ninsert into learnable_staging.applied_migrations(name,sha256) values ('${file.path}','${file.sha256}');\ncommit;`);
    console.log(`Applied to staging ${state.ref}: ${file.path}`);
  }
  query("notify pgrst, 'reload schema';");
  const verified = query('select name, sha256 from learnable_staging.applied_migrations order by name').rows;
  assert.deepEqual(verified.filter(row => row.name !== state.hostedConflictMigration?.name).map(row => ({ path: row.name, sha256: row.sha256 })), files.map(({ path, sha256 }) => ({ path, sha256 })));
  state.migrations = verified; state.migratedAt = new Date().toISOString(); save();
  writeFileSync(join(directory, 'migration-receipt.json'), JSON.stringify({ ref: state.ref, at: state.migratedAt, migrations: verified }, null, 2));
  console.log('All 19 immutable migrations verified on isolated staging. Production was not contacted.');
} else if (action === 'forward-inventory') {
  target(); verifyCandidate(candidate, scope);
  const manifestBytes = readFileSync(join(root, 'docs/upgrade/staging-migrations-2026-09-18.json'));
  const manifest = JSON.parse(manifestBytes);
  const files = verifyStagingMigrations(manifest, new Map(manifest.migrations.map(row => [row.path, readFileSync(join(root,row.path))])), scope);
  const applied = query('select name, sha256 from learnable_staging.applied_migrations order by name').rows;
  for (const row of applied) assert.ok(files.some(file => file.path === row.name && file.sha256 === row.sha256), 'Unrecognized or changed applied migration');
  for (const file of files.slice(0,19)) assert.ok(applied.some(row => row.name === file.path), 'Original staging migrations must already be tracked');
  for (const file of files.slice(19)) {
    if (applied.some(row => row.name === file.path)) continue;
    if (file.path.startsWith('db/21-')) assert.equal(Number(query('select count(*) as rows from public.generation_jobs_legacy_phase22').rows[0].rows),0,'Inspect nonempty hosted history before changing access');
    query(`begin;\n${readFileSync(join(root,file.path),'utf8')}\ninsert into learnable_staging.applied_migrations(name,sha256) values ('${file.path}','${file.sha256}');\ncommit;`);
    console.log(`Applied pinned staging forward migration: ${file.path}`);
  }
  const verified = query('select name, sha256 from learnable_staging.applied_migrations order by name').rows;
  assert.deepEqual(verified.map(row => ({path:row.name,sha256:row.sha256})),files);
  const privileges = query("select (select relrowsecurity from pg_class where oid='public.generation_jobs_legacy_phase22'::regclass) as rls, has_table_privilege('anon','public.generation_jobs_legacy_phase22','select') as anon_read, has_table_privilege('authenticated','public.generation_jobs_legacy_phase22','select') as authenticated_read").rows[0];
  assert.ok(privileges.rls && !privileges.anon_read && !privileges.authenticated_read);
  state.migrations=verified;state.forwardInventory={at:new Date().toISOString(),sha256:createHash('sha256').update(manifestBytes).digest('hex'),privileges};save();
  query("notify pgrst, 'reload schema';");
  const receipt=join(directory,`forward-inventory-${Date.now()}.json`);
  writeFileSync(receipt,JSON.stringify({ref:state.ref,...state.forwardInventory,migrations:verified},null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({stagingRef:state.ref,verifiedMigrations:verified.length,receipt,production:'unchanged'}));
} else if (action === 'keys') {
  target();
  const result = supabase(['projects', 'api-keys', '--project-ref', state.ref, '--reveal']);
  const keys = result.api_keys || result.keys || result;
  assert.ok(Array.isArray(keys));
  const publicKey = keys.find(key => key.type === 'publishable') || keys.find(key => key.name === 'anon');
  const secretKey = keys.find(key => key.type === 'secret') || keys.find(key => key.name === 'service_role');
  assert.ok(publicKey?.api_key && secretKey?.api_key);
  secrets.publicKey = publicKey.api_key; secrets.secretKey = secretKey.api_key; save();
  console.log('Staging-only API keys captured in private local output. Values were not logged.');
} else if (action === 'artifact') {
  target(); verifyCandidate(candidate, scope);
  assert.ok(secrets.publicKey && secrets.secretKey);
  const web = join(directory, 'web');
  assert.ok(!existsSync(web), 'Staging artifact exists; do not overwrite reviewed bytes');
  const changes = [];
  for (const [file, entry] of Object.entries(scope.files)) {
    let bytes = readFileSync(join(candidate, file));
    if (/^js[^/]*\/config\.js$/.test(file)) {
      let code = bytes.toString();
      assert.ok(code.includes(`https://${production}.supabase.co`));
      code = code.replace(/export const SUPABASE_URL = '[^']+';/, `export const SUPABASE_URL = ${JSON.stringify(state.supabaseUrl)};`)
        .replace(/export const SUPABASE_ANON_KEY = '[^']+';/, `export const SUPABASE_ANON_KEY = ${JSON.stringify(secrets.publicKey)};`);
      bytes = Buffer.from(code);
    }
    if (/^js[^/]*\/auth\.js$/.test(file)) {
      bytes = Buffer.from(bytes.toString().replaceAll(`https://supabase.com/dashboard/project/${production}/sql/new`, `https://supabase.com/dashboard/project/${state.ref}/sql/new`));
    }
    if (file === 'vercel.json') {
      const config = JSON.parse(bytes);
      config.installCommand = 'npm ci --ignore-scripts --no-audit --no-fund';
      config.headers = [{ source: '/(.*)', headers: [{ key: 'X-Robots-Tag', value: 'noindex, nofollow' }] }];
      bytes = Buffer.from(JSON.stringify(config, null, 2) + '\n');
    }
    const hash = createHash('sha256').update(bytes).digest('hex');
    assert.ok(!bytes.includes(Buffer.from(production)), `Production reference remains: ${file}`);
    assert.ok(!bytes.includes(Buffer.from(secrets.secretKey)), `Server secret in artifact: ${file}`);
    if (hash !== entry.sha256) changes.push({ path: file, from: entry.sha256, to: hash });
    const destination = join(web, file); mkdirSync(resolve(destination, '..'), { recursive: true });
    writeFileSync(destination, bytes, { flag: 'wx' });
  }
  assert.equal(changes.length, 9);
  mkdirSync(join(web, '.vercel'));
  writeFileSync(join(web, '.vercel/project.json'), JSON.stringify({ projectId: 'prj_nphig6i4hA9E8o9Wg3nhzxyP1krB', orgId: 'team_ONTVy4HempTg7uINmG0C8P3N', projectName: 'learnable-staging' }), { flag: 'wx' });
  writeFileSync(join(directory, 'artifact-receipt.json'), JSON.stringify({ candidate, ref: state.ref, web, changes, createdAt: new Date().toISOString() }, null, 2));
  verifyCandidate(candidate, scope);
  console.log(JSON.stringify({ web, files: Object.keys(scope.files).length, changedPaths: changes.map(change => change.path), originalCandidateUnchanged: true }));
} else if (action === 'lock-empty-legacy') {
  target();
  assert.equal(state.migrations?.length, 19);
  const before = query("select count(*) as rows from public.generation_jobs_legacy_phase22").rows[0];
  assert.equal(Number(before.rows), 0, 'Only a fresh empty staging archive may be configured here');
  const sql = 'begin; alter table public.generation_jobs_legacy_phase22 enable row level security; revoke all on public.generation_jobs_legacy_phase22 from public,anon,authenticated; commit;';
  query(sql);
  const after = query("select (select relrowsecurity from pg_class where oid='public.generation_jobs_legacy_phase22'::regclass) as rls, has_table_privilege('anon','public.generation_jobs_legacy_phase22','select') as anon_read, has_table_privilege('authenticated','public.generation_jobs_legacy_phase22','select') as authenticated_read").rows[0];
  assert.equal(after.rls, true); assert.equal(after.anon_read, false); assert.equal(after.authenticated_read, false);
  state.legacyHardening = { at: new Date().toISOString(), sql, verified: after, scope: 'empty-staging-only-not-a-production-migration' }; save();
  console.log('Locked the empty staging-only legacy archive. No rows deleted; production unchanged.');
} else if (action === 'hosted-conflict') {
  target();
  assert.ok(state.migrations?.length >= 19);
  const path = 'db/20-hosted-course-conflict.sql';
  const sql = readFileSync(join(root, path), 'utf8');
  const sha256 = createHash('sha256').update(sql).digest('hex');
  const prior = query(`select sha256 from learnable_staging.applied_migrations where name='${path}'`).rows;
  if (prior.length) assert.equal(prior[0].sha256, sha256, 'Applied migration 20 changed');
  else query(`begin;\n${sql}\ninsert into learnable_staging.applied_migrations(name,sha256) values ('${path}','${sha256}'); commit;`);
  state.hostedConflictMigration = { name: path, sha256, at: new Date().toISOString() }; save();
  console.log('Applied forward migration 20 to staging only; the original 19 migrations remain unchanged.');
} else if (action === 'stop-qa-backend') {
  target();
  assert.ok(state.hostedConflictMigration, 'Fix the guard before stopping a retry');
  const pid = Number(process.argv[3]); assert.ok(Number.isInteger(pid) && pid > 0);
  // Exact inspected backend, in this staging project only. Never terminate broadly.
  const result = query(`select pg_terminate_backend(pid) as stopped from pg_stat_activity where pid=${pid} and usename='authenticator' and state='active' and query like '%user_courses%'`);
  console.log(JSON.stringify(result.rows));
} else {
  throw new Error('Choose create, inventory, query, keys, migrate, artifact or lock-empty-legacy. No action taken.');
}
