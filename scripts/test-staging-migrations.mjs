import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { verifyStagingMigrations } from './packaging/staging-migrations.mjs';
const manifest=JSON.parse(readFileSync(new URL('../docs/upgrade/staging-migrations-2026-09-18.json',import.meta.url)));
const base=JSON.parse(readFileSync(new URL('../docs/upgrade/workspace-release-scope-2026-09-18-candidate3.json',import.meta.url)));
const files=new Map(manifest.migrations.map(r=>[r.path,readFileSync(new URL('../'+r.path,import.meta.url))]));
let checks=0;const check=(name,run)=>{run();checks++;};
check('full pinned sequence, original 19 untouched',()=>assert.equal(verifyStagingMigrations(manifest,files,base).length,21));
check('foreign target refused',()=>assert.throws(()=>verifyStagingMigrations({...manifest,stagingRef:'production'},files,base)));
check('missing migration refused',()=>assert.throws(()=>verifyStagingMigrations({...manifest,migrations:manifest.migrations.slice(0,20)},files,base)));
check('changed source refused',()=>assert.throws(()=>verifyStagingMigrations(manifest,new Map([...files,['db/20-hosted-course-conflict.sql',Buffer.from('changed')]]),base),/drift/));
check('extra source refused',()=>assert.throws(()=>verifyStagingMigrations(manifest,new Map([...files,['db/22-unreviewed.sql',Buffer.from('extra')]]),base)));
check('guard body remains unchanged except its two response codes',()=>{
  const body=source=>source.toString().match(/function public\.guard_course_revision\(\)[\s\S]*?\n\$\$;/)[0].replace(/--[^\n]*/g,'').replace(/\s+/g,' ').trim();
  const old=body(files.get('db/19-course-write-revisions.sql'));
  const next=body(files.get('db/20-hosted-course-conflict.sql'));
  assert.equal(next,old.replaceAll("errcode='40001'","errcode='PT409'"));
});
check('archive migration only changes access, never historical rows',()=>{
  const sql=files.get('db/21-private-legacy-job-archive.sql').toString().replace(/^--.*$/gm,'').trim();
  assert.equal(sql,'alter table public.generation_jobs_legacy_phase22 enable row level security;\nrevoke all on public.generation_jobs_legacy_phase22 from public, anon, authenticated;');
});
console.log(`Staging migration inventory: ${checks} contracts passed.`);
