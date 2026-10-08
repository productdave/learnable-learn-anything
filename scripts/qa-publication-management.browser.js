(async page=>{
 const qa=__PUBLIC_PREVIEW_QA__,checks=[],errors=[],writes=[];
 const check=(value,label)=>{if(!value)throw new Error(label);checks.push(label);};page.on('pageerror',e=>errors.push(e.message));page.on('request',r=>{if(r.url().includes('/api/courses/publish')&&r.method()==='POST')writes.push(r.postData());});
 const signIn=async index=>page.evaluate(async({module,account})=>{const a=await import(module),r=await(await a.sb()).auth.signInWithPassword({email:account.email,password:account.password});if(r.error)throw r.error;},{module:qa.modules.auth,account:qa.accounts[index]});
 await signIn(0);await page.goto(qa.origin+'/?experience=workspace&filter=mine');
 const card=page.locator('[data-home-course="'+qa.courseId+'"]'),state=card.locator('[data-publication-state]');
 await card.locator('[data-publication-state="private"]').waitFor();
 check((await card.textContent()).includes('Not published from this account copy'),'private status has clear scope');
 check(await page.locator('[data-home-filter]').count()===2,'publication states are not new navigation tabs');
 check(await page.locator('[data-home-status] option').count()===3,'readiness filters remain unchanged');
 check(writes.length===0,'opening owner status does not publish');
 await page.route('**/api/courses/publication-status?*',route=>route.abort('failed'));
 await page.evaluate(()=>window.dispatchEvent(new Event('publication-changed')));await card.locator('[data-publication-state="error"]').waitFor();
 check(await card.getByRole('button',{name:'Retry status',exact:true}).isVisible(),'status failure offers retry');
 check(await card.locator('h3 a').isVisible(),'saved course remains available after status failure');
 await page.unroute('**/api/courses/publication-status?*');await card.getByRole('button',{name:'Retry status',exact:true}).click();await card.locator('[data-publication-state="private"]').waitFor();
 check(true,'retry restores real account status');
 await card.locator('.home-publication [data-public-preview]').click();
 const preview=page.locator('dialog.public-course-preview').first(),dialog=page.locator('[data-publication-dialog]');
 await preview.getByRole('textbox',{name:'Try a public author name',exact:true}).fill('Management QA Teacher');
 await preview.getByRole('button',{name:'Review publishing →',exact:true}).click();await dialog.getByRole('heading',{name:'Final sharing check',exact:true}).waitFor();
 await dialog.getByRole('checkbox').nth(0).check();await dialog.getByRole('checkbox').nth(1).check();await dialog.getByRole('button',{name:'Publish to Community Courses',exact:true}).click();await dialog.getByRole('heading',{name:'Public version available',exact:true}).waitFor();
 const url=await dialog.getByRole('textbox',{name:'Course link',exact:true}).inputValue();
 await dialog.getByRole('button',{name:'Back to preview',exact:true}).click();await preview.getByRole('button',{name:'Back to saved course',exact:true}).click();await card.locator('[data-publication-state="published"]').waitFor();
 check(true,'successful publication updates card without page reload');
 check(await card.getByText('By Management QA Teacher',{exact:true}).isVisible(),'owner card uses confirmed public byline with initials');
 check(await card.getByRole('link',{name:'View public course',exact:false}).getAttribute('target')==='_blank','public version opens separately from saved copy');
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await card.scrollIntoViewIfNeeded();check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),`owner card fits ${width}px`);await card.screenshot({path:`output/playwright/publication-card-${width}.png`});}
 await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));await card.screenshot({path:'output/playwright/publication-card-dark-320.png'});await page.evaluate(()=>document.documentElement.setAttribute('data-theme','light'));
 let previewReads=0;page.on('request',r=>{if(r.url().includes('/api/courses/public-preview'))previewReads++;});
 const beforeWrites=writes.length;
 await card.getByRole('button',{name:'Manage publication',exact:true}).click();await dialog.getByRole('heading',{name:'Public version available',exact:true}).waitFor();
 check(previewReads===0,'management opens without a lesson-preview detour');
 check(await dialog.locator('[data-pub="publish"]').count()===0&&await dialog.getByRole('checkbox').count()===0,'management cannot bypass content review to publish');
 check((await dialog.textContent()).includes('only works on this computer'),'local sharing limit remains explicit');
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async text=>{window.qaCopiedLink=text;}}}));
 await dialog.getByRole('button',{name:'Copy course link',exact:true}).click();await dialog.getByText('Course link copied.',{exact:true}).waitFor();check(await page.evaluate(()=>window.qaCopiedLink)===url,'copy success writes exact public URL to controlled QA clipboard');
 await page.evaluate(()=>Object.defineProperty(navigator,'clipboard',{configurable:true,value:{writeText:async()=>{throw new Error('denied');}}}));
 await dialog.getByRole('button',{name:'Copy course link',exact:true}).click();await dialog.getByRole('alert').waitFor();check((await dialog.getByRole('alert').textContent()).includes('Select and copy'),'clipboard denial has manual recovery');check(await dialog.getByRole('textbox',{name:'Course link',exact:true}).evaluate(el=>el===document.activeElement&&el.selectionEnd===el.value.length),'fallback selects public URL');
 await page.keyboard.press('Tab');check(await page.evaluate(()=>!!document.activeElement.closest('[data-publication-dialog]')),'keyboard focus stays in management dialog');
 await dialog.screenshot({path:'output/playwright/publication-management-320.png'});
 await dialog.getByRole('button',{name:'Unpublish course',exact:true}).click();check((await dialog.getByRole('heading',{name:/^Unpublish /}).textContent()).includes('Publishing Preview Photography QA'),'unpublish confirmation names exact course');await dialog.getByRole('button',{name:'Keep public',exact:true}).click();check(writes.length===beforeWrites,'opening management, copying and cancelling never mutate publication');
 await dialog.getByRole('button',{name:'Review saved course →',exact:true}).click();await preview.getByRole('heading',{name:'Community listing preview',exact:true}).waitFor();check(await dialog.count()===0&&writes.length===beforeWrites,'update entry returns to read-only content preview');await preview.getByRole('button',{name:'Back to saved course',exact:true}).click();
 // Presentation fixture only: actual changed-revision detection has DB tests.
 await page.route('**/api/courses/publication-status?*',async route=>{const response=await route.fetch(),body=await response.json();body.courses.forEach(c=>c.sourceChanged=true);await route.fulfill({response,json:body});});await page.evaluate(()=>window.dispatchEvent(new Event('publication-changed')));await card.getByText('Saved copy changed since publication.',{exact:false}).waitFor();check(true,'changed revision calls for review rather than claiming an exact content diff');await page.unroute('**/api/courses/publication-status?*');
 await card.getByRole('button',{name:'Manage publication',exact:true}).click();await dialog.getByRole('heading',{name:'Public version available',exact:true}).waitFor();
 await page.route('**/api/courses/publish?*',route=>route.abort('failed'));await dialog.getByRole('button',{name:'Refresh publishing status',exact:true}).click();await dialog.getByRole('alert').waitFor();check(await dialog.getByRole('textbox',{name:'Course link',exact:true}).count()===0,'failed management refresh does not present stale link as confirmed');await page.unroute('**/api/courses/publish?*');await dialog.getByRole('button',{name:'Try again',exact:true}).click();await dialog.getByRole('heading',{name:'Public version available',exact:true}).waitFor();
 await dialog.getByRole('button',{name:'Unpublish course',exact:true}).click();await dialog.getByRole('button',{name:'Confirm unpublish',exact:true}).click();await dialog.getByText('Unpublished. Your private course is still saved.',{exact:true}).waitFor();await dialog.getByRole('button',{name:'Back to Your Courses',exact:true}).click();await card.locator('[data-publication-state="unpublished"]').waitFor();
 check(await card.getByRole('button',{name:'Review and publish again',exact:true}).isVisible(),'unpublish refreshes card and offers reviewed republish');check(await card.getByRole('link',{name:'View public course',exact:false}).count()===0,'unpublished card removes public-link action');
 check(await page.evaluate(id=>document.activeElement?.closest('[data-home-course]')?.dataset.homeCourse===id,qa.courseId),'closing management restores focus to a visible action on the current card');
 check(await page.evaluate(async url=>{const id=new URL(url).searchParams.get('course');return(await fetch('/api/courses/community?courseId='+id)).status;},url)===404,'unpublish ends real guest reads');
 await card.getByRole('button',{name:'Review and publish again',exact:true}).click();await preview.getByRole('heading',{name:'Community listing preview',exact:true}).waitFor();check(writes.length===beforeWrites+1,'republish entry never republishes automatically');await preview.getByRole('button',{name:'Back to saved course',exact:true}).click();
 // A delayed owner status must not reappear after sign-out/account switch.
 let release,started;const pending=new Promise(r=>started=r);await page.route('**/api/courses/publication-status?*',async route=>{const response=await route.fetch();await new Promise(resolve=>{release=resolve;started();});await route.fulfill({response}).catch(()=>{});});await page.evaluate(()=>window.dispatchEvent(new Event('publication-changed')));await pending;
 await page.evaluate(async module=>await(await(await import(module)).sb()).auth.signOut(),qa.modules.auth);release();await page.unroute('**/api/courses/publication-status?*');await signIn(1);await page.goto(qa.origin+'/?experience=workspace&filter=mine');await page.waitForFunction(()=>!document.querySelector('[data-home-course]'));
 check(await page.locator('[data-manage-publication]').count()===0&&!((await page.locator('body').textContent()).includes('Management QA Teacher')),'late status never leaks onto another account');
 check(errors.length===0,'no browser exceptions: '+errors.join('; '));
 const result={total:checks.length,checks};await page.evaluate(result=>window.__publicPreviewReport=result,result);return result;
})
