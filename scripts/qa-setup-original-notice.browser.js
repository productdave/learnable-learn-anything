async page => {
  // A generated copy replaces this token with the reviewed local module source.
  // Staging is not changed. The remaining modules/CSS use current staging bytes.
  const source=__COURSE_SETUP_SOURCE__,checks=[],requests=[];
  const out='output/playwright/source-notice-fix-C8aBw6';
  const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  await page.route('**/api/**',route=>{requests.push('blocked API request');return route.abort();});
  await page.route('**/js-workspace-account-20260919-r2/course-setup.js?v=20',route=>route.fulfill({contentType:'text/javascript',body:source}));
  await page.route('**/qa-original-notice',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html lang="en" data-theme="light"><head><meta name="viewport" content="width=device-width, initial-scale=1"><link rel="stylesheet" href="/styles-workspace-account-20260919-r2/tokens.css"><link rel="stylesheet" href="/styles-workspace-account-20260919-r2/base.css"><link rel="stylesheet" href="/styles-workspace-account-20260919-r2/components.css"><link rel="stylesheet" href="/styles-workspace-account-20260919-r2/home.css"><link rel="stylesheet" href="/styles-workspace-account-20260919-r2/themes.css"></head><body class="home-mode"><main id="content"></main></body></html>'}));
  await page.goto('https://learnable-staging.vercel.app/qa-original-notice');
  await page.setViewportSize({width:390,height:844});
  await page.evaluate(async()=>{
    const {createSetupController}=await import('/js-workspace-account-20260919-r2/course-setup.js?v=20');
    const {createDraftStore}=await import('/js-workspace-account-20260919-r2/draft-store.js?v=4');
    const {setupDraft}=await import('/js-workspace-account-20260919-r2/setup-model.js?v=4');
    const draft=setupDraft('Source recovery QA');draft.brief.audience='Adult beginners';draft.step='context';
    draft.sources.notes=[{id:'note',title:'Keep this',text:'Exact note text'}];
    draft.sources.files=['one','two'].map(id=>({id,name:id+'.txt',size:8,type:'text/plain',blob:null}));
    const controller=createSetupController({getOwner:()=> 'qa-local-owner',getIdentity:()=>({id:'qa-local-owner'}),
      navigate:()=>{throw Error('Unexpected navigation');},store:createDraftStore({dbName:'qa-original-notice-'+crypto.randomUUID()}),
      accountClient:{restore:async()=>({draft,cloud:{revision:1,contentHash:'a'.repeat(64),updatedAt:new Date().toISOString()},missing:2})}});
    await controller.render(document.querySelector('#content'),'qa-local-sources','context');
  });
  await page.getByRole('button',{name:'Files 2',exact:true}).click();
  const warning=page.locator('[data-original-notice]');
  check(await warning.isVisible(),'Missing originals show the recovery notice');
  const attach=async id=>{
    // Use the actual hidden picker input after selecting its source. setInputFiles
    // avoids this CLI daemon yielding mid-script on a native file chooser.
    await page.locator(`[data-source-id="${id}"] [data-source-action="reattach"]`).evaluate(button=>{
      const input=document.querySelector('[data-reattach-input]');input.click=()=>{};button.click();
    });
    await page.locator('[data-reattach-input]').setInputFiles('/Users/davidwang/Learnable/scripts/fixtures/'+(id==='one'?'hosted-source-recovery.txt':'hosted-source-recovery-second.txt'));
  };
  await attach('one');
  check(await warning.isVisible(),'Partial reattachment retains the warning');
  await page.locator('[data-source-id="two"] [data-source-action="remove"]').click();
  check(await warning.isHidden(),'Removing the last missing original clears the warning immediately');
  await page.getByRole('button',{name:'Undo removal',exact:true}).click();
  check(await warning.isVisible(),'Undo restores the actionable missing-original notice');
  await attach('two');
  check(await warning.isHidden(),'Reattaching the last missing original clears the warning without navigation');
  check(await page.locator('.source-file').count()===2,'The two source identities are preserved');
  check(await page.locator('.source-file [data-file-state]').allTextContents().then(values=>values.every(v=>v==='Attached')),'Both repaired files display Attached');
  await page.locator('.source-file').last().scrollIntoViewIfNeeded();
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow at 390px');
  await page.screenshot({path:out+'/recovered-390.png',fullPage:true});
  await page.getByRole('button',{name:'Plain notes 1',exact:true}).click();
  check(await page.getByRole('textbox',{name:'Notes, transcript or raw text',exact:true}).inputValue()==='Exact note text','File recovery preserves other source text');
  await page.setViewportSize({width:1280,height:900});
  await page.getByRole('button',{name:'Files 2',exact:true}).click();
  await page.screenshot({path:out+'/recovered-1280.png',fullPage:true});
  check(requests.length===0,'Local recovery UI makes no API requests');
  return {passed:true,checks,localSourceOverride:true,deployed:false,backend:'injected restore double',providerCalls:0};
}
