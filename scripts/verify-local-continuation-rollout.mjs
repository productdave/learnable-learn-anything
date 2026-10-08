// Exercise the exact remote SQL wrapper only against the existing local database.
// Both success and deliberately broken access-control runs roll back completely.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { buildMigrationSql, migrationPath, migrationHash } from './rollout-continuation-staging.mjs';

const container = 'supabase_db_learnable-setup-local';
const running = spawnSync('docker', ['inspect', '--format', '{{.State.Running}}', container], { encoding: 'utf8' });
assert.equal(running.status, 0); assert.equal(running.stdout.trim(), 'true');
const psql = input => spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-A', '-t',
  '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], { input, encoding: 'utf8', timeout: 40000 });
const snapshotSql = `select jsonb_build_object(
  'ledger', to_regclass('learnable_staging.applied_migrations')::text,
  'column', (select count(*) from information_schema.columns where table_schema='public' and table_name='generation_jobs' and column_name='continuation'),
  'rows', (select md5(coalesce(string_agg(to_jsonb(j)::text, '|' order by j.id), '')) from public.generation_jobs j),
  'access', (select jsonb_build_object('rls',relrowsecurity,'force',relforcerowsecurity,'acl',relacl::text) from pg_class where oid='public.generation_jobs'::regclass)
);`;
const inspect = () => { const r = psql(snapshotSql); assert.equal(r.status, 0, r.stderr); return JSON.parse(r.stdout.trim()); };
const before = inspect();
assert.equal(before.ledger, null, 'This local test requires the original uninstalled staging ledger.');
assert.equal(before.column, 0, 'This local test requires migration 22 to remain uninstalled.');
const wrapped = buildMigrationSql(readFileSync(new URL('../' + migrationPath, import.meta.url)));
const body = wrapped.replace(/^begin;$/m, '').replace(/^commit;$/m, '');
const setup = `begin;
create schema if not exists learnable_staging;
create table learnable_staging.applied_migrations (name text primary key, sha256 text not null, applied_at timestamptz not null default now());`;
const success = psql(`${setup}
${body}
do $$ begin
  if not exists(select 1 from learnable_staging.applied_migrations where name='${migrationPath}' and sha256='${migrationHash}') then raise exception 'Migration ledger receipt missing'; end if;
  if not exists(select 1 from information_schema.columns where table_schema='public' and table_name='generation_jobs' and column_name='continuation' and data_type='jsonb' and is_nullable='YES' and column_default is null) then raise exception 'Continuation column shape incorrect'; end if;
  if not exists(select 1 from pg_constraint where conrelid='public.generation_jobs'::regclass and conname='generation_jobs_continuation_check' and convalidated) then raise exception 'Validated constraint missing'; end if;
end $$;
rollback;
select 'exact wrapper passed';`);
assert.equal(success.status, 0, success.stderr);
assert.match(success.stdout, /exact wrapper passed/);
assert.deepEqual(inspect(), before, 'Successful test must leave schema, data and access unchanged.');
// Callback replacement preserves PostgreSQL $$ delimiters literally.
const broken = body.replace('do $$ declare before_state', () => 'alter table public.generation_jobs disable row level security;\ndo $$ declare before_state');
assert.notEqual(broken, body);
const control = psql(`${setup}\n${broken}\nrollback;`);
assert.notEqual(control.status, 0, 'Broken RLS control must be rejected before commit.');
assert.match(control.stderr, /Continuation migration changed existing rows or access/);
assert.deepEqual(inspect(), before, 'Rejected control must leave schema, data and access unchanged.');
console.log(JSON.stringify({ status: 'pass', target: container, exactWrapper: true, ledgerAndColumnVerified: true,
  accessMutationRejected: true, bothTransactionsRolledBack: true, remoteWrites: 0 }));
