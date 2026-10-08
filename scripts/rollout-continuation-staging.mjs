// Scoped continuation rollout. No production target, provider call, allowance,
// key export or feature enablement. Existing release/migration files stay frozen.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, cpSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { verifyContinuationRelease } from './prepare-continuation-release.mjs';
import { baseInventory, tree } from './packaging/grounding-release.mjs';

export const staging = { ref: 'dmnwkrybgggbpqpetuub', projectId: 'prj_nphig6i4hA9E8o9Wg3nhzxyP1krB',
  teamId: 'team_ONTVy4HempTg7uINmG0C8P3N', orgId: 'zdghcycryytrnxopmfpv', alias: 'learnable-staging.vercel.app' };
export const migrationPath = 'db/22-generation-continuation.sql';
export const migrationHash = '39dc1b268d67fdadaf30b5f9f211bf63388bc133fb7629655b4f9f425bd63aca';
const artifactPath = 'output/staging/2026-09-30-continuation/release-WxC4mz';
const root = resolve(new URL('..', import.meta.url).pathname);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const json = path => JSON.parse(readFileSync(join(root, path)));
export const closedFlags = ['LEARNABLE_SETUP_GENERATION', 'LEARNABLE_CREATION_IMAGES',
  'LEARNABLE_SELF_PUBLISH', 'LEARNABLE_PUBLIC_IMAGES', 'LEARNABLE_MODERATION',
  'LEARNABLE_GPT_IMAGES', 'LEARNABLE_IMAGE_REQUESTS', 'LEARNABLE_STAGING_IMAGE_SPEND'];

export function validateEnvironment(rows) {
  for (const key of closedFlags) {
    const entries = rows.filter(row => row.key === key);
    assert.ok(entries.length === 1 && entries[0].value === '0', 'Paid/public flag must remain off: ' + key);
    assert.deepEqual([...entries[0].target].sort(), ['preview', 'production']);
  }
  for (const key of ['LEARNABLE_AI_REFINEMENT', 'LEARNABLE_GENERATION_CONTINUATION']) {
    assert.ok(rows.filter(row => row.key === key).every(row => row.value === '0'), 'Optional paid/continuation path must remain off: ' + key);
  }
  assert.ok(rows.filter(row => row.key === 'SUPABASE_URL').length === 1 &&
    rows.find(row => row.key === 'SUPABASE_URL')?.value === `https://${staging.ref}.supabase.co`, 'Staging database binding changed');
  assert.ok(rows.some(row => row.key === 'LEARNABLE_OPENAI_CONNECTION' && row.value === '1'), 'Preserve connection-only access');
  assert.ok(rows.some(row => row.key === 'LEARNABLE_IMAGE_FUNDING' && row.value === 'creator'), 'Preserve creator funding');
  return { paidPublicOff: [...closedFlags], continuationOff: true, creatorFunding: true, connectionOnly: true };
}

export function assertClosedState(row) {
  for (const key of ['live_jobs', 'open_text_grants', 'open_image_grants']) assert.equal(Number(row[key]), 0, key);
  assert.equal(Number(row.text_requests), 6, 'Text ledger changed; re-review before rollout');
  assert.equal(Number(row.image_requests), 3, 'Image ledger changed; re-review before rollout');
  assert.equal(Number(row.accounted_text_microusd), 1951170);
  assert.equal(Number(row.accounted_image_microusd), 45142);
}

const protectionSql = `select jsonb_build_object(
  'rows', (select md5(coalesce(string_agg((to_jsonb(j)-'continuation')::text, '|' order by j.id), '')) from public.generation_jobs j),
  'policies', (select md5(coalesce(string_agg(row_to_json(p)::text, '|' order by policyname), '')) from pg_policies p where schemaname='public' and tablename='generation_jobs'),
  'access', (select jsonb_build_object('rls',relrowsecurity,'force',relforcerowsecurity,'acl',relacl::text) from pg_class where oid='public.generation_jobs'::regclass)
) as snapshot`;

export function buildMigrationSql(bytes) {
  assert.equal(hash(bytes), migrationHash, 'Unreviewed migration bytes');
  const text = bytes.toString();
  assert.equal((text.match(/^begin;$/gm) || []).length, 1); assert.equal((text.match(/^commit;$/gm) || []).length, 1);
  const body = text.replace(/^begin;$/m, '').replace(/^commit;$/m, '');
  return `begin;
set local lock_timeout = '3s';
set local statement_timeout = '30s';
create temporary table continuation_before on commit drop as ${protectionSql};
${body}
do $$ declare before_state jsonb; after_state jsonb;
begin
  select snapshot into before_state from continuation_before;
  select snapshot into after_state from (${protectionSql}) s;
  if before_state is distinct from after_state then raise exception 'Continuation migration changed existing rows or access'; end if;
  if exists(select 1 from public.generation_jobs where continuation is not null) then raise exception 'Unexpected pre-existing continuation state'; end if;
end $$;
insert into learnable_staging.applied_migrations(name,sha256) values ('${migrationPath}','${migrationHash}');
notify pgrst, 'reload schema';
commit;`;
}

