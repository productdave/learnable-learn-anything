// Only the named Docker-local database. No URL, password or remote-project input.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const container = 'supabase_db_learnable-setup-local';
const info = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0];
if (info.Name !== `/${container}` || !info.State.Running || !info.Config.Image.includes('supabase/postgres')) throw new Error('The isolated Learnable Supabase database must be running.');
const bindings = Object.values(info.NetworkSettings.Ports || {}).flat().filter(Boolean);
if (!bindings.length || bindings.some(binding => binding.HostIp !== '127.0.0.1')) throw new Error('Refusing a database that is not bound exclusively to loopback.');
function sql(input) {
  return execFileSync('docker', ['exec', '-i', '--user', 'postgres', container, 'psql', '-X', '-U', 'postgres', '-d', 'postgres', '-v', 'ON_ERROR_STOP=1', '-tA'], { input, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'] });
}
sql('create schema if not exists learnable_local; revoke all on schema learnable_local from public; create table if not exists learnable_local.applied_migrations (name text primary key, sha256 text not null, applied_at timestamptz not null default now());');
const files = ['01-schema.sql', '02-rls.sql', '03-user-state.sql', '04-agentic-workflow.sql', '05-clean-generation-job-write-policies.sql', '06-course-setups.sql', '07-provider-connections.sql', '08-openai-provider-connection.sql', '09-course-image-requests.sql', '10-accept-course-image.sql', '11-delete-course-drafts.sql', '12-course-publications.sql', '13-publication-images.sql', '14-community-discovery.sql', '15-report-moderation.sql', '16-moderation-audit-grants.sql', '17-preserve-versioned-account-state.sql', '18-generation-action-checkpoints.sql'];
files.push('19-course-write-revisions.sql');
files.push('20-hosted-course-conflict.sql', '21-private-legacy-job-archive.sql');
for (const name of files) {
  const source = readFileSync(new URL(`../db/${name}`, import.meta.url), 'utf8');
  const hash = createHash('sha256').update(source).digest('hex');
  const prior = sql(`select sha256 from learnable_local.applied_migrations where name = '${name}';`).trim();
  if (prior) {
    if (prior !== hash) throw new Error(`Previously applied ${name} changed. Add a forward migration; no reset or overwrite was performed.`);
    console.log(`Already applied locally: ${name}`); continue;
  }
  if (name === '01-schema.sql' && sql("select to_regclass('public.learner_profiles') is not null;").trim() === 't') throw new Error('Existing untracked app schema found. Inspect it before applying migrations; no reset was performed.');
  sql(`begin;\n${source}\ninsert into learnable_local.applied_migrations(name,sha256) values ('${name}','${hash}');\ncommit;`);
  console.log(`Applied to isolated local Docker database: ${name}`);
}
sql("notify pgrst, 'reload schema';");
console.log('Local migrations complete. No remote database was contacted.');
