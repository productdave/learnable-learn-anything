(async page => {
  const base = 'http://127.0.0.1:4173', mail = 'http://127.0.0.1:54324';
  const checks = [], pageErrors = [], writes = [], seenMail = new Set();
  const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  page.on('pageerror', error => pageErrors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST') writes.push(request.url()); });
  const email = `browser-qa-${Date.now()}@example.test`;
  async function openLocalEmail(target) {
    let selected;
    for (let attempt = 0; attempt < 30; attempt++) {
      const data = await (await target.request.get(`${mail}/api/v1/messages`)).json();
      selected = data.messages.find(item => !seenMail.has(item.ID) && item.To?.some(to => to.Address === email));
      if (selected) break;
      await target.waitForTimeout(250);
    }
    if (!selected) throw new Error('Local sign-in email did not arrive');
    seenMail.add(selected.ID);
    const message = await (await target.request.get(`${mail}/api/v1/message/${selected.ID}`)).json();
    const link = message.HTML.match(/href="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&');
    if (!link?.startsWith('http://127.0.0.1:54321/auth/v1/verify?')) throw new Error('Unexpected email verification destination');
    await target.goto(link);
    await target.getByRole('heading', { name: 'Save this setup to your account?', exact: true }).waitFor();
  }
  await page.goto(`${base}/?experience=workspace`);
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('What do you want to learn or teach?').fill('Local browser backup verification');
  await page.getByRole('button', { name: 'Create course', exact: true }).click();
  await page.getByLabel('Who is it for?').fill('A learner testing a local workspace');
  await page.getByRole('navigation', { name: 'Course setup steps' }).getByRole('link', { name: 'Context', exact: true }).click();
  await page.getByRole('button', { name: '+ Add a note', exact: true }).click();
  await page.getByLabel('Notes, transcript or raw text').fill('Synthetic raw transcript retained through real local sign-in.');
  await page.getByRole('button', { name: /^Links/ }).click();
  await page.getByRole('button', { name: '+ Add a link', exact: true }).click();
  await page.getByLabel('Website URL').fill('https://example.com/local-qa');
  await page.getByRole('button', { name: /^Files/ }).click();
  await page.getByLabel('Choose files or drop them here').setInputFiles('/Users/davidwang/Learnable/scripts/fixtures/local-backup-original.txt');
  await page.getByRole('button', { name: 'Review setup' }).click();
  await page.getByRole('button', { name: 'Save to account' }).click();
  await page.getByLabel('Email address').waitFor();
  const accountURL = page.url();
  check(await page.getByRole('dialog').count() === 0, 'guest reaches contextual sign-in without an entry modal');
  check(writes.every(url => !url.includes('/api/setups/store') && !url.includes('/storage/v1/object')), 'guest setup performs no account writes or uploads');
  await page.getByLabel('Email address').fill(email);
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await page.getByRole('heading', { name: 'Check your email', exact: true }).waitFor();
  check(await page.getByRole('button', { name: 'Resend sign-in link' }).isDisabled(), 'real local mail pending state has resend cooldown');
  const callback = await page.context().newPage();
  await openLocalEmail(callback);
  await page.getByRole('heading', { name: 'Save this setup to your account?', exact: true }).waitFor();
  check(true, 'local email confirmation signs in the original browser tab');
  check(writes.every(url => !url.includes('/api/setups/store') && !url.includes('/storage/v1/object')), 'sign-in does not implicitly claim/upload/save/generate');
  check(await page.getByText('1 note · 1 link · 1 file', { exact: true }).isVisible(), 'selected source summary survives auth');
  await page.screenshot({ path: 'output/playwright/local-backup-confirm-1440.png', fullPage: true });
  await callback.close();
  await page.getByRole('button', { name: 'Save setup to this account', exact: true }).click();
  await page.getByRole('heading', { name: 'Saved to your account', exact: true }).waitFor();
  check(true, 'real browser upload and API commit reach saved confirmation');
  const verification = await page.evaluate(async () => {
    const { sb, getUser } = await import('/js/auth.js?v=26');
    const { createSetupAccountClient } = await import('/js/setup-account-client.js?v=1');
    const id = new URLSearchParams(location.search).get('draft');
    const restored = await createSetupAccountClient().restore(getUser().id, id);
    return { missing: restored.missing, text: await restored.draft.sources.files[0].blob.text(), notes: restored.draft.sources.notes[0].text, id };
  });
  check(!verification.missing && verification.text.includes('Original local browser QA transcript.'), 'saved browser original is downloadable and hash verified');
  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'saved view has no mobile horizontal overflow');
  await page.screenshot({ path: 'output/playwright/local-backup-saved-390.png', fullPage: true });
  await page.getByRole('link', { name: 'Return to Your Courses' }).click();
  await page.getByRole('heading', { name: 'Course setups', exact: true }).waitFor();
  check(!(await page.locator('body').innerText()).includes('Couldn’t load account setup backups'), 'signed-in Home no longer shows the reported backup warning');
  await page.reload();
  await page.getByRole('heading', { name: 'Course setups', exact: true }).waitFor();
  check(await page.getByRole('heading', { name: 'Local browser backup verification', exact: true }).isVisible(), 'account setup remains after a full reload');
  await page.screenshot({ path: 'output/playwright/local-backup-home-390.png', fullPage: true });
  const fresh = await page.context().browser().newContext({ viewport: { width: 390, height: 844 } });
  try {
    const second = await fresh.newPage();
    await second.goto(accountURL);
    await second.getByLabel('Email address').fill(email);
    await second.getByRole('button', { name: 'Email me a sign-in link' }).click();
    await second.getByRole('heading', { name: 'Check your email', exact: true }).waitFor();
    await openLocalEmail(second);
    check(await second.getByText('1 note · 1 link · 1 file', { exact: true }).isVisible(), 'fresh browser restores selected account setup after real email auth');
    await second.getByRole('link', { name: 'Keep editing', exact: true }).click();
    await second.getByRole('navigation', { name: 'Course setup steps' }).getByRole('link', { name: 'Context', exact: true }).click();
    check(await second.getByLabel('Notes, transcript or raw text').inputValue() === verification.notes, 'fresh browser recovers original plain note content');
    await second.getByRole('button', { name: /^Files/ }).click();
    check(await second.getByRole('heading', { name: 'local-backup-original.txt', exact: true }).isVisible() && await second.getByRole('button', { name: 'Reattach file', exact: true }).count() === 0, 'fresh browser restores file bytes without requiring reattachment');
    await second.screenshot({ path: 'output/playwright/local-backup-restored-390.png', fullPage: true });
  } finally { await fresh.close(); }
  check(!writes.some(url => /\/api\/gen\/(start|resume|review)/.test(url)), 'no generation request was started');
  check(pageErrors.length === 0, 'no uncaught browser JavaScript errors');
  const result = { checks, pageErrors, total: checks.length, retained: 'One synthetic local browser account and its setup remain for inspection.' };
  await page.evaluate(result => { window.__localBackupQAResult = result; }, result);
  return result;
})
