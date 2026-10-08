(async page => {
  const checks = [], errors = [], writes = [];
  const check = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/(gen|setups|providers)/.test(request.url())) writes.push(request.url()); });
  await page.goto('http://127.0.0.1:4173/?experience=workspace');
  await page.getByRole('heading', { name: 'What will you learn next?', exact: true }).waitFor();
  await page.evaluate(async () => {
    const jobs = await import('/js/jobs.js?v=3');
    const { openIntakeForJob } = await import('/js/intake.js?v=82');
    const row = {
      runner: 'cloud', status: 'review_research', stage: 'research', runId: 'qa-run-1', title: 'Photography in natural light',
      brief: { topic: 'Photography in natural light', source_urls: ['https://example.com/handout', 'https://example.com/unread'],
        source_manifest: { links: [{ title: 'Workshop handout', url: 'https://example.com/handout' }, { title: 'Unavailable workshop page', url: 'https://example.com/unread' }] } },
      checkpoint: { extractedUrls: [{ ok: true, url: 'https://example.com/handout', textContent: 'Fixture excerpt' }, { ok: false, url: 'https://example.com/unread', error: 'Fixture failure' }] },
      review: { researchResults: [
        { mod: { id: 'light', title: 'Find soft light' }, bundle: { key_concepts: ['Recognise soft light', 'Notice shadow edges'], examples: ['Place a subject near a window'], sources: [{ title: 'Window light reference', url: 'https://example.com/reference' }, { title: 'Printed photography handbook' }, { title: 'Unsafe link example', url: 'javascript:bad()' }] } },
        { mod: { id: 'practice', title: 'Practise a portrait' }, bundle: { key_concepts: 'A legacy single concept', examples: 'Compare two positions', sources: [] } },
        { mod: { id: 'missing', title: 'Review your photographs' }, bundle: {} }
      ] }
    };
    jobs.removeJob('job-evidence-qa'); jobs.removeJob('job-evidence-other-qa');
    jobs.ensureJob('job-evidence-qa', row.brief, row);
    window.__evidenceQA = { jobs, row, patch: patch => jobs.updateJob('job-evidence-qa', patch) };
    openIntakeForJob('job-evidence-qa');
  });
  const feedback = () => page.locator('#intake-modal [data-review-feedback]');
  const approve = () => page.locator('#intake-modal [data-review-continue]');
  const modulePanel = () => page.locator('#intake-modal [data-evidence-panel="module-0"]');
  await page.getByRole('heading', { name: 'Review the research and sources', exact: true }).waitFor();
  check(await approve().isDisabled(), 'missing empty research bundle blocks lesson approval');
  check(await page.getByText('1 of 3 modules list references', { exact: true }).isVisible(), 'reference coverage is explicit');
  check(await page.getByText('Text available', { exact: true }).isVisible(), 'successful extraction is shown without verified claim');
  check(await page.getByText('Couldn’t read', { exact: true }).isVisible(), 'failed source is visible by default');
  check(await page.getByText('A legacy single concept', { exact: true }).isVisible(), 'legacy string research renders');
  check(await page.locator('.research-missing').filter({ hasText: 'No references listed.' }).isVisible(), 'missing references explained');
  await modulePanel().locator('summary').focus(); await page.keyboard.press('Enter');
  check(await modulePanel().evaluate(el => el.open), 'keyboard opens references');
  check(await page.getByText('No link supplied — check the reference manually.', { exact: true }).isVisible(), 'title-only reference has honest fallback');
  check(await page.getByText('Link unavailable — check the reference manually.', { exact: true }).isVisible(), 'unsafe link has nonclickable fallback');
  check(await page.locator('#intake-modal a[href^="javascript:"]').count() === 0, 'unsafe navigation absent');
  const reference = () => page.getByRole('link', { name: /^Window light reference/ });
  check(await reference().getAttribute('referrerpolicy') === 'no-referrer', 'references do not leak referrer');
  await reference().focus();
  await page.evaluate(() => window.__evidenceQA.patch({ message: 'Updated review' }));
  check(await reference().evaluate(el => document.activeElement === el), 'reference link focus survives background updates');
  await page.context().route('https://example.com/reference', route => route.fulfill({ contentType: 'text/html', body: '<h1>Fixture reference</h1>' }));
  const popupWait = page.waitForEvent('popup');
  await reference().click(); const popup = await popupWait;
  await popup.getByRole('heading', { name: 'Fixture reference' }).waitFor();
  check(await page.getByRole('heading', { name: 'Review the research and sources' }).isVisible(), 'external reference opens separately without leaving review');
  await popup.close(); await page.bringToFront();
  await feedback().fill('Please resolve the conflicting guidance before we write lessons.');
  await feedback().evaluate(el => { el.focus(); el.setSelectionRange(7, 14); });
  const scrollBefore = await page.locator('#intake-modal').evaluate(el => el.scrollTop);
  await page.evaluate(() => window.__evidenceQA.patch({ message: 'Background checkpoint refreshed' }));
  check((await feedback().inputValue()).startsWith('Please resolve'), 'same-checkpoint update retains typed feedback');
  check(await feedback().evaluate(el => document.activeElement === el && el.selectionStart === 7 && el.selectionEnd === 14), 'same-checkpoint update retains input focus/selection');
  check(await modulePanel().evaluate(el => el.open), 'same-checkpoint update retains expanded references');
  check(Math.abs((await page.locator('#intake-modal').evaluate(el => el.scrollTop)) - scrollBefore) < 2, 'same-checkpoint update retains scroll position');
  await modulePanel().locator('summary').focus();
  await page.evaluate(() => window.__evidenceQA.jobs.ensureJob('job-evidence-other-qa', { topic: 'Other QA course' }, { status: 'review_curriculum' }));
  check(await modulePanel().locator('summary').evaluate(el => document.activeElement === el), 'unrelated job update retains disclosure focus');
  check((await feedback().inputValue()).startsWith('Please resolve'), 'unrelated job update retains feedback');
  await page.evaluate(() => { const q = window.__evidenceQA; q.patch({ review: { researchResults: q.row.review.researchResults.slice(0, 2) } }); });
  check(await approve().isEnabled(), 'missing citations/read failures warn but do not block notes-based approval');
  await page.evaluate(() => window.__evidenceQA.patch({ reviewPending: { action: 'approve_research', continueLabel: 'Starting lesson writing...', status: 'Starting lesson writing...' } }));
  check(await page.locator('.intake-review-card').getAttribute('data-review-busy') === 'true', 're-rendered pending action remains busy');
  await approve().focus(); await page.keyboard.press('Enter');
  check(writes.length === 0, 'clicking pending approval starts no duplicate request');
  check(await page.evaluate(() => { const job = window.__evidenceQA.jobs.getJob('job-evidence-qa'); return !!job.reviewPending && !job.error; }), 'pending Enter does not invoke review submission or session-error handling');
  await page.evaluate(() => window.__evidenceQA.patch({ reviewPending: null, error: 'Research review could not be submitted. Try again.' }));
  check(await page.locator('#intake-modal [data-error]').isVisible(), 'review submission failure is visible');
  check((await feedback().inputValue()).startsWith('Please resolve'), 'submission failure retains feedback for retry');
  await page.getByRole('button', { name: 'Adjust sources', exact: true }).click();
  await page.locator('[data-editor-error]').getByText('Your account changed.', { exact: false }).waitFor();
  check(await page.getByRole('dialog', { name: 'Adjust sources', exact: true }).isVisible(), 'existing source editor handles missing QA session');
  await page.keyboard.press('Escape');
  check((await feedback().inputValue()).startsWith('Please resolve'), 'source editor return preserves review feedback');
  check(await modulePanel().evaluate(el => el.open), 'source editor return preserves references');
  check(await page.getByRole('button', { name: 'Adjust sources', exact: true }).evaluate(el => document.activeElement === el), 'source editor return restores action focus');
  await page.evaluate(() => window.__evidenceQA.patch({ error: null, runId: 'qa-run-2' }));
  check(await feedback().inputValue() === '', 'new run clears previous checkpoint feedback');
  check(await modulePanel().evaluate(el => !el.open), 'new run resets reference disclosures');
  await feedback().fill('Owner A feedback');
  await page.evaluate(() => window.__evidenceQA.patch({ ownerId: 'qa-owner-b' }));
  check(await feedback().inputValue() === '', 'different owner cannot inherit typed feedback');
  await page.evaluate(() => { const q = window.__evidenceQA; q.patch({ ownerId: null, message: 'Review the evidence before writing lessons.', review: q.row.review, checkpoint: { extractedUrls: [] } }); });
  check(await page.getByText('Read status unavailable', { exact: true }).count() === 2, 'absent URL extraction is unknown, not successful');
  await modulePanel().locator('summary').click();
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: width === 1440 ? 1100 : 844 });
    check(await page.locator('#intake-modal').evaluate(el => el.scrollWidth <= el.clientWidth), `review fits ${width}px without horizontal overflow`);
    check(await reference().evaluate(el => el.getBoundingClientRect().height >= 44), `reference link has touch-size target at ${width}px`);
    await page.getByRole('heading', { name: 'Review the research and sources' }).scrollIntoViewIfNeeded();
    if (width !== 320) await page.screenshot({ path: `output/playwright/research-evidence-${width}.png`, animations: 'disabled' });
    await modulePanel().evaluate(el => el.scrollIntoView({ block: 'start' }));
    if (width !== 320) await page.screenshot({ path: `output/playwright/research-references-${width}.png`, animations: 'disabled' });
  }
  await page.evaluate(() => window.__evidenceQA.patch({ review: { researchResults: [{ mod: { title: 'Long reference labels' }, bundle: { sources: [{ title: 'Unbroken'.repeat(65), url: `https://example.com/${'long-path'.repeat(30)}` }] } }] } }));
  if (!(await modulePanel().evaluate(el => el.open))) await modulePanel().locator('summary').click();
  check(await page.getByRole('link', { name: /^Unbroken/ }).isVisible(), 'long reference is expanded during overflow check');
  check(await page.locator('#intake-modal').evaluate(el => el.scrollWidth <= el.clientWidth), 'long unbroken reference label fits narrow viewport');
  await page.evaluate(() => window.__evidenceQA.patch({ brief: { source_urls: [] }, review: { researchResults: [] } }));
  check(await approve().isDisabled(), 'zero-module checkpoint blocks approval');
  check(await page.getByText('No module research is available.', { exact: false }).isVisible(), 'empty research provides rerun guidance');
  await page.evaluate(() => window.__evidenceQA.patch({ needsApiKey: true, error: 'Missing API key' }));
  check(await page.getByRole('button', { name: 'Add API key', exact: true }).isVisible(), 'missing-key review recovery still exposes account action');
  check(await page.locator('#intake-modal [data-error]').isVisible(), 'missing-key review warning is visible');
  await page.evaluate(() => window.__evidenceQA.patch({ status: 'timed_out', needsApiKey: false, checkpoint: { brief: { modules: [] } }, error: null }));
  check(await page.locator('#intake-modal [data-error]').isVisible(), 'existing timeout recovery remains visible');
  check(await page.getByRole('button', { name: 'Resume', exact: true }).isVisible(), 'existing checkpoint resume remains available');
  await page.getByRole('button', { name: 'Close', exact: true }).filter({ visible: true }).first().click();
  await page.evaluate(() => { const q = window.__evidenceQA; q.jobs.removeJob('job-evidence-qa'); q.jobs.removeJob('job-evidence-other-qa'); });
  check(errors.length === 0, `no browser exceptions: ${errors.join('; ')}`);
  check(writes.length === 0, 'read-only fixture checks issued no generation/account/provider writes');
  const report = { checks: checks.length, passed: checks, scope: 'Actual app UI, synthetic job/source records and reference page; no paid AI or hosted acceptance.' };
  await page.evaluate(report => { window.__evidenceQA = { report }; }, report);
  return report;
})
