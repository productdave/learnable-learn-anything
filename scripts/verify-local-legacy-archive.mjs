// Every test row and DDL replay stays inside one rolled-back LOCAL transaction.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
const container='supabase_db_learnable-setup-local';
const info=JSON.parse(execFileSync('docker',['inspect',container],{encoding:'utf8'}))[0];
assert.equal(info.Name,'/'+container);assert.ok(info.State.Running&&info.Config.Image.includes('supabase/postgres'));
assert.ok(Object.values(info.NetworkSettings.Ports).flat().filter(Boolean).every(p=>p.HostIp==='127.0.0.1'));
const owner=randomUUID(),course=randomUUID(),job=randomUUID();
const migration=readFileSync(new URL('../db/21-private-legacy-job-archive.sql',import.meta.url),'utf8');
const script=`begin;
insert into auth.users(id) values ('${owner}');
insert into public.courses(id,owner_id,slug,title,brief) values ('${course}','${owner}','archive-fixture','Archive preservation fixture','{}');
insert into public.generation_jobs_legacy_phase22(id,course_id,owner_id,stage,payload) values ('${job}','${course}','${owner}','done','{"keep":"original"}');
${migration}
${migration}
do $$ begin
  if (select payload from public.generation_jobs_legacy_phase22 where id='${job}') <> '{"keep":"original"}'::jsonb then raise exception 'Historical row changed'; end if;
  if not (select relrowsecurity from pg_class where oid='public.generation_jobs_legacy_phase22'::regclass) then raise exception 'RLS missing'; end if;
  if has_table_privilege('anon','public.generation_jobs_legacy_phase22','select,insert,update,delete,truncate,references,trigger') then raise exception 'Anonymous grant remains'; end if;
  if has_table_privilege('authenticated','public.generation_jobs_legacy_phase22','select,insert,update,delete,truncate,references,trigger') then raise exception 'Authenticated grant remains'; end if;
end $$;
set local role anon;
do $$ begin begin perform 1 from public.generation_jobs_legacy_phase22; raise exception 'Anonymous read allowed'; exception when insufficient_privilege then null; end; end $$;
reset role;
set local role authenticated;
do $$ begin begin perform 1 from public.generation_jobs_legacy_phase22; raise exception 'Authenticated read allowed'; exception when insufficient_privilege then null; end; end $$;
reset role;
rollback;`;
execFileSync('docker',['exec','-i','--user','postgres',container,'psql','-X','-U','postgres','-d','postgres','-v','ON_ERROR_STOP=1'],{input:script,stdio:['pipe','pipe','pipe']});
console.log('Legacy archive: 6 real local SQL checks passed, including nonempty replay preservation and both browser roles denied. Transaction rolled back; no existing rows changed.');
