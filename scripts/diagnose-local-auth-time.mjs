// Reproduce fresh-token rejection without changing clocks or auth policy.
// Only a uniquely owned local Auth fixture is created and deleted.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig } from './dev-setup-server.mjs';

const config = await loadPreviewConfig(resolve('.env.preview.local'));
assert.equal(config.mode, 'local'); assert.equal(config.url, 'http://127.0.0.1:54321');
const admin = createClient(config.url, config.secretKey, { auth:{persistSession:false,autoRefreshToken:false} });
const client = createClient(config.url, config.publicKey, { auth:{persistSession:false,autoRefreshToken:false} });
const inspect = name => JSON.parse(execFileSync('docker', ['inspect', name], {encoding:'utf8'}))[0];
const rest = inspect('supabase_rest_learnable-setup-local');
const directory = resolve('output/diagnostics'); mkdirSync(directory, {recursive:true});
const out = mkdtempSync(join(directory, 'local-auth-time-'));
const email = 'auth-time-' + randomUUID() + '@example.test', password = randomUUID() + 'aA7!';
const report = {at:new Date().toISOString(),localOnly:true,restImage:rest.Config.Image,requests:[],cleaned:false};
let owner;
try {
  const created = await admin.auth.admin.createUser({email,password,email_confirm:true});
  assert.ok(!created.error && created.data.user); owner = created.data.user.id;
  const signed = await client.auth.signInWithPassword({email,password});
  assert.ok(!signed.error && signed.data.session);
  const token = signed.data.session.access_token;
  const claims = JSON.parse(Buffer.from(token.split('.')[1], 'base64url'));
  assert.equal(claims.sub, owner);
  report.issuedAt = claims.iat;
  for (let i = 0; i < 3; i++) {
    const before = Date.now() / 1000;
    const r = await fetch(config.url + '/rest/v1/user_state?select=state&user_id=eq.' + owner, {
      headers:{apikey:config.publicKey,Authorization:'Bearer ' + token}, signal:AbortSignal.timeout(10000)
    });
    const body = await r.json();
    assert.ok(r.ok || (r.status === 401 && body.code === 'PGRST303'), 'Unexpected response; do not infer a timing failure');
    if (r.ok) assert.deepEqual(body, []);
    report.requests.push({sequence:i+1,hostBefore:before,hostAfter:Date.now()/1000,status:r.status,code:body.code||null,message:body.message||null});
  }
  const hostBefore = Date.now()/1000;
  const database = Number(execFileSync('docker', ['exec','supabase_db_learnable-setup-local','psql','-U','postgres','-d','postgres','-tAc','select extract(epoch from clock_timestamp())'], {encoding:'utf8'}).trim());
  report.clock = {hostBefore,database,hostAfter:Date.now()/1000};
  report.freshTokenNotFuture = report.requests.every(r => report.issuedAt <= r.hostBefore);
  report.reproduced = report.requests.some(r => r.status === 401 && r.message === 'JWT issued at future');
  report.sameTokenRecovered = report.reproduced && report.requests.some(r => r.status === 200);
} finally {
  if (owner) {
    const current = await admin.auth.admin.getUserById(owner); assert.equal(current.data.user?.email,email);
    const result = await admin.auth.admin.deleteUser(owner); assert.ok(!result.error);
    const missing = await admin.auth.admin.getUserById(owner); assert.ok(!missing.data.user);
    report.cleaned = true;
  }
  writeFileSync(join(out, 'receipt.json'), JSON.stringify(report,null,2), {flag:'wx',mode:0o600});
  console.log(JSON.stringify({directory:out,...report}));
}
