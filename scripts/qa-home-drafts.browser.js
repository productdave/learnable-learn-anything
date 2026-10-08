// Historical Slice A browser harness. Its Account-at-Create assertions describe
// the pre-Slice-B boundary. Use qa-guest-setup.browser.js for the current flow;
// test-draft-foundation.mjs continues to cover the Home draft controller.
(async (page) => {
  const checks = [], errors = [], writes = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/|\/auth\/v1\/otp/.test(request.url())) writes.push(request.url()); });
  const input = page.getByRole('textbox', { name: 'What do you want to learn or teach?' });
  const saved = tab => tab.getByRole('status').filter({ hasText: 'Saved on this device' }).waitFor({ timeout: 5000 });
  await input.fill('Teach my four-year-old to swim'); await saved(page);
  check(await input.evaluate(el => el === document.activeElement), 'autosave preserves typing focus');
  await page.reload();
  await page.getByRole('status').filter({ hasText: 'Idea restored' }).waitFor();
  check(await input.inputValue() === 'Teach my four-year-old to swim', 'refresh restores Home idea');
  await page.getByRole('link', { name: 'Your Courses', exact: true }).click();
  check(await input.inputValue() === 'Teach my four-year-old to swim', 'collection navigation preserves idea');
  await page.getByLabel('Status', { exact: true }).selectOption('attention');
  check(await input.inputValue() === 'Teach my four-year-old to swim', 'status filtering preserves idea');
  await page.goBack();
  check(await input.inputValue() === 'Teach my four-year-old to swim', 'browser Back preserves idea');
  const downloadEvent = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download idea', exact: true }).click();
  const download = await downloadEvent;
  await download.saveAs('output/playwright/home-idea-backup.json');
  check(download.suggestedFilename() === 'learnable-idea.json', 'text-only backup download');

  const other = await page.context().newPage();
  try {
    await other.goto('http://127.0.0.1:4173/?experience=workspace&filter=community');
    await other.getByRole('status').filter({ hasText: 'Idea restored' }).waitFor();
    await input.fill('First tab: parent-led swimming'); await saved(page);
    const secondInput = other.getByRole('textbox', { name: 'What do you want to learn or teach?' });
    await secondInput.fill('Second tab: swimming confidence');
    await other.getByRole('status').filter({ hasText: 'changed or expired' }).waitFor();
    check(await secondInput.inputValue() === 'Second tab: swimming confidence', 'conflict preserves newer typed input');
    await other.getByRole('button', { name: 'Save mine as a separate idea' }).click(); await saved(other);
    const drafts = await page.evaluate(async () => (await (await import('/js/draft-store.js?v=1')).createDraftStore().list()).drafts);
    check(drafts.some(d => d.brief.topic === 'First tab: parent-led swimming') && drafts.some(d => d.brief.topic === 'Second tab: swimming confidence'), 'conflict resolution preserves both versions');
    await other.getByText('About local saving and saved ideas', { exact: true }).click();
    await other.getByRole('button', { name: /^Restore:/ }).first().click();
    await other.getByRole('status').filter({ hasText: 'Idea restored' }).waitFor();
    check(await secondInput.inputValue() === 'First tab: parent-led swimming', 'saved history restores actual current revision');
  } finally { await other.close(); }

  await page.evaluate(() => {
    window.__draftOriginalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) {
      if (this.transaction.db.name === 'learnable-creation-drafts') throw new DOMException('Injected QA quota', 'QuotaExceededError');
      return window.__draftOriginalPut.apply(this, args);
    };
  });
  try {
    await input.fill('Unsaved after simulated full storage');
    await page.getByRole('status').filter({ hasText: 'Not saved on this device' }).waitFor();
    check(await input.inputValue() === 'Unsaved after simulated full storage', 'quota failure preserves text');
    await page.getByRole('button', { name: 'Continue without a device backup' }).click();
    await page.getByRole('dialog', { name: 'Account', exact: true }).waitFor();
    check(true, 'explicit continue avoids a storage dead end and retains existing auth boundary');
    await page.getByRole('dialog', { name: 'Account', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  } finally {
    await page.evaluate(() => { IDBObjectStore.prototype.put = window.__draftOriginalPut; delete window.__draftOriginalPut; });
  }
  await page.getByRole('button', { name: 'Retry saving' }).click(); await saved(page);
  await page.reload();
  await page.getByRole('status').filter({ hasText: 'Idea restored' }).waitFor();
  check(await input.inputValue() === 'Unsaved after simulated full storage', 'retry commits the current text, not a stale snapshot');
  await page.getByText('About local saving and saved ideas', { exact: true }).click();
  await page.getByRole('button', { name: 'Remove this saved idea from this device' }).click();
  check(await page.getByRole('button', { name: 'Remove saved idea', exact: true }).isVisible(), 'local removal has explicit confirmation');
  await page.getByRole('button', { name: 'Keep idea', exact: true }).click();
  check(await input.inputValue() === 'Unsaved after simulated full storage', 'cancel deletion preserves idea');
  await page.getByRole('button', { name: 'Remove this saved idea from this device' }).click();
  await page.getByRole('button', { name: 'Remove saved idea', exact: true }).click();
  await page.getByRole('status').filter({ hasText: 'Saved idea removed' }).waitFor();
  check(await input.inputValue() === '', 'confirmed deletion clears only the selected Home idea');
  check(await page.getByRole('button', { name: /^Restore:/ }).count() > 0, 'other saved version remains available after removal');
  await input.fill('Teach my four-year-old to swim'); await saved(page);
  await page.getByText('About local saving and saved ideas', { exact: true }).click();
  await page.getByRole('link', { name: 'Community Courses', exact: true }).click();
  const dimensions = [];
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    const size = await page.evaluate(() => ({ overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth),
      downloadHeight: document.querySelector('[data-draft-download]').getBoundingClientRect().height,
      summaryHeight: document.querySelector('.home-draft-details summary').getBoundingClientRect().height }));
    check(size.overflow === 0 && size.downloadHeight >= 44 && size.summaryHeight >= 44, `responsive controls at ${width}px`);
    dimensions.push({ width, ...size });
    if (width === 390 || width === 1440) await page.screenshot({ path: `output/playwright/draft-foundation-${width}.png`, animations: 'disabled' });
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await page.screenshot({ path: 'output/playwright/draft-foundation-dark.png', animations: 'disabled' });
  await page.getByRole('button', { name: 'Create course', exact: true }).click();
  await page.getByRole('dialog', { name: 'Account', exact: true }).waitFor();
  check(true, 'ordinary Create still uses existing sign-in, not anonymous generation');
  await page.getByRole('dialog', { name: 'Account', exact: true }).getByRole('button', { name: 'Close', exact: true }).click();
  check(writes.length === 0, 'no authentication email or backend mutation requested');
  check(errors.length === 0, 'no page errors in normal or injected-failure flow');
  return { passed: checks.length, checks, dimensions, errors, backendWrites: writes.length };
})
