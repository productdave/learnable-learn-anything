async page=>{
  const {urls,account,modules,legacyModules,courseId,scenario,backend}=__COURSE_COMPAT_QA__;
  const checks=[],errors=[],writes=[];
  const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  const context=await page.context().browser().newContext(),old=await context.newPage();
  const guard=route=>{
    const request=route.request(),url=request.url();
    if([urls.legacy,urls.modern,backend].some(origin=>url.startsWith(origin+'/'))||request.method()==='GET'&&/^https:\/\/(?:esm\.sh|fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net)\//.test(url))return route.continue();
    return route.abort('blockedbyclient');
  };
  await context.route('**/*',guard);await page.context().route('**/*',guard);
  for(const target of[old,page])target.on('pageerror',error=>errors.push(error.message));
  await old.route('**/rest/v1/user_courses**',async route=>{
    if(route.request().method()==='PATCH'){
      const response=await route.fetch();writes.push({status:response.status(),body:await response.json()});return route.fulfill({response});
    }
    return route.fallback();
  });
  const read=()=>page.evaluate(async id=>{
    const result=await(await window.qaAuth.sb()).from('user_courses').select('payload,updated_at').eq('owner_id',window.qaAuth.getUser().id).eq('id',id).single();if(result.error)throw result.error;return result.data;
  },courseId);
  try{
    for(const[target,kind,paths]of[[old,'legacy',legacyModules],[page,'modern',modules]]){
      await target.goto(urls[kind]+'/?'+(kind==='modern'?'experience=workspace':''));
      await target.evaluate(async paths=>{window.qaAuth=await import(paths.auth);window.qaCourses=await import(paths['user-courses']);window.qaCourseSync=await import(paths['course-sync']);},paths);
      const error=await target.evaluate(async account=>{const result=await(await window.qaAuth.sb()).auth.signInWithPassword({email:account.email,password:account.password});return result.error?.message;},account);
      check(!error,kind+' authenticates against local Auth');
      await target.waitForFunction(owner=>window.qaAuth.getUser()?.id===owner,account.owner);
      await target.evaluate(()=>window.qaCourseSync.syncCoursesNow());
      await target.waitForFunction(id=>!!window.qaCourses.getUserCourse(id),courseId);
    }
    await old.evaluate(id=>{window.qaStaleCourse=structuredClone(window.qaCourses.getUserCourse(id));},courseId);
    if(scenario==='mirror'){
      const first=await page.evaluate(async id=>{
        const course=window.qaCourses.getUserCourse(id);course.config.subtitle='First current-client edit';
        window.qaCourses.saveUserCourse(course);return window.qaCourseSync.pushCourseNow(id);
      },courseId);
      check(first.pushed&&!first.pending,'actual current mirror commits an edit based on its original read');
      const committed=await read();
      check(!!committed.payload._courseRevision&&committed.payload.config.subtitle==='First current-client edit','account stores the new revision and content');
      const local=await page.evaluate(id=>window.qaCourses.getUserCourse(id),courseId);
      check(local._courseRevision===committed.payload._courseRevision&&local._courseUpdatedAt===committed.updated_at,'mirror installs exact returned version');
      let release,arrived;const barrier=new Promise(done=>release=done),held=new Promise(done=>arrived=done);let requests=0;
      await page.route('**/rest/v1/rpc/commit_user_course',async route=>{
        requests++;const response=await route.fetch();arrived();await barrier;await route.fulfill({response});
      });
      const saving=page.evaluate(async id=>{
        const course=window.qaCourses.getUserCourse(id);course.config.subtitle='Save in flight';
        window.qaCourses.saveUserCourse(course);return window.qaCourseSync.pushCourseNow(id);
      },courseId);
      try{
        await held;
        await page.evaluate(id=>{
          const course=window.qaCourses.getUserCourse(id);course.config.subtitle='Newer unsent device edit';window.qaCourses.saveUserCourse(course);
        },courseId);
      }finally{release();}
      const result=await saving;
      check(result.pushed&&await page.evaluate(()=>window.qaCourseSync.getStatus().pushFailures.some(x=>x.kind==='conflict')),'completed request leaves a visible warning for its separate newer pending edit');
      const pending=await page.evaluate(id=>window.qaCourses.getUserCourse(id),courseId);
      check(pending.config.subtitle==='Newer unsent device edit'&&pending._courseRevision===committed.payload._courseRevision,'in-flight response neither erases pending content nor rebases its original token');
      check((await read()).payload.config.subtitle==='Save in flight','only submitted version reaches the account');
      const retry=await page.evaluate(id=>window.qaCourseSync.pushCourseNow(id),courseId);
      check(!retry.pushed&&retry.skipped&&requests===1,'stale retry is skipped without another write');
      await page.evaluate(()=>window.qaCourseSync.syncCoursesNow());
      check(await page.evaluate(id=>window.qaCourses.getUserCourse(id).config.subtitle,courseId)==='Newer unsent device edit','pull preserves conflicting device copy');
      check(await page.evaluate(()=>window.qaCourseSync.getStatus().pushFailures.some(x=>x.kind==='conflict')),'conflict remains visible in sync status');
      await page.getByRole('button',{name:'Account',exact:true}).click();
      await page.getByText('1 course could not save to your account — details',{exact:true}).click();
      await page.getByText('This course changed in another tab.',{exact:false}).first().waitFor();
      for(const width of[1440,390,320]){
        await page.setViewportSize({width,height:1000});
        const detail=page.locator('[data-cloud-sync-body] details');
        if(!await detail.evaluate(el=>el.open))await detail.locator('summary').click();
        await page.getByText('This course changed in another tab.',{exact:false}).first().scrollIntoViewIfNeeded();
        check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`conflict message fits ${width}px`);
        check(await page.locator('.auth-card').evaluate(el=>el.scrollWidth<=el.clientWidth),`account dialog has no horizontal overflow at ${width}px`);
        await page.screenshot({path:`output/playwright/course-revision-conflict-${width}.png`});
      }
      check(errors.length===0,'no browser exceptions');
      const report={checks:checks.length,passed:checks,scope:'Actual current mirror, local Auth/DB, controlled response race and visible conflict; no providers'};
      await page.evaluate(report=>window.__courseCompatReport=report,report);return report;
    }
    if(scenario==='new-run'){
      const rebuilt=await(await page.request.post(urls.modern+'/__qa/new-run')).json();
      check(rebuilt.courseId===courseId&&!!rebuilt.runId,'Actual generator writer saves newer run into the same course');
      const accepted=await read();
      check(accepted.payload.modules[1]['lesson-1'].title==='Newer generated lesson','New run is durably readable');
      const result=await old.evaluate(async id=>{window.qaCourses.saveUserCourse(window.qaStaleCourse);return window.qaCourseSync.pushCourseNow(id);},courseId);
      check(!result.pushed&&!result.failed&&result.skipped,'Actual old writer declines a different generation run');
      check(writes.length===0,'Different-run rejection happens before PATCH');
      check(JSON.stringify((await read()).payload)===JSON.stringify(accepted.payload),'Newer generated content remains intact');
      await old.evaluate(()=>window.qaCourseSync.syncCoursesNow());
      check(await old.evaluate(id=>window.qaCourses.getUserCourse(id)._generationRunId!==window.qaStaleCourse._generationRunId,courseId)===false,'Unsynced old-device course is retained instead of silently discarded');
      const report={checks:checks.length,passed:checks,scope:'Actual old writer vs real local generation save; known run IDs only; no provider calls'};
      await page.evaluate(report=>window.__courseCompatReport=report,report);return report;
    }
    await page.goto(urls.modern+'/?experience=workspace&filter=mine');
    await page.getByRole('link',{name:/^Review course\s*:/}).click();
    await page.getByRole('button',{name:'Make changes',exact:true}).click();
    const editor=page.locator('dialog.course-editor');
    const choice=await editor.getByRole('option',{name:/Photography lesson 1 — Checklist/}).getAttribute('value');
    await editor.locator('[data-editor-target]').selectOption(choice);
    const label='Accepted new version: clear the surface before practicing.';
    await editor.getByRole('textbox',{name:'Label',exact:true}).first().fill(label);
    await editor.getByRole('button',{name:'Preview change',exact:true}).click();
    await editor.getByRole('button',{name:'Replace this item',exact:true}).click();
    await editor.getByRole('heading',{name:'Change saved',exact:true}).waitFor();
    // A navigation recreated this page's JS globals; bind the loaded modules again.
    await page.evaluate(async paths=>{window.qaAuth=await import(paths.auth);window.qaCourses=await import(paths['user-courses']);window.qaCourseSync=await import(paths['course-sync']);},modules);
    const accepted=await read();
    check(accepted.payload.modules[1]['lesson-1'].sections.find(s=>s.type==='checklist').items[0].label===label,'Current editor really saves accepted replacement');
    const result=await old.evaluate(async id=>{
      // The real deployed local save stamps a later clock, then its real mirror
      // reads the latest DB updated_at before issuing its guarded PATCH.
      window.qaCourses.saveUserCourse(window.qaStaleCourse);
      return window.qaCourseSync.pushCourseNow(id);
    },courseId);
    check(writes.length===1,'Actual old writer issued one PATCH after accepted edit');
    const after=await read();
    if(JSON.stringify(after.payload)!==JSON.stringify(accepted.payload)){
      throw Error('REPRODUCED: deployed stale course writer overwrote accepted editing. '+JSON.stringify({legacyWriteStatus:writes[0].status,legacyReportedPushed:result.pushed,acceptedReceiptRetained:!!after.payload._lastRefinement}));
    }
    check(true,'Older saved copy cannot erase accepted content or editing receipt');
    check(result.failed&&!result.pushed,'Old client does not falsely report a rejected save as success');
    check(errors.length===0,'No browser exceptions');
    const report={checks:checks.length,passed:checks,scope:'Actual deployed local course writer and current editor, local Auth/DB only; no provider calls'};
    await page.evaluate(report=>window.__courseCompatReport=report,report);return report;
  }finally{await context.close();}
}