const snapshots = ['user_courses', 'user_state', 'course_setups', 'provider_connections', 'course_image_requests',
  'course_publications', 'course_publication_reports', 'course_moderators', 'course_moderation_audit',
  'learnable_staging_spend_budgets', 'learnable_staging_spend_requests',
  'learnable_staging_image_budgets', 'learnable_staging_image_spend'];
const dataSql = snapshots.map(table => `select '${table}' as name, count(*)::integer as count,
  md5(coalesce(string_agg(to_jsonb(t)::text, '|' order by to_jsonb(t)::text), '')) as digest from public.${table} t`).join(' union all ');
const stateSql = `select
  (select count(*) from information_schema.columns where table_schema='public' and table_name='generation_jobs' and column_name='continuation' and data_type='jsonb' and is_nullable='YES' and column_default is null) as continuation_columns,
  (select count(*) from pg_constraint where conrelid='public.generation_jobs'::regclass and conname='generation_jobs_continuation_check' and convalidated) as continuation_constraints,
  (select count(*) from public.generation_jobs where status in ('queued','running','cancelling')) as live_jobs,
  (select count(*) from public.learnable_staging_spend_budgets where enabled) as open_text_grants,
  (select count(*) from public.learnable_staging_image_budgets where enabled) as open_image_grants,
  (select count(*) from public.learnable_staging_spend_requests) as text_requests,
  (select count(*) from public.learnable_staging_image_spend) as image_requests,
  (select sum(charged_microusd) from public.learnable_staging_spend_budgets) as accounted_text_microusd,
  (select sum(charged_microusd) from public.learnable_staging_image_budgets) as accounted_image_microusd`;

