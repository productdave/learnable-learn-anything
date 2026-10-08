async page => {
  const checks = [], requests = [], out = 'output/playwright/hosted-account-auth-browser-dwch0b';
  const check = (ok, label) => { if (!ok) throw Error(label); checks.push(label); };
  const record = request => { const prefix='https://learnable-staging.vercel.app'; const url=request.url(); if (url.startsWith(prefix+'/api/')) requests.push({ path:url.slice(prefix.length).split('?')[0], method:request.method() }); };
  page.on('request', record);
  const account = page.getByRole('button', {name:'Account', exact:true});
  const dialog = page.getByRole('dialog');
  const open = async () => { await account.click(); await page.getByRole('status').filter({hasText:/^Not connected$/}).waitFor(); };
  await page.getByRole('status').filter({hasText:/^Not connected$/}).waitFor();
  check(await dialog.getByText('This connection is encrypted on the server, not stored in this browser or in your course.', {exact:true}).isVisible(), 'Actual hosted GET shows disconnected and server storage disclosure');
  check(await page.evaluate(() => document.activeElement?.id === 'workspace-account-title'), 'Title receives initial focus, not the key input');
  for (const [width,height] of [[390,844],[320,740],[1280,900]]) {
    await page.setViewportSize({width,height});
    await dialog.evaluate(el => {el.scrollTop=0;});
    const fit = await dialog.evaluate(el => { const r=el.getBoundingClientRect(); return r.left>=0 && r.right<=innerWidth+1 && r.top>=0 && r.bottom<=innerHeight+1 && el.scrollWidth<=el.clientWidth+1; });
    check(fit, 'Dialog fits '+width+'px viewport without horizontal overflow');
    check(await dialog.getByRole('button').evaluateAll(buttons => buttons.every(el => {const r=el.getBoundingClientRect();return r.width>=44 && r.height>=44;})), 'Account buttons meet 44px target at '+width+'px');
    await page.screenshot({path:out+'/disconnected-'+width+'.png'});
  }
  await page.getByRole('textbox', {name:'Claude API key',exact:true}).fill('unsubmitted-account-qa-only');
  await page.keyboard.press('Escape');
  check(await dialog.count()===0 && await account.evaluate(el => el===document.activeElement), 'Escape dismisses and restores Account focus');
  check(await page.getByRole('heading', {name:'Review your course setup',exact:true}).isVisible(), 'Dismissal returns to the existing Review');
  await open();
  check(await page.getByRole('textbox', {name:'Claude API key',exact:true}).inputValue()==='', 'Unsubmitted key clears on close/reopen');
  check(await page.evaluate(() => !Object.values(localStorage).concat(Object.values(sessionStorage)).some(v => v.includes('unsubmitted-account-qa-only'))), 'Unsubmitted test value absent from browser storage');
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name:'Toggle theme',exact:true}).click();
  await page.setViewportSize({width:390,height:844});
  await open();
  await page.screenshot({path:out+'/disconnected-dark-390.png'});
  check(await page.getByRole('textbox', {name:'Claude API key',exact:true}).getAttribute('type')==='password', 'Key input remains masked');
  await page.keyboard.press('Escape');
  await page.getByRole('button', {name:'Toggle theme',exact:true}).click();
  const failure = async route => route.request().method()==='GET' ? route.abort('failed') : route.continue();
  await page.route('**/api/providers/connection', failure);
  try {
    await account.click();
    await dialog.getByRole('alert').waitFor();
    check(await dialog.getByRole('status').innerText()==='Connection status unavailable', 'Injected GET failure is unknown, not falsely disconnected');
    check(await dialog.getByRole('textbox').count()===0, 'Unknown status does not offer replacement input');
    await page.screenshot({path:out+'/connection-unavailable-390.png'});
  } finally { await page.unroute('**/api/providers/connection', failure); }
  await dialog.getByRole('button',{name:'Check status',exact:true}).click();
  await dialog.getByRole('status').filter({hasText:/^Not connected$/}).waitFor();
  check(await dialog.getByRole('alert').count()===0, 'Check status recovers through the real hosted GET');
  await page.keyboard.press('Escape');
  check(!requests.some(r=>r.method==='POST' && (/providers/.test(r.path)||/gen\/(start|resume|restart)/.test(r.path))), 'No provider POST or generation start/resume/restart');
  page.off('request',record);
  return {passed:true,checks,requests,syntheticFault:'one aborted connection GET',realKeySubmitted:false,paidCalls:0,screenshots:out};
}
