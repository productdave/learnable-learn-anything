// Local captured SMTP only. Never sends to a real recipient, generates an admin
// link, changes SMTP configuration, or prints a token-bearing callback URL.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync, mkdirSync, mkdtempSync, chmodSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createClient } from '@supabase/supabase-js';
import { loadPreviewConfig } from './dev-setup-server.mjs';

const config = await loadPreviewConfig(resolve('.env.preview.local'));
assert.equal(config.mode, 'local');
assert.equal(config.url, 'http://127.0.0.1:54321');
const auth = JSON.parse(execFileSync('docker', ['inspect', 'supabase_auth_learnable-setup-local'], { encoding: 'utf8' }))[0];
assert.ok(auth.Config.Env.includes('GOTRUE_SMTP_HOST=supabase_inbucket_learnable-setup-local'));
assert.ok(auth.Config.Env.includes('GOTRUE_SMTP_PORT=1025'));
assert.ok(auth.Config.Env.includes('GOTRUE_MAILER_AUTOCONFIRM=false'));
const browserConfig = await (await fetch('http://127.0.0.1:4173/js/config.js')).text();
assert.ok(browserConfig.includes(JSON.stringify(config.url)) && browserConfig.includes(JSON.stringify(config.publicKey)));
const client = createClient(config.url, config.secretKey, { auth: { persistSession: false, autoRefreshToken: false } });
const base = resolve('output/playwright');
const action = process.argv[2];
const write = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2), { flag: 'wx', mode: 0o600 });
async function messages(email) {
  const r = await fetch('http://127.0.0.1:54324/api/v1/search?query=' + encodeURIComponent('to:' + email));
  assert.ok(r.ok); const data = await r.json();
  return data.messages.filter(m => m.To.some(to => to.Address === email));
}
async function ownedUser(email) {
  for (let page = 1; page <= 100; page++) {
    const result = await client.auth.admin.listUsers({ page, perPage: 100 });
    assert.ok(!result.error);
    const match = result.data.users.find(u => u.email === email);
    if (match) return match;
    if (result.data.users.length < 100) return null;
  }
  throw Error('User listing exceeded bounded pages');
}
if (action === 'prepare') {
  const draft = process.argv[3]; assert.match(draft || '', /^setup-[0-9a-f-]{36}$/);
  mkdirSync(base, { recursive: true });
  const dir = mkdtempSync(join(base, 'local-email-')); chmodSync(dir, 0o700);
  const email = 'learnable-mail-' + randomUUID() + '@example.test';
  assert.equal((await messages(email)).length, 0); assert.equal(await ownedUser(email), null);
  write(join(dir, 'fixture.json'), { email, draft, createdAt: new Date().toISOString() });
  console.log(JSON.stringify({ directory: dir, email, localCaptureOnly: true }));
} else {
  const dir = resolve(process.argv[3] || 'missing');
  assert.ok(dir.startsWith(base + '/local-email-') && !dir.slice(base.length + 1).includes('/'));
  const f = JSON.parse(readFileSync(join(dir, 'fixture.json')));
  assert.match(f.email, /^learnable-mail-[0-9a-f-]{36}@example\.test$/);
  assert.match(f.draft, /^setup-[0-9a-f-]{36}$/);
  if (action === 'capture') {
    const found = await messages(f.email); assert.equal(found.length, 1);
    const r = await fetch('http://127.0.0.1:54324/api/v1/message/' + encodeURIComponent(found[0].ID));
    assert.ok(r.ok); const message = await r.json();
    assert.ok(message.To.some(to => to.Address === f.email));
    const links = [...message.HTML.matchAll(/href=["']([^"']+)["']/g)].map(m => m[1].replaceAll('&amp;', '&'));
    const link = links.find(value => value.startsWith(config.url + '/auth/v1/verify?'));
    assert.ok(link, 'Captured SMTP message contains a real verification link');
    const url = new URL(link), redirect = new URL(url.searchParams.get('redirect_to'));
    assert.equal(redirect.origin, 'http://127.0.0.1:4173');
    assert.equal(redirect.searchParams.get('draft'), f.draft);
    const user = await ownedUser(f.email); assert.ok(user && !user.email_confirmed_at);
    assert.ok(Date.parse(user.created_at) >= Date.parse(f.createdAt));
    write(join(dir, 'private-link.json'), { actionLink: link, messageId: found[0].ID, owner: user.id });
    const code = `async page => {
      await page.goto(${JSON.stringify(link)});
      await page.waitForURL(url => url.origin === 'http://127.0.0.1:4173' && !url.hash, {timeout:30000});
      await page.getByRole('heading', {name:'Review your course setup',exact:true}).waitFor();
      const state = await page.evaluate(async () => {
        const auth = await import('/js/auth.js?v=31');
        return {signedIn:auth.getUser()?.id === ${JSON.stringify(user.id)}, draft:new URL(location.href).searchParams.get('draft'), step:new URL(location.href).searchParams.get('step'), tokenCleared:!location.hash};
      });
      if (!state.signedIn || state.draft !== ${JSON.stringify(f.draft)} || state.step !== 'review' || !state.tokenCleared) throw Error('Email return mismatch');
      if (!await page.getByRole('heading',{name:'Dummy email delivery QA',exact:true}).isVisible()) throw Error('Topic missing');
      if (!await page.getByText('1 note · 0 links · 0 files',{exact:true}).isVisible()) throw Error('Note missing');
      await page.screenshot({path:${JSON.stringify(join(dir, 'returned-review.png'))}});
      return {emailCallbackPassed:true,reviewReturned:true,topicPreserved:true,notePreserved:true,tokenCleared:true};
    }`;
    writeFileSync(join(dir, 'private-visit.js'), code, { flag: 'wx', mode: 0o600 });
    write(join(dir, 'capture-receipt.json'), { at:new Date().toISOString(), localSMTP:true, matchingMessages:1, correctRecipient:true, realVerificationLink:true, correctDraftReturn:true, unconfirmedBeforeLink:true, externalDelivery:false });
    console.log('Captured one owned local SMTP message; recipient and callback verified. Link not displayed.');
  } else if (action === 'visit' || action === 'verify-return') {
    try {
      let filename = join(dir, 'private-visit.js');
      if (action === 'verify-return') {
        // Recheck the already-returned page; never consume the same link twice.
        filename = join(dir, 'private-verify-return.js');
        writeFileSync(filename, readFileSync(join(dir, 'private-visit.js'), 'utf8').replace(/^\s*await page\.goto\([^\n]+\);\n/m, '\n'), { flag:'wx', mode:0o600 });
      }
      const output = execFileSync('/Users/davidwang/.codex/skills/playwright/scripts/playwright_cli.sh', ['-s=learnable-local-mail', 'run-code', '--filename', filename], { encoding:'utf8', env:{...process.env,npm_config_offline:'true'}, stdio:['ignore','pipe','pipe'] });
      const result = JSON.parse(output.split('### Result')[1]?.split('### Ran')[0].trim());
      assert.equal(result.emailCallbackPassed, true); assert.ok(!output.includes('### Error'));
      write(join(dir, 'callback-receipt.json'), { at:new Date().toISOString(), ...result, currentPageRechecked:action==='verify-return' });
      console.log('Actual captured email link signed in and returned to the preserved Review step.');
    } catch { throw Error('Email callback verification failed; inspect the owned browser without printing token-bearing URLs'); }
  } else if (['inspect-before-save','inspect-after-save','cleanup'].includes(action)) {
    const privateState = JSON.parse(readFileSync(join(dir, 'private-link.json')));
    const user = await ownedUser(f.email); assert.equal(user?.id, privateState.owner); assert.ok(user.email_confirmed_at);
    const setups = await client.from('course_setups').select('id,revision,payload').eq('owner_id', user.id); assert.ok(!setups.error);
    const jobs = await client.from('generation_jobs').select('id').eq('owner_id', user.id); assert.ok(!jobs.error); assert.equal(jobs.data.length, 0);
    const courses = await client.from('courses').select('id').eq('owner_id', user.id); assert.ok(!courses.error); assert.equal(courses.data.length, 0);
    if (action === 'inspect-before-save') assert.equal(setups.data.length, 0, 'Email callback alone does not save or generate');
    else {
      assert.equal(setups.data.length, 1); const row = setups.data[0];
      assert.equal(row.id, f.draft); assert.equal(row.revision, 1);
      assert.equal(row.payload.brief.topic, 'Dummy email delivery QA');
      assert.equal(row.payload.brief.audience, 'A disposable local test learner');
      assert.equal(row.payload.sources.notes[0].text, 'Local captured email must preserve this transcript exactly.');
      assert.equal(row.payload.sources.files.length, 0);
    }
    if (action === 'cleanup') {
      const found = await messages(f.email); assert.equal(found.length, 1); assert.equal(found[0].ID, privateState.messageId);
      const removed = await client.auth.admin.deleteUser(user.id); assert.ok(!removed.error); assert.equal(await ownedUser(f.email), null);
      const remaining = await client.from('course_setups').select('id').eq('owner_id', user.id); assert.ok(!remaining.error); assert.equal(remaining.data.length, 0);
      const deleted = await fetch('http://127.0.0.1:54324/api/v1/messages', { method:'DELETE',headers:{'Content-Type':'application/json'},body:JSON.stringify({IDs:[privateState.messageId]}) });
      assert.ok(deleted.ok); assert.equal((await messages(f.email)).length, 0);
    }
    const receipt = { at:new Date().toISOString(), action, emailConfirmed:true, savedSetups:action==='cleanup'?0:setups.data.length, jobs:0, courses:0, exactInputsPreserved:action!=='inspect-before-save', ownedFixtureCleaned:action==='cleanup' };
    write(join(dir, action + '-receipt.json'), receipt); console.log(JSON.stringify(receipt));
  } else throw Error('Unknown local email QA action');
}
