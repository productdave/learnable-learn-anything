(async page => {
  const { accounts, modules } = __MATERIAL_DEFAULTS_QA__;
  const checks = [], errors = [], creations = [];
  const check = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST' && /\/api\/(?:gen\/(?:start|resume|restart|review|sources)(?:\?|$)|setups\/store|providers\/connect)/.test(request.url())) creations.push(request.url()); });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:4173/?experience=workspace');
  const helpers = async () => page.evaluate(async modules => {
    window.qaDefaults = (await import(modules['setup-defaults'])).materialDefaults;
    window.qaAuth = await import(modules.auth); window.qaDrafts = (await import(modules['draft-store'])).createDraftStore();
  }, modules);
  await helpers();
  const signIn = async account => {
    const error = await page.evaluate(async account => (await (await window.qaAuth.sb()).auth.signInWithPassword({ email: account.email, password: account.password })).error?.message, account);
    check(!error, 'local account sign-in succeeds');
    await page.waitForFunction(owner => window.qaAuth.getUser()?.id === owner, account.owner);
  };
  const step = async name => { await page.getByRole('navigation', { name: 'Course setup steps' }).getByRole('link', { name, exact: true }).click(); await page.locator('[data-setup-root]').waitFor(); };
  const selected = () => page.locator('[data-component]:checked').evaluateAll(inputs => inputs.map(input => input.dataset.component).sort().join());
  const choose = async values => { for (const value of ['practice', 'checklists', 'quizzes', 'flashcards']) await page.locator(`[data-component="${value}"]`).setChecked(values.includes(value)); };
  const panelReady = () => page.waitForFunction(() => document.querySelector('[data-defaults-selection]')?.textContent.startsWith('Saved defaults:'));
  const id = () => page.evaluate(() => new URLSearchParams(location.search).get('draft'));
  const visit = async url => { await page.evaluate(url => { history.pushState(null, '', url); dispatchEvent(new PopStateEvent('popstate')); }, url); };
  const newSetup = async name => {
    await visit('?experience=workspace'); await helpers();
    await page.getByLabel('What do you want to learn or teach?').fill(name);
    await page.getByRole('button', { name: 'Create course', exact: true }).click();
    await page.getByLabel('Who is it for?').fill('New photographers');
    await page.getByRole('button', { name: 'Continue to Experience' }).click();
    return id();
  };
  const savedDraft = async expected => page.waitForFunction(async expected => {
    const result = await window.qaDrafts.load(new URLSearchParams(location.search).get('draft'), window.qaAuth.getUser()?.id || null);
    return result.status === 'found' && [...result.draft.components].sort().join() === [...expected].sort().join();
  }, expected);
  const screenshot = async name => {
    await page.locator('.setup-defaults').evaluate(el => window.scrollTo(0, scrollY + el.getBoundingClientRect().top - 100));
    await page.screenshot({ path: `output/playwright/defaults-${name}.png` });
  };
  // Guest choices must survive contextual sign-in even if the account has defaults.
  const first = await newSetup('Defaults QA guest course');
  check(await page.locator('.setup-defaults').count() === 0, 'guest setup has no preference sign-in prompt');
  await choose(['practice', 'checklists']); await savedDraft(['lessons', 'practice', 'checklists']);
  await step('Review'); await page.getByRole('button', { name: 'Create course →', exact: true }).click();
  await page.getByRole('dialog', { name: 'Sign in to create your course' }).waitFor();
  await signIn(accounts[0]);
  await page.getByRole('heading', { name: 'Review your course setup' }).waitFor(); await panelReady();
  check(await id() === first, 'sign-in returns to same reviewed setup');
  const currentSummary = await page.locator('.setup-component-summary').textContent();
  check(currentSummary.includes('Included: Step-by-step lessons, Practice activities, Checklists.'), 'sign-in does not apply account defaults over guest choices');
  check((await page.locator('[data-defaults-selection]').textContent()).includes('Flashcards') && !(await page.locator('[data-defaults-selection]').textContent()).includes('Checklists'), 'saved defaults are distinguished from this course');
  await page.locator('[data-defaults="save"]').click();
  await page.getByText('Saved to your account for new courses. Existing courses and setups are unchanged.', { exact: true }).waitFor();
  check(true, 'creator can save defaults at Review after guest sign-in');
  await screenshot('review-1440');
  const second = await newSetup('Defaults QA second course'); await panelReady();
  check(await selected() === 'checklists,lessons,practice', 'new signed-in setup uses saved materials');
  await choose(['quizzes']); await savedDraft(['lessons', 'quizzes']);
  check((await page.evaluate(owner => window.qaDefaults.load(owner), accounts[0].owner)).components.join() === 'lessons,practice,checklists', 'per-course override does not change defaults');
  // Allow the autosave's completion microtask and any previous-step flush to
  // settle before a deliberate full-page reload (not an in-flight leave test).
  await page.waitForTimeout(350);
  await page.reload(); await helpers(); await panelReady();
  check(await selected() === 'lessons,quizzes', 'reloading existing setup does not reapply defaults');
  await page.locator('[data-defaults="apply"]').focus(); await page.keyboard.press('Enter');
  check(await selected() === 'checklists,lessons,practice', 'explicit keyboard apply restores defaults to this course');
  check(await page.locator('[data-defaults-message]').evaluate(el => el === document.activeElement), 'focus survives Apply control disappearing');
  await choose(['quizzes']); await savedDraft(['lessons', 'quizzes']);
  await page.locator('[data-defaults="reset"]').click();
  await page.getByText('Future courses will start with lessons, quizzes and flashcards. This course is unchanged.', { exact: true }).waitFor();
  check(await selected() === 'lessons,quizzes', 'reset only changes future defaults');
  check((await page.evaluate(owner => window.qaDefaults.load(owner), accounts[0].owner)).components.join() === 'lessons,quizzes,flashcards', 'reset persists standard defaults');
  await page.setViewportSize({ width: 390, height: 844 }); await screenshot('experience-390');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'defaults controls fit 390px');
  await page.setViewportSize({ width: 320, height: 700 }); await screenshot('experience-320');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'defaults controls fit 320px');
  // Another device changes only defaults; current course and panel must not lie.
  await page.evaluate(async owner => { const saved = await window.qaDefaults.load(owner); await window.qaDefaults.save(owner, ['lessons', 'flashcards'], saved.revision); }, accounts[0].owner);
  await page.locator('[data-defaults="save"]').click();
  await page.getByText('Your defaults changed elsewhere. Reload defaults, then choose whether to save these materials again.', { exact: true }).waitFor();
  check(await selected() === 'lessons,quizzes', 'stale defaults conflict preserves course choices');
  await page.locator('[data-defaults="reload"]').click(); await panelReady();
  await page.waitForFunction(() => !document.querySelector('[data-defaults="save"]').disabled);
  check((await page.locator('[data-defaults-selection]').textContent()).includes('Flashcards'), 'reload reveals latest account defaults');
  await page.route('**/rest/v1/user_state**', route => route.abort());
  await page.locator('[data-defaults="save"]').click();
  await page.getByText('Couldn’t confirm the defaults save. Reload defaults to check before trying again. Your course choices are unchanged.', { exact: true }).waitFor();
  check(await selected() === 'lessons,quizzes', 'failed preference save preserves setup');
  check(await page.getByRole('button', { name: 'Continue to Context' }).isEnabled(), 'preference failure does not block creation setup');
  await screenshot('error-320');
  await page.unroute('**/rest/v1/user_state**');
  await page.locator('[data-defaults="reload"]').click();
  await page.waitForFunction(() => !document.querySelector('[data-defaults="save"]').disabled);
  await page.locator('[data-defaults="save"]').click();
  await page.getByText('Saved to your account for new courses. Existing courses and setups are unchanged.', { exact: true }).waitFor();
  check((await page.evaluate(owner => window.qaDefaults.load(owner), accounts[0].owner)).components.join() === 'lessons,quizzes', 'retry saves after connection recovers');
  // Existing first draft retains its original selection after multiple defaults changes.
  await visit(`?experience=workspace&draft=${first}&step=experience`); await helpers(); await panelReady();
  check(await selected() === 'checklists,lessons,practice', 'older course setup remains independent from later defaults');
  await page.evaluate(async () => (await window.qaAuth.sb()).auth.signOut());
  await page.waitForFunction(() => !window.qaAuth.getUser()); await signIn(accounts[1]);
  await newSetup('Defaults QA other account'); await panelReady();
  check(await selected() === 'flashcards,lessons,quizzes', 'another account starts with its own standard defaults');
  await choose(['checklists']); await page.locator('[data-defaults="save"]').click();
  await page.getByText('Saved to your account for new courses. Existing courses and setups are unchanged.', { exact: true }).waitFor();
  check((await page.evaluate(owner => window.qaDefaults.load(owner), accounts[1].owner)).components.join() === 'lessons,checklists', 'other account saves independent defaults');
  await savedDraft(['lessons', 'checklists']);
  // Slow/default-read failure when starting is non-destructive and recoverable.
  await page.route('**/rest/v1/user_state**', route => route.abort());
  await newSetup('Defaults QA unavailable account defaults');
  await page.getByText('Couldn’t load your material defaults. Your course choices are unchanged.', { exact: true }).waitFor();
  check(await selected() === 'flashcards,lessons,quizzes', 'failed initial load starts with usable standard materials');
  check((await page.locator('[data-defaults-notice]').textContent()).includes('standard materials'), 'initial fallback is explained while defaults are unavailable');
  await page.unroute('**/rest/v1/user_state**');
  await choose(['practice']); await page.locator('[data-defaults="reload"]').click(); await panelReady();
  check(await selected() === 'lessons,practice', 'recovered defaults read never overwrites edited choices');
  check((await page.locator('[data-defaults-notice]').textContent()).includes('standard materials'), 'fallback use remains explained after recovery');
  check(creations.length === 0, 'preference workflow never starts AI or uploads sources');
  check(errors.length === 0, 'no uncaught browser errors');
  const report = { total: checks.length, checks, mode: 'real local Auth/Postgres and app; disposable accounts; no paid AI; email delivery not repeated' };
  await page.evaluate(report => { window.__materialDefaultsReport = report; }, report);
  return report;
})
