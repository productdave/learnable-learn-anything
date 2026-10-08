(async (page) => {
  const checks = [], errors = [], writes = [];
  const check = (ok, text) => { if (!ok) throw new Error(text); checks.push(text); };
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => { if (req.method() === 'POST') writes.push(req.url()); });
  await page.goto('http://127.0.0.1:4173/?experience=workspace');
  await page.setViewportSize({ width: 1440, height: 1000 });
  // Actual anonymous application journey. Do not send a real email.
  await page.getByLabel('What do you want to learn or teach?').fill('Build a parent-led swimming course');
  await page.getByRole('button', { name: 'Create course', exact: true }).click();
  await page.getByLabel('Who is it for?').fill('Parent teaching a four-year-old beginner');
  await page.getByRole('navigation', { name: 'Course setup steps' }).getByRole('link', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Save to account' }).click();
  await page.getByRole('heading', { name: 'Sign in to save your setup', exact: true }).waitFor();
  check(await page.getByRole('dialog').count() === 0, 'real app review opens contextual account route, not a modal');
  check(await page.getByLabel('Email address').isVisible(), 'real account step has visible email label');
  check(await page.evaluate(() => scrollY < 10), 'intentional account navigation starts at heading, not old review scroll position');
  await page.screenshot({ path: 'output/playwright/account-setup-real-entry-1440.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('link', { name: 'Keep editing', exact: true }).click();
  await page.getByRole('heading', { name: 'Build a parent-led swimming course', exact: true }).waitFor();
  check(await page.getByRole('heading', { name: 'Build a parent-led swimming course', exact: true }).isVisible(), 'declining sign-in preserves selected setup');

  // Isolated UI fixture: real controllers + IndexedDB; deterministic identity,
  // mail and account service doubles. No Supabase session or backend is changed.
  await page.route('**/qa-account-ui*', route => route.fulfill({ contentType: 'text/html', body: `<!doctype html><html lang="en" data-theme="light"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link href="https://fonts.googleapis.com/css2?family=Plus+Jakarta+Sans:wght@400;500;600;700;800&display=swap" rel="stylesheet"><link rel="stylesheet" href="/styles/tokens.css?v=1"><link rel="stylesheet" href="/styles/base.css?v=1"><link rel="stylesheet" href="/styles/components.css?v=22"><link rel="stylesheet" href="/styles/learnable.css?v=7"><link rel="stylesheet" href="/styles/themes.css?v=1"><link rel="stylesheet" href="/styles/home.css?v=7"></head><body class="home-mode" data-experience="workspace"><header class="app-header"><strong>Learnable</strong><span>Account-save QA fixture</span></header><main class="app-main"><div class="app-main-inner" id="content"></div></main></body></html>` }));
  await page.goto('http://127.0.0.1:4173/qa-account-ui');
  await page.evaluate(async () => {
    const { createDraftStore } = await import('/js/draft-store.js?v=3');
    const { createSetupController } = await import('/js/course-setup.js?v=2');
    const { setupDraft } = await import('/js/setup-model.js?v=1');
    const { prepareAccountPayload } = await import('/js/setup-account-model.js?v=1');
    const qa = window.__accountQA = { user: null, id: `qa-setup-${crypto.randomUUID()}`, otherId: `qa-other-${crypto.randomUUID()}`, store: createDraftStore({ dbName: `qa-account-${crypto.randomUUID()}` }), sendError: false, sent: [], mode: '', saveCalls: 0, rows: new Map() };
    const draft = setupDraft('Little Swimmer · parent-led practice'); draft.brief.audience = 'Parent and four-year-old'; draft.brief.context = 'Fifteen-minute sessions'; draft.step = 'review'; draft.components.push('images', 'checklists');
    draft.sources.notes = [{ id: 'note-one', title: 'Transcript', text: 'Calm practice; stop when distressed.' }];
    draft.sources.links = [{ id: 'link-one', title: '', url: 'https://example.com/swimming' }];
    draft.sources.files = [{ id: 'file-one', name: 'transcript.txt', blob: new Blob(['Original transcript']) }, { id: 'file-two', name: 'lesson-notes.txt', blob: new Blob(['Second original']) }];
    await qa.store.save({ id: qa.id, ...draft });
    await qa.store.save({ id: qa.otherId, ...draft, brief: { ...draft.brief, topic: 'Unrelated private guest idea' } });
    qa.client = {
      async save(owner, id, input, expected, progress) {
        qa.saveCalls++;
        if (qa.mode === 'conflict') throw Object.assign(new Error('The account has a newer version. Keep both with a separate copy.'), { code: 'conflict' });
        progress([{ name: 'transcript.txt', status: 'Transferred' }, { name: 'lesson-notes.txt', status: 'Uploading…' }]);
        if (qa.mode === 'partial') { progress([{ name: 'transcript.txt', status: 'Transferred' }, { name: 'lesson-notes.txt', status: 'Upload failed — retry' }]); throw Object.assign(new Error('One file transferred; lesson-notes.txt failed. The new account revision is not saved. Retry keeps successful files.'), { code: 'upload' }); }
        if (qa.mode === 'hold') await new Promise(resolve => { qa.release = resolve; });
        const prepared = await prepareAccountPayload(input);
        const ack = { id, revision: expected + 1, contentHash: prepared.hash, updatedAt: new Date().toISOString() };
        qa.rows.set(`${owner}/${id}`, { draft: structuredClone(input), cloud: ack, missing: 0 }); return ack;
      },
      async restore(owner, id) { const row = qa.rows.get(`${owner}/${id}`); if (!row) throw Object.assign(new Error('Missing'), { code: 'missing' }); return structuredClone(row); },
      async list(owner) { return { drafts: [...qa.rows.entries()].filter(([key]) => key.startsWith(owner + '/')).map(([,row]) => ({ id: row.cloud.id, brief: row.draft.brief, revision: row.cloud.revision, updated_at: row.cloud.updatedAt })), limit: 100 }; }
    };
    qa.render = () => { const params = new URLSearchParams(location.search); return qa.controller.render(document.querySelector('#content'), params.get('draft') || qa.id, params.get('step') || 'review'); };
    qa.navigate = url => { history.pushState(null, '', url); return qa.render(); };
    qa.newController = () => { qa.controller?.dispose(); qa.controller = createSetupController({ getOwner: () => qa.user?.id || null, getIdentity: () => qa.user, navigate: qa.navigate, store: qa.store, accountClient: qa.client, sendLink: async (email, url) => { if (qa.sendError) throw new Error('Couldn’t send the link. Check your connection and try again.'); qa.sent.push({ email, url }); }, signOutAccount: async () => { qa.user = null; await qa.render(); } }); };
    qa.newController();
    document.addEventListener('click', event => { const link = event.target.closest('a'); if (link?.getAttribute('href')?.includes('draft=')) { event.preventDefault(); qa.navigate(link.getAttribute('href')); } });
    await qa.navigate(`?experience=workspace&draft=${qa.id}&step=review`);
  });
  await page.getByRole('button', { name: 'Save to account' }).click();
  await page.getByLabel('Email address').fill('parent@example.com');
  await page.evaluate(() => { window.__accountQA.sendError = true; });
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await page.locator('#setup-auth-message').filter({ hasText: 'Couldn’t send' }).waitFor();
  check(await page.getByLabel('Email address').inputValue() === 'parent@example.com', 'send failure retains email and setup context');
  await page.evaluate(() => { window.__accountQA.sendError = false; });
  await page.getByRole('button', { name: 'Email me a sign-in link' }).click();
  await page.getByRole('heading', { name: 'Check your email', exact: true }).waitFor();
  check(await page.getByRole('button', { name: 'Resend sign-in link' }).isDisabled(), 'resend has explicit local cooldown');
  const marker = await page.evaluate(() => localStorage.getItem(`learnable-setup-handoff:${window.__accountQA.id}`));
  check(!marker.includes('parent@example.com') && !marker.includes('Transcript') && marker.includes('expiresAt'), 'handoff marker has no email or private source content');
  const returnURL = await page.evaluate(() => window.__accountQA.sent[0].url);
  check(returnURL.includes('step=account') && !returnURL.includes('parent'), 'email return uses selected opaque setup route');
  await page.screenshot({ path: 'output/playwright/account-setup-email-pending-1440.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('link', { name: 'Keep editing', exact: true }).click();
  await page.getByRole('button', { name: 'Save to account' }).click();
  await page.getByRole('heading', { name: 'Check your email', exact: true }).waitFor();
  check(await page.getByRole('heading', { name: 'Check your email', exact: true }).isVisible(), 'keep editing and return preserves pending-email state');
  await page.evaluate(async () => { window.__accountQA.user = { id: 'qa-owner-a', email: 'parent@example.com' }; await window.__accountQA.render(); });
  check(await page.getByRole('button', { name: 'Save setup to this account' }).isVisible(), 'successful identity return still needs explicit account-save confirmation');
  check(await page.evaluate(() => window.__accountQA.saveCalls) === 0, 'sign-in alone never uploads or saves');
  await page.screenshot({ path: 'output/playwright/account-setup-confirm-1440.png', fullPage: true, animations: 'disabled' });
  await page.evaluate(() => { window.__accountQA.mode = 'partial'; });
  await page.getByRole('button', { name: 'Save setup to this account' }).click();
  await page.locator('#setup-auth-message').filter({ hasText: 'new account revision is not saved' }).waitFor();
  const claimed = await page.evaluate(async () => { const q=window.__accountQA; const guest=await q.store.load(q.id); const account=await q.store.load(q.id, q.user.id); const other=await q.store.load(q.otherId); return { guest: guest.status, owned: account.status, bytes: await account.draft.sources.files[0].blob.text(), other: other.status }; });
  check(claimed.guest === 'missing' && claimed.owned === 'found' && claimed.bytes === 'Original transcript', 'explicit confirmation atomically account-binds original local bytes despite upload failure');
  check(claimed.other === 'found', 'unselected guest draft remains untouched');
  check(await page.getByRole('heading', { name: 'Saved to your account', exact: true }).count() === 0, 'partial upload never shows complete success');
  await page.setViewportSize({ width: 390, height: 844 });
  await page.screenshot({ path: 'output/playwright/account-setup-partial-390.png', fullPage: true, animations: 'disabled' });
  await page.evaluate(async () => { window.__accountQA.user = { id: 'qa-owner-b', email: 'other@example.com' }; await window.__accountQA.render(); });
  check(await page.getByText('Little Swimmer · parent-led practice', { exact: true }).count() === 0 && await page.getByRole('button', { name: 'Save setup to this account' }).count() === 0 && !(await page.locator('#content').textContent()).includes('lesson-notes.txt'), 'account switch hides in-flight account-owned setup and source errors');
  await page.evaluate(async () => { window.__accountQA.user = { id: 'qa-owner-a', email: 'parent@example.com' }; window.__accountQA.mode = 'hold'; await window.__accountQA.render(); });
  const before = await page.evaluate(() => window.__accountQA.saveCalls);
  await page.getByRole('button', { name: 'Save setup to this account' }).click();
  await page.getByRole('button', { name: 'Saving to your account…' }).waitFor();
  check(await page.getByRole('button', { name: 'Saving to your account…' }).isDisabled(), 'double-submit disabled while save is pending');
  await page.evaluate(() => document.querySelector('[data-account-action="save"]').click());
  check(await page.evaluate(() => window.__accountQA.saveCalls) === before + 1, 'repeated click does not duplicate account-save call');
  await page.evaluate(() => { window.__accountQA.release(); window.__accountQA.mode = ''; });
  await page.getByRole('heading', { name: 'Saved to your account', exact: true }).waitFor();
  check(await page.evaluate(async () => (await window.__accountQA.store.load(window.__accountQA.id, 'qa-owner-a')).draft.cloud.revision) === 1, 'server acknowledgement retained in account-local record');
  await page.evaluate(() => scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: 'output/playwright/account-setup-success-390.png', fullPage: true, animations: 'disabled' });
  await page.getByRole('link', { name: 'Keep editing', exact: true }).click();
  await page.getByRole('navigation', { name: 'Course setup steps' }).getByRole('link', { name: 'Context', exact: true }).click();
  await page.getByLabel('Anything else the course').fill('New local edits after backup');
  await page.getByRole('button', { name: 'Review setup' }).click();
  await page.getByRole('button', { name: 'Save to account' }).click();
  // A fresh edit must not retain the old success card as if it saved these edits.
  await page.getByRole('button', { name: 'Save setup to this account' }).waitFor();
  check(await page.getByRole('button', { name: 'Save setup to this account' }).isVisible(), 'new edits return to explicit save, not stale success');
  await page.evaluate(() => { window.__accountQA.mode = 'conflict'; });
  await page.getByRole('button', { name: 'Save setup to this account' }).click();
  await page.getByRole('button', { name: 'Make a separate setup copy' }).waitFor();
  await page.getByRole('button', { name: 'Make a separate setup copy' }).click();
  await page.waitForFunction(() => new URLSearchParams(location.search).get('draft') !== window.__accountQA.id);
  await page.getByRole('button', { name: 'Save setup to this account' }).waitFor();
  check(await page.evaluate(() => new URLSearchParams(location.search).get('draft') !== window.__accountQA.id), 'conflict creates a separate local setup without overwriting account backup');
  await page.evaluate(async () => { const q=window.__accountQA; q.mode=''; q.store=(await import('/js/draft-store.js?v=3')).createDraftStore({ dbName:`qa-account-fresh-${crypto.randomUUID()}` }); q.newController(); await q.navigate(`?experience=workspace&draft=${q.id}&step=context`); });
  await page.getByLabel('Anything else the course').waitFor();
  check(await page.getByLabel('Anything else the course').inputValue() === 'Fifteen-minute sessions', 'fresh-browser simulation restores acknowledged account version, not unsaved later edits');
  await page.getByRole('button', { name: /^Files/ }).click();
  check(await page.getByText('transcript.txt', { exact: true }).isVisible(), 'fresh device restores original file entries');
  await page.evaluate(async () => {
    const q = window.__accountQA, loaded = (await q.store.load(q.id, q.user.id)).draft;
    loaded.sources.files[0].blob = null;
    await q.store.save(loaded, { ownerId: q.user.id, expectedRevision: loaded.revision });
    q.newController(); await q.navigate(`?experience=workspace&draft=${q.id}&step=context`);
  });
  await page.getByRole('button', { name: 'Retry account originals' }).click();
  await page.waitForFunction(async () => !!(await window.__accountQA.store.load(window.__accountQA.id, window.__accountQA.user.id)).draft.sources.files[0].blob);
  check(true, 'failed original download can be retried without replacing local text');
  await page.getByRole('navigation', { name: 'Course setup steps' }).getByRole('link', { name: 'Review', exact: true }).click();
  await page.getByRole('button', { name: 'Save to account' }).click();
  await page.getByRole('button', { name: 'Save setup to this account' }).waitFor();
  for (const width of [320, 390, 768, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    const size=await page.evaluate(()=>({ overflow:Math.max(0,document.documentElement.scrollWidth-innerWidth), button:document.querySelector('[data-account-action="save"]').getBoundingClientRect().height }));
    check(size.overflow===0 && size.button>=44, `account confirmation responsive at ${width}px`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => document.documentElement.dataset.theme='dark');
  await page.screenshot({ path: 'output/playwright/account-setup-confirm-dark-390.png', fullPage: true, animations: 'disabled' });
  await page.evaluate(async () => { const q=window.__accountQA; await q.navigate(`?experience=workspace&draft=qa-another-browser&step=account`); });
  check(await page.getByText('This browser doesn’t have the selected setup', { exact: true }).isVisible(), 'different-browser callback gives honest missing-setup guidance');
  check(await page.getByRole('button', { name: 'Save setup to this account' }).count()===0, 'missing setup cannot claim save success');
  check(errors.length===0, `no page errors: ${errors.join(', ')}`);
  check(writes.length===0, 'no real OTP email, account backend mutation or generation request');
  const result={passed:checks.length,checks,errors,backendWrites:writes.length};
  await page.evaluate(result=>{window.__accountUIResult=result;},result); return result;
})
