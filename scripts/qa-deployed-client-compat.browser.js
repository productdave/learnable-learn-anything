async page => {
  const {urls,accounts,modules,legacyModules,courseId,backend} = __DEPLOYED_COMPAT_QA__;
  const checks=[],errors=[],legacyWrites=[],modernWrites=[],networkDenied=[];
  const check=(condition,label)=>{if(!condition)throw Error(label);checks.push(label);};
  const browser=page.context().browser(), legacyContext=await browser.newContext(), legacy=await legacyContext.newPage();
  const modern=page;
  let legacyGate=null, modernGate=null;
  const guard=async route=>{
    const url=route.request().url();
    if ([urls.legacy,urls.modern,backend].some(origin=>url.startsWith(origin+'/')) || /^https:\/\/(?:esm\.sh|fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net)\//.test(url)&&route.request().method()==='GET') return route.continue();
    networkDenied.push(url.replace(/\?.*/,'')); return route.abort('blockedbyclient');
  };
  await modern.context().route('**/*',guard); await legacyContext.route('**/*',guard);
  for(const [target,label] of [[legacy,'legacy'],[modern,'modern']]) target.on('pageerror',e=>errors.push(`${label}: ${e.message}`));
  await legacy.route('**/rest/v1/user_state**',async route=>{
    if(route.request().method()==='POST'){
      legacyWrites.push(route.request().postDataJSON());
      if(legacyGate&&!legacyGate.arrived){legacyGate.arrived=true;await legacyGate.promise;}
    }
    return route.fallback();
  });
  await modern.route('**/rest/v1/user_state**',async route=>{
    if(['POST','PATCH'].includes(route.request().method())){
      modernWrites.push({method:route.request().method(),body:route.request().postDataJSON()});
      if(modernGate&&route.request().method()==='PATCH'&&!modernGate.arrived){modernGate.arrived=true;modernGate.request=route.request();await modernGate.promise;}
    }
    return route.fallback();
  });
  const makeGate=()=>{const gate={arrived:false};gate.promise=new Promise(resolve=>gate.release=resolve);return gate;};
  const until=async condition=>{for(let i=0;i<100;i++){if(condition())return;await modern.waitForTimeout(100);}throw Error('Timed out waiting for request barrier');};
  const url=(kind,lesson='lesson-1')=>`${urls[kind]}/?${kind==='modern'?'experience=workspace&':''}course=${courseId}#/foundations/${lesson}`;
  const load=async(target,kind)=>{
    await target.goto(url(kind)); await target.getByRole('heading',{name:'Photography lesson 1',exact:true}).waitFor();
    await target.evaluate(async paths=>{window.qaStore=(await import(paths.store)).store;window.qaAuth=await import(paths.auth);window.qaSync=await import(paths.sync);},kind==='legacy'?legacyModules:modules);
  };
  const signIn=async(target,account)=>{
    const error=await target.evaluate(async a=>{const result=await(await window.qaAuth.sb()).auth.signInWithPassword({email:a.email,password:a.password});return result.error?.message;},account);
    check(!error,'local fixture authentication succeeds');
    await target.waitForFunction(owner=>window.qaAuth.getUser()?.id===owner,account.owner);
    await target.evaluate(()=>window.qaSync.pullSyncNow());
  };
  const read=target=>target.evaluate(async()=>{const {data,error}=await(await window.qaAuth.sb()).from('user_state').select('state,updated_at').eq('user_id',window.qaAuth.getUser().id).single();if(error)throw error;return data;});
  const flush=target=>target.evaluate(()=>window.qaSync.flushSync());
  const quiz=target=>target.locator('[data-quiz-id="quiz-true"]');
  const complete=target=>target.locator('#complete-btn');
  const exercise=target=>target.locator('.exercise-textarea');
  const fillLegacy=async text=>{
    await exercise(legacy).fill(text);
    // The deployed editor debounces local persistence by 500ms. Wait for its
    // actual store, not a guessed delay, before explicitly flushing cloud sync.
    await legacy.waitForFunction(text=>window.qaStore.getExerciseDraft('compat-response')?.text===text,text);
  };
  const item=()=>modern.locator('[data-checklist-item="clear-space"]');
  const practice=()=>modern.locator('[data-step-index="0"]');
  try {
    await load(legacy,'legacy'); await signIn(legacy,accounts[0]);
    await quiz(legacy).locator('[data-option="false"]').click(); await quiz(legacy).getByRole('button',{name:'Check Answer'}).click();
    await fillLegacy('Legacy local response'); await complete(legacy).click(); await flush(legacy);
    let state=await read(legacy);
    check(state.state.progress.foundations['lesson-1'].completed,'actual deployed completion is saved');
    check(!!state.state.quizAnswers['quiz-true'],'actual deployed quiz answer is saved');
    check(!state.state._learningV2,'old client does not invent scoped ownership');
    await load(modern,'modern'); await signIn(modern,accounts[0]);
    await modern.waitForFunction(owner=>window.qaStore.scope().owner===owner,accounts[0].owner);
    check(!await item().isChecked()&&!await practice().isChecked(),'new learner does not infer legacy activity ownership');
    check(!(await complete(modern).textContent()).includes('Completed')&&!await quiz(modern).evaluate(el=>el.classList.contains('answered')),'new learner does not misattribute old completion or quiz');
    await item().check(); await practice().check(); await exercise(modern).fill('Account A private response');
    await quiz(modern).locator('[data-option="true"]').click(); await quiz(modern).getByRole('button',{name:'Check Answer'}).click(); await complete(modern).click(); await flush(modern);
    const defaults=await modern.evaluate(async({path,owner})=>{const{createMaterialDefaultsClient}=await import(path);const client=createMaterialDefaultsClient({getClient:window.qaAuth.sb,getIdentity:window.qaAuth.getUser});return client.save(owner,['lessons','checklists'],null);},{path:modules['material-defaults'],owner:accounts[0].owner});
    let before=await read(modern);
    check(!!before.state._learningV2.courses[courseId],'new real UI writes scoped progress');
    check(!!before.state.progress.foundations['lesson-1'].completed,'new sync retains unlabelled legacy history');
    await fillLegacy('Old tab saves after upgrade'); await flush(legacy);
    let after=await read(modern);
    check(JSON.stringify(after.state._learningV2)===JSON.stringify(before.state._learningV2),'old client save preserves every modern learning record');
    check(after.state._courseMaterialDefaults.revision===defaults.revision,'old client save preserves material defaults');
    check(after.state.exerciseDrafts['compat-response'].text==='Old tab saves after upgrade','old completion and response remain writable');
    check(after.updated_at>before.updated_at,'old write advances account revision');
    check(legacyWrites.length>0&&legacyWrites.every(w=>!w.state._learningV2&&!w.state._courseMaterialDefaults),'observed old POST payloads omit modern fields, exercising the real protection');

    await legacy.reload(); await legacy.getByRole('heading',{name:'Photography lesson 1',exact:true}).waitFor();
    await legacy.evaluate(async paths=>{window.qaStore=(await import(paths.store)).store;window.qaAuth=await import(paths.auth);window.qaSync=await import(paths.sync);},legacyModules);
    await legacy.waitForFunction(owner=>window.qaAuth.getUser()?.id===owner,accounts[0].owner); await legacy.evaluate(()=>window.qaSync.pullSyncNow());
    await flush(legacy); after=await read(modern);
    check(JSON.stringify(after.state._learningV2)===JSON.stringify(before.state._learningV2),'old reload/pull/automatic union also preserves new learning');
    await modern.evaluate(owner=>localStorage.removeItem(`learnable-learning-v2:account:${encodeURIComponent(owner)}`),accounts[0].owner);
    await load(modern,'modern'); await modern.waitForFunction(owner=>window.qaStore.scope().owner===owner,accounts[0].owner); await modern.evaluate(()=>window.qaSync.pullSyncNow());
    check(await item().isChecked()&&await practice().isChecked(),'database-only rehydration restores visible checklist/practice');
    check(await exercise(modern).inputValue()==='Account A private response','new response survives old save/reload');
    check((await complete(modern).textContent()).includes('Completed')&&await quiz(modern).evaluate(el=>el.classList.contains('answered')),'new completion and quiz restore from account');

    // A real old-client upsert invalidates the new client's already-read revision.
    modernGate=makeGate(); const modernAttempts=modernWrites.length;
    await item().uncheck(); const pendingModern=flush(modern); await until(()=>modernGate.arrived);
    await fillLegacy('Old write wins first'); await flush(legacy);
    const staleRequest=modernGate.request;
    modernGate.release(); await pendingModern; modernGate=null;
    const staleResponse=await staleRequest.response(), staleBody=await staleResponse.json();
    check((Array.isArray(staleBody)&&staleBody.length===0)||staleBody?.code==='PGRST116','the held conditional request actually matched zero rows');
    after=await read(modern);
    check(modernWrites.length-modernAttempts>=2,'new client retries its stale conditional write after actual legacy save');
    check(after.state.exerciseDrafts['compat-response'].text==='Old write wins first','conditional retry preserves latest legacy response');
    check(!await item().isChecked()&&await modern.evaluate(()=>window.qaStore.getSaveStatus().sync)==='saved','new unchecked state still saves after conflict');
    check(after.state._courseMaterialDefaults.revision===defaults.revision,'defaults survive stale-read retry');

    // Reverse ordering: old payload formed before the new save reaches the DB last.
    legacyGate=makeGate(); await fillLegacy('Delayed old save'); const pendingLegacy=flush(legacy); await until(()=>legacyGate.arrived);
    await item().check(); await exercise(modern).fill('Account A private response updated'); await flush(modern); before=await read(modern);
    legacyGate.release(); await pendingLegacy; legacyGate=null; after=await read(modern);
    check(JSON.stringify(after.state._learningV2)===JSON.stringify(before.state._learningV2),'late old payload cannot erase just-saved modern progress');
    check(after.state.exerciseDrafts['compat-response'].text==='Delayed old save','delayed legacy save remains valid for its own flat fields');
    check(after.state._courseMaterialDefaults.revision===defaults.revision,'defaults survive reverse save ordering');

    await modern.evaluate(()=>window.qaAuth.signOut()); await modern.waitForFunction(()=>window.qaStore.scope().owner===null);
    await signIn(modern,accounts[1]); await modern.waitForFunction(owner=>window.qaStore.scope().owner===owner,accounts[1].owner);
    check(!await item().isChecked()&&await exercise(modern).inputValue()==='','new account B cannot see account A response or checklist');
    check(!(await complete(modern).textContent()).includes('Completed'),'new account B has independent completion');
    await exercise(modern).fill('Account B own response'); await flush(modern);
    check(!JSON.stringify((await read(modern)).state).includes('Account A private response'),'account B durable state excludes A learning');
    await modern.evaluate(()=>window.qaAuth.signOut()); await signIn(modern,accounts[0]);
    await modern.waitForFunction(owner=>window.qaStore.scope().owner===owner,accounts[0].owner); await modern.evaluate(()=>window.qaSync.pullSyncNow());
    check(await item().isChecked()&&await exercise(modern).inputValue()==='Account A private response updated','account A restores its own latest work after switching back');
    for(const width of [390,320]){
      await modern.setViewportSize({width,height:844}); await modern.locator('.lesson-checklist').scrollIntoViewIfNeeded();
      check(await modern.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`${width}px recovered learner fits`);
      await modern.screenshot({path:`output/playwright/deployed-compat-${width}.png`,animations:'disabled'});
    }
    check(errors.length===0,'no uncaught errors in either app');
    check(networkDenied.length===0,'neither app attempted a production backend/provider request');
    await flush(modern); await flush(legacy);
    const report={status:'passed',total:checks.length,checks,legacyWrites:legacyWrites.length,modernWrites:modernWrites.length,mode:'actual recovered UI/store/sync; real local DB/Auth; synthetic static lesson, no providers'};
    await modern.evaluate(report=>window.__deployedCompatReport=report,report); return report;
  } catch(error) {
    await modern.screenshot({path:'output/playwright/deployed-compat-failure.png',animations:'disabled'}).catch(()=>{});
    await modern.evaluate(error=>window.__deployedCompatReport={status:'failed',error},error.message); throw error;
  } finally { legacyGate?.release(); modernGate?.release(); await legacyContext.close(); }
}
