import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('..', import.meta.url).pathname;
const schema = readFileSync(join(root, 'db/01-schema.sql'), 'utf8');
const rls = readFileSync(join(root, 'db/02-rls.sql'), 'utf8');
const workflow = readFileSync(join(root, 'db/04-agentic-workflow.sql'), 'utf8');
const setup = readFileSync(join(root, 'db/SETUP.md'), 'utf8');

assert.ok(
  schema.includes('create table public.generation_jobs'),
  'db/01-schema.sql should still expose the legacy generation_jobs table that db/04 migrates away from.'
);

assert.ok(
  workflow.includes('alter table public.generation_jobs rename to generation_jobs_legacy_phase22'),
  'db/04-agentic-workflow.sql must preserve/rename the legacy generation_jobs table before creating the cloud state machine.'
);

assert.ok(
  workflow.includes('create table if not exists public.generation_jobs'),
  'db/04-agentic-workflow.sql must create the durable cloud generation_jobs table.'
);

assert.ok(
  rls.includes('generation_jobs is owned by db/04-agentic-workflow.sql'),
  'db/02-rls.sql should document that generation_jobs RLS is owned by db/04.'
);

assert.ok(
  !rls.includes('on public.generation_jobs'),
  'db/02-rls.sql must not create generation_jobs policies; rerunning it after db/04 would collide with cloud workflow policy.'
);

const orderedScripts = [
  'db/01-schema.sql',
  'db/02-rls.sql',
  'db/03-user-state.sql',
  'db/04-agentic-workflow.sql'
];
let lastIndex = -1;
for (const name of orderedScripts) {
  const idx = setup.indexOf(name);
  assert.ok(idx > lastIndex, `db/SETUP.md should list ${name} after the previous setup script.`);
  lastIndex = idx;
}

console.log('db setup contract tests passed');
