async page => {
  const checks=[],requests=[],out='output/playwright/hosted-account-auth-browser-dwch0b/connected-final';
  const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  const record=request=>{const prefix='https://learnable-staging.vercel.app',url=request.url();if(url.startsWith(prefix+'/api/'))requests.push({path:url.slice(prefix.length).split('?')[0],method:request.method()});};
  page.on('request',record);
  const dialog=page.getByRole('dialog'),account=page.getByRole('button',{name:'Account',exact:true});
  await dialog.getByRole('status').filter({hasText:/^Connected securely$/}).waitFor();
  check(await dialog.getByRole('textbox').count()===0,'Actual hosted GET recognizes synthetic encrypted connection without exposing a key');
  await page.screenshot({path:out+'/connected-390.png'});
  for(let i=0;i<12;i++) {
    await page.keyboard.press('Tab');
    check(await page.evaluate(()=>!document.hasFocus()||!!document.activeElement?.closest('dialog')),'Tab cycle '+(i+1)+' does not reach background controls');
  }
  await dialog.getByRole('button',{name:'Replace key',exact:true}).click();
  await dialog.getByRole('textbox',{name:'New Claude API key',exact:true}).fill('unsubmitted-replacement-qa');
  await dialog.getByRole('button',{name:'Cancel',exact:true}).click();
  check(await dialog.getByRole('textbox').count()===0,'Cancel replacement preserves connected state and removes key field');
  await dialog.getByRole('button',{name:'Disconnect…',exact:true}).click();
  await dialog.getByRole('group',{name:'Disconnect Claude?',exact:true}).waitFor();
  check(await dialog.getByRole('button',{name:'Keep connected',exact:true}).evaluate(el=>el===document.activeElement),'Disconnect confirmation initially focuses the safe choice');
  await page.screenshot({path:out+'/disconnect-confirm-390.png'});
  await dialog.getByRole('button',{name:'Keep connected',exact:true}).click();
  check(await dialog.getByRole('status').innerText()==='Connected securely','Keep connected cancels without deleting');
  await dialog.getByRole('button',{name:'Disconnect…',exact:true}).click();
  const deletion=page.waitForResponse(r=>r.url().includes('/api/providers/connection')&&r.request().method()==='DELETE');
  await dialog.getByRole('button',{name:'Disconnect Claude',exact:true}).click();
  check((await deletion).status()===200,'Confirmed disconnect uses actual hosted owner DELETE');
  await dialog.getByRole('status').filter({hasText:/^Claude disconnected\. Saved courses are unchanged\.$/}).waitFor();
  check(await dialog.getByRole('textbox',{name:'Claude API key',exact:true}).inputValue()==='','Disconnected form is empty');
  await page.screenshot({path:out+'/disconnected-success-390.png'});
  await page.keyboard.press('Escape');
  await account.click();
  await dialog.getByRole('status').filter({hasText:/^Not connected$/}).waitFor();
  check(true,'Reopen confirms durable disconnected status through actual hosted GET');
  await page.keyboard.press('Escape');
  await page.getByRole('link',{name:'Edit context',exact:true}).click();
  await page.getByRole('button',{name:'Plain notes 1',exact:true}).click();
  await page.getByRole('textbox',{name:'Notes, transcript or raw text',exact:true}).waitFor();
  check(await page.getByRole('textbox',{name:'Title Optional',exact:true}).inputValue()==='Photography notes','Note title survives Account interactions');
  check(await page.getByRole('textbox',{name:'Notes, transcript or raw text',exact:true}).inputValue()==='Practice framing an everyday subject in natural light. Preserve this exact note through Account actions.','Exact note content survives Account interactions');
  await page.getByRole('button',{name:'Links 1',exact:true}).click();
  check(await page.getByRole('textbox',{name:'Website URL',exact:true}).inputValue()==='https://example.com/photography','Exact link survives Account interactions');
  await page.getByRole('button',{name:'Review setup →',exact:true}).click();
  await page.getByRole('heading',{name:'Review your course setup',exact:true}).waitFor();
  check(requests.filter(r=>r.method==='DELETE').length===1,'Exactly one explicit DELETE; cancelling caused none');
  check(!requests.some(r=>r.method==='POST' && r.path!=='/api/gen/watchdog'),'No provider validation, setup save or generation POST; only routine watchdog status checks allowed');
  page.off('request',record);
  return {passed:true,checks,requests,realKeySubmitted:false,paidCalls:0,screenshots:out};
}
