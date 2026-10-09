// Creates and removes only a uniquely named disposable DB in the existing local
// Learnable Supabase container. No hosted URL, credentials or provider calls.
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
const run = promisify(execFile), container = 'supabase_db_learnable-setup-local';
const db = `learnable_ai_spend_test_${Date.now()}`;
const command = (database, sql) => ['exec', '-i', container, 'psql', '-U', 'postgres', '-d', database, '-v', 'ON_ERROR_STOP=1', '-At', '-c', sql];
const query = sql => execFileSync('docker', command(db, sql), { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim();
const owner = '11111111-1111-4111-8111-111111111111', other = '22222222-2222-4222-8222-222222222222';
const lease = '33333333-3333-4333-8333-333333333333', nextLease = '44444444-4444-4444-8444-444444444444';
const rid = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = [rid(100), rid(101), rid(102)], job = 'job-local-ai-spend-test', policyHash = 'a'.repeat(64);
let checks = 0;
const check = (label, fn) => { fn(); checks++; };
const reserve = (n, amount = 30, change = {}) => `select public.reserve_learnable_ai_spend('${change.owner || owner}','${change.job || job}','${change.run || lease}',
  '${rid(n)}','${change.operation || 'lesson-' + n}','${'b'.repeat(64)}','${change.policy || policyHash}',${amount},'${change.model || 'deepseek/deepseek-v4.1-flash'}','lesson')`;
const settle = (n, amount = 10, extra = {}) => `select public.settle_learnable_ai_spend('${extra.owner || owner}','${job}','${extra.run || lease}',
  '${rid(n)}',${amount},'${extra.generation || 'gen-local-' + n}','{"input_tokens":1}'::jsonb)`;
const result = sql => JSON.parse(query(sql));
function reset({ budgetIds = ids, expiredPolicy = false } = {}) {
  query(`truncate public.learnable_ai_requests,public.learnable_ai_budgets,public.generation_jobs;
    insert into public.learnable_ai_budgets(id,owner_id,job_id,cap_microusd,max_calls,expires_at,enabled) values
    ('${ids[0]}',null,null,100,10,now()+interval '1 hour',true),
    ('${ids[1]}','${owner}',null,100,10,now()+interval '1 hour',true),
    ('${ids[2]}','${owner}','${job}',100,10,now()+interval '1 hour',true);
    insert into public.generation_jobs(id,owner_id,run_id,status,lease_expires_at,ai_budget_ids,ai_policy) values
      ('${job}','${owner}','${lease}','running',now()+interval '1 hour',array['${budgetIds.join("','")}']::uuid[],
      '${JSON.stringify({ funding: 'platform', fingerprint: policyHash, validUntil: new Date(Date.now() + (expiredPolicy ? -60000 : 3600000)).toISOString(), routes: { lesson: { model: 'deepseek/deepseek-v4.1-flash' } } })}'::jsonb);`);
}
execFileSync('docker', command('postgres', `create database ${db}`), { stdio: 'pipe' });
try {
  query(`create table public.generation_jobs(id text primary key,owner_id uuid,run_id text,status text,lease_expires_at timestamptz);
    insert into public.generation_jobs values('${job}','${owner}','${lease}','running',now()+interval '1 hour');`);
  query(readFileSync(new URL('../db/25-platform-ai-spend.sql', import.meta.url), 'utf8'));
  check('migration creates no grants', () => assert.equal(query('select count(*) from public.learnable_ai_budgets'), '0'));
  check('no policy/grants cannot reserve', () => assert.equal(result(reserve(1)).ok, false));
  for (const role of ['anon', 'authenticated']) check(`${role} cannot read budgets or invoke reserve`, () => {
    assert.equal(query(`select has_table_privilege('${role}','public.learnable_ai_budgets','select'),
      has_function_privilege('${role}','public.reserve_learnable_ai_spend(uuid,text,text,uuid,text,text,text,bigint,text,text)','execute')`), 'f|f');
  });
  check('runtime cannot mint or edit budget/request rows', () => assert.equal(query(`select has_table_privilege('service_role','public.learnable_ai_budgets','insert'),
    has_table_privilege('service_role','public.learnable_ai_requests','update')`), 'f|f'));
  reset();
  for (const change of [{ owner: other }, { job: 'job-other' }, { run: nextLease }, { policy: 'c'.repeat(64) }, { model: 'untested/model' }])
    check('identity/policy mismatch denies dispatch', () => assert.equal(result(reserve(1, 30, change)).ok, false));
  for (const amount of [-1, 0, 101, 1000000001]) check('invalid or over-cap reservation denied', () => assert.equal(result(reserve(1, amount)).ok, false));
  for (const id of ids) {
    reset(); query(`update public.learnable_ai_budgets set cap_microusd=20 where id='${id}'`);
    check('each budget scope independently caps spending', () => assert.equal(result(reserve(1, 21)).reason, 'budget'));
  }
  reset();
  const concurrent = await Promise.all([1, 2].map(n => run('docker', command(db, `set role service_role; ${reserve(n, 60)}`))));
  check('concurrent callers cannot cross shared cap', () => {
    assert.equal(concurrent.filter(r => JSON.parse(r.stdout.trim().split('\n').at(-1)).ok).length, 1);
    assert.equal(query('select min(committed_microusd),max(committed_microusd) from public.learnable_ai_budgets'), '60|60');
  });
  reset();
  const allowed = await Promise.all([1, 2].map(n => run('docker', command(db, `set role service_role; ${reserve(n, 40)}`))));
  check('parallel requests whose reservations fit both proceed', () => assert.equal(allowed.filter(r => JSON.parse(r.stdout.trim().split('\n').at(-1)).ok).length, 2));
  check('settlement releases only the unused portion across all scopes', () => {
    assert.equal(result(settle(1)).ok, true);
    assert.equal(query('select min(committed_microusd),max(committed_microusd) from public.learnable_ai_budgets'), '50|50');
  });
  check('duplicate settlement cannot refund twice', () => { assert.equal(result(settle(1)).ok, true); assert.equal(query('select min(committed_microusd) from public.learnable_ai_budgets'), '50'); });
  check('changed cost or receipt is not a valid replay', () => {
    assert.equal(result(settle(1, 0)).ok, false); assert.equal(result(settle(1, 10, { generation: 'gen-other' })).ok, false);
  });
  check('settlement cannot exceed reservation', () => assert.equal(result(settle(2, 41)).ok, false));
  check('one provider receipt cannot settle two different paid requests', () => assert.equal(result(settle(2, 10, { generation: 'gen-local-1' })).ok, false));
  check('another owner cannot settle', () => assert.equal(result(settle(2, 10, { owner: other })).ok, false));
  check('same operation cannot be bought again under a new request ID', () => assert.equal(result(reserve(3, 10, { operation: 'lesson-1' })).reason, 'duplicate'));
  reset(); result(reserve(1)); query(`update public.generation_jobs set run_id='${nextLease}'`);
  check('lost prior-runner outcome blocks Resume spending', () => assert.equal(result(reserve(2, 30, { run: nextLease })).reason, 'pending'));
  check('late original settlement is permitted without active lease', () => assert.equal(result(settle(1)).ok, true));
  check('new runner can proceed after known settlement', () => assert.equal(result(reserve(2, 30, { run: nextLease })).ok, true));
  reset(); result(reserve(1));
  query(`select public.halt_learnable_ai_spend('${owner}','${job}','${lease}','${rid(1)}')`);
  check('uncertainty halts all bound scopes while holding funds', () => assert.equal(query('select count(*) from public.learnable_ai_budgets where halted and committed_microusd=30'), '3'));
  result(settle(1)); check('settlement does not silently reopen a halted allowance', () => assert.equal(result(reserve(2)).ok, false));
  reset(); query(`update public.learnable_ai_budgets set owner_id='${other}' where id='${ids[1]}'`);
  check('cross-owner budget attachment denied', () => assert.equal(result(reserve(1)).ok, false));
  reset({ budgetIds: [ids[0], ids[0], ids[2]] });
  check('omitting owner budget via duplicate ID denied', () => assert.equal(result(reserve(1)).ok, false));
  reset(); query(`update public.learnable_ai_budgets set expires_at=now()-interval '1 second' where id='${ids[2]}'`);
  check('expired allowance denied', () => assert.equal(result(reserve(1)).ok, false));
  reset();
  for (const patch of ["ai_policy=null", "ai_budget_ids=null", `owner_id='${other}'`])
    check('saved policy, budgets and platform owner cannot change', () => assert.throws(() => query(`update public.generation_jobs set ${patch}`)));
  reset({ expiredPolicy: true });
  check('expired saved price policy denies dispatch', () => assert.equal(result(reserve(1)).reason, 'policy'));
  reset(); query(`update public.generation_jobs set lease_expires_at=now()-interval '1 second'`);
  check('expired runner lease denies dispatch', () => assert.equal(result(reserve(1)).reason, 'job'));
  reset(); query(`update public.generation_jobs set status='cancelled'`);
  check('cancelled job cannot spend', () => assert.equal(result(reserve(1)).reason, 'job'));
  reset(); query(`update public.learnable_ai_budgets set max_calls=1`); result(reserve(1)); result(settle(1, 0));
  check('call cap is retained even after zero-cost settlement', () => assert.equal(result(reserve(2)).reason, 'budget'));
  console.log(JSON.stringify({ status: 'passed', checks, database: 'disposable local PostgreSQL', providerCalls: 0, hostedChanges: 0 }));
} finally {
  assert.match(db, /^learnable_ai_spend_test_\d+$/);
  execFileSync('docker', command('postgres', `drop database ${db}`), { stdio: 'pipe' });
}
