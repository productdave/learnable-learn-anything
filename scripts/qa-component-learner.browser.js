(async page => {
  const fixtures=__COMPONENT_COURSE_FIXTURES__;
  // Production IDs should be unique. Avoid legacy global quiz-key collisions in
  // these repeated fixture courses; progress-store migration is a separate slice.
  for(const [id,course] of Object.entries(fixtures))for(const topics of Object.values(course.modules))for(const topic of Object.values(topics))for(const section of topic.sections)if(section.type==='quiz')section.id=`${id}-${topic.id}-${section.id}`;
  const checks=[],errors=[];
  const check=(value,label)=>{if(!value)throw new Error(label);checks.push(label);};
  page.on('pageerror',error=>errors.push(error.message));
  await page.unrouteAll({behavior:'ignoreErrors'});
  await page.route('**/data/courses/qa-components-*/**',async route=>{
    const match=route.request().url().match(/\/data\/courses\/([^/]+)\/(.+)/);
    const course=fixtures[match[1]],file=match[2];
    const body=file==='course.json'?course.config:file==='curriculum.json'?course.curriculum:course.modules[Number(file.match(/module-(\d+)/)?.[1])];
    if(!body)throw new Error('Unexpected fixture file '+file);
    await route.fulfill({json:body});
  });
  await page.setViewportSize({width:1440,height:1000});
  await page.goto('http://127.0.0.1:4173/?experience=workspace&course=qa-components-0#/foundations/lesson-1');
  const visit=async id=>{
    await page.evaluate(id=>{history.pushState(null,'',`?experience=workspace&course=${id}#/foundations/lesson-1`);dispatchEvent(new PopStateEvent('popstate'));},id);
    await page.waitForFunction(id=>document.title.includes(id),id);
    await page.getByRole('heading',{name:`${id} · Photography lesson 1`,exact:true}).waitFor();
  };
  for(const id of Object.keys(fixtures)) {
    await visit(id);const expected=fixtures[id].config.components||['lessons','quizzes','flashcards'];
    check(await page.locator('.quiz-block').count()===(expected.includes('quizzes')?3:0),`${id}: learner receives only selected quizzes`);
    check(await page.locator('#flashcard-trigger').isVisible()===expected.includes('flashcards'),`${id}: flashcard tool matches selection`);
    if(expected.includes('quizzes')) {
      const quiz=page.locator('.quiz-block').first();
      await quiz.locator('[data-option="true"]').click();await quiz.getByRole('button',{name:'Check Answer'}).click();
      check(await quiz.locator('.quiz-explanation').isVisible(),`${id}: selected quiz reveals feedback`);
    }
    await page.locator('#complete-btn').click();
    check((await page.locator('#complete-btn').textContent()).includes('Completed'),`${id}: lesson completion works`);
    await page.locator('#complete-btn').click();
    if(expected.includes('flashcards')) {
      await page.locator('#flashcard-trigger').click();await page.locator('#fc-card').waitFor();
      check((await page.locator('.flashcard-progress').textContent()).includes('/ 12'),`${id}: selected cards load across lessons`);
      await page.locator('#fc-card').click();check(await page.locator('#fc-card').evaluate(el=>el.classList.contains('flipped')),`${id}: flashcard reveals answer`);
      await page.locator('#fc-close').click();
    }
  }
  // Revisit a cached cards-off course after a cards-on course, not a fresh load.
  await visit('qa-components-0');
  check(!await page.locator('#flashcard-trigger').isVisible(),'cached course switch restores cards-off shell');
  await page.evaluate(()=>{document.activeElement?.blur();window.scrollTo({top:0,behavior:'instant'});});await page.waitForTimeout(300);
  await page.screenshot({path:'output/playwright/components-lesson-1440.png',fullPage:true,animations:'disabled'});
  await page.setViewportSize({width:390,height:844});
  await page.waitForTimeout(300);
  check(await page.locator('#sidebar').evaluate(el=>el.getBoundingClientRect().right<=1),'mobile lesson sidebar stays closed until requested');
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'lessons-only course fits mobile');
  check(await page.locator('#chat-panel').evaluate(el=>!el.classList.contains('open')&&el.getBoundingClientRect().top>=innerHeight),'closed mobile tutor does not cover the lesson');
  // Viewport captures exclude the legacy off-canvas tutor below the screen.
  await page.screenshot({path:'output/playwright/components-lesson-390.png',animations:'disabled'});
  await page.locator('#complete-btn').scrollIntoViewIfNeeded();await page.screenshot({path:'output/playwright/components-lesson-end-390.png',animations:'disabled'});
  // Defensive empty state: old links/scripts cannot open a misleading success state.
  await page.locator('#flashcard-trigger').evaluate(el=>el.click());
  await page.getByRole('heading',{name:'Flashcards aren’t included'}).waitFor();
  check(!(await page.locator('#flashcard-overlay').textContent()).includes('tomorrow'),'omitted cards never claim a completed session or tomorrow’s cards');
  await page.getByRole('button',{name:'Close flashcards',exact:true}).click();
  check(errors.length===0,'no uncaught learner browser errors');
  return {total:checks.length,checks,mode:'real learner rendering and interactions, synthetic local course fixtures'};
})
