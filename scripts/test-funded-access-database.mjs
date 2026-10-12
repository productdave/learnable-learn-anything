// Disposable database in the existing loopback-only Learnable Supabase container.
// No shared application tables, hosted connections or provider calls.
import assert from 'node:assert/strict';
import { execFileSync, execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync } from 'node:fs';
const run=promisify(execFile), container='supabase_db_learnable-setup-local';
const db=`learnable_funding_test_${Date.now()}`;
const args=(database,sql)=>['exec','-i',container,'psql','-U','postgres','-d',database,'-v','ON_ERROR_STOP=1','-At','-c',sql];
const query=sql=>execFileSync('docker',args(db,sql),{encoding:'utf8',stdio:['ignore','pipe','pipe']}).trim();
const a='11111111-1111-4111-8111-111111111111',b='22222222-2222-4222-8222-222222222222', c='33333333-3333-4333-8333-333333333333';
const key=n=>`00000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const grant=(n,credits=500,owner=a)=>`select public.grant_learnable_credits('${owner}','${key(n)}',${credits},'Local complimentary QA')`;
const auth=(owner,sql)=>`set role authenticated; set request.jwt.claim.sub='${owner}'; ${sql}`;
const projection=owner=>`select public.learnable_account_access('${owner}')`;
let checks=0;const check=(label,fn)=>{fn();checks++;};
execFileSync('docker',args('postgres',`create database ${db}`),{stdio:'pipe'});
try {
 query(`create schema auth; create table auth.users(id uuid primary key); create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid $$; grant usage on schema auth to authenticated; insert into auth.users values('${a}'),('${b}'),('${c}')`);
 query(readFileSync(new URL('../db/26-funded-account-access.sql',import.meta.url),'utf8'));
 check('no implicit invitations or grants',()=>assert.equal(query('select (select count(*) from public.learnable_funding_accounts),(select count(*) from public.learnable_credit_grants)'),'0|0'));
 for(const role of ['anon','authenticated','service_role'])check(role+' cannot mint or change credits/enrollment',()=>assert.equal(query(`select has_table_privilege('${role}','public.learnable_funding_accounts','insert'),has_table_privilege('${role}','public.learnable_funding_accounts','update'),has_table_privilege('${role}','public.learnable_credit_grants','insert'),has_table_privilege('${role}','public.learnable_credit_grants','update'),has_table_privilege('${role}','public.learnable_credit_grants','delete'),has_function_privilege('${role}','public.grant_learnable_credits(uuid,uuid,integer,text)','execute')`),'f|f|f|f|f|f'));
 check('anonymous cannot read private account',()=>assert.throws(()=>query(`set role anon; ${projection(a)}`)));
 query(`insert into public.learnable_funding_accounts(owner_id,mode) values('${a}','platform'),('${b}','platform'),('${c}','legacy')`);
 check('enrolled zero grant is explicit zero',()=>assert.equal(JSON.parse(query(projection(a))).granted,0));
 check('legacy grant refused',()=>assert.throws(()=>query(grant(9,10,c))));
 for(const credits of [-1,0,1000001])check('invalid amount '+credits,()=>assert.throws(()=>query(grant(8,credits))));
 check('missing reason refused',()=>assert.throws(()=>query(`select public.grant_learnable_credits('${a}','${key(8)}',1,'')`)));
 const concurrent=await Promise.all([1,2].map(()=>run('docker',args(db,grant(1)))));
 check('concurrent same grant counts once',()=>{assert.equal(concurrent.length,2);assert.equal(JSON.parse(query(projection(a))).granted,500);});
 check('exact replay is idempotent',()=>{query(grant(1));assert.equal(JSON.parse(query(projection(a))).granted,500);});
 check('changed replay fails',()=>assert.throws(()=>query(grant(1,100))));
 check('another owner cannot claim same grant key',()=>assert.throws(()=>query(grant(1,500,b))));
 query(grant(2,70,b));
 check('authenticated owner can read own balance',()=>assert.equal(JSON.parse(query(auth(a,projection(a))).split('\n').at(-1)).granted,500));
 check('cross-owner RPC returns no data',()=>assert.equal(query(auth(a,projection(b))).split('\n').filter(x=>x!=='SET').join(''),''));
 check('cross-owner table read returns no data',()=>assert.equal(query(auth(a,'select count(*) from public.learnable_credit_grants')).split('\n').at(-1),'1'));
 check('second owner gets only own balance',()=>assert.equal(JSON.parse(query(auth(b,projection(b))).split('\n').at(-1)).granted,70));
 check('runtime has read-only projection',()=>assert.equal(JSON.parse(query(`set role service_role; ${projection(a)}`).split('\n').at(-1)).granted,500));
 query(`insert into public.learnable_credit_grants select gen_random_uuid(),'${a}',1,'Row-cap QA',now() from generate_series(1,1001)`);
 check('aggregation does not truncate at REST row cap',()=>assert.equal(JSON.parse(query(projection(a))).granted,1501));
 check('missing owner FK prevents orphan balances',()=>assert.throws(()=>query(`insert into public.learnable_funding_accounts(owner_id,mode) values('${key(999)}','platform')`)));
 check('grant delete denied to authenticated owner',()=>assert.throws(()=>query(auth(a,'delete from public.learnable_credit_grants'))));
 console.log(JSON.stringify({status:'passed',checks,database:'disposable local PostgreSQL',authentication:'RLS subject fixtures; no JWT in this test',providerCalls:0,hostedChanges:0}));
}finally{execFileSync('docker',args('postgres',`drop database ${db} with (force)`),{stdio:'pipe'});}
