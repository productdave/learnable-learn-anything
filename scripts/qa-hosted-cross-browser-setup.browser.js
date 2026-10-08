async page => {
  await page.getByRole('textbox',{name:'What do you want to learn or teach?',exact:true}).fill('Photography staging QA');
  await page.getByRole('button',{name:'Create course',exact:true}).click();
  await page.getByRole('textbox',{name:'Who is it for? Required',exact:true}).fill('Adult beginners');
  await page.getByRole('textbox',{name:'What should they be able to do? Optional',exact:true}).fill('Compose a clear everyday photograph');
  await page.getByRole('button',{name:'Continue to Experience →',exact:true}).click();
  await page.getByRole('button',{name:'Continue to Context →',exact:true}).click();
  await page.getByRole('button',{name:'+ Add a note',exact:true}).click();
  await page.getByRole('textbox',{name:'Title Optional',exact:true}).fill('Cross-browser transcript');
  await page.getByRole('textbox',{name:'Notes, transcript or raw text',exact:true}).fill('Keep this exact raw text in the original browser. Compare two window-light photographs.');
  await page.getByRole('button',{name:'Links 0',exact:true}).click();
  await page.getByRole('button',{name:'+ Add a link',exact:true}).click();
  await page.getByRole('textbox',{name:'Website URL',exact:true}).fill('https://example.com/cross-browser-photography');
  await page.getByRole('button',{name:'Review setup →',exact:true}).click();
  await page.getByRole('heading',{name:'Review your course setup',exact:true}).waitFor();
  await page.getByText('1 note · 1 link · 0 files',{exact:true}).waitFor();
  await page.getByRole('button',{name:'Create course →',exact:true}).click();
  await page.getByRole('heading',{name:'Sign in to create your course',exact:true}).waitFor();
  return {guestSetupComplete:true,signInAtCreate:true,url:page.url()};
}
