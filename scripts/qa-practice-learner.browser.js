(async page => {
  const { fixtures, accounts, modules } = __PRACTICE_QA__;
  const checks = [], errors = [];
  const check = (condition, label) => { if (!condition) throw new Error(label); checks.push(label); };
  page.on('pageerror', error => errors.push(error.message));
  await page.unrouteAll({ behavior: 'ignoreErrors' });
  await page.route('**/data/courses/qa-practice-*/**', async route => {
    const match = route.request().url().match(/\/data\/courses\/([^/]+)\/(.+)/), course = fixtures[match[1]], file = match[2].split('?')[0];
    const body = file === 'course.json' ? course.config : file === 'curriculum.json' ? course.curriculum : course.modules[Number(file.match(/module-(\d+)/)?.[1])];
    if (!body) throw new Error('Unexpected fixture ' + file);
    await route.fulfill({ json: body });
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('http://127.0.0.1:4173/?experience=workspace&course=qa-practice-0#/foundations/lesson-1');
  await page.getByRole('heading', { name: 'qa-practice-0 · Photography lesson 1', exact: true }).waitFor();
  const loadHelpers = async () => page.evaluate(async modules => {
    window.qaStore = (await import(modules.store)).store;
    window.qaAuth = await import(modules.auth); window.qaSync = await import(modules.sync);
  }, modules);
  await loadHelpers();
  const visit = async (id, lesson = 'lesson-1') => {
    await page.evaluate(({ id, lesson }) => { history.pushState(null, '', `?experience=workspace&course=${id}#/foundations/${lesson}`); dispatchEvent(new PopStateEvent('popstate')); }, { id, lesson });
    await page.getByRole('heading', { name: `${id} · Photography lesson ${lesson.slice(-1)}`, exact: true }).waitFor();
  };
  const quiz = () => page.locator('[data-quiz-id="quiz-true"]');
  const practice = () => page.locator('[data-step-index="0"]');
  const item = () => page.locator('[data-checklist-item="clear-space"]');
  for (const [id, fixture] of Object.entries(fixtures)) {
    await visit(id); const selected = fixture.config.components;
    check(await page.locator('.practice-block').count() === Number(selected.includes('practice')), `${id}: practice selection honoured`);
    check(await page.locator('.lesson-checklist').count() === Number(selected.includes('checklists')), `${id}: checklist selection honoured`);
    check(await page.locator('.quiz-block').count() === (selected.includes('quizzes') ? 3 : 0), `${id}: quiz selection honoured`);
    check(await page.locator('#flashcard-trigger').isVisible() === selected.includes('flashcards'), `${id}: flashcard selection honoured`);
  }
  await visit('qa-practice-3');
  check((await page.locator('.practice-block').textContent()).includes('ordinary object') && !(await page.locator('.practice-block').textContent()).includes('Poolside'), 'general practice uses topic guidance, not swimming copy');
  check(await page.getByRole('heading', { name: 'When to pause or stop' }).isVisible(), 'stop conditions are visible without opening a disclosure');
  await practice().check(); await item().check();
  check((await page.locator('.checklist-count').textContent()).startsWith('1 of 3'), 'checklist announces saved count');
  await item().focus(); await page.keyboard.press('Space'); check(!await item().isChecked(), 'checklist supports keyboard uncheck');
  await item().check();
  await page.locator('[data-skill-id]').selectOption('with_help');
  await page.locator('[data-timer-action="start"]').click(); await page.waitForTimeout(1100);
  await page.locator('[data-timer-action="pause"]').click();
  const timer = await page.locator('.practice-timer-value').textContent(); await page.waitForTimeout(1100);
  check(timer === await page.locator('.practice-timer-value').textContent() && timer !== '10:00', 'optional timer counts down and pauses');
  check(!(await page.locator('#complete-btn').textContent()).includes('Completed'), 'practice checks/timer do not certify or complete a lesson');
  await quiz().locator('[data-option="true"]').click(); await quiz().getByRole('button', { name: 'Check Answer' }).click();
  await page.getByRole('textbox', { name: 'Describe the difference response' }).fill('Guest notes </textarea><img src=x onerror=alert(1)>');
  await page.locator('#complete-btn').click();
  await visit('qa-practice-4');
  check(!await practice().isChecked() && !await item().isChecked(), 'identical practice/checklist IDs in another course are independent');
  check(!await quiz().evaluate(el => el.classList.contains('answered')) && !(await page.locator('#complete-btn').textContent()).includes('Completed'), 'identical quiz/module/topic IDs in another course are independent');
  check(await page.locator('.exercise-textarea').inputValue() === '', 'exercise response never leaks into another course');
  await visit('qa-practice-3', 'lesson-2');
  check(!await quiz().evaluate(el => el.classList.contains('answered')) && await page.locator('.exercise-textarea').inputValue() === '', 'same quiz/exercise IDs in another lesson are independent');
  await visit('qa-practice-3');
  check(await practice().isChecked() && await item().isChecked() && await page.locator('[data-skill-id]').inputValue() === 'with_help', 'return restores practice, checklist and self-assessment');
  check(await page.locator('.exercise-textarea').inputValue() === 'Guest notes </textarea><img src=x onerror=alert(1)>' && await page.locator('.exercise-block img').count() === 0, 'exercise text roundtrips as text, never markup');
  await page.reload(); await page.getByRole('heading', { name: 'qa-practice-3 · Photography lesson 1', exact: true }).waitFor(); await loadHelpers();
  check(await practice().isChecked() && await quiz().evaluate(el => el.classList.contains('answered')), 'guest course history survives reload');
  const signIn = async account => {
    const result = await page.evaluate(async account => { const client = await window.qaAuth.sb(); const result = await client.auth.signInWithPassword({ email: account.email, password: account.password }); return result.error?.message || null; }, account);
    check(!result, 'local account sign-in succeeds');
    await page.waitForFunction(owner => window.qaStore.scope().owner === owner, account.owner);
    await page.getByRole('heading', { name: 'qa-practice-3 · Photography lesson 1', exact: true }).waitFor();
    await page.evaluate(() => window.qaSync.pullSyncNow());
  };
  await signIn(accounts[0]);
  check(!await practice().isChecked() && !await quiz().evaluate(el => el.classList.contains('answered')) && await page.locator('.exercise-textarea').inputValue() === '', 'sign-in starts account A independently from guest history');
  await practice().check(); await item().check();
  await quiz().locator('[data-option="false"]').click(); await quiz().getByRole('button', { name: 'Check Answer' }).click();
  await page.locator('.exercise-textarea').fill('Account A notes');
  await page.locator('#flashcard-trigger').click(); await page.locator('#fc-card').waitFor(); await page.locator('#fc-card').click();
  await page.locator('[data-quality="5"]').click(); await page.locator('#fc-close').click();
  check(await page.evaluate(() => Object.keys(window.qaStore.get().flashcardState).length) === 1, 'flashcard rating belongs to active account/course');
  await page.evaluate(() => window.qaSync.flushSync());
  check(await page.evaluate(() => window.qaStore.getSaveStatus().sync) === 'saved', 'account save confirms actual local cloud sync');
  await page.locator('.quiz-fib-input').fill('window');
  await page.evaluate(() => { window.qaOldQuizButton = document.querySelector('[data-quiz-id="quiz-blank"] .quiz-check-btn'); });
  await page.evaluate(async () => { await (await window.qaAuth.sb()).auth.signOut(); });
  await page.waitForFunction(() => window.qaStore.scope().owner === null);
  await signIn(accounts[1]);
  check(!await practice().isChecked() && !await quiz().evaluate(el => el.classList.contains('answered')) && await page.locator('.exercise-textarea').inputValue() === '', 'account B sees none of account A progress');
  check(await page.evaluate(() => Object.keys(window.qaStore.get().flashcardState).length) === 0, 'account B has independent flashcard schedule');
  await page.evaluate(() => window.qaOldQuizButton.click());
  check(await page.evaluate(() => !window.qaStore.getQuizAnswer('quiz-blank')), 'detached account A quiz callback cannot write account B');
  await page.evaluate(async () => { await (await window.qaAuth.sb()).auth.signOut(); });
  await page.waitForFunction(() => window.qaStore.scope().owner === null); await signIn(accounts[0]);
  check(await practice().isChecked() && await page.locator('.exercise-textarea').inputValue() === 'Account A notes', 'return to account A restores only its progress');
  await page.evaluate(() => window.qaSync.flushSync());
  // Remove only this isolated QA account's device copy to require cloud hydration.
  await page.evaluate(owner => localStorage.removeItem(`learnable-learning-v2:account:${encodeURIComponent(owner)}`), accounts[0].owner);
  await page.reload(); await page.getByRole('heading', { name: 'qa-practice-3 · Photography lesson 1', exact: true }).waitFor(); await loadHelpers();
  await page.waitForFunction(owner => window.qaStore.scope().owner === owner, accounts[0].owner);
  await page.evaluate(() => window.qaSync.pullSyncNow());
  check(await practice().isChecked() && await item().isChecked() && await quiz().evaluate(el => el.classList.contains('answered')), 'cloud-only history hydrates visible idle controls without reopening lesson');
  check(await page.locator('.exercise-textarea').inputValue() === 'Account A notes', 'cloud-only exercise response hydrates idle editor');
  await page.route('**/rest/v1/user_state**', route => route.abort('failed'));
  await item().uncheck(); await page.evaluate(() => window.qaSync.flushSync().catch(() => {}));
  check(!await item().isChecked() && await page.locator('.learning-save-warning').isVisible(), 'failed account sync retains uncheck and shows contextual retry');
  await page.unroute('**/rest/v1/user_state**');
  await page.getByRole('button', { name: 'Retry saving progress' }).click();
  await page.waitForFunction(() => !document.querySelector('.learning-save-warning'));
  check(await page.evaluate(() => window.qaStore.getSaveStatus().sync) === 'saved', 'retry sync succeeds without reentering progress');
  await page.evaluate(() => { window.qaOriginalSetItem = Storage.prototype.setItem; Storage.prototype.setItem = function(key, value) { if (key.startsWith('learnable-learning-v2:')) throw new DOMException('QA quota', 'QuotaExceededError'); return window.qaOriginalSetItem.call(this, key, value); }; });
  await item().check();
  check((await page.locator('.learning-save-warning').textContent()).includes('held on this page'), 'device storage failure never falsely says saved');
  await page.evaluate(() => { Storage.prototype.setItem = window.qaOriginalSetItem; });
  await page.getByRole('button', { name: 'Retry saving progress' }).click(); await page.waitForFunction(() => !document.querySelector('.learning-save-warning'));
  check(await item().isChecked(), 'retry persists work retained during device failure');
  check(!(await page.locator('.checklist-status').textContent()).includes('not saved'), 'successful retry clears stale checklist failure copy');
  // Viewport evidence keeps fixed chrome real; tall element captures would include
  // the legacy off-canvas tutor outside the viewport and obscure the activity.
  const showPracticeStart = () => page.locator('.practice-block').evaluate(el => window.scrollTo({ top: scrollY + el.getBoundingClientRect().top - 84, behavior: 'instant' }));
  await showPracticeStart(); await page.screenshot({ path: 'output/playwright/practice-learner-1440.png', animations: 'disabled' });
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 }); await showPracticeStart();
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px: no horizontal overflow`);
    check(await page.locator('[data-timer-action="start"]').evaluate(el => el.getBoundingClientRect().height >= 44), `${width}px: timer touch target at least 44px`);
    await page.screenshot({ path: `output/playwright/practice-learner-${width}.png`, animations: 'disabled' });
    await page.locator('.lesson-checklist').scrollIntoViewIfNeeded(); await page.screenshot({ path: `output/playwright/checklist-learner-${width}.png`, animations: 'disabled' });
  }
  check(errors.length === 0, 'no uncaught browser errors');
  await page.evaluate(() => window.qaSync.flushSync());
  return { total: checks.length, checks, mode: 'real learner/local Auth and cloud progress; synthetic course fixtures; isolated disposable accounts' };
})
