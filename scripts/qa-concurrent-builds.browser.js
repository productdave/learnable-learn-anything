(async page => {
  const qa = __CONCURRENT_QA__, checks = [], errors = [], cancelReplies = [];
  const check = (ok, name) => { if (!ok) throw Error(name); checks.push(name); };
  async function control(release) {
    const r = await page.request.post(qa.proxy + '/api/qa/concurrency', { headers: { 'x-qa-key': qa.nonce }, data: { release } });
    if (!r.ok()) throw Error('Fixture control failed'); return r.json();
  }
  async function until(predicate, label) {
    for (let i = 0; i < 150; i++) { const state = await control(); if (predicate(state)) return state; await page.waitForTimeout(100); }
    throw Error('Timed out: ' + label);
  }
  async function prepare(target) {
    target.setDefaultTimeout(12000); target.on('pageerror', e => errors.push(e.message));
    await target.route(qa.base + '/api/**', async route => {
      const req = route.request(), relative = req.url().slice(qa.base.length), headers = { ...req.headers() }; delete headers.host;
      if (headers.origin) headers.origin = qa.proxy; headers['sec-fetch-site'] = 'same-origin';
      const response = await route.fetch({ url: qa.proxy + relative, headers });
      if (relative === '/api/gen/cancel') cancelReplies.push({ status: response.status(), request: req.postDataJSON(), response: await response.json() });
      await route.fulfill({ response });
    });
    await target.route('https://api.anthropic.com/**', r => r.abort()); await target.route('https://api.openai.com/**', r => r.abort());
  }
  async function create(target, fixture) {
    await target.goto(qa.base + '/?experience=workspace');
    await target.getByLabel('What do you want to learn or teach?').fill(`${fixture.label} Photography`);
    await target.getByRole('button', { name: 'Create course', exact: true }).click();
    await target.getByLabel('Who is it for?').fill('A new photographer');
    await target.getByRole('button', { name: 'Continue to Experience' }).click();
    for (const value of ['practice', 'checklists', 'quizzes', 'flashcards']) await target.locator(`[data-component="${value}"]`).setChecked(fixture.components.includes(value));
    await target.getByRole('button', { name: 'Continue to Context' }).click();
    await target.getByRole('button', { name: '+ Add a note', exact: true }).click();
    await target.getByLabel('Notes, transcript or raw text').fill(`${fixture.label}-PRIVATE-NOTE: use a ${fixture.label.toLowerCase()} object beside the window.`);
    await target.getByRole('button', { name: 'Review setup' }).click();
    await target.getByRole('button', { name: /^Create course(?: →)?$/ }).click();
    await target.getByRole('button', { name: 'Create course plan →', exact: true }).click();
    await target.waitForURL(/workspace=job-/);
    return target.evaluate(() => new URL(location.href).searchParams.get('workspace'));
  }
  async function approveBoth(target, label) {
    await target.getByRole('button', { name: 'Open review', exact: true }).click();
    check((await target.locator('.intake-card').textContent()).includes(label + ' Photography'), label + ' opens its own curriculum');
    await target.locator('[data-review-continue]').click();
    await target.getByRole('heading', { name: 'Review the research and sources', exact: true }).waitFor();
    check((await target.locator('.intake-card').textContent()).includes(label + ' synthetic reference'), label + ' receives its own research');
    await target.locator('[data-review-continue]').click();
    await target.getByRole('button', { name: 'Close', exact: true }).filter({ visible: true }).first().click();
  }
  await prepare(page); await page.goto(qa.base + '/?experience=workspace');
  await page.evaluate(async ({ authModule, account }) => { const sdk = await (await import(authModule)).sb(); const r = await sdk.auth.signInWithPassword(account); if (r.error) throw Error('Fixture sign-in failed'); }, qa);
  const amberId = await create(page, qa.fixtures[0]);
  await until(s => s.calls.some(c => c.label === 'Amber'), 'Amber call held');
  const indigo = await page.context().newPage(); await prepare(indigo);
  try {
    const indigoId = await create(indigo, qa.fixtures[1]);
    const initial = await until(s => s.calls.some(c => c.label === 'Indigo'), 'Indigo call held');
    check(amberId !== indigoId && initial.jobs.length === 2 && initial.jobs.every(j => j.status === 'running'), 'two distinct jobs are actively building at once');
    check(initial.calls.length === 2, 'one initial model call per independent setup');
    await page.reload();
    check(await page.evaluate(() => new URL(location.href).searchParams.get('workspace')) === amberId, 'refresh stays in the selected build');
    await control('curriculum:Indigo'); await approveBoth(indigo, 'Indigo');
    const beforeAmber = await until(s => s.insertArrivals.includes('Indigo'), 'Indigo waits at save');
    check(beforeAmber.jobs.find(j => j.id === amberId).stage === 'intake', 'progress in one course does not advance another');
    check(beforeAmber.calls.filter(c => c.label === 'Amber').length === 1, 'refresh does not redispatch the held course');
    await control('curriculum:Amber'); await approveBoth(page, 'Amber');
    const bothSaving = await until(s => s.insertArrivals.length === 2, 'both insert attempts overlap');
    check(bothSaving.jobs.every(j => j.status === 'running' && j.stage === 'assemble') && !bothSaving.courses.length, 'both courses reach the same unclaimed slug before either insert');
    check(await page.evaluate(() => new URL(location.href).searchParams.get('workspace')) === amberId && await indigo.evaluate(() => new URL(location.href).searchParams.get('workspace')) === indigoId, 'each tab retains its own course workspace');
    await indigo.getByText('More actions', { exact: true }).click();
    let alertMessage = '', resolveAlert; const alertSeen = new Promise(resolve => { resolveAlert = resolve; });
    indigo.on('dialog', async dialog => {
      if (dialog.type() === 'confirm') {
        await control('parallel-save');
        await until(s => s.jobs.filter(j => [amberId, indigoId].includes(j.id)).every(j => j.status === 'completed'), 'completion wins before cancel confirmation');
      } else alertMessage = dialog.message();
      await dialog.accept(); if (dialog.type() === 'alert') resolveAlert();
    });
    await indigo.locator('[data-job-action="cancel"]').click(); await alertSeen;
    check(cancelReplies[0].status === 409 && cancelReplies[0].request.expected.status === 'running', 'stale cancellation loses to a completed save');
    check(alertMessage.includes('No action was taken') && alertMessage.includes('latest version'), 'late cancellation gives an honest recovery message');
    const completed = await control();
    check(completed.collisions === 1 && completed.courses.length === 2, 'real unique-key collision is recovered without overwriting either course');
    check(new Set(completed.courses.map(c => c.id)).size === 2, 'same model slug produces distinct account course IDs');
    await page.getByRole('link', { name: /^Open course/ }).waitFor(); await indigo.getByRole('link', { name: /^Open course/ }).waitFor();
    const amberHref = await page.getByRole('link', { name: /^Open course/ }).getAttribute('href'), indigoHref = await indigo.getByRole('link', { name: /^Open course/ }).getAttribute('href');
    check(amberHref !== indigoHref, 'Ready links point at their corresponding saved courses');
    await page.getByRole('link', { name: /^Open course/ }).click(); await page.getByRole('link', { name: /^Module 1 Light and composition/ }).click();
    await page.getByRole('heading', { name: 'Amber lesson-1', exact: true }).waitFor();
    check(await page.locator('[data-checklist-item="clear-space"]').count() === 1, 'Amber learner receives its selected checklist');
    await page.locator('[data-checklist-item="clear-space"]').check();
    await indigo.getByRole('link', { name: /^Open course/ }).click(); await indigo.getByRole('link', { name: /^Module 1 Light and composition/ }).click();
    await indigo.getByRole('heading', { name: 'Indigo lesson-1', exact: true }).waitFor();
    check(await indigo.locator('[data-checklist-item]').count() === 0, 'Indigo does not inherit Amber material choices');
    check(!(await indigo.locator('main').textContent()).includes('Amber course example'), 'learner content does not cross course boundaries');
    await page.reload(); await page.getByRole('heading', { name: 'Amber lesson-1', exact: true }).waitFor();
    check(await page.locator('[data-checklist-item="clear-space"]').isChecked(), 'Amber progress survives learning in the other tab');
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 900 }); await page.goto(qa.base + '/?experience=workspace&filter=mine');
      await page.getByRole('link', { name: 'Amber Photography', exact: true }).waitFor(); await page.getByRole('link', { name: 'Indigo Photography', exact: true }).waitFor();
      check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'both independent courses fit the library at ' + width + 'px');
      await page.screenshot({ path: `output/playwright/concurrent-courses-${width}.png`, fullPage: true });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const goldId = await create(page, qa.fixtures[2]); await control('curriculum:Gold'); await approveBoth(page, 'Gold');
    const provisional = await until(s => s.goldInserted, 'provisional Gold course inserted before final checkpoint');
    check(provisional.courses.length === 3 && provisional.jobs.find(j => j.id === goldId).status === 'running', 'cancellation test reaches a real provisional DB save');
    await page.getByText('More actions', { exact: true }).click(); page.once('dialog', d => d.accept());
    await page.locator('[data-job-action="cancel"]').click();
    await until(s => s.jobs.find(j => j.id === goldId).status === 'cancelling', 'cancel accepted before finalize');
    check(cancelReplies.at(-1).status === 200, 'current cancellation is accepted while final save is incomplete');
    await control('gold-inserted');
    const cancelled = await until(s => s.jobs.find(j => j.id === goldId).status === 'cancelled', 'runner drains and rolls back');
    check(cancelled.courses.length === 2 && !cancelled.courses.some(c => c.jobId === goldId), 'cancelled provisional course is removed, other two preserved');
    check(cancelled.jobs.filter(j => j.id !== goldId).every(j => j.status === 'completed'), 'cancellation cannot change another build');
    await page.goto(qa.base + '/?experience=workspace&filter=mine');
    await page.getByRole('link', { name: 'Amber Photography', exact: true }).waitFor(); await page.getByRole('link', { name: 'Indigo Photography', exact: true }).waitFor();
    const local = await page.evaluate(async module => Object.values((await import(module))._readAllCourses()).map(c => ({ id: c.config?.id, jobId: c._generationJobId })), qa.coursesModule);
    check(!local.some(c => c.jobId === goldId), 'cancelled provisional course does not survive in the local library');
    check(!errors.length, 'no browser exceptions: ' + errors.join('; '));
    const report = { checks: checks.length, passed: checks, scope: 'Actual local browser/Auth/API/DB and full runner; synthetic model outputs, controlled save races; not hosted or real-provider quality.' };
    await page.evaluate(report => { window.__concurrentQAReport = report; }, report); return report;
  } catch (error) {
    await page.evaluate(report => { window.__concurrentQAReport = report; }, { checks: checks.length, passed: checks, error: error.message });
    throw error;
  } finally { await indigo.close(); }
})
