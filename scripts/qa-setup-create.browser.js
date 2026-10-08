(async page => {
  const checks = [], errors = [];
  const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/qa-setup-create', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet"><link rel="stylesheet" href="/styles/tokens.css"><link rel="stylesheet" href="/styles/base.css"><link rel="stylesheet" href="/styles/themes.css"><link rel="stylesheet" href="/styles/home.css?v=10"></head><body class="home-mode" data-experience="workspace"><main class="app-main"><div class="app-main-inner" id="content"></div></main></body></html>' }));
  await page.goto('http://127.0.0.1:4173/qa-setup-create');
  await page.evaluate(async () => {
    const { createSetupController } = await import('/js/course-setup.js?v=5');
    const { createDraftStore } = await import('/js/draft-store.js?v=3');
    const { setupDraft } = await import('/js/setup-model.js?v=1');
    const q = window.__createQA = { user: { id: 'qa-owner', email: 'learner@example.test' }, saves: 0, starts: 0, connects: 0, opens: [], routes: [], connected: false, issues: [], failure: '', hold: false, existing: false };
    q.store = createDraftStore({ dbName: `learnable-creation-qa-${crypto.randomUUID()}` });
    const draft = setupDraft('A practical introduction to photography'); draft.brief.audience = 'Complete beginners'; draft.step = 'review';
    draft.sources.notes = [{ id: 'n1', title: 'Workshop transcript', text: 'Use natural light and start with a simple subject.' }];
    q.id = `setup-qa-${crypto.randomUUID()}`;
    await q.store.save({ id: q.id, ...draft }, { ownerId: q.user.id, expectedRevision: 0 });
    const generationClient = {
      async check() { if (q.existing) return { existing: true, jobId: 'job-qa-existing' }; return { ready: q.connected && !q.issues.length, connected: q.connected, issues: q.issues, enabled: true, model: 'claude-sonnet-4-5' }; },
      async connect(owner, key) { q.connects++; if (!key.startsWith('sk-ant-')) throw new Error('Claude rejected this API key.'); q.connected = true; },
      async disconnect() { q.connected = false; },
      async start() { q.starts++; if (q.hold) await new Promise(resolve => { q.release = resolve; }); if (q.failure) throw new Error(q.failure); return { jobId: 'job-qa-canonical' }; }
    };
    q.controller = createSetupController({ store: q.store, getOwner: () => q.user?.id || null, getIdentity: () => q.user, generationClient,
      accountClient: { save: async () => { q.saves++; if (q.saveFailure) throw new Error('Couldn’t save your request. Try again.'); return { revision: 1, contentHash: 'qa', updatedAt: new Date().toISOString() }; }, list: async () => ({ drafts: [] }) },
      openJob: async job => q.opens.push(job), navigate: url => { q.routes.push(url); const params = new URLSearchParams(url); return q.controller.render(document.querySelector('#content'), q.id, params.get('step')); }
    });
    q.show = step => q.controller.render(document.querySelector('#content'), q.id, step);
    await q.show('review');
  });
  await page.getByRole('button', { name: 'Create course →', exact: true }).click();
  await page.getByRole('heading', { name: 'Connect Claude to create your plan' }).waitFor();
  check(await page.evaluate(() => window.__createQA.routes.at(-1).includes('step=create') && window.__createQA.saves === 1 && window.__createQA.starts === 0), 'signed-in Review saves the request and checks readiness without starting AI');
  check(await page.getByLabel('Claude API key', { exact: true }).getAttribute('type') === 'password', 'API key is masked and labeled');
  check(await page.getByText('A practical introduction to photography', { exact: true }).isVisible(), 'course name remains visible');
  check(await page.getByRole('button', { name: 'Create course plan →', exact: true }).count() === 0, 'cannot generate without connection');
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: 'output/playwright/setup-create-connect-1440.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  const fits = () => page.evaluate(() => document.documentElement.scrollWidth <= innerWidth);
  check(await fits(), 'connection form fits mobile without horizontal scrolling');
  await page.screenshot({ path: 'output/playwright/setup-create-connect-390.png', fullPage: true });
  await page.getByLabel('Claude API key', { exact: true }).fill('bad-key');
  await page.getByRole('button', { name: 'Connect Claude', exact: true }).click();
  await page.getByText('Claude rejected this API key.', { exact: true }).waitFor();
  check(await page.getByLabel('Claude API key', { exact: true }).inputValue() === '', 'failed key is cleared, not retained in DOM');
  check(await page.locator('[data-creation-error]').evaluate(el => el === document.activeElement), 'connection errors receive keyboard focus');
  await page.getByLabel('Claude API key', { exact: true }).fill('sk-ant-synthetic-QA-not-real');
  await page.getByRole('button', { name: 'Connect Claude', exact: true }).click();
  await page.getByRole('button', { name: 'Create course plan →', exact: true }).waitFor();
  check(await page.evaluate(() => window.__createQA.starts === 0), 'connecting never automatically starts a paid job');
  check((await page.locator('.setup-create-consent').textContent()).includes('billed to your provider account'), 'cost and source-sharing disclosure appears before confirmation');
  check(await page.evaluate(async () => { const q=window.__createQA; const saved=await q.store.load(q.id,q.user.id); return !JSON.stringify(saved).includes('sk-ant-') && !JSON.stringify(localStorage).includes('sk-ant-synthetic-QA-not-real'); }), 'key absent from saved draft and localStorage');
  check(await fits(), 'ready confirmation fits mobile');
  await page.screenshot({ path: 'output/playwright/setup-create-ready-390.png', fullPage: true });
  await page.setViewportSize({ width: 1440, height: 1100 });
  await page.screenshot({ path: 'output/playwright/setup-create-ready-1440.png', fullPage: true });
  await page.evaluate(() => { window.__createQA.hold = true; });
  await page.getByRole('button', { name: 'Create course plan →', exact: true }).click();
  check(await page.getByRole('button', { name: 'Please wait…', exact: true }).isDisabled(), 'creation confirmation disabled while pending');
  await page.evaluate(() => { document.querySelector('[data-create-action="start"]').click(); window.__createQA.release(); });
  await page.waitForFunction(() => window.__createQA.opens.length === 1);
  check(await page.evaluate(() => window.__createQA.starts === 1 && window.__createQA.opens[0] === 'job-qa-canonical'), 'duplicate click cannot launch a second request and success opens progress');
  await page.evaluate(async () => { const q=window.__createQA; q.hold=false; q.failure='The request couldn’t be confirmed. Retry to check your saved progress before starting again.'; await q.show('create'); });
  await page.getByRole('button', { name: 'Create course plan →', exact: true }).click();
  await page.getByText('The request couldn’t be confirmed. Retry to check your saved progress before starting again.', { exact: true }).waitFor();
  check(await page.getByRole('button', { name: 'Create course plan →', exact: true }).isEnabled(), 'ambiguous start remains retryable');
  await page.evaluate(async () => { const q=window.__createQA; q.failure=''; q.issues=[{step:'context',text:'guide.pdf: Paste the text into Notes for this release.'}]; await q.show('create'); });
  await page.getByRole('heading', { name: 'A few things to adjust' }).waitFor();
  check((await page.getByRole('link', { name: 'Edit context', exact: true }).getAttribute('href')).includes('step=context') && await page.getByRole('button', {name:'Create course plan →',exact:true}).count() === 0, 'unsupported source offers contextual fix and blocks start');
  await page.setViewportSize({ width: 390, height: 844 });
  check(await fits(), 'source errors fit mobile');
  await page.screenshot({ path: 'output/playwright/setup-create-issues-390.png', fullPage: true });
  await page.evaluate(async () => { const q=window.__createQA; q.existing=true; q.issues=[]; await q.show('create'); });
  await page.waitForFunction(() => window.__createQA.opens.includes('job-qa-existing'));
  check(await page.evaluate(() => window.__createQA.starts === 2), 'returning to existing job reattaches without another start');
  await page.evaluate(async () => { const q=window.__createQA; q.existing=false; q.saveFailure=true; await q.show('create'); });
  await page.getByText('Couldn’t save your request. Try again.', { exact: true }).waitFor();
  check(await page.getByRole('button', { name: 'Check again', exact: true }).isEnabled() && await page.getByRole('link', {name:'Keep editing'}).isVisible(), 'save failure preserves an escape and a retry');
  await page.evaluate(async () => { const q=window.__createQA; q.saveFailure=false; q.hold=true; await q.show('create'); });
  await page.getByRole('button', { name: 'Create course plan →', exact: true }).click();
  const opened = await page.evaluate(() => window.__createQA.opens.length);
  await page.evaluate(() => { const q=window.__createQA; q.user={id:'other',email:'other@example.test'}; q.release(); });
  // Resolve microtasks; no arbitrary sleep needed.
  await page.evaluate(() => Promise.resolve());
  check(await page.evaluate(() => window.__createQA.opens.length) === opened, 'late response cannot open previous owner’s job');
  check(errors.length === 0, 'no uncaught JavaScript errors');
  return { checks, total: checks.length, mode: 'real controller/IndexedDB/styles; account and generation services are doubles; no paid provider calls' };
})
