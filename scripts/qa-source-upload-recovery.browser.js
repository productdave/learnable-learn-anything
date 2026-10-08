// Real app + Auth/Storage/database, controlled browser transport faults only.
// No substituted upload result or setup commit; successful requests reach local services.
async page => {
  const qa=__IDENTITY_QA__,checks=[],errors=[],uploads=[],setupWrites=[];
  const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  page.setDefaultTimeout(15000);page.on('pageerror',e=>errors.push(e.message));
  let secondAttempts=0,dropCommit=true;
  const paths=new Map();
  const control=async action=>{
    const response=await page.request.post(qa.proxy+'/api/qa/identity',{headers:{'x-qa-key':qa.nonce},data:{action}});
    if(!response.ok())throw Error('Fixture control failed');return response.json();
  };
  const noGeneration=async label=>{const state=await control('status');check(!state.jobs.length&&!state.calls.length,label);};
  await page.route('**/*',route=>{
    const r=route.request(),url=r.url();
    if([qa.base,qa.proxy,qa.backend].some(origin=>url.startsWith(origin+'/'))||r.method()==='GET'&&/^https:\/\/(esm\.sh|cdn\.jsdelivr\.net|fonts\.googleapis\.com|fonts\.gstatic\.com)\//.test(url))return route.continue();
    return route.abort('blockedbyclient');
  });
  await page.route(qa.base+'/api/**',async route=>{
    const req=route.request(),relative=req.url().slice(qa.base.length),headers={...req.headers()};delete headers.host;
    if(headers.origin)headers.origin=qa.proxy;headers['sec-fetch-site']='same-origin';
    const response=await route.fetch({url:qa.proxy+relative,headers});
    if(relative==='/api/setups/store'&&req.method()==='POST'){
      setupWrites.push({status:response.status(),value:await response.json()});
      if(dropCommit){dropCommit=false;return route.abort('connectionreset');}
    }
    return route.fulfill({response});
  });
  await page.route(qa.backend+'/storage/v1/object/setup-sources/**',async route=>{
    const req=route.request();if(req.method()!=='POST')return route.fallback();
    if(!paths.has(req.url()))paths.set(req.url(),paths.size+1);
    const file=paths.get(req.url());
    check(req.headers()['x-upsert']!=='true','upload never enables overwrite');
    if(file===2&&++secondAttempts===1){uploads.push({file,result:'dropped-before-send'});return route.abort('connectionreset');}
    const response=await route.fetch();uploads.push({file,status:response.status()});
    if(file===2&&secondAttempts===2){check(response.ok(),'lost reply follows actual second-file acceptance');return route.abort('connectionreset');}
    return route.fulfill({response});
  });
  const note='Synthetic private note: keep café 日本語 and window-light observations intact.';
  const originals=[{name:'upload-window-light.txt',text:'First original: compare indirect window light. café 日本語.\n'},{name:'upload-composition.txt',text:'Second original: leave room around the subject. résumé.\n'}];
  const expected=await page.evaluate(async files=>Promise.all(files.map(async file=>{
    const bytes=new TextEncoder().encode(file.text),digest=await crypto.subtle.digest('SHA-256',bytes);
    return {name:file.name,size:bytes.length,sha256:[...new Uint8Array(digest)].map(n=>n.toString(16).padStart(2,'0')).join('')};
  })),originals);
  try{
    await page.goto(qa.base+'/?experience=workspace');await page.setViewportSize({width:1440,height:1000});
    await page.getByLabel('What do you want to learn or teach?').fill('Interrupted Source Upload Photography');
    await page.getByRole('button',{name:/^Create course/}).click();
    await page.getByLabel('Who is it for?').fill('A beginner taking photos at home');
    await page.getByRole('button',{name:'Continue to Experience'}).click();
    for(const value of ['practice','checklists','quizzes','flashcards'])await page.locator(`[data-component="${value}"]`).uncheck();
    await page.getByRole('button',{name:'Continue to Context'}).click();
    await page.getByRole('button',{name:'+ Add a note',exact:true}).click();
    await page.getByLabel('Notes, transcript or raw text').fill(note);
    await page.locator('[data-source-kind="files"]').click();await page.locator('#source-files').setInputFiles(originals.map(file=>'scripts/fixtures/'+file.name));
    await page.getByRole('button',{name:'Review setup'}).click();
    const draftId=await page.evaluate(()=>new URL(location.href).searchParams.get('draft'));
    check(uploads.length===0,'guest source selection uploads no private files');
    await page.getByRole('button',{name:/^Create course/}).click();
    await page.getByRole('dialog',{name:'Sign in to create your course'}).waitFor();
    await page.evaluate(async({authModule,account})=>{
      const sdk=await(await import(authModule)).sb();const r=await sdk.auth.signInWithPassword({email:account.email,password:account.password});if(r.error)throw Error('Fixture sign-in failed');
    },{authModule:qa.authModule,account:qa.accounts[0]});
    await page.locator('.setup-create-context').filter({hasText:qa.accounts[0].email}).waitFor();
    await page.getByRole('button',{name:/^Create course/}).click();
    await page.getByText(/composition.txt could not be uploaded/).waitFor();
    let state=await control('uploads');
    check(state.objects.length===1&&state.setups.length===0,'interrupted second upload retains first object but no incomplete account revision');
    check(uploads.some(x=>x.result==='dropped-before-send')&&setupWrites.length===0,'transport interruption happens before second storage write and before setup commit');
    await noGeneration('failed upload starts no job or AI call');
    check((await page.locator('[data-creation-error]').textContent()).includes('1 original files transferred so far'),'error states partial transfer and retry preservation');
    for(const width of[1440,390,320]){
      await page.setViewportSize({width,height:1000});await page.locator('[data-creation-error]').scrollIntoViewIfNeeded();
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`upload failure fits ${width}px`);
      await page.screenshot({path:`output/playwright/source-upload-failure-${width}.png`});
    }
    await page.reload();
    await page.getByText(/composition.txt could not be uploaded/).waitFor();
    state=await control('uploads');
    check(state.objects.length===2&&state.setups.length===0,'lost successful upload reply keeps both originals without claiming setup saved');
    check(await page.evaluate(()=>new URL(location.href).searchParams.get('draft'))===draftId,'reload resumes the same setup');
    check(await page.getByText('1 note · 0 links · 2 files',{exact:true}).isVisible(),'reload retains selected note and both files');
    await noGeneration('reload and lost upload reply still start no AI');
    await page.getByRole('button',{name:'Check again',exact:true}).click();
    await page.getByText('Couldn’t confirm the account save. Your device copy is safe. Retry to check the existing version before saving again.',{exact:true}).waitFor();
    state=await control('uploads');
    check(state.objects.length===2&&state.setups.length===1&&state.setups[0].revision===1,'accepted setup commit survives lost response without duplicate files');
    check(state.setups[0].payload.sources.notes[0].text===note,'account commit retains complete Unicode note');
    for(const file of expected)check(state.objects.some(object=>object.size===file.size&&object.sha256===file.sha256),`${file.name} original bytes survive retries`);
    check(uploads.filter(x=>x.status===200).length===2&&uploads.filter(x=>x.status===400||x.status===409).length===3,'only two uploads accepted; retries encounter immutable existing objects');
    const uploadCount=uploads.length;
    await noGeneration('ambiguous setup reply starts no paid work');
    await page.getByRole('button',{name:'Check again',exact:true}).click();
    await page.locator('[data-source-reviewed]').waitFor();
    state=await control('uploads');
    check(state.setups[0].revision===1&&setupWrites.length===1&&uploads.length===uploadCount,'retry rereads accepted setup without uploading or committing again');
    check(await page.getByText('Text ready',{exact:true}).count()===2,'both actual source files are extracted after recovery');
    check(await page.getByRole('button',{name:'Create course plan →',exact:true}).isDisabled(),'source review still required before metered start');
    await noGeneration('successful source recovery waits for explicit Create');
    for(const width of[1440,390,320]){
      await page.setViewportSize({width,height:1000});await page.locator('[data-source-reviewed]').scrollIntoViewIfNeeded();
      check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`recovered source review fits ${width}px`);
      await page.screenshot({path:`output/playwright/source-upload-recovered-${width}.png`});
    }
    await page.locator('[data-source-reviewed]').check();await control('release');
    await page.getByRole('button',{name:'Create course plan →',exact:true}).click();
    await page.waitForURL(/workspace=job-/);
    await page.getByRole('button',{name:'Open review',exact:true}).waitFor();await page.getByRole('button',{name:'Open review',exact:true}).click();
    await page.locator('[data-review-continue]').click();
    await page.getByRole('button',{name:'Close',exact:true}).filter({visible:true}).first().click();
    await page.getByRole('button',{name:'Open review',exact:true}).waitFor();await page.getByRole('button',{name:'Open review',exact:true}).click();
    await page.getByRole('heading',{name:'Review the research and sources',exact:true}).waitFor();
    await page.locator('[data-review-continue]').click();await page.getByRole('button',{name:'Close',exact:true}).filter({visible:true}).first().click();
    await page.getByRole('link',{name:/^Open course/}).waitFor({timeout:30000});
    check((await control('status')).jobs.length===1&&(await control('status')).jobs[0].status==='completed','explicit recovery journey completes one account course');
    await page.getByRole('link',{name:/^Open course/}).click();
    await page.getByRole('link',{name:/^Module 1 Light and composition/}).click();
    await page.getByRole('heading',{name:'Photography lesson-1',exact:true}).waitFor();
    check(true,'creator opens the actual saved lesson after upload recovery');
    check(!errors.length,'no uncaught browser exceptions');
    const report={checks:checks.length,passed:checks,uploads:uploads.map(({file,status,result})=>({file,status,result})),scope:'Actual local Auth/API/Postgres/Storage; dropped request, accepted upload lost reply, accepted setup lost reply, full synthetic course; not hosted or physical-device acceptance.'};
    await page.evaluate(report=>window.__identityQAReport=report,report);return report;
  }catch(error){
    await page.evaluate(report=>window.__identityQADiagnostic=report,{checks,errors,uploads,setupWrites:setupWrites.map(x=>({status:x.status,revision:x.value.revision}))});throw error;
  }
}
