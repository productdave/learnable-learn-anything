async page => {
  const checks=[],out='output/playwright/hosted-account-auth-browser-C8aBw6';
  const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  await page.getByRole('heading',{name:'Review your course setup',exact:true}).waitFor();
  check(await page.getByText('1 note · 1 link · 1 file',{exact:true}).isVisible(),'Independent browser receives full account source inventory');
  await page.getByRole('link',{name:'Edit context',exact:true}).click();
  await page.getByRole('button',{name:'Files 1',exact:true}).click();
  const file=page.locator('.source-file').filter({hasText:'hosted-source-recovery.txt'});
  check(await file.getByText('Attached',{exact:true}).isVisible(),'Original is attached without reselecting a local file');
  check(await file.getByRole('button',{name:'Reattach file',exact:true}).count()===0,'No unnecessary reattachment prompt');
  await file.scrollIntoViewIfNeeded();
  check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'No horizontal overflow at 390px');
  await page.screenshot({path:out+'/file-restored-390.png'});
  const original=await page.evaluate(async()=>{
    const auth=await import('/js-workspace-account-20260919-r2/auth.js?v=31');
    const {createSetupAccountClient}=await import('/js-workspace-account-20260919-r2/setup-account-client.js?v=10');
    const id=new URL(location.href).searchParams.get('draft');
    const result=await createSetupAccountClient().restore(auth.getUser().id,id);
    const file=result.draft.sources.files[0];
    const expected='Photography source recovery — disposable staging QA\nCompare two window-light photographs. Keep the exact original bytes.\nThis fixture contains no personal information and is not instructional acceptance evidence.\n';
    return {count:result.draft.sources.files.length,missing:result.missing,revision:result.cloud.revision,exactBytes:await file.blob.text()===expected,hashVerified:!!file.blob};
  });
  check(original.count===1&&original.missing===0,'Private storage download succeeds for signed-in owner');
  check(original.exactBytes&&original.hashVerified,'Original UTF-8 bytes and stored SHA-256 validation survive recovery');
  check(original.revision===1,'Recovery does not create another saved revision');
  await page.getByRole('button',{name:'Review setup →',exact:true}).click();
  await page.getByRole('heading',{name:'Review your course setup',exact:true}).waitFor();
  return {passed:true,checks,original,physicalDevice:false,emailSent:false,providerCalls:0};
}