function run(command, args, timeout = 30000) {
  try { return JSON.parse(execFileSync(command, args, { cwd: root, encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'], timeout, maxBuffer: 8 * 1024 * 1024 })); }
  catch { throw Error('External command did not confirm. Inspect target state before retrying; raw output suppressed.'); }
}
const api = path => run('vercel', ['api', path + '?teamId=' + staging.teamId]);
const dbCli = '/Users/davidwang/.npm/_npx/6f1b058a4d9555af/node_modules/supabase/dist/supabase.js';
const database = sql => run(process.execPath, [dbCli, 'db', 'query', '--linked', '--project-ref', staging.ref, sql, '--output-format', 'json']);

function verifyMigrations(rows, installed) {
  const base = json('docs/upgrade/staging-migrations-2026-09-18.json');
  assert.equal(base.stagingRef, staging.ref); assert.equal(base.migrations.length, 21);
  for (const m of base.migrations) assert.equal(hash(readFileSync(join(root, m.path))), m.sha256);
  const expected = base.migrations.map(m => ({ name: m.path, sha256: m.sha256 }));
  if (installed) expected.push({ name: migrationPath, sha256: migrationHash });
  assert.deepEqual(rows, expected, 'Migration ledger drift');
}

async function preflight() {
  const state = json('output/staging/2026-09-18/state.json');
  assert.equal(state.ref, staging.ref); assert.equal(state.org, staging.orgId);
  assert.equal(state.supabaseUrl, `https://${staging.ref}.supabase.co`);
  const projects = run(process.execPath, [dbCli, 'projects', 'list', '--output-format', 'json']).projects;
  const project = projects.find(p => p.id === staging.ref);
  assert.ok(project?.name === 'Learnable Staging' && project.organization_id === staging.orgId, 'Staging target identity changed');
  const vercel = api('/v9/projects/' + staging.projectId);
  assert.ok(vercel.id === staging.projectId && vercel.name === 'learnable-staging', 'Vercel target changed');
  const alias = api('/v4/aliases/' + staging.alias);
  assert.equal(alias.projectId, staging.projectId, 'Alias target changed');
  const deploymentId = alias.deploymentId || alias.deployment?.id;
  assert.match(deploymentId || '', /^dpl_[A-Za-z0-9]+$/);
  const environment = validateEnvironment(api('/v9/projects/' + staging.projectId + '/env').envs);
  const stateRow = database(stateSql).rows[0]; assertClosedState(stateRow);
  const migrations = database('select name,sha256 from learnable_staging.applied_migrations order by name').rows;
  const installed = migrations.some(m => m.name === migrationPath); verifyMigrations(migrations, installed);
  assert.equal(Number(stateRow.continuation_columns), installed ? 1 : 0);
  assert.equal(Number(stateRow.continuation_constraints), installed ? 1 : 0);
  const data = database(dataSql).rows.sort((a,b) => a.name.localeCompare(b.name));
  const protection = database(protectionSql).rows[0].snapshot;
  assert.equal(protection.access.rls, true);
  return { at: new Date().toISOString(), stagingRef: staging.ref, projectId: staging.projectId,
    currentDeployment: deploymentId, environment, state: stateRow, migrations, installed, data, protection };
}

export async function main(action) {
  assert.ok(['inspect', 'migrate', 'deploy-disabled'].includes(action), 'Choose inspect, migrate or deploy-disabled');
  const verified = verifyContinuationRelease(join(root, artifactPath));
  const evidence = json('output/diagnostics/m3-continuation-package-20260930/verification.json');
  for (const [p,h] of Object.entries(evidence.package.pins)) assert.equal(hash(readFileSync(join(root,p))), h, 'Verified input drift: ' + p);
  assert.equal(evidence.package.runtime.checks, 227); assert.equal(evidence.package.targeted.testCount, 197);
  const before = await preflight();
  const parent = join(root, 'output/staging/2026-09-30-continuation-rollout'); mkdirSync(parent, { recursive: true });
  const operation = mkdtempSync(join(parent, action + '-'));
  const save = (name, value) => writeFileSync(join(operation, name + '.json'), JSON.stringify(value, null, 2) + '\n', { flag: 'wx' });
  save('before', before);
  if (action === 'inspect') { console.log(JSON.stringify({ operation, ...before }, null, 2)); return; }
  if (action === 'migrate') {
    assert.equal(before.installed, false, 'Migration is already tracked; inspect instead of repeating it');
    save('intent', { at: new Date().toISOString(), action, migrationPath, migrationHash, stagingRef: staging.ref });
    database(buildMigrationSql(readFileSync(join(root, migrationPath))));
    const after = await preflight(); save('after', after);
    assert.equal(after.installed, true); assert.deepEqual(after.data, before.data); assert.deepEqual(after.protection, before.protection);
    assert.deepEqual(after.environment, before.environment); assert.equal(after.currentDeployment, before.currentDeployment);
    save('receipt', { at: new Date().toISOString(), status: 'migration-installed-data-and-access-preserved', migrationPath, migrationHash,
      stagingRef: staging.ref, dataPreserved: true, accessPreserved: true, grantsClosed: true, deployed: false, paidCalls: 0 });
    console.log(JSON.stringify({ operation, status: 'migration-installed-data-and-access-preserved', stagingRef: staging.ref, paidCalls: 0 })); return;
  }
  assert.equal(before.installed, true, 'Install migration before deploying its readers');
  const source = join(root, artifactPath, '.vercel/output'), destination = join(operation, 'deploy');
  mkdirSync(join(destination, '.vercel'), { recursive: true }); cpSync(source, join(destination, '.vercel/output'), { recursive: true });
  const inventory = baseInventory(json(artifactPath + '/packaging-report.json'));
  assert.deepEqual(tree(join(destination, '.vercel/output')), Object.keys(inventory).sort());
  for (const [p,h] of Object.entries(inventory)) assert.equal(hash(readFileSync(join(destination, '.vercel/output', p))), h, p);
  writeFileSync(join(destination, '.vercel/project.json'), JSON.stringify({ projectId: staging.projectId, orgId: staging.teamId, projectName: 'learnable-staging' }), { flag: 'wx' });
  save('intent', { at: new Date().toISOString(), action, projectId: staging.projectId, destination,
    sourceArtifact: artifactPath, verified, rollbackDeployment: before.currentDeployment, paidPublicOff: true, continuationOff: true });
  // --prod is Vercel's alias target inside the isolated Learnable Staging project.
  // It is not the Learnable production project. No env values are pulled/written.
  const result = run('vercel', ['deploy', '--prebuilt', '--prod', '--yes', '--no-wait', '--format', 'json',
    '--scope', 'david-davidwangcos-projects', '--project', staging.projectId, '--cwd', destination], 60000);
  const d = result.deployment || result;
  const deployed = { id: d.id || d.deploymentId, url: d.url, status: d.readyState || result.status };
  assert.match(deployed.id || '', /^dpl_[A-Za-z0-9]+$/);
  save('dispatch', { at: new Date().toISOString(), projectId: staging.projectId, ...deployed,
    paidPublicOff: true, continuationOff: true, paidCalls: 0 });
  console.log(JSON.stringify({ operation, ...deployed, paidCalls: 0, verificationPending: true }));
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  assert.equal(process.argv.length, 3, 'One explicit action only');
  await main(process.argv[2]);
}
