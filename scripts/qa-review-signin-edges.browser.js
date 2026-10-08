(async page => {
  const checks = [], errors = [];
  const check = (ok, text) => { if (!ok) throw new Error(text); checks.push(text); };
  page.on('pageerror', error => errors.push(error.message));
  // Real controllers and isolated IndexedDB; identity/mail/creation are doubles.
  // This fixture never changes the signed-in user's drafts or backend account.
  await page.route('**/qa-signin-edges*', route => route.fulfill({ contentType: 'text/html', body: '<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/tokens.css"><link rel="stylesheet" href="/styles/base.css"><link rel="stylesheet" href="/styles/home.css?v=8"></head><body data-experience="workspace"><main id="content"></main></body></html>' }));
  await page.goto('http://127.0.0.1:4173/qa-signin-edges');
  await page.evaluate(async () => {
    const { createDraftStore } = await import('/js/draft-store.js?v=3');
    const { createSetupController } = await import('/js/course-setup.js?v=3');
    const { setupDraft } = await import('/js/setup-model.js?v=1');
    const { createSetupHandoffs } = await import('/js/setup-handoff.js?v=1');
    const q = window.__signinEdges = { owner: null, id: `edge-${crypto.randomUUID()}`, other: `other-${crypto.randomUUID()}`, calls: 0, mail: 0, held: false, failSave: false };
    q.store = createDraftStore({ dbName: `signin-edges-${crypto.randomUUID()}` });
    q.markers = createSetupHandoffs();
    const draft = setupDraft('Selected private setup'); draft.brief.audience = 'Test learner'; draft.step = 'review';
    draft.sources.notes = [{ id: 'n1', title: 'Private transcript', text: 'Only selected content' }];
    await q.store.save({ id: q.id, ...draft });
    await q.store.save({ id: q.other, ...draft, brief: { ...draft.brief, topic: 'Unrelated guest setup' } });
    q.render = () => { const p = new URLSearchParams(location.search); return q.controller.render(document.querySelector('#content'), p.get('draft') || q.id, p.get('step') || 'review'); };
    q.navigate = url => { history.pushState(null, '', url); return q.render(); };
    q.controller = createSetupController({
      getOwner: () => q.owner, getIdentity: () => q.owner ? { id: q.owner, email: `${q.owner}@example.test` } : null,
      navigate: q.navigate, store: { ...q.store, save: (...args) => { if (q.failSave) throw Object.assign(new Error('Quota failure'), { code: 'quota' }); return q.store.save(...args); } },
      accountClient: { restore: async () => { throw Object.assign(new Error('Missing'), { code: 'missing' }); } },
      sendLink: async () => { q.mail++; if (q.held) await new Promise(resolve => { q.releaseMail = resolve; }); },
      createCourse: async input => { q.calls++; q.input = input; if (q.held) await new Promise(resolve => { q.releaseCreate = resolve; }); }
    });
    document.addEventListener('click', event => { const link = event.target.closest('a'); if (link?.getAttribute('href')?.includes('draft=')) { event.preventDefault(); q.navigate(link.getAttribute('href')); } });
    await q.navigate(`?experience=workspace&draft=${q.id}&step=review`);
  });
  await page.evaluate(async () => { const q=window.__signinEdges; q.owner='owner-a'; await q.render(); });
  check(await page.getByRole('heading', { name: 'Setup unavailable' }).isVisible(), 'generic sign-in without a selected marker cannot claim guest content');
  check(await page.evaluate(async () => (await window.__signinEdges.store.load(window.__signinEdges.id)).status) === 'found', 'unselected guest data remains intact');
  await page.evaluate(async () => { const q=window.__signinEdges; q.owner=null; await q.render(); });
  await page.getByRole('button', { name: 'Create course' }).click();
  await page.getByLabel('Email address').waitFor();
  await page.evaluate(async () => { const q=window.__signinEdges; q.owner='owner-a'; await q.render(); });
  check(await page.getByRole('dialog').count() === 0 && await page.locator('.setup-create-context').filter({ hasText: 'owner-a' }).isVisible(), 'contextual sign-in returns directly to account-aware Review');
  check(await page.evaluate(() => window.__signinEdges.calls) === 0, 'authentication does not execute the creation callback');
  check(await page.evaluate(async () => (await window.__signinEdges.store.load(window.__signinEdges.other)).status) === 'found', 'only the selected guest setup is attached');
  await page.evaluate(() => { window.__signinEdges.held=true; });
  await page.getByRole('button', { name: 'Create course' }).click();
  check(await page.getByRole('button', { name: 'Create course' }).isDisabled(), 'Create is disabled during continuation');
  await page.evaluate(() => document.querySelector('[data-setup-action="create"]').click());
  check(await page.evaluate(() => window.__signinEdges.calls) === 1, 'repeated Create clicks invoke continuation once');
  check(await page.evaluate(() => { const q=window.__signinEdges; return q.input.ownerId === 'owner-a' && q.input.id === q.id && q.input.draft.sources.notes[0].text === 'Only selected content'; }), 'continuation receives authenticated owner and full selected content');
  await page.evaluate(async () => { const q=window.__signinEdges; q.owner='owner-b'; await q.render(); q.releaseCreate(); });
  check(await page.getByRole('heading', { name: 'Setup unavailable' }).isVisible() && !(await page.locator('#content').textContent()).includes('Selected private setup'), 'account switch hides the first account’s setup during an in-flight continuation');
  await page.evaluate(async () => { const q=window.__signinEdges; q.owner=null; q.id=q.other; q.held=true; await q.navigate(`?experience=workspace&draft=${q.id}&step=review`); });
  await page.getByRole('button', { name: 'Create course' }).click();
  await page.getByLabel('Email address').fill('pending@example.test');
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await page.getByRole('button', { name: 'Sending…' }).waitFor();
  await page.getByRole('button', { name: 'Close sign-in' }).click();
  await page.evaluate(() => window.__signinEdges.releaseMail());
  await page.getByRole('heading', { name: 'Unrelated guest setup', exact: true }).waitFor();
  check(await page.getByRole('dialog').count() === 0 && await page.getByRole('heading', { name: 'Unrelated guest setup', exact: true }).isVisible(), 'late email completion never reopens a dismissed dialog');
  await page.getByRole('button', { name: 'Create course' }).click();
  await page.getByRole('heading', { name: 'Check your email', exact: true }).waitFor();
  await page.keyboard.press('Tab');
  check(await page.evaluate(() => !!document.activeElement.closest('dialog')), 'keyboard focus stays in the native modal');
  await page.getByRole('button', { name: 'Back to review' }).click();
  await page.evaluate(async () => { const q=window.__signinEdges; localStorage.setItem(`learnable-setup-handoff:${q.id}`, JSON.stringify({ id: q.id, guest: true, expiresAt: Date.now() - 1 })); q.owner='owner-a'; await q.render(); });
  check(await page.getByRole('heading', { name: 'Setup unavailable' }).isVisible(), 'expired marker cannot silently import a guest setup');
  await page.evaluate(async () => { const q=window.__signinEdges; q.owner=null; q.held=false; await q.render(); });
  await page.getByRole('link', { name: 'Edit goal', exact: true }).click();
  await page.evaluate(() => { window.__signinEdges.failSave=true; });
  await page.getByLabel('Who is it for?').fill('Unsaved revised learner');
  await page.getByRole('navigation', { name: 'Course setup steps' }).getByRole('link', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Create course' }).click();
  check(await page.getByRole('dialog').count() === 0 && await page.getByRole('button', { name: 'Retry saving' }).isVisible(), 'storage failure presents recovery instead of risking data loss through sign-in');
  check(errors.length === 0, 'edge-case fixture has no uncaught JavaScript errors');
  return { checks, total: checks.length, mode: 'real controllers and isolated IndexedDB with auth/mail/creation doubles' };
})
