(async page => {
  const qa = __EDITOR_QA__, checks = [], errors = [];
  const check = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
  page.on('pageerror', error => errors.push(error.message));
  await page.evaluate(async qa => {
    const { openCourseEditor } = await import(qa.modulePath);
    const c = window.__editorControl = { owner: 'qa-a', payload: qa.course, hash: 'one', writes: 0, accepts: 0, loadError: false, delayPreview: false, delaySave: false };
    c.current = target => { const lesson = c.payload.modules[1][target.topicId]; return target.kind === 'lesson' ? lesson : target.kind === 'section' ? lesson.sections[target.index] : lesson.flashcards[target.index]; };
    const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
    const client = {
      async load() { if (c.loadError) fail('unavailable', 'Your account copy could not be loaded. Try again.'); return { payload: structuredClone(c.payload), baseHash: c.hash }; },
      async preview(owner, input) {
        if (c.delayPreview) await new Promise(resolve => { c.releasePreview = resolve; });
        if (input.baseHash !== c.hash) fail('conflict', 'The saved course changed. Compare the latest version.');
        if ('title' in input.replacement && !input.replacement.title.trim()) fail('validation', 'A title is required. Your saved course is unchanged.');
        if (input.replacement.variant === 'multiple-choice' && !input.replacement.options.some(option => option.id === input.replacement.correct)) fail('validation', 'Choose a correct answer that is still in the quiz.');
        return { ...structuredClone(input), changed: JSON.stringify(input.replacement) !== JSON.stringify(c.current(input.target)), impact: { interactions: 0, flashcards: 0, lessonCompletion: true } };
      },
      async accept(owner, input) {
        c.accepts++;
        if (c.delaySave) await new Promise(resolve => { c.releaseSave = resolve; });
        if (input.baseHash !== c.hash) fail('conflict', 'A newer course was saved. Your proposal is retained.');
        const lesson = c.payload.modules[1][input.target.topicId];
        if (input.target.kind === 'section') lesson.sections[input.target.index] = structuredClone(input.replacement);
        else if (input.target.kind === 'lesson') c.payload.modules[1][input.target.topicId] = structuredClone(input.replacement);
        else lesson.flashcards[input.target.index] = structuredClone(input.replacement);
        c.hash += '-next'; c.writes++;
        return { payload: structuredClone(c.payload), updatedAt: new Date().toISOString() };
      }
    };
    const opener = document.createElement('button'); opener.id = 'editor-qa-opener'; opener.textContent = 'Open editor QA'; opener.style.cssText = 'position:fixed;bottom:16px;right:16px;z-index:1000;padding:12px;background:white;color:black'; document.body.append(opener);
    opener.onclick = () => { window.__editorInstance = openCourseEditor(c.payload.config.id, { getIdentity: () => ({ id: c.owner }), watchIdentity: callback => { c.notify = callback; return () => {}; }, client }); };
  }, qa);
  const editor = page.locator('dialog.course-editor'), open = page.getByRole('button', { name: 'Open editor QA', exact: true });
  const control = fn => page.evaluate(fn);
  const select = async pattern => { const value = await editor.getByRole('option', { name: pattern }).first().getAttribute('value'); await editor.locator('[data-editor-target]').selectOption(value); };
  const title = () => editor.getByRole('textbox', { name: 'Title', exact: true }).first();
  const preview = async () => { await editor.getByRole('button', { name: 'Preview change', exact: true }).click(); };
  await control(() => { window.__editorControl.loadError = true; }); await open.click();
  await editor.getByRole('alert').waitFor(); check(await editor.getByRole('button', { name: 'Try again', exact: true }).isVisible(), 'unavailable account copy offers retry');
  await control(() => { window.__editorControl.loadError = false; }); await editor.getByRole('button', { name: 'Try again', exact: true }).click();
  await title().waitFor(); await preview(); await editor.getByText('No content changes to save.', { exact: true }).waitFor();
  check(await control(() => window.__editorControl.writes) === 0, 'no-op creates no write');
  await select(/Photography lesson 1 — Concept 1/);
  await title().fill(''); await preview(); await editor.getByRole('alert').waitFor();
  check(await title().inputValue() === '' && await control(() => window.__editorControl.writes) === 0, 'invalid edit is preserved, current course unchanged');
  await title().fill('Proposed first concept'); await preview(); await editor.getByRole('heading', { name: 'Review your change', exact: true }).waitFor();
  await editor.getByRole('button', { name: 'Close course editor' }).click(); await editor.getByRole('button', { name: 'Keep editing', exact: true }).click();
  check(await editor.getByRole('heading', { name: 'Review your change', exact: true }).isVisible(), 'cancel close from preview returns to preview');
  await editor.getByRole('button', { name: 'Keep editing', exact: true }).click();
  await editor.getByRole('button', { name: 'Close course editor' }).click(); await editor.getByRole('button', { name: 'Keep editing', exact: true }).click();
  check(await title().inputValue() === 'Proposed first concept', 'cancel close from editing returns to editing with text');
  await control(() => { const c = window.__editorControl; c.hash = 'newer'; c.payload.modules[1]['lesson-1'].sections[0].title = 'Newer account concept'; });
  await preview(); await editor.getByRole('button', { name: 'Load latest and keep my text', exact: true }).click();
  check(await title().inputValue() === 'Proposed first concept', 'conflict reload retains proposed text');
  await preview(); await editor.getByRole('heading', { name: 'Review your change', exact: true }).waitFor();
  check(await editor.getByText('Newer account concept', { exact: true }).isVisible() && await editor.getByText('Proposed first concept', { exact: true }).isVisible(), 'conflict comparison shows newer saved and retained proposal');
  await control(() => { window.__editorControl.hash = 'newer-again'; });
  await editor.getByRole('button', { name: 'Replace this item', exact: true }).click(); await editor.getByRole('alert').waitFor();
  check(await title().inputValue() === 'Proposed first concept' && await control(() => window.__editorControl.writes) === 0, 'accept conflict retains proposal without clobbering saved copy');
  await editor.getByRole('button', { name: 'Load latest and keep my text', exact: true }).click(); await preview();
  await editor.getByRole('button', { name: 'Replace this item', exact: true }).waitFor();
  await control(() => { window.__editorControl.delaySave = true; });
  await editor.getByRole('button', { name: 'Replace this item', exact: true }).click();
  await editor.getByRole('button', { name: 'Saving…', exact: true }).waitFor();
  await editor.getByRole('button', { name: 'Close course editor' }).click(); await editor.getByRole('button', { name: 'Keep editing', exact: true }).click();
  check(await editor.getByRole('button', { name: 'Saving…', exact: true }).isDisabled(), 'returning during save cannot submit duplicate acceptance');
  await control(() => { window.__editorControl.releaseSave(); window.__editorControl.delaySave = false; });
  await editor.getByRole('heading', { name: 'Change saved', exact: true }).waitFor();
  check(await control(() => window.__editorControl.writes) === 1, 'explicit acceptance saves once after conflict recovery');
  await editor.getByRole('button', { name: 'Close course editor' }).click();
  check(await open.evaluate(el => el === document.activeElement), 'closing restores focus to the invoking button');
  await open.click(); await title().waitFor(); await select(/Photography lesson 1 — Quiz.*Which change/);
  await editor.getByRole('button', { name: 'Add answer choice', exact: true }).click();
  await editor.getByRole('button', { name: 'Remove Options 1', exact: true }).click();
  check(await editor.getByRole('combobox', { name: 'Correct answer', exact: true }).inputValue() === '', 'removing correct option requires a new explicit answer');
  await preview(); await editor.getByRole('alert').waitFor();
  check((await editor.getByRole('alert').textContent()).includes('Choose a correct answer'), 'removed quiz answer cannot silently change correctness');
  await editor.getByRole('button', { name: 'Close course editor' }).click(); await editor.getByRole('button', { name: 'Close editor', exact: true }).click();
  check(await control(() => window.__editorControl.writes) === 1, 'discard does not write quiz edits');
  await open.click(); await title().waitFor(); await select(/Photography lesson 1 — Concept 1/); await title().fill('Late preview must not reopen');
  await control(() => { window.__editorControl.delayPreview = true; }); await preview();
  await editor.getByRole('button', { name: 'Close course editor' }).click();
  await control(() => { window.__editorControl.releasePreview(); window.__editorControl.delayPreview = false; });
  await page.waitForTimeout(100);
  check(await editor.getByRole('heading', { name: 'Keep your changes?', exact: true }).isVisible(), 'late preview cannot dismiss close confirmation');
  await editor.getByRole('button', { name: 'Keep editing', exact: true }).click();
  check(await title().inputValue() === 'Late preview must not reopen', 'cancel interrupted preview keeps draft');
  for (const width of [1440, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    check(await editor.evaluate(el => el.scrollWidth <= el.clientWidth), `${width}px editor has no horizontal overflow`);
    await editor.screenshot({ path: `output/playwright/editor-concept-${width}.png` });
  }
  await control(() => { document.documentElement.setAttribute('data-theme', 'dark'); });
  await editor.locator('.home-button').evaluate(el => Promise.all(el.getAnimations().map(animation => animation.finished.catch(() => {}))));
  check(await editor.evaluate(el => getComputedStyle(el).backgroundColor !== 'rgb(255, 255, 255)'), 'editor uses the application dark surface');
  const contrast = await editor.locator('.home-button').evaluate(el => {
    const luminance = color => color.match(/[\d.]+/g).slice(0, 3).map(Number).map(v => v / 255).map(v => v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4).reduce((total, v, i) => total + v * [.2126, .7152, .0722][i], 0);
    const s = getComputedStyle(el), a = luminance(s.color), b = luminance(s.backgroundColor); return { foreground: s.color, background: s.backgroundColor, ratio: (Math.max(a, b) + .05) / (Math.min(a, b) + .05) };
  });
  check(contrast.ratio >= 4.5, 'dark primary action text meets 4.5:1 contrast: ' + JSON.stringify(contrast));
  await editor.screenshot({ path: 'output/playwright/editor-concept-dark-320.png' });
  await control(() => { document.documentElement.setAttribute('data-theme', 'light'); });
  await page.keyboard.press('Tab'); check(await page.evaluate(() => !!document.activeElement.closest('dialog')), 'keyboard focus remains in modal');
  await control(() => { window.__editorControl.delayPreview = true; }); await preview();
  await control(() => { const c = window.__editorControl; c.owner = 'qa-b'; c.notify(); c.owner = 'qa-a'; c.notify(); c.releasePreview(); });
  await page.waitForTimeout(100);
  check(await editor.count() === 0, 'account roundtrip closes editor and ignores late proposal');
  check(await control(() => window.__editorControl.writes) === 1, 'account switch cannot apply a pending proposal');
  check(errors.length === 0, `no browser exceptions: ${errors.join('; ')}`);
  const report = { total: checks.length, passed: checks, scope: 'Actual editor/browser; explicit service doubles; no account writes or paid provider calls.' };
  await page.evaluate(report => { window.__editorQAReport = report; }, report); return report;
})
