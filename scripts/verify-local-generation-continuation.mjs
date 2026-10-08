// Runs only against the named, already-running LOCAL Docker database.
// Migration and fixtures are inside a rolled-back transaction. No remote URL,
// key, grant, generation call or persistent schema/data change is involved.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const container = 'supabase_db_learnable-setup-local';
const probe = spawnSync('docker', ['inspect', '--format', '{{.State.Running}}', container], { encoding: 'utf8' });
assert.equal(probe.status, 0, 'The existing Learnable local database must be available.');
assert.equal(probe.stdout.trim(), 'true', 'The local database must already be running.');
const migration = readFileSync(new URL('../db/22-generation-continuation.sql', import.meta.url), 'utf8');
assert.equal((migration.match(/^begin;$/gm) || []).length, 1);
assert.equal((migration.match(/^commit;$/gm) || []).length, 1);
const body = migration.replace(/^begin;$/m, '').replace(/^commit;$/m, '');
const psql = input => spawnSync('docker', ['exec', '-i', container, 'psql', '-X', '-q', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1'], {
  input, encoding: 'utf8', timeout: 20_000, maxBuffer: 1024 * 1024
});
const columnQuery = "select count(*) from information_schema.columns where table_schema='public' and table_name='generation_jobs' and column_name='continuation';";
const before = psql(columnQuery); assert.equal(before.status, 0);
const result = psql(`begin;
create temporary table continuation_qa_policy as
  select md5(coalesce(string_agg(row_to_json(p)::text, ',' order by policyname), '')) as digest
  from pg_policies p where schemaname='public' and tablename='generation_jobs';
${body}
${body}
create temporary table continuation_qa (like public.generation_jobs including defaults including constraints);
do $$
declare bad jsonb; affected integer; before_policy text; after_policy text;
begin
  select digest into before_policy from continuation_qa_policy;
  select md5(coalesce(string_agg(row_to_json(p)::text, ',' order by policyname), '')) into after_policy
    from pg_policies p where schemaname='public' and tablename='generation_jobs';
  if before_policy is distinct from after_policy then raise exception 'Migration changed RLS policies'; end if;
  if not (select relrowsecurity from pg_class where oid='public.generation_jobs'::regclass) then raise exception 'RLS is disabled'; end if;
  insert into continuation_qa (id,owner_id) values ('legacy','11111111-1111-4111-8111-111111111111');
  if (select continuation from continuation_qa where id='legacy') is not null then raise exception 'Legacy default changed'; end if;
  for bad in select value from jsonb_array_elements('[null,[],1,"text",{}, {"version":2,"phase":"pending"}, {"version":1}, {"version":1,"phase":"unsafe"}]'::jsonb) loop
    begin
      insert into continuation_qa (id,owner_id,continuation) values ('bad','11111111-1111-4111-8111-111111111111',bad);
      raise exception 'Invalid continuation state was accepted';
    exception when check_violation then null;
    end;
  end loop;
  insert into continuation_qa (id,owner_id,status,run_id,continuation) values
    ('handoff','11111111-1111-4111-8111-111111111111','queued','old-run','{"version":1,"phase":"pending","runId":"old-run"}');
  update continuation_qa set status='running',run_id='new-run',continuation='{"version":1,"phase":"running","runId":"new-run"}'
    where id='handoff' and owner_id='11111111-1111-4111-8111-111111111111' and status='queued' and run_id='old-run'
      and continuation->>'phase'='pending' and continuation->>'runId'='old-run';
  get diagnostics affected = row_count;
  if affected <> 1 then raise exception 'Exact pending handoff was not claimed'; end if;
  update continuation_qa set status='running' where id='handoff' and status='queued' and run_id='old-run'
    and continuation->>'phase'='pending' and continuation->>'runId'='old-run';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Duplicate claim was accepted'; end if;
  update continuation_qa set status='failed' where id='handoff' and owner_id='99999999-9999-4999-8999-999999999999';
  get diagnostics affected = row_count;
  if affected <> 0 then raise exception 'Wrong owner claim was accepted'; end if;
end $$;
rollback;
select 'PASS: migration twice, RLS unchanged, legacy null, 8 invalid shapes rejected, exact claim, duplicate and wrong-owner refusal; rolled back.';
`);
assert.equal(result.status, 0, result.stderr);
const after = psql(columnQuery); assert.equal(after.status, 0);
assert.equal(after.stdout, before.stdout, 'Rolled-back migration must not change the installed schema.');
console.log(result.stdout.trim());
