(async page => {
  const { course, modulePath } = __READY_QA__;
  const checks = [], errors = [];
  const check = (ok, label) => { if (!ok) throw new Error(label); checks.push(label); };
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('http://127.0.0.1:4173/?experience=workspace');
  await page.getByRole('heading', { name: 'What will you learn next?' }).waitFor();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.evaluate(async ({ course, modulePath }) => {
    const { createHomeController } = await import(modulePath);
    const main = document.querySelector('#content'); main.hidden = true;
    const host = document.createElement('main'); host.id = 'ready-test'; main.after(host);
    const qa = window.__readyQA = { course, original: structuredClone(course), owner: 'owner', job: { id: 'readiness-qa', ownerId: 'owner', runner: 'cloud', status: 'completed', stage: 'done', title: 'Practical photography', courseInstalled: true, savedCourseId: course.config.id, topicsTotal: 3, topicsDone: 3 }, failCatalog: false };
    qa.controller = createHomeController({
      getUser: () => ({ id: qa.owner }), getJob: () => qa.job, listJobs: () => qa.job ? [qa.job] : [],
      getSavedCourse: id => qa.owner === 'owner' && qa.course?.config.id === id ? qa.course : null,
      loadLibrary: async () => ({ courses: qa.owner === 'owner' && qa.course ? [{ id: qa.course.config.id, title: 'Practical photography', user: true }] : [], catalogError: qa.failCatalog }),
      onJobsChange: () => () => {}, canDelete: () => false, wireJobs() {}, wireCourses() {}, refreshCloud: async () => {},
      jobControls: job => job.courseInstalled ? `<a href="?course=${job.savedCourseId}">Open course</a>` : '<button type="button">Sync course</button>'
    });
    qa.show = () => qa.controller.render(host, 'readiness-qa');
    await qa.show();
  }, { course, modulePath });
  const root = page.locator('#ready-test');
  check((await root.locator('.home-workspace-head .home-status').textContent()) === 'Ready', 'complete saved fixture is openable');
  check((await root.locator('.ready-materials').textContent()).includes('9 questions'), 'quiz count comes from actual saved sections');
  await root.locator('.ready-references summary').focus(); await page.keyboard.press('Enter');
  check(await root.getByRole('link', { name: /^Synthetic photography reference/ }).isVisible(), 'references open by keyboard');
  await page.evaluate(() => { window.__readyQA.job.lastUpdatedAt = Date.now(); window.__readyQA.course._research.foundations.sources.push({ title: 'Another synthetic reference', url: 'https://example.com/second' }); return window.__readyQA.controller.refresh(); });
  check(await root.locator('.ready-references').evaluate(el => el.open) && await root.locator('.ready-references summary').evaluate(el => el === document.activeElement), 'refresh preserves open references and summary focus');
  await root.locator('.course-readiness').evaluate(el => window.scrollTo(0, scrollY + el.getBoundingClientRect().top - 84));
  await page.screenshot({ path: 'output/playwright/ready-inventory-1440.png' });
  // Missing material and an unresolved image in otherwise saved lessons.
  await page.evaluate(async () => {
    const qa = window.__readyQA;
    qa.course.modules[1]['lesson-1'].sections = qa.course.modules[1]['lesson-1'].sections.filter(section => section.type !== 'checklist');
    qa.course.modules[1]['lesson-3'].sections.push({ type: 'image', ref_kind: 'pdf', file_index: 0, page: 1, alt: '' });
    await qa.controller.refresh();
  });
  check(await root.locator('.home-workspace-head .home-status').textContent() === 'Saved with issues', 'completed job cannot conceal missing saved materials');
  check(await root.locator('.home-timeline li:last-child').evaluate(el => el.classList.contains('is-next')), 'timeline does not mark incomplete Ready as complete');
  check(await root.locator('.ready-lesson-list').evaluate(el => el.open), 'affected lessons are expanded');
  check(await root.locator('.ready-lesson-list a').count() === 2, 'review links target both affected saved lessons');
  check((await root.locator('.ready-lesson-list').textContent()).includes('alternative text'), 'image alt-text gap is visible');
  check((await root.locator('.ready-references').textContent()).includes('reported by AI') && (await root.locator('.ready-references').textContent()).includes('not proof that a source was read'), 'no invented source verification');
  for (const width of [390, 320]) {
    await page.setViewportSize({ width, height: 844 });
    await root.locator('.ready-lesson-list').evaluate(el => window.scrollTo(0, scrollY + el.getBoundingClientRect().top - 84));
    check(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `${width}px: no horizontal overflow`);
    check(await root.locator('.ready-lesson-list a').first().evaluate(el => el.getBoundingClientRect().height >= 44), `${width}px: review link touch target`);
    await page.screenshot({ path: `output/playwright/ready-issues-${width}.png` });
  }
  await page.evaluate(async () => {
    const qa = window.__readyQA; qa.course = structuredClone(qa.original); delete qa.course.modules[1]['lesson-2']; qa.course.failedTopics = ['foundations/lesson-2']; qa.job = null; await qa.show();
  });
  check(await root.locator('.home-status').textContent() === 'Partially ready', 'missing build history retains partial status');
  check(await root.locator('.ready-lesson-list a').count() === 0, 'missing lesson gets no broken link');
  check((await root.locator('.course-readiness').textContent()).includes('build history is not available'), 'no unsupported retry is promised without the build job');
  await page.evaluate(async () => { window.__readyQA.course = structuredClone(window.__readyQA.original); await window.__readyQA.show(); });
  check(await root.locator('.home-status').textContent() === 'Ready', 'complete saved course remains reviewable without build history');
  await page.evaluate(async () => { const qa = window.__readyQA; delete qa.course.config.components; delete qa.course._brief.components; delete qa.course._research; await qa.show(); });
  check((await root.locator('.course-readiness').textContent()).includes('no saved material selection'), 'legacy request expectations stay unknown');
  check((await root.locator('.course-readiness').textContent()).includes('no inspectable research references'), 'missing evidence is visible');
  await page.evaluate(async () => { const qa = window.__readyQA; qa.course = { config: { id: qa.original.config.id }, _generationJobId: 'readiness-qa' }; await qa.show(); });
  check((await root.locator('.course-readiness').textContent()).includes('can’t confirm'), 'metadata-only course does not report zero as success');
  await page.evaluate(async () => { window.__readyQA.owner = 'other'; await window.__readyQA.show(); });
  check(await root.getByRole('heading', { name: 'Workspace unavailable' }).isVisible(), 'other account cannot inspect course details');
  check(await root.locator('.course-readiness').count() === 0 && !(await root.textContent()).includes('photography reference'), 'other account cannot see saved references');
  check(errors.length === 0, 'no uncaught browser errors');
  const report = { total: checks.length, checks, mode: 'real rendered Home; synthetic saved courses and controller services; no account/provider writes' };
  await page.evaluate(report => { window.__readyQAReport = report; }, report);
  return report;
})
