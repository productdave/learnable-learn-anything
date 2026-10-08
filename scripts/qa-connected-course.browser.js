(async page => {
  const qa = __CONNECTED_QA__, checks = [], errors = [], apiRequests = [];
  let loseSaveReply = false;
  const check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
  const curriculumState = async action => {
    const response = await page.request.fetch(qa.proxy + '/api/qa/curriculum', { method: action ? 'POST' : 'GET', ...(action ? { data: { action } } : {}), headers: { 'x-qa-key': qa.nonce } });
    if (!response.ok()) throw new Error('Fixture-only curriculum state unavailable');
    return response.json();
  };
  page.on('pageerror', error => errors.push(error.message));
  // The isolated context keeps the configured 4173 email return origin. Only
  // its API traffic uses the fresh no-paid-AI server; user browser is unaffected.
  await page.route(qa.base + '/api/**', async route => {
    const request = route.request(), relative = request.url().slice(qa.base.length);
    apiRequests.push({ path: relative.split('?')[0], method: request.method() });
    const headers = { ...request.headers() }; delete headers.host;
    if (headers.origin) headers.origin = qa.proxy;
    headers['sec-fetch-site'] = 'same-origin';
    const response = await route.fetch({ url: qa.proxy + relative, headers });
    if (loseSaveReply && relative === '/api/courses/refine' && request.method() === 'POST' && request.postDataJSON()?.action === 'accept' && response.ok()) { loseSaveReply = false; await route.abort('failed'); return; }
    await route.fulfill({ response });
  });
  await page.route('https://api.anthropic.com/**', route => route.abort());
  if(qa.components.includes('images'))await page.route(qa.base+'/js/config.js*',async route=>{const headers={...route.request().headers()};delete headers.host;if(headers.origin)headers.origin=qa.proxy;headers['sec-fetch-site']='same-origin';const response=await route.fetch({url:qa.proxy+'/js/config.js',headers});await route.fulfill({response});});
  await page.goto(qa.base + '/?experience=workspace');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByLabel('What do you want to learn or teach?').fill('Connected Photography QA');
  await page.getByRole('button', { name: 'Create course', exact: true }).click();
  await page.getByLabel('Who is it for?').waitFor();
  check(await page.getByRole('dialog').count() === 0, 'guest enters setup without sign-in');
  await page.getByLabel('Who is it for?').fill('A beginner learning to photograph window light');
  await page.getByRole('button', { name: 'Continue to Experience' }).click();
  for (const value of ['practice', 'checklists', 'quizzes', 'flashcards']) await page.locator(`[data-component="${value}"]`).setChecked(qa.components.includes(value));
  if(qa.components.includes('images')){
    check((await page.locator('.setup-image-choice').textContent()).includes('Uses extra tokens.') && (await page.locator('.setup-image-choice').textContent()).includes('US$0.013 per image'), 'extra token usage and per-image estimate visible before selecting images');
    await page.locator('[data-component="images"]').check();
    await page.getByText('How image costs work',{exact:true}).click();
    check((await page.locator('[data-image-cost-details]').textContent()).includes('Example: 12 lessons'), 'unknown lesson count is clearly labeled as an example');
    check((await page.locator('.setup-image-choice').textContent()).includes('does not generate images or authorize charges'),'image timing and funding explained at selection');
    for(const width of [390,320]){await page.setViewportSize({width,height:900});check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'image selection fits '+width);await page.screenshot({path:`output/playwright/creation-images-selection-${width}.png`,fullPage:true});}
    await page.setViewportSize({width:1440,height:1000});
  }
  for (const value of ['practice', 'checklists']) check(await page.locator(`[data-component="${value}"]`).isEnabled(), `${value} is available without sign-in`);
  await page.screenshot({ path: `output/playwright/${qa.artifactPrefix}-experience-1440.png`, fullPage: true });
  await page.getByRole('button', { name: 'Continue to Context' }).click();
  await page.getByRole('button', { name: '+ Add a note', exact: true }).click();
  await page.getByLabel('Notes, transcript or raw text').fill('Private workshop notes: compare soft window light from two angles.');
  await page.getByRole('button', { name: 'Review setup' }).click();
  const selectedSummary = await page.locator('.setup-component-summary p').first().textContent();
  if(qa.components.includes('images'))check((await page.locator('.setup-component-summary').textContent()).includes('Plus prompt tokens; not a fixed quote.'),'review repeats cost caveat before sign-in');
  for (const [value, label] of [['practice', 'Practice activities'], ['checklists', 'Checklists'], ['quizzes', 'Quizzes'], ['flashcards', 'Flashcards']]) check(selectedSummary.includes(label) === qa.components.includes(value), `Review matches selected ${value}`);
  const draftId = await page.evaluate(() => new URLSearchParams(location.search).get('draft'));
  check(!apiRequests.some(req => req.method === 'POST'), 'guest setup starts no account or generation writes');
  await page.getByRole('button', { name: 'Create course' }).click();
  await page.getByRole('dialog', { name: 'Sign in to create your course' }).waitFor();
  check(await page.getByText('Course you’re creating', { exact: true }).isVisible(), 'contextual sign-in labels the preserved course');
  await page.getByLabel('Email address').fill(qa.email);
  await page.getByRole('button', { name: 'Continue with email' }).click();
  await page.getByRole('heading', { name: 'Check your email', exact: true }).waitFor();
  let selected;
  for (let attempt = 0; attempt < 40; attempt++) {
    const inbox = await (await page.request.get('http://127.0.0.1:54324/api/v1/messages')).json();
    selected = inbox.messages.find(item => item.To?.some(to => to.Address === qa.email));
    if (selected) break;
    await page.waitForTimeout(250);
  }
  if (!selected) throw new Error('Local email did not arrive');
  const message = await (await page.request.get(`http://127.0.0.1:54324/api/v1/message/${selected.ID}`)).json();
  const link = message.HTML.match(/href="([^"]+)"/)?.[1]?.replaceAll('&amp;', '&');
  if (!link?.startsWith('http://127.0.0.1:54321/auth/v1/verify?')) throw new Error('Unexpected email link');
  await page.goto(link);
  await page.locator('.setup-create-context').filter({ hasText: qa.email }).waitFor();
  check(await page.getByRole('dialog').count() === 0, 'real local email callback returns to Review');
  check(await page.getByText('1 note · 0 links · 0 files', { exact: true }).isVisible(), 'source note remains through sign-in');
  check(await page.locator('.setup-component-summary p').first().textContent() === selectedSummary, 'exact material choices survive email sign-in');
  if(qa.components.includes('images')){
    await page.getByRole('button',{name:'Save these materials as my defaults',exact:true}).click();
    await page.getByText('Saved to your account for new courses. Existing courses and setups are unchanged.',{exact:true}).waitFor();
    check(true,'image preference saves through actual account defaults');
  }
  check(!apiRequests.some(req => /\/api\/(setups\/generate|gen\/review)/.test(req.path)), 'sign-in alone starts no AI work');
  await page.reload();
  await page.locator('.setup-create-context').filter({ hasText: qa.email }).waitFor();
  check(await page.evaluate(() => new URLSearchParams(location.search).get('draft')) === draftId, 'same account setup survives reload');
  await page.getByRole('button', { name: 'Create course' }).click();
  await page.getByRole('button', { name: 'Create course plan →', exact: true }).waitFor();
  check(await page.getByText('Claude is connected', { exact: true }).isVisible(), 'saved account connection is reused');
  check(await page.locator('.setup-component-summary p').first().textContent() === selectedSummary, 'explicit creation check repeats exact materials');
  await page.getByRole('button', { name: 'Create course plan →', exact: true }).click();
  if (qa.curriculumRecovery) {
    let initialJobId, priorRunId;
    for (const attempt of [1, 2]) {
      let state;
      for (let poll = 0; poll < 100; poll++) {
        state = await curriculumState();
        if (state.jobs[0]?.status === 'failed' && state.calls.length === attempt && (!priorRunId || state.jobs[0].run_id !== priorRunId)) break;
        await page.waitForTimeout(100);
      }
      if (await page.locator('#intake-modal .intake-close').isVisible()) await page.locator('#intake-modal .intake-close').click();
      await page.locator('.home-existing-controls').getByRole('button', { name: 'Retry', exact: true }).waitFor({ timeout: 30000 });
      const row = state.jobs[0];
      check(state.jobs.length === 1 && row.status === 'failed' && row.stage === 'intake', `invalid curriculum attempt ${attempt} stops at intake`);
      check(!row.brief && state.courses.length === 0, `invalid curriculum attempt ${attempt} saves no false plan/course`);
      check(state.calls.length === attempt && state.calls.every(name => name === 'submit_course_brief'), `attempt ${attempt} starts no research or lesson calls`);
      check(row.user_brief.source_text.includes('Private workshop notes: compare soft window light from two angles.'), `attempt ${attempt} retains original notes`);
      check(row.error.includes('The AI returned an incomplete course plan.') && row.error.includes('this uses more tokens.') && !row.error.includes('too_small'), `attempt ${attempt} explains failure, preservation and retry cost without validation JSON`);
      initialJobId ||= row.id;
      check(row.id === initialJobId && (!priorRunId || row.run_id !== priorRunId), `attempt ${attempt} belongs to the same job with its own run`);
      priorRunId = row.run_id;
      check((await page.locator('.home-workspace-head .home-status').textContent()).trim() === 'Needs attention', `attempt ${attempt} is not falsely Ready`);
      for (const width of attempt === 1 ? [1440, 390, 320] : [320]) {
        await page.setViewportSize({ width, height: 1000 });
        check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `curriculum failure ${attempt} fits ${width}px`);
        await page.screenshot({ path: `output/playwright/curriculum-failure-${attempt}-${width}.png`, fullPage: true });
      }
      await page.reload();
      await page.getByRole('button', { name: 'Retry', exact: true }).waitFor();
      const restored = await curriculumState();
      check(restored.calls.length === attempt && restored.jobs[0].run_id === priorRunId, `reload after attempt ${attempt} does not redispatch`);
      check(await page.evaluate(() => new URLSearchParams(location.search).get('workspace')) === initialJobId, `reload after attempt ${attempt} restores the same workspace`);
      await page.getByRole('button', { name: 'Retry', exact: true }).click();
    }
    await page.locator('[data-review-continue]').waitFor();
    await page.locator('#intake-modal .intake-close').click();
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  await page.getByRole('button', { name: 'Open review', exact: true }).waitFor();
  const jobId = await page.evaluate(() => new URLSearchParams(location.search).get('workspace'));
  check(!!jobId, 'creation reaches the canonical job workspace');
  await page.reload();
  await page.getByRole('button', { name: 'Open review', exact: true }).waitFor();
  check(await page.evaluate(() => new URLSearchParams(location.search).get('workspace')) === jobId, 'curriculum checkpoint reattaches after reload');
  await page.getByRole('button', { name: 'Open review', exact: true }).click();
  if (qa.curriculumRecovery) {
    const before = await curriculumState();
    check(before.calls.length === 3 && before.jobs[0].status === 'review_curriculum', 'explicit retry accepts a valid third plan and pauses for approval');
    await page.locator('[data-review-feedback]').fill('   ');
    const rejection = page.waitForResponse(response => response.url().includes('/api/gen/review') && response.request().method() === 'POST');
    await page.locator('[data-review-regenerate]').click();
    check((await rejection).status() === 400, 'API rejects the blank revision before claiming a new run');
    await page.locator('#intake-modal [data-error]').filter({ hasText: 'Tell us what to change before revising the curriculum' }).waitFor();
    const after = await curriculumState();
    check(after.calls.length === before.calls.length && after.jobs[0].run_id === before.jobs[0].run_id, 'blank curriculum revision must not dispatch another model call or replace its checkpoint');
    check(JSON.stringify(after.jobs[0].brief) === JSON.stringify(before.jobs[0].brief), 'rejected blank revision leaves the reviewed plan intact');
    check(await page.locator('[data-review-continue]').isEnabled(), 'blank feedback does not block approving the existing plan');
    for (const width of [1440, 390, 320]) {
      await page.setViewportSize({ width, height: 1000 });
      check(await page.locator('.intake-card').evaluate(el => el.scrollWidth <= el.clientWidth), `blank revision recovery fits ${width}px`);
      await page.locator('#intake-modal [data-error]').scrollIntoViewIfNeeded();
      check(await page.locator('#intake-modal [data-error]').evaluate(el => { const r = el.getBoundingClientRect(); return r.top >= 0 && r.bottom <= innerHeight; }), `blank revision explanation is reachable within the ${width}px dialog`);
      await page.screenshot({ path: `output/playwright/curriculum-blank-feedback-${width}.png` });
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const feedback = 'Add a short comparison of two window-light directions.';
    await curriculumState('disconnect');
    await page.locator('[data-review-feedback]').fill(feedback);
    const missingKey = page.waitForResponse(response => response.url().includes('/api/gen/review') && response.request().method() === 'POST');
    await page.locator('[data-review-regenerate]').click();
    check((await missingKey).status() === 400, 'missing creator key prevents revision dispatch');
    const pending = await curriculumState();
    check(pending.calls.length === 3 && pending.jobs[0].run_id === before.jobs[0].run_id, 'missing key retains the same plan checkpoint without model calls');
    check(pending.jobs[0].review_history.at(-1)?.feedback === feedback, 'validated revision feedback survives a missing-key response in the account');
    await curriculumState('reconnect');
    await page.reload();
    await page.getByRole('button', { name: 'Open review', exact: true }).click();
    check(await page.locator('[data-review-feedback]').inputValue() === '', 'reload has no new feedback typed into the field');
    const recovered = page.waitForResponse(response => response.url().includes('/api/gen/review') && response.request().method() === 'POST');
    await page.locator('[data-review-regenerate]').click();
    check((await recovered).status() === 200, 'explicit key-recovery action can use already-saved pending feedback');
    let revised;
    for (let poll = 0; poll < 100; poll++) {
      revised = await curriculumState();
      if (revised.calls.length === 4 && revised.jobs[0].status === 'review_curriculum') break;
      await page.waitForTimeout(100);
    }
    check(revised.calls.length === 4 && revised.jobs[0].run_id !== before.jobs[0].run_id, 'key recovery dispatches exactly one revision');
    check(revised.jobs[0].user_brief.source_text.split(feedback).length === 2, 'saved feedback enters the revised request exactly once');
    await page.locator('[data-review-regenerate]').waitFor();
    const consumed = page.waitForResponse(response => response.url().includes('/api/gen/review') && response.request().method() === 'POST');
    await page.locator('[data-review-regenerate]').click();
    check((await consumed).status() === 400, 'completed revision history cannot authorize another blank revision');
    const unchanged = await curriculumState();
    check(unchanged.calls.length === 4 && unchanged.jobs[0].run_id === revised.jobs[0].run_id, 'consumed feedback cannot trigger a duplicate paid run');
    await page.locator('[data-review-feedback]').fill('');
  }
  if(qa.components.includes('images')){
    const imagePlan=await page.locator('.intake-image-plan').textContent();
    check(imagePlan.includes('3 illustrations planned'),'curriculum review shows actual planned image count');
    check(imagePlan.includes('US$0.040 for 3 images')&&imagePlan.includes('1,317 image-output tokens')&&!imagePlan.includes('Example:'),'outline estimate uses actual lesson count, not the earlier example');
    await page.locator('.intake-image-plan summary').click();
    await page.setViewportSize({width:320,height:900});
    check(await page.locator('.intake-card').evaluate(el=>el.scrollWidth<=el.clientWidth),'expanded course estimate fits 320px');
    await page.locator('.intake-image-plan').screenshot({path:'output/playwright/image-cost-outline-320.png'});
    await page.setViewportSize({width:1440,height:1000});
  }
  await page.locator('[data-review-continue]').click();
  await page.getByRole('heading', { name: 'Review the research and sources', exact: true }).waitFor();
  await page.locator('[data-evidence-panel="module-0"] summary').click();
  check(await page.getByRole('link', { name: /^Synthetic reference/ }).isVisible(), 'actual persisted research reaches reference UI');
  await page.locator('[data-review-feedback]').fill('Keep the explanations short and practical.');
  await page.getByRole('button', { name: 'Close', exact: true }).filter({ visible: true }).first().click();
  await page.getByRole('link', { name: 'Home', exact: true }).first().click();
  await page.getByRole('link', { name: 'Your Courses', exact: true }).click();
  await page.getByRole('link', { name: /^Review evidence/ }).click();
  check(await page.evaluate(() => new URLSearchParams(location.search).get('workspace')) === jobId, 'leave and return selects the same research job');
  await page.getByRole('button', { name: 'Open review', exact: true }).click();
  await page.locator('[data-review-continue]').click();
  await page.getByRole('button', { name: 'Close', exact: true }).filter({ visible: true }).first().click();
  let partialCourseHref;
  if (qa.partial) {
    await page.getByRole('button', { name: 'Retry missing topics', exact: true }).waitFor({ timeout: 30000 });
    check(await page.locator('.home-workspace-head .home-status').textContent() === 'Partially ready', 'failed lesson is partial, not falsely Ready');
    check(await page.getByText('2 of 3 lessons saved', { exact: true }).isVisible(), 'partial progress counts saved lessons rather than failed attempts');
    if(qa.components.includes('images'))check(await page.getByRole('button',{name:'Continue images →',exact:true}).count()===0&&(await page.locator('.ready-image-plan').textContent()).includes('0 of 3 planned'),'partial text build preserves image scope and requires lesson recovery first');
    check((await page.locator('.home-timeline [aria-current="step"]').textContent()).includes('Lessons'), 'partial timeline does not mark all lessons complete');
    partialCourseHref = await page.getByRole('link', { name: 'Open as-is', exact: true }).getAttribute('href');
    check(!!partialCourseHref, 'successful lessons are saved and openable during partial failure');
    check((await page.locator('.home-materials').textContent()).includes('not a completion check'), 'partial materials summary does not claim unfinished content is ready');
    check((await page.locator('.course-readiness .home-section-heading').textContent()).includes('2 / 3 lessons'), 'partial saved inventory reads actual saved course');
    check(await page.locator('.ready-lesson-list a[href$="/lesson-2"]').count() === 0, 'failed unsaved lesson has no broken review link');
    for (const [value, label] of [['practice', 'Practice activities'], ['checklists', 'Checklists'], ['quizzes', 'Quizzes'], ['flashcards', 'Flashcards']]) {
      const row = page.locator('.ready-materials li').filter({ hasText: label });
      check((await row.textContent()).includes(qa.components.includes(value) ? '2 of 3 lessons' : 'Not selected'), `partial saved coverage honours ${value}`);
    }
    check(await page.getByText('Retry rebuilds only failed lessons, including their selected materials. Your saved lessons and their progress stay available.', { exact: true }).isVisible(), 'retry scope and preservation are explained before action');
    await page.screenshot({ path: `output/playwright/${qa.artifactPrefix}-partial-1440.png`, fullPage: true });
    if (qa.components.includes('checklists')) {
      await page.getByRole('button', { name: 'View errors', exact: true }).click();
      await page.locator('.intake-failures summary').click();
      check(await page.getByText('A required checklist is missing or invalid in this lesson. Retry rebuilds this lesson, not just the checklist; other saved lessons stay available.', { exact: true }).isVisible(), 'missing checklist has visible explanation and recovery scope');
      await page.getByRole('button', { name: 'Close', exact: true }).filter({ visible: true }).first().click();
      await page.getByRole('link', { name: 'Open as-is', exact: true }).click();
      await page.getByRole('link', { name: /^Module 1 Light and composition/ }).click();
      await page.getByRole('heading', { name: 'Photography lesson-1', exact: true }).waitFor();
      await page.locator('[data-checklist-item="clear-space"]').check();
      check(await page.locator('[data-checklist-item="clear-space"]').isChecked(), 'accepted checklist is usable while another lesson is partial');
      await page.goto(`${qa.base}/?experience=workspace&workspace=${jobId}`);
      await page.getByRole('button', { name: 'Retry missing topics', exact: true }).waitFor();
    }
    await page.getByRole('button', { name: 'Retry missing topics', exact: true }).click();
  }
  await page.getByRole('link', { name: /^Open course/ }).waitFor({ timeout: 30000 });
  if (qa.partial) check(await page.getByRole('link', { name: /^Open course/ }).getAttribute('href') === partialCourseHref, 'retry completes the same saved course rather than a duplicate');
  check(qa.components.includes('images') ? (await page.locator('.home-workspace-head .home-status').textContent())==='Images to finish' : await page.getByText('Ready', { exact: true }).count() > 0, 'text completion does not falsely complete requested images');
  if(qa.components.includes('images')){
    check((await page.locator('.ready-image-plan').textContent()).includes('0 of 3 planned'),'no images counted before explicit generation');
    for(const width of [1440,390,320]){await page.setViewportSize({width,height:900});await page.locator('.ready-image-plan').scrollIntoViewIfNeeded();check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'image handoff fits '+width);await page.screenshot({path:`output/playwright/creation-images-pending-${width}.png`});}
    check(!apiRequests.some(req=>req.path==='/api/courses/images'&&req.method==='POST'),'creation has not started an image request automatically');
    for(let index=0;index<3;index++){
      await page.getByRole('button',{name:'Continue images →',exact:true}).click();const editor=page.locator('dialog.image-editor');
      await editor.getByRole('button',{name:'Generate 1 image',exact:true}).waitFor();
      check(await editor.locator('#image-lesson').inputValue()===String(index),'Continue images opens next unfinished lesson');
      await editor.locator('#image-consent').check();await editor.getByRole('button',{name:'Generate 1 image',exact:true}).click();
      await editor.getByRole('heading',{name:'2. Review the candidate',exact:true}).waitFor({timeout:20000});
      await page.waitForFunction(()=>document.querySelector('dialog.image-editor .image-preview img')?.naturalWidth>0);
      await editor.locator('#image-alt').fill('Soft side light shows how the object casts a shadow.');await editor.locator('#image-reviewed').check();
      await editor.getByRole('button',{name:'Use this image',exact:true}).click();await editor.getByRole('heading',{name:'Image added to the lesson',exact:true}).waitFor();
      check((await editor.locator('.image-coverage').textContent()).includes(`${index+1} of 3 lessons`),'image coverage advances only after reviewed acceptance');
      await editor.getByRole('button',{name:'Close course images',exact:true}).click();
      await page.reload();await page.getByRole('heading',{name:'Your image plan',exact:true}).waitFor();
    }
    check((await page.locator('.ready-image-plan').textContent()).includes('3 of 3 planned')&&!await page.getByRole('button',{name:'Continue images →',exact:true}).count(),'all images complete without repeated generation');
    check(await page.getByText('Ready',{exact:true}).count()>0,'course becomes Ready after image coverage is fulfilled');
  }
  check((await page.locator('.course-readiness .home-section-heading').textContent()).includes('3 / 3 lessons'), 'Ready inventory updates after account save');
  for (const [value, label] of [['practice', 'Practice activities'], ['checklists', 'Checklists'], ['quizzes', 'Quizzes'], ['flashcards', 'Flashcards']]) check((await page.locator('.ready-materials li').filter({ hasText: label }).textContent()).includes(qa.components.includes(value) ? '3 of 3 lessons' : 'Not selected'), `saved Ready coverage honours ${value}`);
  await page.locator('.ready-references summary').click();
  check(await page.getByRole('link', { name: /^Synthetic reference/ }).isVisible(), 'saved research references remain inspectable after build');
  await page.setViewportSize({ width: 390, height: 844 });
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Ready fits mobile');
  await page.screenshot({ path: `output/playwright/${qa.artifactPrefix}-ready-390.png`, fullPage: true });
  if (qa.viewportCaptures) {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: `output/playwright/${qa.artifactPrefix}-ready-viewport-390.png`, animations: 'disabled' });
    check(await page.locator('.app-header').evaluate(el => Math.abs(el.getBoundingClientRect().top) < 1), 'Ready header stays at the viewport top');
  }
  await page.locator('.course-readiness').evaluate(el => window.scrollTo(0, scrollY + el.getBoundingClientRect().top - 84));
  await page.screenshot({ path: `output/playwright/${qa.artifactPrefix}-inventory-390.png` });
  await page.getByRole('link', { name: /^Open course/ }).click();
  await page.getByRole('heading', { name: 'Connected Photography QA', exact: true }).waitFor();
  await page.getByRole('link', { name: /^Module 1 Light and composition/ }).click();
  await page.getByRole('heading', { name: 'Photography lesson-1', exact: true }).waitFor();
  const courseId = await page.evaluate(() => new URLSearchParams(location.search).get('course'));
  check(!!courseId, 'Open loads the saved lesson, not another setup');
  if(qa.components.includes('images')){await page.waitForFunction(()=>document.querySelector('[data-private-image] img')?.naturalWidth>0);check(true,'accepted image loads in the actual learner');}
  check(await page.locator('.practice-block').count() === Number(qa.components.includes('practice')), 'saved lesson contains only selected practice');
  check(await page.locator('.lesson-checklist').count() === Number(qa.components.includes('checklists')), 'saved lesson contains only selected checklists');
  check(await page.locator('.quiz-block').count() === (qa.components.includes('quizzes') ? 3 : 0), 'saved lesson contains only selected quizzes');
  check(await page.locator('#flashcard-trigger').isVisible() === qa.components.includes('flashcards'), 'saved lesson exposes only selected flashcards');
  if (qa.components.includes('practice')) await page.locator('[data-step-index="0"]').check();
  if (qa.components.includes('checklists')) {
    if (qa.partial) check(await page.locator('[data-checklist-item="clear-space"]').isChecked(), 'retry preserves progress in accepted lesson');
    await page.locator('[data-checklist-item="clear-space"]').check();
  }
  await page.reload();
  await page.getByRole('heading', { name: 'Photography lesson-1', exact: true }).waitFor();
  check(await page.evaluate(() => new URLSearchParams(location.search).get('course')) === courseId, 'saved course reloads at its own URL');
  if (qa.components.includes('practice')) check(await page.locator('[data-step-index="0"]').isChecked(), 'generated activity progress survives reload');
  if (qa.components.includes('checklists')) check(await page.locator('[data-checklist-item="clear-space"]').isChecked(), 'generated checklist progress survives reload');
  check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'generated rich lesson fits mobile');
  if (qa.components.includes('practice')) await page.locator('.practice-block').evaluate(el => window.scrollTo({ top: scrollY + el.getBoundingClientRect().top - 84, behavior: 'instant' }));
  else if (qa.components.includes('checklists')) await page.locator('.lesson-checklist').scrollIntoViewIfNeeded();
  await page.screenshot({ path: `output/playwright/${qa.artifactPrefix}-lesson-390.png`, animations: 'disabled' });
  await page.getByRole('link', { name: 'Learnable Home', exact: true }).click();
  await page.getByRole('link', { name: 'Your Courses', exact: true }).click();
  await page.getByRole('link', { name: /^Connected Photography QA/ }).waitFor();
  check(await page.getByRole('link', { name: /^Connected Photography QA/ }).count() === 1, 'Home lists one saved course without duplicate job card');
  check(await page.getByText('Continue setting up', { exact: true }).count() === 0, 'completed setup is not presented as unfinished');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.screenshot({ path: `output/playwright/${qa.artifactPrefix}-home-1440.png`, fullPage: true });
  if (qa.viewportCaptures) {
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await page.screenshot({ path: `output/playwright/${qa.artifactPrefix}-home-viewport-1440.png`, animations: 'disabled' });
    check(await page.locator('.home-skip-link').evaluate(el => el.getBoundingClientRect().bottom < 0 || document.activeElement === el), 'Skip link stays hidden unless keyboard-focused');
  }
  const reviewCourse = page.getByRole('link', { name: /^Review course\s*:\s*Connected Photography QA/ });
  check((await reviewCourse.getAttribute('href')).includes(jobId), 'Your Courses offers the same saved review workspace');
  await reviewCourse.click();
  await page.getByRole('heading', { name: 'What’s in your saved course', exact: true }).waitFor();
  await page.locator('.ready-lesson-list summary').click();
  await page.locator('.ready-lesson-list a[href$="/lesson-1"]').click();
  await page.getByRole('heading', { name: 'Photography lesson-1', exact: true }).waitFor();
  check(true, 'Review course can open a specific saved lesson');
  if (qa.refinement) {
    await page.locator('#complete-btn').click();
    check((await page.locator('#complete-btn').textContent()).includes('Completed'), 'original lesson is completed before editing');
    await page.getByRole('link', { name: 'Learnable Home', exact: true }).click();
    await page.getByRole('link', { name: 'Your Courses', exact: true }).click();
    await page.getByRole('link', { name: /^Review course\s*:/ }).click();
    await page.getByRole('button', { name: 'Make changes', exact: true }).click();
    const editor = page.locator('dialog.course-editor');
    await editor.getByText('Make changes below, then preview them', { exact: false }).waitFor();
    const choice = await editor.getByRole('option', { name: /Photography lesson 1 — Checklist/ }).getAttribute('value');
    await editor.locator('[data-editor-target]').selectOption(choice);
    const changedLabel = 'The surface is stable, clear, and ready for this comparison.';
    await editor.getByRole('textbox', { name: 'Label', exact: true }).first().fill(changedLabel);
    await editor.getByRole('button', { name: 'Preview change', exact: true }).click();
    await editor.getByRole('heading', { name: 'Review your change', exact: true }).waitFor();
    check(await editor.getByText('Currently saved', { exact: true }).isVisible() && await editor.getByText('Proposed replacement', { exact: true }).isVisible(), 'current and proposed content are distinct before accept');
    check((await editor.locator('.editor-impact').textContent()).includes('1 changed interactions'), 'preview explains which progress starts fresh');
    await editor.getByRole('button', { name: 'Keep editing', exact: true }).click();
    check(await editor.getByRole('textbox', { name: 'Label', exact: true }).first().inputValue() === changedLabel, 'return from preview preserves edits');
    await editor.getByRole('button', { name: 'Close course editor' }).click();
    await editor.getByRole('button', { name: 'Keep editing', exact: true }).click();
    check(await editor.getByRole('textbox', { name: 'Label', exact: true }).first().inputValue() === changedLabel, 'cancel closing retains the proposal');
    for (const width of [390, 320]) {
      await page.setViewportSize({ width, height: 844 });
      check(await editor.evaluate(el => el.scrollWidth <= el.clientWidth), `${width}px editor has no horizontal overflow`);
      await editor.screenshot({ path: `output/playwright/refinement-edit-${width}.png` });
    }
    await editor.getByRole('button', { name: 'Preview change', exact: true }).click();
    await editor.getByRole('heading', { name: 'Review your change', exact: true }).waitFor();
    await editor.screenshot({ path: 'output/playwright/refinement-preview-320.png' });
    if (qa.viewportCaptures) {
      await editor.getByRole('button', { name: 'Replace this item', exact: true }).scrollIntoViewIfNeeded();
      await editor.screenshot({ path: 'output/playwright/refinement-preview-actions-320.png', animations: 'disabled' });
      check(await editor.getByRole('button', { name: 'Replace this item', exact: true }).evaluate(el => {
        const r=el.getBoundingClientRect(); return el.contains(document.elementFromPoint(r.x+r.width/2, r.y+r.height/2));
      }), '320px editor acceptance is reachable and not obscured');
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    await editor.screenshot({ path: 'output/playwright/refinement-preview-1440.png' });
    loseSaveReply = true;
    await editor.getByRole('button', { name: 'Replace this item', exact: true }).click();
    await editor.getByRole('button', { name: 'Check the same save', exact: true }).waitFor();
    check((await editor.getByRole('alert').textContent()).includes('could not be confirmed'), 'lost save reply does not falsely report failure or create another operation');
    await editor.getByRole('button', { name: 'Check the same save', exact: true }).click();
    await editor.getByRole('heading', { name: 'Change saved', exact: true }).waitFor();
    await editor.getByRole('link', { name: 'Open updated lesson', exact: true }).click();
    await page.getByRole('heading', { name: 'Photography lesson-1', exact: true }).waitFor();
    check(await page.getByText(changedLabel, { exact: true }).isVisible(), 'accepted replacement opens in the actual learner');
    check(!await page.locator('[data-checklist-item="clear-space"]').isChecked(), 'changed checklist starts fresh');
    check(await page.locator('[data-step-index="0"]').isChecked(), 'unchanged practice retains its progress');
    check(!(await page.locator('#complete-btn').textContent()).includes('Completed'), 'new lesson revision needs its own completion check');
    const retained = await page.evaluate(async ({ modulePath, courseId }) => (await import(modulePath)).store.exportSnapshot().courses[courseId].progress.foundations['lesson-1'].completed, { modulePath: qa.storeModule, courseId });
    check(retained, 'old completion is retained rather than erased');
    await page.locator('#complete-btn').click();
    await page.reload();
    await page.getByRole('heading', { name: 'Photography lesson-1', exact: true }).waitFor();
    check((await page.locator('#complete-btn').textContent()).includes('Completed') && await page.getByText(changedLabel, { exact: true }).isVisible(), 'revised content and current completion survive reload');
    const moduleProgress = await page.evaluate(async modulePath => (await import(modulePath)).store.getModuleProgress('foundations', 3), qa.storeModule);
    check(moduleProgress === 1 / 3, 'completion summaries do not double-count old and new revisions');
  }
  check(apiRequests.some(req => req.path === '/api/courses/get'), 'direct saved-course route participates in completion');
  check(errors.length === 0, `no browser exceptions: ${errors.join('; ')}`);
  if(qa.components.includes('images')){
    await page.goto(qa.base+'/?experience=workspace&filter=mine');await page.getByLabel('What do you want to learn or teach?').fill('Image defaults QA');
    await page.getByRole('button',{name:'Create course',exact:true}).click();await page.getByLabel('Who is it for?').fill('Another beginner');
    await page.getByRole('button',{name:'Continue to Experience'}).click();check(await page.locator('[data-component="images"]').isChecked(),'new course inherits image preference without generation or billing consent');
  }
  const report = { checks: checks.length, passed: checks, jobId, courseId, scope: 'Actual local email/Auth/API/database/runner; synthetic AI; isolated browser API proxy; no hosted or paid-provider acceptance' };
  await page.evaluate(report => { window.__connectedQAReport = report; }, report);
  return report;
})
