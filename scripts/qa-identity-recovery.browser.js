(async page => {
  const qa = __IDENTITY_QA__, checks = [], errors = [], requests = [];
  page.setDefaultTimeout(12000);
  const check = (ok, name) => { if (!ok) throw Error(name); checks.push(name); };
  let duplicateStart = false, duplicateResult;
  const observe = target => {
    target.setDefaultTimeout(12000);
    target.on('pageerror', error => errors.push(error.message));
  };
  async function routes(target) {
    await target.route(qa.base + '/api/**', async route => {
      const request = route.request(), relative = request.url().slice(qa.base.length);
      requests.push({ path: relative.split('?')[0], method: request.method() });
      const headers = { ...request.headers() }; delete headers.host;
      if (headers.origin) headers.origin = qa.proxy; headers['sec-fetch-site'] = 'same-origin';
      const options = { url: qa.proxy + relative, headers };
      if (duplicateStart && relative === '/api/setups/generate' && request.postDataJSON()?.action === 'start') {
        duplicateStart = false;
        const results = await Promise.all([route.fetch(options), route.fetch(options)]);
        duplicateResult = await Promise.all(results.map(async result => ({ status: result.status(), body: await result.json() })));
        await route.abort('failed'); return;
      }
      await route.fulfill({ response: await route.fetch(options) });
    });
    await target.route('https://api.anthropic.com/**', route => route.abort());
    await target.route('https://api.openai.com/**', route => route.abort());
  }
  async function control(action, extra = {}) {
    const result = await page.request.post(qa.proxy + '/api/qa/identity', { headers: { 'x-qa-key': qa.nonce }, data: { action, ...extra } });
    if (!result.ok()) throw Error('Local QA control failed: ' + result.status()); return result.json();
  }
  async function signIn(target, account) {
    await target.evaluate(async ({ authModule, account }) => {
      const auth = await import(authModule), sdk = await auth.sb();
      if (!window.__identityAuthEvents) {
        window.__identityAuthEvents = [];
        sdk.auth.onAuthStateChange((event, session) => { window.__identityAuthEvents.push({ event, signedIn: !!session, time: Date.now() }); });
      }
      const result = await sdk.auth.signInWithPassword({ email: account.email, password: account.password });
      if (result.error) throw Error('Fixture sign-in failed');
    }, { authModule: qa.authModule, account });
    await target.waitForFunction(async ({ authModule, owner }) => (await import(authModule)).getUser()?.id === owner, { authModule: qa.authModule, owner: account.owner });
  }
  async function expire() {
    const token = await page.evaluate(async authModule => (await (await (await import(authModule)).sb()).auth.getSession()).data.session.access_token, qa.authModule);
    await control('expire', { token });
    const expired = await page.evaluate(async authModule => {
      const auth = await import(authModule), sdk = await auth.sb();
      const session = (await sdk.auth.getSession()).data.session, now = Date.now;
      // A revoked refresh token alone leaves a still-valid access token usable.
      // Move only this isolated page's Date.now beyond its access-token expiry;
      // keep timers/server time unchanged and restore the clock immediately.
      Date.now = () => session.expires_at * 1000 + 1000;
      try {
        const result = await sdk.auth.refreshSession();
        return { rejected: !!result.error, signedOut: !auth.getUser() && !(await sdk.auth.getSession()).data.session };
      } finally { Date.now = now; }
    }, qa.authModule);
    check(expired.rejected && expired.signedOut, 'expired browser clock plus actual revoked refresh signs out frontend and SDK');
  }
  async function authedPost(body) {
    return page.evaluate(async ({ authModule, body }) => {
      const sdk = await (await import(authModule)).sb(), session = (await sdk.auth.getSession()).data.session;
      const row = await sdk.from('generation_jobs').select('status,run_id').eq('id', body.jobId).single();
      if (row.error) throw Error(row.error.message);
      body.expected = { status: row.data.status, runId: row.data.run_id };
      const send = async () => { const result = await fetch('/api/gen/review', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); return { status: result.status, body: await result.json() }; };
      return Promise.all([send(), send()]);
    }, { authModule: qa.authModule, body });
  }
  try {
  observe(page); await routes(page); await page.goto(qa.base + '/?experience=workspace');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('What do you want to learn or teach?').fill('Identity Recovery Photography');
  await page.getByRole('button', { name: 'Create course', exact: true }).click();
  await page.getByLabel('Who is it for?').fill('A beginner taking photos at home');
  await page.getByRole('button', { name: 'Continue to Experience' }).click();
  for (const value of ['practice', 'checklists', 'quizzes', 'flashcards']) await page.locator(`[data-component="${value}"]`).uncheck();
  await page.getByRole('button', { name: 'Continue to Context' }).click();
  await page.getByRole('button', { name: '+ Add a note', exact: true }).click();
  await page.getByLabel('Notes, transcript or raw text').fill('Synthetic private note: compare window light without moving the object.');
  await page.locator('[data-source-kind="files"]').click();
  await page.locator('#source-files').setInputFiles('scripts/fixtures/identity-source.txt');
  await page.getByRole('button', { name: 'Review setup' }).click();
  const draftId = await page.evaluate(() => new URL(location.href).searchParams.get('draft'));
  check(!!draftId && await page.getByRole('dialog').count() === 0, 'guest completes four steps before sign-in');
  await page.getByRole('button', { name: 'Create course' }).click();
  await page.getByLabel('Email address').fill(qa.accounts[0].email);
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await page.getByRole('heading', { name: 'Check your email', exact: true }).waitFor();
  let mail;
  for (let attempt = 0; attempt < 40; attempt++) {
    const inbox = await (await page.request.get('http://127.0.0.1:54324/api/v1/messages')).json();
    mail = inbox.messages.find(m => m.To?.some(to => to.Address === qa.accounts[0].email));
    if (mail) break; await page.waitForTimeout(250);
  }
  if (!mail) throw Error('Fixture email not delivered');
  const content = await (await page.request.get(`http://127.0.0.1:54324/api/v1/message/${mail.ID}`)).json();
  const link = content.HTML.match(/href="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&');
  if (!link?.startsWith('http://127.0.0.1:54321/auth/v1/verify?')) throw Error('Unexpected local email URL');

  // Fresh browser context models another device: no shared IndexedDB or handoff.
  const otherContext = await page.context().browser().newContext();
  try {
    const other = await otherContext.newPage(); observe(other); await routes(other); await other.goto(link);
    await other.getByRole('heading', { name: 'Setup unavailable', exact: true }).waitFor();
    check(await other.evaluate(async authModule => !!(await import(authModule)).getUser(), qa.authModule), 'email really signs in on the second browser');
    check(!(await other.locator('body').textContent()).includes('Identity Recovery Photography'), 'new device does not invent or expose absent private setup');
    check((await other.locator('body').textContent()).includes('browser where you started'), 'new-device recovery points to original browser');
    check(await page.getByRole('heading', { name: 'Check your email', exact: true }).isVisible(), 'original browser retains its selected setup and email state');
    check(!(await control('status')).jobs.length, 'email on another device starts no generation');
  } finally { await otherContext.close(); }

  await signIn(page, qa.accounts[0]);
  await page.locator('.setup-create-context').filter({ hasText: qa.accounts[0].email }).waitFor();
  check(await page.getByText('1 note · 0 links · 1 file', { exact: true }).isVisible(), 'original browser claims only selected note and file after real authentication');
  await expire();
  await page.getByRole('heading', { name: 'Setup unavailable', exact: true }).waitFor();
  check(!(await page.locator('body').textContent()).includes('Identity Recovery Photography'), 'session loss hides account-owned setup rather than displaying it as guest data');
  await page.getByRole('link', { name: 'Sign in or recover account setup' }).click();
  await page.getByRole('dialog', { name: 'Sign in to create your course' }).waitFor();
  check((await page.getByRole('dialog').textContent()).includes('After sign-in'), 'recovery dialog explains what happens next when setup is not yet accessible');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 900 });
    check(await page.getByRole('dialog').evaluate(el => el.scrollWidth <= el.clientWidth), 'session recovery dialog fits ' + width);
    await page.screenshot({ path: `output/playwright/identity-recovery-${width}.png` });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('Email address').focus();
  await page.keyboard.press('Shift+Tab');
  check(await page.getByRole('dialog').evaluate(el => el.contains(document.activeElement)), 'recovery dialog keeps keyboard focus inside');
  await page.keyboard.press('Escape');
  await page.getByRole('heading', { name: 'Setup unavailable', exact: true }).waitFor();
  check(await page.getByRole('dialog').count() === 0 && !(await page.locator('body').textContent()).includes('Identity Recovery Photography'), 'Escape closes sign-in without exposing the private setup');
  await page.getByRole('link', { name: 'Sign in or recover account setup' }).click();
  await page.getByRole('dialog', { name: 'Sign in to create your course' }).waitFor();
  check(true, 'cancelled recovery can be reopened');
  await signIn(page, qa.accounts[1]);
  await page.getByRole('heading', { name: 'Setup unavailable', exact: true }).waitFor();
  check(!(await page.locator('body').textContent()).includes('Identity Recovery Photography'), 'wrong account cannot claim the retained original setup');
  await signIn(page, qa.accounts[0]);
  await page.locator('.setup-create-context').filter({ hasText: qa.accounts[0].email }).waitFor();
  check(await page.getByText('1 note · 0 links · 1 file', { exact: true }).isVisible(), 'returning to correct account restores the same sources');
  check(!(await control('status')).calls.length, 'session recovery and account switching dispatch no provider calls');
  await page.getByRole('button', { name: 'Create course' }).click();
  await page.getByText('Text ready', { exact: true }).waitFor();
  await page.locator('[data-source-reviewed]').check();
  duplicateStart = true;
  await page.getByRole('button', { name: 'Create course plan →', exact: true }).click();
  await page.getByText('The request couldn’t be confirmed. Retry to check your saved progress before starting again.', { exact: true }).waitFor();
  check(duplicateResult.length === 2 && duplicateResult.every(result => result.status === 200) && duplicateResult[0].body.jobId === duplicateResult[1].body.jobId, 'concurrent accepted HTTP starts use one job');
  check((await control('status')).calls.length === 1, 'duplicate starts dispatched one synthetic curriculum call');
  await page.getByRole('button', { name: 'Create course plan →', exact: true }).click();
  await page.waitForURL(/workspace=job-/);
  const jobId = await page.evaluate(() => new URL(location.href).searchParams.get('workspace'));
  check(jobId === duplicateResult[0].body.jobId, 'lost reply retry reconnects to accepted job');
  await expire();
  await page.getByRole('heading', { name: 'Workspace unavailable', exact: true }).waitFor();
  check(!(await page.locator('body').textContent()).includes('Identity Recovery Photography'), 'session loss during background work hides private job');
  await control('release');
  for (let attempt = 0; attempt < 100; attempt++) { if ((await control('status')).jobs[0]?.status === 'review_curriculum') break; await page.waitForTimeout(100); }
  check((await control('status')).jobs[0]?.status === 'review_curriculum', 'background runner reaches durable checkpoint while browser is signed out');
  await signIn(page, qa.accounts[0]);
  await page.getByRole('button', { name: 'Open review', exact: true }).waitFor();
  check(await page.evaluate(() => new URL(location.href).searchParams.get('workspace')) === jobId, 'reauthentication restores the same durable job');
  check((await control('status')).calls.length === 1, 'reauthentication does not repeat curriculum work');
  const reviews = await authedPost({ jobId, action: 'approve_curriculum' });
  check(reviews.map(r => r.status).sort().join(',') === '200,409', 'concurrent HTTP review approvals admit one transition');
  await page.reload();
  await page.getByRole('button', { name: 'Open review', exact: true }).waitFor();
  await page.getByRole('button', { name: 'Open review', exact: true }).click();
  await page.getByRole('heading', { name: 'Review the research and sources', exact: true }).waitFor();
  check((await control('status')).calls.filter(name => name === 'submit_research_bundle').length === 1, 'concurrent review approvals dispatch one research call');
  await page.locator('[data-review-continue]').click();
  await page.getByRole('button', { name: 'Close', exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('link', { name: /^Open course/ }).waitFor({ timeout: 30000 });
  check((await control('status')).jobs[0].status === 'completed', 'recovered journey completes one durable job');
  await page.getByRole('link', { name: /^Open course/ }).click();
  await page.getByRole('link', { name: /^Module 1 Light and composition/ }).click();
  await page.getByRole('heading', { name: 'Photography lesson-1', exact: true }).waitFor();
  check(true, 'recovered creator opens actual saved lesson');
  check(!errors.length, 'no browser exceptions: ' + errors.join('; '));
  await page.evaluate(report => { window.__identityQAReport = report; }, { checks: checks.length, passed: checks, scope: 'Real local email/Auth/HTTP/database/Storage; isolated second browser; revoked refresh with browser-clock expiry and API races; synthetic AI. No hosted/physical-device acceptance.' });
  return { checks: checks.length, passed: checks };
  } catch (error) {
    await page.evaluate(async ({ checks, errors, authModule }) => {
      const auth = await import(authModule);
      const sdk = await auth.sb(), stored = await sdk.auth.getSession();
      window.__identityQADiagnostic = { checks, errors, signedIn: !!auth.getUser(), sdkSignedIn: !!stored.data.session, events: window.__identityAuthEvents, accountButton: document.querySelector('#account-trigger')?.title?.startsWith('Signed in'), dialogOpen: !!document.querySelector('dialog[open]') };
    }, { checks, errors, authModule: qa.authModule });
    throw error;
  }
})
