(async page => {
  const qa = __STALE_QA__, checks = [], errors = [], responses = [];
  const check = (ok, name) => { if (!ok) throw Error(name); checks.push(name); };
  page.setDefaultTimeout(12000); page.on('pageerror', error => errors.push(error.message));
  let advanceReview = true;
  async function control(action, jobId) {
    const result = await page.request.post(qa.proxy + '/api/qa/stale', { headers: { 'x-qa-key': qa.nonce }, data: { action, jobId } });
    if (!result.ok()) throw Error('QA control failed'); return result.json();
  }
  await page.route(qa.base + '/api/**', async route => {
    const request = route.request(), relative = request.url().slice(qa.base.length), headers = { ...request.headers() }; delete headers.host;
    if (headers.origin) headers.origin = qa.proxy; headers['sec-fetch-site'] = 'same-origin';
    if (advanceReview && relative === '/api/gen/review') { advanceReview = false; await control('advance', qa.jobs[0].id); }
    const result = await route.fetch({ url: qa.proxy + relative, headers });
    if (['/api/gen/review', '/api/gen/delete'].includes(relative)) responses.push({ path: relative, status: result.status(), body: request.postDataJSON() });
    await route.fulfill({ response: result });
  });
  await page.route('https://api.anthropic.com/**', route => route.abort());
  await page.route('https://api.openai.com/**', route => route.abort());
  await page.goto(qa.base + '/?experience=workspace');
  await page.evaluate(async ({ authModule, account }) => {
    const sdk = await (await import(authModule)).sb(), result = await sdk.auth.signInWithPassword(account);
    if (result.error) throw Error('Fixture sign-in failed');
  }, qa);
  await page.goto(qa.base + '/?experience=workspace&workspace=' + qa.jobs[0].id);
  await page.getByRole('button', { name: 'Open review', exact: true }).click();
  await page.locator('[data-review-feedback]').fill('Please keep my example about window light.');
  await page.locator('[data-review-continue]').click();
  await page.getByText('Your unsent feedback (previous version)', { exact: true }).waitFor();
  check(responses[0].status === 409 && responses[0].body.expected.runId === qa.jobs[0].runId, 'actual UI submits the displayed run; newer same-stage review is rejected');
  check((await control('status')).dispatches === 0, 'stale approval starts no work');
  check((await page.locator('.intake-card').textContent()).includes('Stale review newer version'), 'dialog refreshes the newer curriculum');
  check((await page.locator('[data-error]').textContent()).includes('No action was taken'), 'visible message explains rejection');
  check(await page.locator('[data-stale-feedback]').inputValue() === 'Please keep my example about window light.', 'unsent feedback is retained verbatim');
  check(await page.locator('[data-review-feedback]').inputValue() === '', 'old feedback is not silently applied to the new review');
  check(await page.locator('[data-stale-feedback]').getAttribute('readonly') !== null, 'recovery text is selectable and read-only');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    await page.locator('.intake-review-recovery').scrollIntoViewIfNeeded();
    check(await page.locator('.intake-card').evaluate(el => el.scrollWidth <= el.clientWidth), 'review recovery fits ' + width + 'px');
    await page.screenshot({ path: `output/playwright/stale-review-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.intake-review-recovery summary').focus(); await page.keyboard.press('Enter');
  check(!await page.locator('.intake-review-recovery').evaluate(el => el.open), 'feedback recovery works with keyboard');
  await page.keyboard.press('Enter');
  await page.locator('[data-review-continue]').click();
  await page.getByRole('button', { name: 'Cancel generation', exact: true }).waitFor();
  check(responses[1].status === 200 && responses[1].body.expected.runId === qa.jobs[0].nextRunId, 'explicit approval of refreshed curriculum succeeds');
  check((await control('status')).dispatches === 1, 'exactly one accepted synthetic dispatch');
  check(await page.locator('[data-stale-feedback]').count() === 0, 'successful current review clears old recovery copy');
  await page.getByRole('button', { name: 'Close', exact: true }).filter({ visible: true }).first().click();
  await page.goto(qa.base + '/?experience=workspace&workspace=' + qa.jobs[1].id);
  // Use the actual workspace deletion control; change the durable row while the
  // native confirmation is open, not by rewriting the HTTP request payload.
  await page.getByText('More actions', { exact: true }).click();
  let firstDelete = true, alertMessage = '';
  let resolveAlert; const alertSeen = new Promise(resolve => { resolveAlert = resolve; });
  page.on('dialog', async dialog => {
    if (dialog.type() === 'confirm' && firstDelete) { firstDelete = false; await control('advance', qa.jobs[1].id); }
    if (dialog.type() === 'alert') { alertMessage = dialog.message(); await dialog.accept(); resolveAlert(); return; }
    await dialog.accept();
  });
  await page.locator('[data-job-action="delete-job"]').click();
  await alertSeen;
  check(alertMessage.includes('Nothing was deleted') && alertMessage.includes('latest version'), 'delete conflict explains what happened and what to review next');
  const rejectedDelete = responses.find(r => r.path === '/api/gen/delete');
  check(rejectedDelete.status === 409 && rejectedDelete.body.expected.runId === qa.jobs[1].runId, 'delete consent remains bound to the version before confirmation');
  check((await control('status')).jobs.some(j => j.id === qa.jobs[1].id && j.run_id === qa.jobs[1].nextRunId), 'newer job survives stale deletion');
  const menu = page.locator('details').filter({ has: page.getByText('More actions', { exact: true }) });
  if (!await menu.evaluate(el => el.open)) await page.getByText('More actions', { exact: true }).click();
  await page.locator('[data-job-action="delete-job"]').click();
  await page.getByRole('heading', { name: 'Workspace unavailable', exact: true }).waitFor();
  check(responses.filter(r => r.path === '/api/gen/delete').at(-1).status === 200, 'fresh explicit deletion succeeds');
  check(!(await control('status')).jobs.some(j => j.id === qa.jobs[1].id), 'only selected fixture is deleted');
  check(!errors.length, 'no browser exceptions: ' + errors.join('; '));
  const report = { checks: checks.length, passed: checks, scope: 'Real local Auth/HTTP/DB; seeded review jobs and synthetic dispatch; no hosted or real-provider acceptance.' };
  await page.evaluate(report => { window.__staleQAReport = report; }, report);
  return report;
})
