import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';

const root = new URL('..', import.meta.url).pathname;
const envNames = ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SECRET_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'CRON_SECRET'];
const priorEnv = Object.fromEntries(envNames.map(name => [name, process.env[name]]));
for (const name of envNames) delete process.env[name];

const warn = console.warn;
console.warn = () => {};
const url = pathToFileURL(join(root, 'web/api/health/cloud.js'));
url.searchParams.set('test', Date.now().toString(36));
const {
  REQUIRED_GENERATION_JOB_COLUMNS,
  REQUIRED_USER_COURSE_COLUMNS,
  REQUIRED_USER_STATE_COLUMNS
} = await import(url.href);
console.warn = warn;

const migration = readFileSync(join(root, 'db/04-agentic-workflow.sql'), 'utf8');
const continuationMigration = readFileSync(join(root, 'db/22-generation-continuation.sql'), 'utf8');
const integratedImagesMigration = readFileSync(join(root, 'db/23-integrated-course-images.sql'), 'utf8');
const visualDesignerMigration = readFileSync(join(root, 'db/24-visual-designer.sql'), 'utf8');
const cloudClient = readFileSync(join(root, 'web/js/cloud-gen-client.js'), 'utf8');
const migrations = {
  'db/04-agentic-workflow.sql': migration,
  'db/22-generation-continuation.sql': continuationMigration,
  'db/23-integrated-course-images.sql': integratedImagesMigration,
  'db/24-visual-designer.sql': visualDesignerMigration
};
const columnOwners = {
  'generation_jobs.continuation': 'db/22-generation-continuation.sql',
  'generation_jobs.image_progress': 'db/23-integrated-course-images.sql',
  'generation_jobs.design_progress': 'db/24-visual-designer.sql'
};

function assertMigrationOwnsColumns(table, columns, sources = migrations) {
  for (const column of columns) {
    const owner = columnOwners[`${table}.${column}`] || 'db/04-agentic-workflow.sql';
    const sql = (sources[owner] || '').replace(/--[^\n]*|\/\*[\s\S]*?\*\//g, '');
    const tableBody = sql.match(new RegExp(`create table if not exists public\\.${table}\\s*\\(([\\s\\S]*?)\\n\\);`, 'i'))?.[1] || '';
    const createColumn = new RegExp(`^\\s*${column}\\s+\\w+`, 'im').test(tableBody);
    const alterColumn = new RegExp(`alter\\s+table\\s+public\\.${table}\\s+add\\s+column\\s+if\\s+not\\s+exists\\s+${column}\\s+\\w+`, 'i').test(sql);
    assert.ok(
      createColumn || alterColumn,
      `${table} health contract requires ${column}, but ${owner} does not create or backfill it.`
    );
  }
}

assertMigrationOwnsColumns('generation_jobs', REQUIRED_GENERATION_JOB_COLUMNS);
assertMigrationOwnsColumns('user_courses', REQUIRED_USER_COURSE_COLUMNS);
assertMigrationOwnsColumns('user_state', REQUIRED_USER_STATE_COLUMNS);

// A new required column must belong to its incremental migration. A mention in
// a comment, another table, or a similarly named column is not schema coverage.
for (const badSql of [
  '',
  '-- alter table public.generation_jobs add column if not exists continuation jsonb;',
  '/* alter table public.generation_jobs add column if not exists continuation jsonb; */',
  'alter table public.user_courses add column if not exists continuation jsonb;',
  'alter table public.generation_jobs add column if not exists continuation_extra jsonb;'
]) {
  assert.throws(() => assertMigrationOwnsColumns('generation_jobs', ['continuation'], {
    ...migrations, 'db/22-generation-continuation.sql': badSql
  }), /generation_jobs health contract requires continuation/);
}
assert.throws(() => assertMigrationOwnsColumns('generation_jobs', ['started_at'], {
  ...migrations, 'db/04-agentic-workflow.sql': ''
}), /generation_jobs health contract requires started_at/);
assert.ok(REQUIRED_GENERATION_JOB_COLUMNS.includes('continuation'),
  'continuation must block readiness until migration 22 is installed, even while its feature flag is off.');

for (const badSql of [
  '',
  '-- alter table public.generation_jobs add column if not exists image_progress jsonb;',
  '/* alter table public.generation_jobs add column if not exists image_progress jsonb; */',
  'alter table public.user_courses add column if not exists image_progress jsonb;',
  'alter table public.generation_jobs add column if not exists image_progress_extra jsonb;'
]) {
  assert.throws(() => assertMigrationOwnsColumns('generation_jobs', ['image_progress'], {
    ...migrations, 'db/23-integrated-course-images.sql': badSql
  }), /generation_jobs health contract requires image_progress/);
}
assert.ok(REQUIRED_GENERATION_JOB_COLUMNS.includes('image_progress'),
  'integrated image progress must block readiness until migration 23 is installed.');
assert.ok(REQUIRED_GENERATION_JOB_COLUMNS.includes('design_progress'),
  'Visual Designer progress must block readiness until migration 24 is installed.');
assert.throws(() => assertMigrationOwnsColumns('generation_jobs', ['design_progress'], {
  ...migrations, 'db/24-visual-designer.sql': '-- alter table public.generation_jobs add column if not exists design_progress jsonb;'
}), /generation_jobs health contract requires design_progress/);

assert.ok(
  REQUIRED_GENERATION_JOB_COLUMNS.includes('started_at'),
  'generation_jobs health contract must include started_at because the cloud client renders it.'
);
assert.ok(
  cloudClient.includes('started_at') && migration.includes('add column if not exists started_at'),
  'generation_jobs.started_at must be both rendered by the client and backfilled by the migration.'
);
assert.ok(
  migration.includes('delete_generation_job_rpc_service_only') &&
  migration.includes('generation_jobs_id_safe_check') &&
  migration.includes("id ~ '^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$'") &&
  migration.includes("'job_id_constraint'") &&
  migration.includes('generation_jobs_counters_check') &&
  migration.includes("'counter_constraint'") &&
  migration.includes('topics_done <= topics_total') &&
  migration.includes('recovery_attempts = greatest(0, recovery_attempts)') &&
  migration.includes('generation_jobs_completion_check') &&
  migration.includes("'completion_constraint'") &&
  migration.includes('completed_at = null') &&
  migration.includes('completed_at is not null') &&
  migration.includes("p.prosecdef = true") &&
  migration.includes("has_function_privilege('service_role', 'public.delete_generation_job_for_owner(text, uuid)', 'EXECUTE')") &&
  migration.includes("not has_function_privilege('authenticated', 'public.delete_generation_job_for_owner(text, uuid)', 'EXECUTE')"),
  'workflow health must verify job id/counter/completion safety and the destructive cleanup RPC is security-definer/service-role only.'
);

for (const [name, value] of Object.entries(priorEnv)) {
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
}

console.log('cloud schema contract tests passed');
