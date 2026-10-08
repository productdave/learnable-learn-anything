// Explicit isolated staging only. Does not merge/push, purchase plans, or invoke AI.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, mkdtempSync, chmodSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { assertVaultKey, repairLegacyVaultEncoding } from './packaging/staging-vault.mjs';
import { verifyGroundingArtifact } from './packaging/grounding-release.mjs';
import { verifySpendArtifact } from './packaging/staging-spend-release.mjs';
const root=resolve(new URL('..',import.meta.url).pathname),cli='/Users/davidwang/.npm-global/bin/vercel';
const projectId='prj_nphig6i4hA9E8o9Wg3nhzxyP1krB',teamId='team_ONTVy4HempTg7uINmG0C8P3N';
const stateDir=join(root,'output/staging/2026-09-18');
const sha=b=>createHash('sha256').update(b).digest('hex');
function api(path,body,method='POST') {
  try { return JSON.parse(execFileSync(cli,['api',path,...(body?['--method',method,'--input','-']:[])],
    {input:body?JSON.stringify(body):undefined,encoding:'utf8',stdio:['pipe','pipe','pipe'],timeout:60000})); }
  catch(error) {
    // Include diagnostics only after removing every submitted value; never dump
    // the request, CLI error object, or successful environment response.
    let detail=String(error.stderr||'');
    for(const entry of Array.isArray(body)?body:body?[body]:[])if(typeof entry.value==='string'&&entry.value.length>1)detail=detail.split(entry.value).join('[redacted]');
    detail=detail.replace(/sb[ps]_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_.-]+|vcp_[A-Za-z0-9_-]+/g,'[redacted]');
    throw Error('Staging Vercel API request failed: '+detail.slice(-1200));
  }
}
function target() {
  const project=api(`/v9/projects/${projectId}?teamId=${teamId}`);
  assert.equal(project.id,projectId);assert.equal(project.name,'learnable-staging');assert.equal(project.accountId,teamId);
  assert.equal(project.nodeVersion,'22.x');assert.equal(project.resourceConfig.fluid,true);
  assert.equal(api(`/v2/teams/${teamId}`).billing.plan,'hobby');
  return project;
}
const action=process.argv[2];
target();
if(action==='configure-env') {
  const state=JSON.parse(readFileSync(join(stateDir,'state.json'))),secret=JSON.parse(readFileSync(join(stateDir,'secrets.json')));
  assert.equal(state.ref,'dmnwkrybgggbpqpetuub');assert.equal(state.migrations.length,21);
  assertVaultKey(secret.vaultKey);
  const values={SUPABASE_URL:state.supabaseUrl,SUPABASE_ANON_KEY:secret.publicKey,SUPABASE_SECRET_KEY:secret.secretKey,
    LEARNABLE_PROVIDER_VAULT_KEY:secret.vaultKey,CRON_SECRET:secret.cronSecret,
    LEARNABLE_SETUP_GENERATION:'0',LEARNABLE_GPT_IMAGES:'0',LEARNABLE_IMAGE_REQUESTS:'0',LEARNABLE_CREATION_IMAGES:'0',
    LEARNABLE_SELF_PUBLISH:'0',LEARNABLE_PUBLIC_IMAGES:'0',LEARNABLE_MODERATION:'0',LEARNABLE_IMAGE_FUNDING:'creator'};
  const prior=api(`/v9/projects/${projectId}/env?teamId=${teamId}`).envs;
  assert.equal(prior.length,0,'Environment already configured; inspect metadata before changing values.');
  for(const [key,value]of Object.entries(values))assert.ok(typeof value==='string'&&value,`Missing staging value: ${key}`);
  const entries=Object.entries(values).map(([key,value])=>({key,value,type:key==='SUPABASE_URL'||value==='0'||key==='LEARNABLE_IMAGE_FUNDING'?'plain':'sensitive',target:['production','preview']}));
  // CLI 54.6.1 serializes objects, but passes a parsed root array to fetch
  // unencoded (HTTP 400 Invalid JSON). The API also accepts individual objects.
  // Never upsert: after any partial failure, inspect metadata before resuming.
  for(const entry of entries) {
    const created=api(`/v10/projects/${projectId}/env?teamId=${teamId}`,entry);
    assert.ok(!created.failed?.length,'Staging environment entry failed; inspect metadata, do not blindly overwrite.');
  }
  const verified=api(`/v9/projects/${projectId}/env?teamId=${teamId}`).envs;
  for(const entry of entries)assert.ok(verified.some(row=>row.key===entry.key&&row.type===entry.type&&['production','preview'].every(t=>row.target.includes(t))));
  const report={at:new Date().toISOString(),projectId,teamId,stagingRef:state.ref,env:verified.map(({key,type,target})=>({key,type,target})),paidFeatures:'disabled'};
  writeFileSync(join(stateDir,'vercel-env-receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({projectId,configured:verified.length,secretsLogged:false,paidFeatures:'disabled'}));
} else if(action==='repair-vault-encoding') {
  const secretPath=join(stateDir,'secrets.json'),secret=JSON.parse(readFileSync(secretPath));
  const value=repairLegacyVaultEncoding(secret.vaultKey);
  const inventory=JSON.parse(execFileSync(process.execPath,[join(root,'scripts/provision-learnable-staging.mjs'),'query',
    'select (select count(*) from public.provider_connections) as provider_rows, (select count(*) from auth.users) as auth_users'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000}));
  assert.equal(Number(inventory.rows[0].provider_rows),0,'Inspect existing connections before changing vault configuration.');
  assert.equal(Number(inventory.rows[0].auth_users),0,'Staging is no longer empty; review the repair with its users.');
  const before=api(`/v9/projects/${projectId}/env?teamId=${teamId}`).envs;
  const entries=before.filter(row=>row.key==='LEARNABLE_PROVIDER_VAULT_KEY');
  assert.equal(entries.length,1);assert.equal(entries[0].type,'sensitive');
  assert.deepEqual([...entries[0].target].sort(),['preview','production']);
  const operation=mkdtempSync(join(stateDir,'vault-repair-'));chmodSync(operation,0o700);
  writeFileSync(join(operation,'secrets-before.json'),readFileSync(secretPath),{flag:'wx',mode:0o600});
  // Patch the one identified record, preserving both targets. CLI env update
  // rejects stdin without a target; a partial-target update would split it.
  api(`/v10/projects/${projectId}/env/${entries[0].id}?teamId=${teamId}`,
    {value,type:'sensitive',target:entries[0].target},'PATCH');
  const after=api(`/v9/projects/${projectId}/env?teamId=${teamId}`).envs;
  const repaired=after.filter(row=>row.key==='LEARNABLE_PROVIDER_VAULT_KEY');
  assert.equal(repaired.length,1);assert.equal(repaired[0].type,'sensitive');assert.deepEqual([...repaired[0].target].sort(),['preview','production']);
  const metadata=rows=>rows.filter(r=>r.key!=='LEARNABLE_PROVIDER_VAULT_KEY').map(({id,key,type,target,updatedAt})=>({id,key,type,target,updatedAt})).sort((a,b)=>a.key.localeCompare(b.key));
  assert.deepEqual(metadata(after),metadata(before),'Unrelated environment entry changed.');
  secret.vaultKey=value;writeFileSync(secretPath,JSON.stringify(secret),{mode:0o600});chmodSync(secretPath,0o600);
  const report={at:new Date().toISOString(),projectId,teamId,sameKeyBytes:true,format:'hex',existingConnections:0,unrelatedEntriesPreserved:true,redeploymentRequired:true};
  writeFileSync(join(operation,'receipt.json'),JSON.stringify(report,null,2)+'\n',{flag:'wx'});
  console.log(JSON.stringify({...report,operation,secretsLogged:false}));
} else if(action==='deploy') {
  const secret=JSON.parse(readFileSync(join(stateDir,'secrets.json')));
  assertVaultKey(secret.vaultKey);
  const kit=resolve(process.argv[3]||'missing');
  assert.ok(kit.startsWith(join(root,'output/linux-staging/build-')));
  const release=JSON.parse(readFileSync(join(kit,'linux-release-receipt.json')));
  assert.equal(release.status,'linux-verified-not-deployed');assert.equal(release.platform.platform,'linux');assert.equal(release.platform.architecture,'x64');
  assert.equal(release.stagingRef,'dmnwkrybgggbpqpetuub');assert.equal(release.migrationInventory.migrations.length,21);assert.equal(release.checks,227);
  const artifact=resolve(kit,release.artifact);assert.ok(artifact.startsWith(kit+'/output/grouped-staging/package-'));
  const report=JSON.parse(readFileSync(join(artifact,'packaging-report.json'))),output=join(artifact,'.vercel/output');
  if(report.accountFrontendOverlay) {
    assert.equal(report.accountFrontendOverlay.scope.purpose,'workspace-account-connection');
    assert.equal(report.accountFrontendOverlay.sha256,sha(JSON.stringify(report.accountFrontendOverlay.scope)));
    assert.deepEqual(release.accountFrontend,JSON.parse(readFileSync(join(artifact,'account-frontend-qa.json'))));
    assert.equal(release.accountFrontend.status,'passed-packaged-account-frontend');
    assert.equal(release.accountFrontend.namespace,'js-'+(report.groundingOverlay?.namespace||report.sourceRecoveryOverlay?.scope.namespace||report.accountFrontendOverlay.scope.namespace)+'/');
    assert.deepEqual(release.documentContract,JSON.parse(readFileSync(join(artifact,'document-contract-qa.json'))));
    assert.equal(release.documentContract.status,'passed-packaged-document-contract');
    assert.equal(release.documentContract.readerLimitMs,8000);
  }
  if(report.sourceRecoveryOverlay){
    const overlay=report.sourceRecoveryOverlay;
    assert.equal(overlay.scope.purpose,'source-original-notice');
    assert.equal(overlay.scope.namespace,'workspace-source-recovery-20260919');
    assert.deepEqual(Object.keys(overlay.scope.sources),['js/course-setup.js']);
    assert.equal(overlay.sha256,sha(JSON.stringify(overlay.scope)));
    assert.deepEqual(release.sourceRecoveryOverlay,overlay);
    assert.equal(sha(readFileSync(join(output,'static','js-'+overlay.scope.namespace,'course-setup.js'))),overlay.scope.sources['js/course-setup.js']);
  }
  if(report.groundingOverlay){
    if(report.stagingSpendOverlay){
      verifySpendArtifact(kit,artifact);
      assert.deepEqual(release.stagingSpendOverlay,report.stagingSpendOverlay);
      assert.equal(release.spendInputSha256,sha(readFileSync(join(kit,'spend-input.json'))));
      assert.deepEqual(release.stagingSpendChecks,{guards:[{group:'generation',checks:11},{group:'sources',checks:11}],disabledPaidPaths:4});
      const guardInstall=JSON.parse(readFileSync(join(root,'output/diagnostics/m3-staging-safeguard-20260922/database-install.json')));
      assert.equal(guardInstall.stagingRef,'dmnwkrybgggbpqpetuub');assert.equal(guardInstall.status,'installed-no-allowance');
      assert.equal(guardInstall.migrationSha256,report.stagingSpendOverlay.sourceHashes['scripts/staging-safeguard/migration.sql']);
      const counts=JSON.parse(execFileSync(process.execPath,[join(root,'scripts/provision-learnable-staging.mjs'),'query',
        'select (select count(*) from public.learnable_staging_spend_budgets) as budgets, (select count(*) from public.learnable_staging_spend_requests) as requests'],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:60000})).rows[0];
      assert.ok(Object.values(counts).every(v=>Number(v)===0),'No allowance or provider work is authorized for this deployment');
    } else verifyGroundingArtifact(kit,artifact);
    assert.deepEqual(release.groundingOverlay,report.groundingOverlay);
    assert.equal(release.paidCalls,0);
    assert.equal(sha(readFileSync(join(kit,report.stagingSpendOverlay?'prior/grounding-input.json':'grounding-input.json'))),release.inputReceiptSha256);
    assert.deepEqual(release.groundingRegressions.map(r=>[r.group,r.name,r.checks]),[
      ['generation','test-mvp-grounding',10],['generation','test-mvp-lesson-constraints',4],
      ['sources','test-mvp-grounding',10],['sources','test-mvp-lesson-constraints',4]]);
  }
  const list=(dir,prefix='')=>readdirSync(join(dir,prefix),{withFileTypes:true}).flatMap(entry=>{
    assert.ok(!entry.isSymbolicLink());const p=prefix+entry.name;return entry.isDirectory()?list(dir,p+'/'):[p];
  }).sort();
  assert.deepEqual(list(join(output,'static')),Object.keys(report.staticFiles).sort());
  for(const[p,h]of Object.entries(report.staticFiles))assert.equal(sha(readFileSync(join(output,'static',p))),h);
  assert.equal(report.groups.length,8);
  assert.equal(readdirSync(join(output,'functions/_functions')).length,8);
  for(const group of report.groups){assert.ok(group.maxDuration<=300);const dir=join(output,`functions/_functions/${group.id}.func`);
    assert.deepEqual(list(dir),Object.keys(group.files).sort());for(const[p,h]of Object.entries(group.files))assert.equal(sha(readFileSync(join(dir,p))),h);
  }
  assert.equal(sha(readFileSync(join(output,'config.json'))),report.configSha256);
  const env=api(`/v9/projects/${projectId}/env?teamId=${teamId}`).envs;
  assert.ok(['SUPABASE_URL','SUPABASE_SECRET_KEY','CRON_SECRET'].every(key=>env.some(row=>row.key===key)));
  if(report.groundingOverlay){
    for(const key of ['LEARNABLE_SETUP_GENERATION','LEARNABLE_GPT_IMAGES','LEARNABLE_IMAGE_REQUESTS','LEARNABLE_CREATION_IMAGES','LEARNABLE_SELF_PUBLISH','LEARNABLE_PUBLIC_IMAGES','LEARNABLE_MODERATION']){
      const rows=env.filter(row=>row.key===key);assert.equal(rows.length,1);assert.equal(rows[0].value,'0',`Feature must stay disabled: ${key}`);
      assert.deepEqual([...rows[0].target].sort(),['preview','production']);
    }
    assert.equal(env.find(row=>row.key==='LEARNABLE_IMAGE_FUNDING')?.value,'creator');
    assert.equal(env.find(row=>row.key==='SUPABASE_URL')?.value,'https://dmnwkrybgggbpqpetuub.supabase.co');
    if(report.stagingSpendOverlay)assert.ok(!env.some(row=>row.key==='LEARNABLE_AI_REFINEMENT'&&row.value!=='0'),'Refinement must remain off');
  }
  const link=join(artifact,'.vercel/project.json');mkdirSync(join(artifact,'.vercel'),{recursive:true});
  const project={projectId,orgId:teamId,projectName:'learnable-staging'};
  if(existsSync(link))assert.deepEqual(JSON.parse(readFileSync(link)),project);else writeFileSync(link,JSON.stringify(project),{flag:'wx'});
  try {
    const result=JSON.parse(execFileSync(cli,['deploy','--prebuilt','--prod','--yes','--no-wait','--format','json','--scope','david-davidwangcos-projects','--project',projectId,'--cwd',artifact],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:120000,maxBuffer:8*1024*1024}));
    // "production" here is only Vercel's label for this isolated staging project.
    const receipt={at:new Date().toISOString(),projectId,teamId,artifact,result};
    writeFileSync(join(stateDir,`vercel-deploy-${Date.now()}.json`),JSON.stringify(receipt,null,2)+'\n',{flag:'wx',mode:0o600});
    const deployment=result.deployment||result;
    console.log(JSON.stringify({projectId,id:deployment.id||deployment.deploymentId,url:deployment.url,status:deployment.readyState||result.status,target:deployment.target}));
  } catch(error) {
    // CLI errors here contain no env payloads, but suppress arbitrary response data.
    const message=String(error.stderr||'').replace(/sb[ps]_[A-Za-z0-9_-]+|eyJ[A-Za-z0-9_.-]+/g,'[redacted]');
    throw Error('Staging deployment did not confirm: '+message.slice(-1800));
  }
} else throw Error('Choose configure-env, repair-vault-encoding or deploy <verified-linux-kit>.');
