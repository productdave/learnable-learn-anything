async page => {
  const checks=[],out='output/playwright/hosted-account-auth-browser-zEj2K1';
  const check=(ok,label)=>{if(!ok)throw Error(label);checks.push(label);};
  await page.getByRole('heading',{name:'Review your course setup',exact:true}).waitFor();
  check(await page.getByRole('heading',{name:'Photography staging QA',exact:true}).isVisible(),'Second browser opens the account-saved setup at Review');
  check(await page.getByText('1 note · 1 link · 0 files',{exact:true}).isVisible(),'Second browser receives saved source inventory');
  await page.screenshot({path:out+'/secondary-saved-review-390.png'});
  await page.getByRole('link',{name:'Edit context',exact:true}).click();
  await page.getByRole('button',{name:'Plain notes 1',exact:true}).click();
  check(await page.getByRole('textbox',{name:'Title Optional',exact:true}).inputValue()==='Cross-browser transcript','Exact note title recovered from account');
  check(await page.getByRole('textbox',{name:'Notes, transcript or raw text',exact:true}).inputValue()==='Keep this exact raw text in the original browser. Compare two window-light photographs.','Exact raw text recovered from account');
  await page.getByRole('textbox',{name:'Notes, transcript or raw text',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:out+'/secondary-saved-note-390.png'});
  await page.getByRole('button',{name:'Links 1',exact:true}).click();
  check(await page.getByRole('textbox',{name:'Website URL',exact:true}).inputValue()==='https://example.com/cross-browser-photography','Exact link recovered from account');
  await page.getByRole('textbox',{name:'Website URL',exact:true}).scrollIntoViewIfNeeded();
  await page.screenshot({path:out+'/secondary-saved-link-390.png'});
  await page.getByRole('button',{name:'Review setup →',exact:true}).click();
  await page.getByRole('heading',{name:'Review your course setup',exact:true}).waitFor();
  check(page.url().includes('step=review'),'Reading saved setup never starts creation');
  return {passed:true,checks,independentBrowserSession:true,physicalDevice:false,emailSent:false};
}
