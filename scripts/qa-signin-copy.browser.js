(async page => {
  const checks = [], errors = [];
  const check = (ok, text) => { if (!ok) throw new Error(text); checks.push(text); };
  page.on('pageerror', error => errors.push(error.message));
  // Real dialog and styles, synthetic course and email sender. No account writes.
  await page.route('**/qa-signin-copy', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet"><link rel="stylesheet" href="/styles/tokens.css"><link rel="stylesheet" href="/styles/base.css"><link rel="stylesheet" href="/styles/themes.css"><link rel="stylesheet" href="/styles/home.css?v=9"></head><body data-experience="workspace"><main id="content"><h1>Review your course setup</h1></main></body></html>' }));
  await page.goto('http://127.0.0.1:4173/qa-signin-copy');
  await page.evaluate(async () => {
    const { createSetupSignIn } = await import('/js/setup-signin.js?v=2');
    const q = window.__signinCopy = { target: { id: 'qa-copy', owner: null, draft: { brief: { topic: 'Test' } } }, sends: 0 };
    q.dialog = createSetupSignIn({ sessions: { flush: async () => true }, handoffs: { begin: () => true }, getUser: () => null, sendLink: async () => { q.sends++; }, navigate: () => q.dialog.dispose() });
    q.show = () => q.dialog.show(document.querySelector('#content'), q.target.id, q.target);
    q.show();
  });
  await page.getByRole('dialog', { name: 'Sign in to create your course' }).waitFor();
  check(await page.getByText('Course you’re creating', { exact: true }).isVisible() && await page.getByText('Test', { exact: true }).isVisible(), 'course name is kept and explicitly labeled');
  check((await page.locator('#setup-signin-description').textContent()).includes('which account'), 'entry explains why sign-in is needed');
  check((await page.locator('#setup-signin-next').textContent()).includes('email you a sign-in link') && (await page.locator('#setup-signin-next').textContent()).includes('return to Review, then click Create course'), 'entry explains email verification and the next action');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'output/playwright/signin-copy-entry-1440.png' });
  await page.setViewportSize({ width: 390, height: 844 });
  const fits = () => page.getByRole('dialog').evaluate(el => { const r=el.getBoundingClientRect(); return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight && el.scrollWidth <= el.clientWidth; });
  check(await fits(), 'entry dialog fits the mobile viewport');
  await page.screenshot({ path: 'output/playwright/signin-copy-entry-390.png' });
  await page.getByLabel('Email address').fill('learner@example.test');
  await page.getByRole('button', { name: 'Continue with email', exact: true }).click();
  await page.getByRole('heading', { name: 'Check your email', exact: true }).waitFor();
  check(await page.getByText('Test', { exact: true }).isVisible(), 'email-pending state retains the labeled course name');
  check((await page.locator('#setup-signin-next').textContent()).includes('details filled in, then click Create course'), 'pending copy explains retained details and the next action');
  check(await fits(), 'email-pending dialog fits the mobile viewport');
  await page.screenshot({ path: 'output/playwright/signin-copy-pending-390.png' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: 'output/playwright/signin-copy-pending-1440.png' });
  await page.evaluate(() => { const q=window.__signinCopy; q.dialog.forget(q.target.id); q.target.draft.brief.topic = 'A course with a very long title '.repeat(7); q.show(); });
  await page.setViewportSize({ width: 390, height: 600 });
  check(await fits(), 'long course name stays contained and vertically scrollable on a short mobile screen');
  await page.getByRole('button', { name: 'Back to review', exact: true }).click();
  check(await page.getByRole('dialog').count() === 0, 'Back to review remains reachable with a long title');
  check(errors.length === 0, 'no uncaught JavaScript errors');
  return { checks, total: checks.length, mode: 'real dialog and styles with synthetic course and email sender' };
})
