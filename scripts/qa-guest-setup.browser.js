(async (page) => {
  const checks = [], errors = [], writes = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/|\/auth\/v1\/otp/.test(request.url())) writes.push(request.url()); });
  const saved = tab => tab.locator('[data-setup-save]').filter({ hasText: 'Saved on this device' }).waitFor({ timeout: 5000 });
  const step = async (name, tab = page) => { await tab.getByRole('navigation', { name: 'Course setup steps' }).getByRole('link', { name, exact: true }).click(); await tab.locator('[data-setup-root]').waitFor(); };
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:4173/?experience=workspace&filter=community');
  await page.getByLabel('What do you want to learn or teach?').fill('Teach my four-year-old to swim');
  await page.getByRole('button', { name: 'Create course', exact: true }).click();
  await page.locator('[data-setup-root]').waitFor();
  const id = await page.evaluate(() => new URL(location.href).searchParams.get('draft'));
  check(!!id && await page.getByRole('dialog').count() === 0, 'Home Create opens guest setup without sign-in');
  check(await page.getByLabel('What is the course about?').inputValue() === 'Teach my four-year-old to swim', 'Home outcome carried into setup');
  await page.getByRole('button', { name: 'Continue to Experience' }).click();
  check(await page.getByLabel('Who is it for?').evaluate(el => el === document.activeElement && el.getAttribute('aria-invalid') === 'true'), 'missing audience gets focused inline error');
  await page.getByLabel('Who is it for?').fill('Parent teaching a four-year-old beginner');
  await page.getByLabel('What should they be able to do?').fill('Build water confidence with short, supported practice.');
  await page.getByLabel('What do they already know?').fill('Comfortable splashing; no formal lessons.');
  await saved(page);
  await page.screenshot({ path: 'output/playwright/guest-setup-goal-1440.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Continue to Experience' }).click();
  await page.getByRole('radio', { name: 'Guided practice' }).check();
  await page.getByLabel('How much depth?').selectOption('Solid foundation');
  await page.getByRole('checkbox', { name: 'Checklists' }).check();
  await page.getByRole('checkbox', { name: 'Generate Course Images' }).check();
  await page.getByRole('checkbox', { name: 'Flashcards' }).uncheck();
  await page.getByRole('radio', { name: 'Make something' }).check();
  check(await page.getByRole('checkbox', { name: 'Checklists' }).isChecked(), 'format changes do not reset explicit component choices');
  await page.getByRole('radio', { name: 'Guided practice' }).check();
  await saved(page); await page.reload(); await saved(page);
  check(await page.getByRole('radio', { name: 'Guided practice' }).isChecked() && await page.getByRole('checkbox', { name: 'Generate Course Images' }).isChecked(), 'format and components survive refresh');
  check(await page.getByRole('checkbox', { name: 'Step-by-step lessons' }).isDisabled(), 'lessons always included');
  await page.screenshot({ path: 'output/playwright/guest-setup-experience-1440.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Continue to Context' }).click();
  await page.getByLabel('Anything else the course').fill('15-minute sessions, shallow pool, one parent within reach.');
  await saved(page); await page.goBack(); await saved(page);
  check(await page.getByRole('radio', { name: 'Guided practice' }).isChecked(), 'browser Back restores selected experience');
  await page.goForward(); await saved(page);
  check(await page.getByLabel('Anything else the course').inputValue() === '15-minute sessions, shallow pool, one parent within reach.', 'browser Forward restores context');
  await page.context().setOffline(true);
  try { await page.getByLabel('Anything else the course').fill('Offline edits save locally.'); await saved(page); check(true, 'loaded setup remains editable and saves while offline'); }
  finally { await page.context().setOffline(false); }
  await page.getByLabel('Anything else the course').fill('15-minute sessions, shallow pool, one parent within reach.');
  await page.getByRole('button', { name: '+ Add a note', exact: true }).click();
  const raw = '😀'.repeat(12001) + '\n  Transcript end.\n';
  await page.getByLabel('Notes, transcript or raw text').fill(raw);
  check(await page.getByLabel('Notes, transcript or raw text').inputValue() === raw, 'oversized pasted note is not truncated');
  await page.getByRole('button', { name: 'Split into smaller notes' }).click();
  const parts = await page.getByLabel('Notes, transcript or raw text').allTextContents();
  check(parts.length === 2 && parts.join('') === raw, 'split preserves all Unicode text and whitespace');
  await page.getByRole('button', { name: 'Remove note', exact: true }).last().click();
  await page.getByRole('button', { name: 'Undo removal' }).click();
  check(await page.getByLabel('Notes, transcript or raw text').count() === 2, 'source removal can be undone');
  await page.getByLabel('Notes, transcript or raw text').first().fill('Transcript: start with calm, playful practice. Stop if distressed.');
  await page.getByRole('button', { name: /^Links/ }).click();
  await page.getByRole('button', { name: '+ Add a link', exact: true }).click();
  await page.getByLabel('Website URL').fill('javascript:alert(1)');
  await page.getByRole('button', { name: 'Review setup' }).click();
  await page.waitForFunction(() => document.activeElement?.matches('[data-source-field="url"]'));
  check(await page.getByLabel('Website URL').evaluate(el => el === document.activeElement && el.getAttribute('aria-invalid') === 'true'), 'invalid link blocks review and focuses affected link');
  await page.getByLabel('Website URL').fill('https://www.redcross.org/take-a-class/swimming');
  await page.getByRole('button', { name: /^Files/ }).click();
  await page.locator('#source-files').setInputFiles(['scripts/fixtures/guest-setup/practice-notes.txt', 'scripts/fixtures/guest-setup/not-supported.csv']);
  check(await page.locator('[data-source-feedback]').textContent().then(text => text.includes('1 file added') && text.includes('Choose a PDF')), 'mixed file batch keeps accepted file and explains rejection');
  await saved(page);
  check(await page.getByText('Saved on device', { exact: true }).count() === 1, 'file status reflects committed save');
  await page.locator('#source-files').setInputFiles('scripts/fixtures/guest-setup/practice-notes.txt');
  check(await page.locator('[data-source-feedback]').textContent().then(text => text.includes('already included')), 'duplicate file warning');
  await page.reload(); await saved(page);
  await page.getByRole('button', { name: /^Files/ }).click();
  check(await page.getByText('practice-notes.txt', { exact: true }).isVisible(), 'file list survives refresh');
  const bytes = await page.evaluate(async id => (await (await import('/js/draft-store.js?v=2')).createDraftStore().load(id)).draft.sources.files[0].blob.text(), id);
  check(bytes === 'Original file text — recover me.\n', 'actual IndexedDB Blob bytes restored');
  await page.getByRole('button', { name: /^Plain notes/ }).click();
  check(await page.getByLabel('Notes, transcript or raw text').count() === 2, 'all notes restored after refresh');
  await page.getByRole('button', { name: 'Review setup' }).click(); await saved(page);
  check(await page.getByText('Your setup is complete', { exact: true }).isVisible(), 'complete setup review');
  check(await page.getByText('No course has been generated or published.', { exact: false }).isVisible(), 'preview boundary does not claim course generation');
  check(await page.getByRole('button', { name: /Generate|Publish/ }).count() === 0, 'no fake generation or publishing CTA');
  const downloadEvent = page.waitForEvent('download'); await page.getByRole('button', { name: 'Download setup' }).click();
  const download = await downloadEvent; await download.saveAs('output/playwright/guest-setup-backup.json');
  check(download.suggestedFilename() === 'learnable-setup.json', 'setup text backup download');
  await page.screenshot({ path: 'output/playwright/guest-setup-review-1440.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('link', { name: 'Return to Your Courses' }).click();
  await page.locator(`[data-home-results] a[href*="${id}"]`).waitFor();
  check(await page.getByText('Course setups', { exact: true }).isVisible(), 'guest setup discoverable under Your Courses');
  await page.getByLabel('Status', { exact: true }).selectOption('building');
  check(await page.getByRole('link', { name: /^Continue setup/ }).count() === 0, 'local setup is not labelled In Progress generation');
  await page.getByLabel('Status', { exact: true }).selectOption('all');
  await page.locator(`[data-home-results] a[href*="${id}"]`).click();
  await step('Context');
  await page.evaluate(() => {
    window.__setupOriginalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) { if (this.transaction.db.name === 'learnable-creation-drafts') throw new DOMException('QA quota', 'QuotaExceededError'); return window.__setupOriginalPut.apply(this, args); };
  });
  try {
    await page.getByLabel('Anything else the course').fill('Unsaved context must survive navigation.');
    await page.locator('[data-setup-save]').filter({ hasText: 'Not saved' }).waitFor();
    await page.getByRole('button', { name: /^Files/ }).click();
    await page.locator('#source-files').setInputFiles('scripts/fixtures/guest-setup/pending.txt');
    await page.getByText('Not saved — keep the original', { exact: true }).waitFor();
    check(true, 'failed file save is never labelled saved');
    await page.getByRole('link', { name: '← Your Courses', exact: true }).click();
    await page.locator(`[data-home-results] a[href*="${id}"]`).click();
    check(await page.getByLabel('Anything else the course').inputValue() === 'Unsaved context must survive navigation.', 'unsaved context retained through Home and reopen');
    check(await page.getByText('pending.txt', { exact: true }).isVisible(), 'unsaved original file retained in tab');
  } finally { await page.evaluate(() => { IDBObjectStore.prototype.put = window.__setupOriginalPut; delete window.__setupOriginalPut; }); }
  await page.getByRole('button', { name: 'Retry saving', exact: true }).click(); await saved(page);
  await page.reload(); await saved(page);
  check(await page.getByLabel('Anything else the course').inputValue() === 'Unsaved context must survive navigation.', 'retry persists latest setup');
  const other = await page.context().newPage();
  try {
    await other.goto(page.url()); await saved(other);
    await page.getByLabel('Anything else the course').fill('First tab saved version'); await saved(page);
    await other.getByLabel('Anything else the course').fill('Second tab preserved version');
    await other.locator('[data-setup-save]').filter({ hasText: 'Another version' }).waitFor();
    await other.getByRole('button', { name: 'Save as a separate setup' }).click(); await saved(other);
    const copyId = await other.evaluate(() => new URL(location.href).searchParams.get('draft'));
    const rows = await page.evaluate(async () => (await (await import('/js/draft-store.js?v=2')).createDraftStore().list()).drafts);
    check(copyId !== id && rows.some(d => d.id === id && d.brief.context === 'First tab saved version') && rows.some(d => d.id === copyId && d.brief.context === 'Second tab preserved version'), 'two-tab conflict recovery preserves both setups');
  } finally { await other.close(); }
  // Make a separate imported-metadata fixture, never alter the user's draft.
  const missingId = await page.evaluate(async () => {
    const store = (await import('/js/draft-store.js?v=2')).createDraftStore(); const id = `qa-missing-${crypto.randomUUID()}`;
    await store.save({ id, step: 'context', brief: { topic: 'Reattach QA', audience: 'Test audience' }, sources: { files: [{ id: 'missing-file', name: 'missing.txt', size: 8 }] } }); return id;
  });
  await page.goto(`http://127.0.0.1:4173/?experience=workspace&draft=${missingId}&step=context`); await saved(page);
  await page.getByRole('button', { name: /^Files/ }).click();
  check(await page.getByText('Reattach needed', { exact: true }).isVisible(), 'missing Blob needs reattachment');
  await page.locator('[data-reattach-input]').evaluate(input => {
    // Set the target through the real click handler; suppress only the native
    // chooser, which the CLI manages outside run-code. File bytes use the picker API.
    input.click = () => {};
    document.querySelector('[data-source-action="reattach"]').click();
  });
  await page.locator('[data-reattach-input]').setInputFiles('scripts/fixtures/guest-setup/missing.txt'); await saved(page);
  check(await page.getByText('Reattach needed', { exact: true }).count() === 0, 'reattachment replaces metadata-only row');
  await page.goto(`http://127.0.0.1:4173/?experience=workspace&draft=${id}&step=context`); await saved(page);
  const dimensions = [];
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1000 : 844 });
    for (const name of ['Goal', 'Experience', 'Context', 'Review']) {
      await step(name); await saved(page);
      const size = await page.evaluate(() => ({ overflow: Math.max(0, document.documentElement.scrollWidth - innerWidth), navHeight: document.querySelector('.setup-steps a').getBoundingClientRect().height }));
      check(size.overflow === 0 && size.navHeight >= 44, `${name} responsive and tappable at ${width}px`); dimensions.push({ width, step: name, ...size });
      if (width === 390) await page.screenshot({ path: `output/playwright/guest-setup-${name.toLowerCase()}-390.png`, fullPage: true, animations: 'disabled' });
    }
  }
  await page.setViewportSize({ width: 390, height: 844 }); await step('Context');
  await saved(page);
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await page.screenshot({ path: 'output/playwright/guest-setup-context-dark-390.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('button', { name: 'Toggle theme' }).click();
  await page.goto('http://127.0.0.1:4173/?experience=workspace&draft=qa-not-found&step=review');
  await page.getByRole('heading', { name: 'Setup unavailable' }).waitFor();
  check(true, 'unknown setup offers a recoverable missing state');
  await page.goto(`http://127.0.0.1:4173/?experience=workspace&draft=${id}&step=context`); await saved(page);
  check(writes.length === 0, 'no authentication email or backend mutation');
  check(errors.length === 0, `no page errors: ${errors.join(', ')}`);
  const summary = { passed: checks.length, checks, dimensions, errors, backendWrites: writes.length, draftId: id };
  await page.evaluate(summary => { window.__guestSetupQA = summary; }, summary);
  return summary;
})
