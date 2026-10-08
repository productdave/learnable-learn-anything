// Disposable real Supabase Auth verification, without sending an email. Tokens
// stay in private generated output and are never printed or passed as CLI args.
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, mkdtempSync, chmodSync, mkdirSync } from 'node:fs';
import { join, resolve, basename } from 'node:path';
import { randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { sealProviderKey } from '../web/api/_lib/provider-vault.mjs';
const dir=resolve('output/staging/2026-09-18');
const state=JSON.parse(readFileSync(join(dir,'state.json'))),secret=JSON.parse(readFileSync(join(dir,'secrets.json')));
assert.equal(state.ref,'dmnwkrybgggbpqpetuub');assert.equal(state.supabaseUrl,'https://dmnwkrybgggbpqpetuub.supabase.co');
const client=createClient(state.supabaseUrl,secret.secretKey,{auth:{persistSession:false,autoRefreshToken:false},global:{fetch:(input,options={})=>{
  const url=new URL(typeof input==='string'?input:input.url||input.href);assert.equal(url.origin,state.supabaseUrl);
  return fetch(input,{...options,redirect:'error',signal:AbortSignal.timeout(30000)});
}}});
const action=process.argv[2];
if(action==='prepare'){
  const draft=process.argv[3];assert.match(draft||'',/^setup-[0-9a-f-]{36}$/);
  const expectedFiles=Number(process.argv[4]||0);assert.ok(Number.isInteger(expectedFiles)&&expectedFiles>=0&&expectedFiles<=5);
  const namespace=process.argv[5]||'workspace-account-20260919-r2';
  assert.ok(['workspace-account-20260919-r2','workspace-source-recovery-20260919'].includes(namespace));
  const users=await client.auth.admin.listUsers();assert.ok(!users.error&&users.data.users.length===0,'Needs isolated empty staging');
  const fixtureDir=mkdtempSync(join(dir,'auth-browser-'));chmodSync(fixtureDir,0o700);
  const email='auth-browser-'+randomUUID()+'@example.test';
  const created=await client.auth.admin.createUser({email,email_confirm:true});assert.ok(!created.error);
  const fixture={owner:created.data.user.id,email,draft,expectedFiles,namespace,createdAt:new Date().toISOString()};
  const path=join(fixtureDir,'fixture.json');writeFileSync(path,JSON.stringify(fixture),{flag:'wx',mode:0o600});
  const redirectTo='https://learnable-staging.vercel.app/?experience=workspace&draft='+draft+'&step=account';
  const link=await client.auth.admin.generateLink({type:'magiclink',email,options:{redirectTo}});assert.ok(!link.error);
  const url=new URL(link.data.properties.action_link);assert.equal(url.origin,state.supabaseUrl);assert.equal(url.searchParams.get('redirect_to'),redirectTo);
  writeFileSync(path,JSON.stringify({...fixture,actionLink:url.href}),{mode:0o600});
  console.log(JSON.stringify({fixture:path,emailSent:false,providerConnected:false}));
}else if(action==='visit'||action==='replay'||action==='restore'||action==='visit-secondary'||action==='restore-secondary'||action==='restore-secondary-failure'){
  const path=resolve(process.argv[3]||'missing');assert.ok(path.startsWith(dir+'/auth-browser-')&&path.endsWith('/fixture.json'));
  const fixture=JSON.parse(readFileSync(path));assert.equal(new URL(fixture.actionLink).origin,state.supabaseUrl);
  const namespace=fixture.namespace||'workspace-account-20260919-r2';
  assert.ok(['workspace-account-20260919-r2','workspace-source-recovery-20260919'].includes(namespace));
  let actionLink=fixture.actionLink;
  if(action==='restore'||action==='restore-secondary'||action==='restore-secondary-failure') {
    assert.match(fixture.email,/^auth-browser-[0-9a-f-]+@example\.test$/);
    assert.match(fixture.draft,/^setup-[0-9a-f-]{36}$/);
    const user=await client.auth.admin.getUserById(fixture.owner);
    assert.ok(!user.error&&user.data.user.email===fixture.email,'Only renew the owned QA account link');
    const redirectTo='https://learnable-staging.vercel.app/?experience=workspace&draft='+fixture.draft+'&step=account';
    const link=await client.auth.admin.generateLink({type:'magiclink',email:fixture.email,options:{redirectTo}});
    assert.ok(!link.error);
    const url=new URL(link.data.properties.action_link);
    assert.equal(url.origin,state.supabaseUrl);assert.equal(url.searchParams.get('redirect_to'),redirectTo);
    actionLink=url.href;
    // Preserve the original consumed link and its replay evidence.
    writeFileSync(join(resolve(path,'..'),action+'-link.json'),JSON.stringify({actionLink}),{flag:'wx',mode:0o600});
  }
  const images='output/playwright/hosted-account-'+basename(resolve(path,'..'));mkdirSync(images,{recursive:true});
  const code=action==='visit-secondary'?`async page => {
    await page.goto(${JSON.stringify(actionLink)});
    await page.waitForURL(url => url.origin === 'https://learnable-staging.vercel.app' && !url.hash, {timeout:30000});
    await page.waitForFunction(async owner => {
      const auth = await import(${JSON.stringify('/js-'+namespace+'/auth.js?v=31')});
      return auth.getUser()?.id === owner;
    }, ${JSON.stringify(fixture.owner)});
    await page.getByRole('heading',{name:'Setup unavailable',exact:true}).waitFor();
    await page.screenshot({path:${JSON.stringify(images+'/secondary-no-guest-setup-390.png')}});
    return {signedInOwnedAccount:true,guestDraftNotImported:true,originalBrowserGuidanceVisible:await page.getByText('This setup may belong to another account or browser. Return to the browser where you started and use Create course to sign in again. Other guest setups are never imported automatically.',{exact:true}).isVisible()};
  }`:action==='replay'?`async page => {
    await page.goto(${JSON.stringify(actionLink)});
    await page.getByText('That sign-in link could not be verified. It may have expired or already been used. Your device draft has not been deleted; request a new link.',{exact:true}).waitFor({timeout:30000});
    await page.screenshot({path:${JSON.stringify(images+'/auth-used-link-390.png')}});
    return {usedLinkRejected:true,recoveryVisible:true};
  }`:`async page => {
    ${action==='restore-secondary-failure'?`await page.route('https://dmnwkrybgggbpqpetuub.supabase.co/storage/v1/object/**/setup-sources/**',route=>route.fulfill({status:503,contentType:'application/json',body:'{"message":"Injected disposable QA download outage"}'}));`:''}
    await page.goto(${JSON.stringify(actionLink)});
    await page.waitForURL(url => url.origin === 'https://learnable-staging.vercel.app' && url.searchParams.get('step') === 'review' && !url.hash, {timeout:30000});
    await page.getByRole('heading', {name:'Review your course setup',exact:true}).waitFor();
    ${action==='restore-secondary-failure'?`await page.getByText('Some account originals couldn’t be downloaded. Their filenames are preserved. Reattach them or retry downloading from your account.',{exact:true}).waitFor();`:''}
    await page.screenshot({path:${JSON.stringify(images+'/'+action+'-390.png')}});
    return {callbackReturnedToReview:true, topicVisible:await page.getByRole('heading',{name:'Photography staging QA',exact:true}).isVisible(), materialSummary:await page.getByText(${JSON.stringify('1 note · 1 link · '+(fixture.expectedFiles||0)+' '+(fixture.expectedFiles===1?'file':'files'))},{exact:true}).isVisible()};
  }`;
  const codePath=join(resolve(path,'..'),action+'.js');writeFileSync(codePath,code,{flag:'wx',mode:0o600});
  try {
    const session=action==='visit-secondary'||action==='restore-secondary'||action==='restore-secondary-failure'?'learnable-auth-secondary':'learnable-hosted-acceptance';
    const out=execFileSync('/Users/davidwang/.codex/skills/playwright/scripts/playwright_cli.sh',['-s='+session,'run-code','--filename',codePath],{encoding:'utf8',stdio:['ignore','pipe','pipe'],timeout:45000});
    const match=out.match(/### Result\s*\n(\{[^\n]+\})/);assert.ok(match,'No safe callback result.');
    const report=JSON.parse(match[1]);assert.ok(action==='replay'?report.usedLinkRejected&&report.recoveryVisible:action==='visit-secondary'?report.signedInOwnedAccount&&report.guestDraftNotImported&&report.originalBrowserGuidanceVisible:report.callbackReturnedToReview&&report.topicVisible&&report.materialSummary);
    writeFileSync(join(resolve(path,'..'),action+'-callback-receipt.json'),JSON.stringify({...report,emailSent:false},null,2),{flag:'wx'});
    console.log(JSON.stringify(report));
  }catch{throw Error('Auth callback check did not confirm; inspect the browser without printing token-bearing URLs.');}
}else if(action==='inspect'||action==='cleanup'||action==='seed-connection'){
  const path=resolve(process.argv[3]||'missing');assert.ok(path.startsWith(dir+'/auth-browser-')&&path.endsWith('/fixture.json'));
  const fixture=JSON.parse(readFileSync(path));assert.match(fixture.email,/^auth-browser-[0-9a-f-]+@example\.test$/);
  const user=await client.auth.admin.getUserById(fixture.owner);assert.ok(!user.error&&user.data.user.email===fixture.email,'Refuse touching an unrelated user');
  if(action==='seed-connection') {
    const prior=await client.from('provider_connections').select('provider').eq('owner_id',fixture.owner);assert.ok(!prior.error&&prior.data.length===0,'Never overwrite an existing connection');
    process.env.LEARNABLE_PROVIDER_VAULT_KEY=secret.vaultKey;
    const encrypted_key=sealProviderKey('non-billable-account-browser-fixture',fixture.owner);
    const inserted=await client.from('provider_connections').insert({owner_id:fixture.owner,provider:'anthropic',encrypted_key});assert.ok(!inserted.error);
    writeFileSync(join(resolve(path,'..'),'synthetic-connection-receipt-'+Date.now()+'.json'),JSON.stringify({at:new Date().toISOString(),synthetic:true,providerCalls:0}),{flag:'wx'});
    console.log(JSON.stringify({syntheticConnectionSeeded:true,providerCalls:0}));
    process.exit(0);
  }
  const setups=await client.from('course_setups').select('id,revision,payload').eq('owner_id',fixture.owner);assert.ok(!setups.error);
  const jobs=await client.from('generation_jobs').select('id').eq('owner_id',fixture.owner);assert.ok(!jobs.error);
  const courses=await client.from('user_courses').select('id').eq('owner_id',fixture.owner);assert.ok(!courses.error);
  const summary={at:new Date().toISOString(),setups:setups.data.map(r=>({id:r.id,revision:r.revision,topic:r.payload?.brief?.topic,notes:r.payload?.sources?.notes?.length,links:r.payload?.sources?.links?.length,files:r.payload?.sources?.files?.length,components:r.payload?.components})),jobs:jobs.data.length,courses:courses.data.length,emailSent:false};
  assert.equal(jobs.data.length,0,'Unexpected generation activity; inspect before cleanup');assert.equal(courses.data.length,0);
  if(action==='cleanup'){
    // Auth deletion cannot remove a user who still owns Storage objects. Remove
    // only exact manifest paths from this verified disposable fixture first.
    const paths=[];
    for(const row of setups.data){
      assert.equal(row.id,fixture.draft,'Unexpected fixture setup; inspect before cleanup');
      for(const file of row.payload?.sources?.files||[]){
        assert.match(file.id,/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/);assert.match(file.sha256,/^[a-f0-9]{64}$/);
        paths.push(`${fixture.owner}/${row.id}/${file.id}/${file.sha256}`);
      }
    }
    if(paths.length)assert.ok(!(await client.storage.from('setup-sources').remove(paths)).error);
    assert.ok(!(await client.auth.admin.deleteUser(fixture.owner)).error);summary.cleanedUp=true;summary.originalsRemoved=paths.length;
  }
  writeFileSync(join(resolve(path,'..'),action+'-receipt-'+Date.now()+'.json'),JSON.stringify(summary,null,2),{flag:'wx'});
  console.log(JSON.stringify(summary));
}else throw Error('Choose prepare <draft-id> [expected-files], visit/visit-secondary/replay/restore/restore-secondary/restore-secondary-failure/inspect/seed-connection/cleanup <fixture-path>.');
