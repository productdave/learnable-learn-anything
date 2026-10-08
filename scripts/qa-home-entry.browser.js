// Playwright CLI harness: actual app/IndexedDB, no sign-in email or paid generation.
(async page => {
  const checks = [], errors = [], writes = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/|\/auth\/v1\/otp/.test(request.url())) writes.push(request.url()); });
  const home = 'http://127.0.0.1:4173/?experience=workspace&filter=community';
  const topic = `Home entry QA ${Date.now()}`;
  const input = tab => tab.getByLabel('What do you want to learn or teach?');
  const committed = (tab, value) => tab.waitForFunction(async text => {
    const { createDraftStore } = await import('/js/draft-store.js?v=2');
    return (await createDraftStore().list()).drafts.some(d => d.step === 'home' && d.brief.topic === text);
  }, value);
  await page.goto(home);
  await input(page).waitFor();
  check(!(await page.locator('[data-draft-recovery]').isVisible()), 'normal Home hides recovery controls');
  check(!(await page.locator('.home-draft-details').isVisible()), 'normal Home has no backup-management panel');
  check(!/Download idea|About local saving|Account backup|Local setup/.test(await page.locator('body').innerText()), 'normal Home has no retired backup terminology');
  await input(page).fill(topic); await committed(page, topic);
  check(await input(page).evaluate(el => document.activeElement === el), 'quiet persistence preserves typing focus');
  check(!/saving|saved on|backup/i.test(await page.locator('[data-draft-status]').innerText()), 'normal persistence does not become a product step');
  await page.reload(); await page.locator('[data-draft-status]').filter({ hasText: 'Your unfinished idea is here' }).waitFor();
  check(await input(page).inputValue() === topic, 'reload preserves the unfinished idea');
  await page.getByRole('link', { name: 'Your Courses', exact: true }).click();
  check(await input(page).inputValue() === topic, 'collection navigation preserves the idea');
  await page.getByRole('button', { name: /^Create course(?: →)?$/ }).click();
  await page.locator('[data-setup-root]').waitFor();
  check(await page.getByRole('dialog').count() === 0, 'Home Create does not gate guest setup');
  check(await page.getByLabel('What is the course about?').inputValue() === topic, 'Home input reaches Goal');
  await page.getByLabel('Who is it for?').fill('An adult beginner');
  await page.getByLabel('What should they be able to do?').fill('Practice a new skill step by step.');
  await page.getByRole('button', { name: 'Continue to Experience' }).click();
  await page.getByRole('button', { name: 'Continue to Context' }).click();
  await page.getByRole('button', { name: '+ Add a note', exact: true }).click();
  await page.getByLabel('Notes, transcript or raw text').fill('Original transcript for the Home entry acceptance test.');
  await page.getByRole('button', { name: 'Review setup' }).click();
  await page.getByRole('heading', { name: 'Review your course setup' }).waitFor();
  check(await page.getByRole('dialog').count() === 0, 'all four setup steps remain ungated');
  await page.getByRole('button', { name: /^Create course(?: →)?$/ }).click();
  const signin = page.getByRole('dialog', { name: 'Sign in to create your course' });
  await signin.waitFor();
  check((await signin.innerText()).includes(topic) && (await signin.innerText()).includes('What happens next'), 'final Create explains sign-in and retains labelled course identity');
  await page.keyboard.press('Escape');
  check(await page.getByRole('dialog').count() === 0, 'sign-in cancellation returns to Review');
  check(await page.getByRole('button', { name: /^Create course(?: →)?$/ }).evaluate(el => document.activeElement === el), 'sign-in cancellation restores Create focus');
  await page.getByRole('link', { name: 'Edit context', exact: true }).click();
  check((await page.getByLabel('Notes, transcript or raw text').inputValue()).startsWith('Original transcript'), 'source input survives the sign-in handoff');
  await page.getByRole('link', { name: 'Learnable Home' }).click();
  await page.getByRole('link', { name: 'Your Courses', exact: true }).click();
  await page.getByRole('heading', { name: 'Continue setting up', exact: true }).waitFor();
  check((await page.locator('.home-local-setups').innerText()).includes(topic), 'unfinished setup is resumable from Your Courses');
  check(!/Account backup|Local setup|Device copy/.test(await page.locator('.home-local-setups').innerText()), 'unfinished setups use course-oriented status labels');
  await page.getByRole('link', { name: 'Community Courses', exact: true }).click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
    check(await page.locator('[data-home-root]').evaluate(el => el.scrollWidth <= el.clientWidth), `Home content fits at ${width}px`);
    check(await page.getByRole('button', { name: 'Create course', exact: true }).evaluate(el => el.getBoundingClientRect().height >= 44), `Create touch target at ${width}px`);
    if (width !== 320) await page.screenshot({ path: `output/playwright/home-entry-${width}.png`, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  const quotaOn = () => page.evaluate(() => {
    window.__entryPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.transaction.db.name === 'learnable-creation-drafts') throw new DOMException('QA quota', 'QuotaExceededError');
      return window.__entryPut.apply(this, args);
    };
  });
  const quotaOff = () => page.evaluate(() => { if (window.__entryPut) { IDBObjectStore.prototype.put = window.__entryPut; delete window.__entryPut; } });
  const failedText = `${topic} latest unsaved text`;
  await quotaOn();
  try {
    await input(page).fill(failedText);
    await page.locator('[data-draft-status]').filter({ hasText: 'couldn’t preserve' }).waitFor();
    check(await input(page).inputValue() === failedText, 'quota failure preserves current text');
    check(await page.getByRole('button', { name: 'Continue setup', exact: true }).isVisible(), 'failure exposes a non-blocking continuation');
    await page.evaluate(() => {
      window.__entryURL = URL.createObjectURL;
      URL.createObjectURL = function (blob) { window.__entryDownload = blob; return window.__entryURL(blob); };
    });
    try {
      const downloading = page.waitForEvent('download');
      await page.getByRole('button', { name: 'Download a copy', exact: true }).click();
      const download = await downloading;
      check(download.suggestedFilename() === 'learnable-idea.json', 'recovery download remains available');
      check(await page.evaluate(async text => JSON.parse(await window.__entryDownload.text()).brief.topic === text, failedText), 'download contains current input, not an old snapshot');
    } finally { await page.evaluate(() => { URL.createObjectURL = window.__entryURL; delete window.__entryURL; delete window.__entryDownload; }); }
    await page.screenshot({ path: 'output/playwright/home-entry-recovery-390.png', animations: 'disabled' });
  } finally { await quotaOff(); }
  await page.getByRole('button', { name: 'Try again', exact: true }).click(); await committed(page, failedText);
  check(!(await page.locator('[data-draft-recovery]').isVisible()), 'successful retry removes recovery-only actions');
  check(await input(page).evaluate(el => document.activeElement === el), 'retry returns keyboard focus before hiding its button');
  const other = await page.context().newPage();
  try {
    await other.goto(home); await other.locator('[data-draft-status]').filter({ hasText: 'Your unfinished idea is here' }).waitFor();
    await input(page).fill(`${topic} first tab`); await committed(page, `${topic} first tab`);
    await input(other).fill(`${topic} second tab`);
    await other.getByRole('button', { name: 'Keep both ideas', exact: true }).waitFor();
    check(await input(other).inputValue() === `${topic} second tab`, 'concurrent edit does not overwrite typed text');
    await other.getByRole('button', { name: 'Keep both ideas', exact: true }).click();
    await committed(other, `${topic} second tab`); await committed(other, `${topic} first tab`);
    check(!(await other.locator('[data-draft-recovery]').isVisible()), 'conflict resolution retains both ideas and dismisses recovery');
  } finally { await other.close(); }
  await quotaOn();
  try {
    await input(page).fill(`${topic} continue despite quota`);
    await page.getByRole('button', { name: 'Continue setup', exact: true }).waitFor();
    await page.getByRole('button', { name: 'Continue setup', exact: true }).click();
    await page.locator('[data-setup-root]').waitFor();
    check(await page.getByLabel('What is the course about?').inputValue() === `${topic} continue despite quota`, 'Continue setup carries unsaved text into the real guest controller');
    check(await page.getByRole('dialog').count() === 0, 'storage failure never substitutes an early sign-in gate');
  } finally { await quotaOff(); }
  check(errors.length === 0, `no uncaught errors: ${errors.join(', ')}`);
  check(writes.length === 0, 'no email, account write or generation POST during guest flow');
  const report = { passed: checks.length, checks, errors, writes, scope: 'Real browser and IndexedDB; injected quota only. No email/provider/account mutation.' };
  await page.evaluate(value => { window.__homeEntryQA = value; }, report);
  return report;
})
