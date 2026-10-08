(async page => {
  const { combinations, modules } = __COMPONENT_SETUP_QA__;
  const checks=[], errors=[], writes=[];
  const check=(value,label)=>{if(!value)throw new Error(label);checks.push(label);};
  page.on('pageerror',error=>errors.push(error.message));
  page.on('request',request=>{if(request.method()==='POST'&&/\/api\/|\/auth\/v1\/otp/.test(request.url()))writes.push(request.url());});
  const quiz=()=>page.locator('[data-component="quizzes"]'), cards=()=>page.locator('[data-component="flashcards"]');
  const step=async name=>{await page.getByRole('navigation',{name:'Course setup steps'}).getByRole('link',{name,exact:true}).click();await page.locator('[data-setup-root]').waitFor();};
  const fits=()=>page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth);
  // Wait for the real debounced IndexedDB commit before testing a reload. A
  // reload during the 180ms unsaved window correctly opens a leave-page guard.
  const saved=async components=>{await page.waitForFunction(async ({ expected, modulePath })=>{
    const {createDraftStore}=await import(modulePath);
    const result=await createDraftStore().load(new URLSearchParams(location.search).get('draft'));
    return result.status==='found'&&result.draft.step==='review'&&JSON.stringify([...result.draft.components].sort())===JSON.stringify([...expected].sort());
  },{expected:components,modulePath:modules.draft});await page.waitForTimeout(200);};
  await page.goto('http://127.0.0.1:4173/?experience=workspace');
  await page.setViewportSize({width:1440,height:1050});
  await page.getByLabel('What do you want to learn or teach?').fill('Photography component choices QA');
  await page.getByRole('button',{name:'Create course',exact:true}).click();
  await page.getByLabel('Who is it for?').fill('New photographers');
  await page.getByRole('button',{name:'Continue to Experience'}).click();
  check(await quiz().isChecked()&&await cards().isChecked(),'new setups default to quizzes and flashcards');
  check(await page.locator('[data-component="lessons"]').isChecked()&&await page.locator('[data-component="lessons"]').isDisabled(),'lessons cannot be turned off');
  for(const component of ['practice','checklists'])check(await page.locator(`[data-component="${component}"]`).isEnabled()&&!await page.locator(`[data-component="${component}"]`).isChecked(),`${component} is available but not silently added to defaults`);
  check(await page.locator('[data-component="images"]').isDisabled(),'generated images remain honestly unavailable');
  await page.locator('[data-brief-field="experience"][value="guided_practice"]').check();
  check(!await page.locator('[data-component="practice"]').isChecked(),'learning approach does not silently change materials');
  for(const components of combinations) {
    const quizzes=components.includes('quizzes'),flashcards=components.includes('flashcards');
    for(const value of ['practice','checklists','quizzes','flashcards'])await page.locator(`[data-component="${value}"]`).setChecked(components.includes(value));
    await page.getByRole('button',{name:'Continue to Context'}).click();await page.getByRole('button',{name:'Review setup'}).click();
    const included=await page.locator('.setup-component-summary p').first().textContent();
    const excluded=await page.locator('.setup-component-summary p').nth(1).count()?await page.locator('.setup-component-summary p').nth(1).textContent():'';
    check(included.includes('Quizzes')===quizzes&&included.includes('Flashcards')===flashcards,'Review includes exactly the chosen tools');
    check(excluded.includes('Quizzes')===!quizzes&&excluded.includes('Flashcards')===!flashcards,'Review names optional tools that are off');
    check(included.includes('Practice activities')===components.includes('practice')&&included.includes('Checklists')===components.includes('checklists'),'Review includes exact practical material choices');
    check(excluded.includes('Practice activities')===!components.includes('practice')&&excluded.includes('Checklists')===!components.includes('checklists'),'Review names omitted practice/checklists');
    await saved(components);
    await page.reload();await page.getByRole('heading',{name:'Review your course setup'}).waitFor();
    check(await page.locator('.setup-component-summary p').first().textContent()===included,'Review choice summary survives reload');
    await step('Experience');check(await quiz().isChecked()===quizzes&&await cards().isChecked()===flashcards,'going back preserves both independent choices');
    check(await page.locator('[data-component="practice"]').isChecked()===components.includes('practice')&&await page.locator('[data-component="checklists"]').isChecked()===components.includes('checklists'),'going back preserves practice/checklists');
  }
  await quiz().uncheck();
  await page.screenshot({path:'output/playwright/components-experience-1440.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});check(await fits(),'Step 2 fits mobile');
  await page.screenshot({path:'output/playwright/components-experience-390.png',fullPage:true});
  await cards().focus();await page.keyboard.press('Space');check(!await cards().isChecked(),'optional cards toggle by keyboard');
  for(const value of ['practice','checklists']) { await page.locator(`[data-component="${value}"]`).focus();await page.keyboard.press('Space');check(!await page.locator(`[data-component="${value}"]`).isChecked(),`${value} toggles by keyboard`); }
  await page.getByRole('button',{name:'Continue to Context'}).click();await page.getByRole('button',{name:'Review setup'}).click();
  await page.getByRole('heading',{name:'Review your course setup'}).waitFor();await saved(['lessons']);
  await page.screenshot({path:'output/playwright/components-review-390.png',fullPage:true});
  check(await fits(),'lessons-only Review fits mobile');
  await page.getByRole('button',{name:'Create course →',exact:true}).click();
  await page.getByRole('dialog',{name:'Sign in to create your course'}).waitFor();check(true,'lessons-only reaches contextual sign-in without a component blocker');
  await page.keyboard.press('Escape');
  await saved(['lessons']);
  check(writes.length===0,'changing and reviewing selections sends no sign-in, upload or generation POST');
  // Only alter the new disposable QA draft, never a user draft.
  await page.evaluate(async modulePath=>{
    const {createDraftStore}=await import(modulePath);const store=createDraftStore(),id=new URLSearchParams(location.search).get('draft');
    const {draft}=await store.load(id);if(draft.brief.topic!=='Photography component choices QA')throw new Error('Unexpected QA draft');
    draft.components.push('images');await store.save(draft,{expectedRevision:draft.revision});
  },modules.draft);
  await page.reload();await page.getByRole('button',{name:'Create course →',exact:true}).click();
  await page.getByRole('heading',{name:'Choose how the learning happens'}).waitFor();
  check(await page.getByRole('dialog').count()===0,'old unavailable choice is caught before authentication');
  check(await page.locator('[data-component="images"]').isChecked()&&await page.locator('[data-component="images"]').isEnabled(),'older unavailable selection is preserved and removable');
  check(await page.locator('[data-component="images"]').evaluate(el=>el===document.activeElement),'repair focuses the unavailable selected option');
  await page.screenshot({path:'output/playwright/components-unavailable-390.png',fullPage:true});
  await page.locator('[data-component="images"]').uncheck();
  check(await page.locator('[data-component="images"]').isDisabled()&&await page.locator('[data-component-warning]').textContent()==='','unchecking recovers without silently changing other choices');
  await page.setViewportSize({width:320,height:568});check(await fits(),'Step 2 fits narrow mobile');
  // Creation renderer: real UI, isolated service doubles, no AI work.
  await page.evaluate(async modules=>{
    const {createSetupCreation}=await import(modules.create);const {setupDraft}=await import(modules.model);
    const q=window.__componentQA={starts:0};const draft=setupDraft('Photography component choices QA');draft.brief.audience='New photographers';
    q.session={id:'setup-component-checks',owner:'qa-owner',version:0,draft,record:null};
    q.creation=createSetupCreation({sessions:{flush:async()=>true,acknowledge:async()=>true},getUser:()=>({id:'qa-owner',email:'learner@example.test'}),accountClient:{save:async()=>({revision:1})},client:{check:async()=>({ready:true,connected:true,enabled:true,issues:[],model:'test-model'}),start:async()=>{q.starts++;return {jobId:'synthetic-job'};}},navigate:()=>{},openJob:async()=>{}});
    q.show=components=>{q.session.draft.components=components;q.creation.render(document.querySelector('#content'),q.session);};
    q.show(['lessons']);
  },modules);
  for(const components of combinations) {
    await page.evaluate(c=>window.__componentQA.show(c),components);
    await page.getByRole('button',{name:'Create course plan →',exact:true}).waitFor();
    check(await page.getByRole('button',{name:'Create course plan →',exact:true}).isEnabled(),'creation allows each supported component combination');
    const included=await page.locator('.setup-component-summary p').first().textContent();
    check(included.includes('Quizzes')===components.includes('quizzes')&&included.includes('Flashcards')===components.includes('flashcards'),'readiness repeats the exact selection');
    check(included.includes('Practice activities')===components.includes('practice')&&included.includes('Checklists')===components.includes('checklists'),'readiness repeats exact practice/checklist choice');
  }
  check(await page.evaluate(()=>window.__componentQA.starts===0),'readiness never starts AI on its own');
  await page.setViewportSize({width:390,height:844});
  await page.screenshot({path:'output/playwright/components-readiness-390.png',fullPage:true});
  check(errors.length===0,'no uncaught browser errors');
  return {checks,total:checks.length,mode:'real guest app and IndexedDB; creation service doubles; no paid calls'};
})
