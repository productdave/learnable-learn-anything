(async page=>{
 const qa=__PUBLIC_PREVIEW_QA__,checks=[],errors=[];
 const check=(value,label)=>{if(!value)throw new Error(label);checks.push(label);};page.on('pageerror',e=>errors.push(e.message));
 async function signIn(){await page.evaluate(async({module,account})=>{const auth=await import(module);const result=await(await auth.sb()).auth.signInWithPassword({email:account.email,password:account.password});if(result.error)throw result.error;},{module:qa.modules.auth,account:qa.accounts[0]});}
 await signIn();await page.goto(qa.origin+'/?experience=workspace&filter=mine');
 await page.getByText('Options',{exact:true}).click();await page.locator('.home-menu').getByRole('button',{name:'Preview for publishing',exact:true}).click();
 const preview=page.locator('dialog.public-course-preview').first(),publish=page.locator('dialog[data-publication-dialog]');
 let publicImageURL='';const unexpected=[];page.on('request',r=>{if(/\/api\/(courses\/images|media\/resolve-image)/.test(r.url()))unexpected.push(r.url());});
 if(qa.images){
   await page.route('**/api/courses/public-preview?**imageId=*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Image temporarily unavailable. Retry loading; no image is regenerated.'})}));
   await preview.getByRole('button',{name:'Lesson content',exact:true}).click();
   const figure=preview.locator('[data-shared-image]').first();await figure.getByRole('button',{name:'Retry image',exact:true}).waitFor();
   check((await figure.textContent()).includes('Synthetic gray square'),'owner failure preserves image description');
   await page.unroute('**/api/courses/public-preview?**imageId=*');await figure.getByRole('button',{name:'Retry image',exact:true}).click();await figure.locator('img').waitFor({state:'visible'});
   check(await figure.locator('img').evaluate(i=>i.naturalWidth===1024),'owner preview loads actual authenticated PNG');
   check((await figure.textContent()).includes('Alternative text:'),'owner explicitly reviews alternative text');
   for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await figure.scrollIntoViewIfNeeded();check(await preview.evaluate(el=>el.scrollWidth<=el.clientWidth),`image preview fits ${width}px`);await figure.screenshot({path:`output/playwright/publication-image-preview-${width}.png`});}
   await preview.getByRole('button',{name:'Course listing',exact:true}).click();
 }
 await preview.getByRole('textbox',{name:'Try a public author name',exact:true}).fill('Sam Creator');
 await preview.getByRole('button',{name:'Review publishing →',exact:true}).click();
 await publish.getByRole('heading',{name:'Final sharing check',exact:true}).waitFor();
 const confirm=publish.getByRole('button',{name:'Publish to Community Courses',exact:true});
 check(await confirm.isDisabled(),'publication requires deliberate acknowledgments');
 check((await publish.textContent()).includes('not the live Learnable site'),'local publication clearly distinguished from hosted release');
 check(await publish.getByRole('textbox',{name:'Public author name',exact:true}).inputValue()==='Sam Creator','trial byline carried into final confirmation');
 for(const width of [1440,390,320]){await page.setViewportSize({width,height:1000});await publish.evaluate(el=>el.scrollTop=0);check(await publish.evaluate(el=>el.scrollWidth<=el.clientWidth),`confirmation fits ${width}px`);await publish.screenshot({path:`output/playwright/publishing-confirm-${width}.png`});}
 await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));await publish.screenshot({path:'output/playwright/publishing-dark-320.png'});await page.evaluate(()=>document.documentElement.setAttribute('data-theme','light'));
 await page.keyboard.press('Tab');check(await page.evaluate(()=>!!document.activeElement.closest('[data-publication-dialog]')),'keyboard remains in confirmation');
 await publish.getByRole('button',{name:'Back to preview',exact:true}).click();check(await publish.count()===0,'cancel closes confirmation without publishing');
 const absent=await page.evaluate(async id=>(await(await fetch('/api/courses/community')).json()).courses.every(c=>c.id!==id),qa.courseId);check(absent,'private source ID never in community catalog');
 await preview.getByRole('button',{name:'Review publishing →',exact:true}).click();await publish.getByRole('heading',{name:'Final sharing check',exact:true}).waitFor();
 await publish.getByRole('checkbox').nth(0).check();check(await confirm.isDisabled(),'one checkbox is insufficient');await publish.getByRole('checkbox').nth(1).check();
 if(qa.images){check(await confirm.isDisabled(),'images require their own explicit sharing confirmation');check((await publish.textContent()).includes('1 course image will be shared')&&(await publish.textContent()).includes('additional AI tokens'),'image count and no new generation explained');await publish.getByRole('checkbox').nth(2).check();}
 check(await confirm.isEnabled(),'complete confirmation enables publish');
 let lost=false;await page.route('**/api/courses/publish',async route=>{if(route.request().method()==='POST'&&!lost){lost=true;await route.fetch();await route.abort('failed');}else await route.continue();});
 await confirm.click();await publish.getByRole('alert').waitFor();check((await publish.getByRole('alert').textContent()).includes('could not be confirmed'),'lost reply is ambiguous, not false failure');
 check(await publish.getByRole('checkbox').nth(0).isChecked(),'failed action retains confirmation input');
 await confirm.click();await publish.getByRole('heading',{name:'Public version available',exact:true}).waitFor();await page.unroute('**/api/courses/publish');
 const url=await publish.getByRole('textbox',{name:'Course link',exact:true}).inputValue(),publicId=await page.evaluate(url=>new URL(url).searchParams.get('course'),url);
 check(publicId.startsWith('public-')&&publicId!==qa.courseId,'separate shareable public identity');
 check((await publish.textContent()).includes('Published successfully'),'success shown only after confirmed publication');
 check((await publish.textContent()).includes('only works on this computer'),'localhost sharing limit explained');
 await publish.screenshot({path:'output/playwright/publishing-success-320.png'});
 const status=await page.evaluate(async({authPath,id})=>{const auth=await import(authPath),{data}=await(await auth.sb()).auth.getSession();return(await(await fetch('/api/courses/publish?courseId='+id,{headers:{Authorization:'Bearer '+data.session.access_token}})).json());},{authPath:qa.modules.auth,id:qa.courseId});
 check(status.publication.version===1,'lost-response retry did not create another revision');
 await page.goto(url);await page.getByRole('heading',{name:'Publishing Preview Photography QA',exact:true}).waitFor();
 check(await page.getByText('By Sam Creator',{exact:true}).isVisible(),'public learner shows confirmed author');
 await page.getByRole('button',{name:'Report this course',exact:true}).click();const report=page.getByRole('dialog',{name:'Report this course',exact:true});await report.getByRole('textbox').fill('This synthetic QA course contains a test issue for review.');await report.getByRole('button',{name:'Submit report',exact:true}).click();await report.getByText('Report received.',{exact:false}).waitFor();check((await report.textContent()).includes('does not automatically remove'),'report receipt does not promise moderation outcome');await report.getByRole('button',{name:'Close report',exact:true}).click();
 // Use the actual saved curriculum rather than assume a module slug.
 const lesson=await page.evaluate(async id=>{const {course}=await(await fetch('/api/courses/community?courseId='+id)).json();return course.curriculum.modules[0].id+'/'+course.curriculum.modules[0].topics[0].id;},publicId);
 await page.goto(url+'#/'+lesson);await page.locator('.topic-title').waitFor();check(await page.locator('.quiz-block').count()>0&&await page.locator('.practice-block').count()>0,'published course uses interactive learner, not read-only preview');
 if(qa.images){const figure=page.locator('[data-shared-image]').first();await figure.locator('img').waitFor({state:'visible'});publicImageURL=await figure.getAttribute('data-shared-image');check((await figure.textContent()).includes('AI-generated illustration'),'learner labels generated image');await figure.screenshot({path:'output/playwright/publication-image-learner-320.png'});}
 const quiz=page.locator('.quiz-block[data-variant="multiple-choice"]').first();await quiz.locator('.quiz-option').first().click();await quiz.getByRole('button',{name:'Check Answer',exact:true}).click();check(await quiz.locator('.quiz-explanation').isVisible(),'published quiz can be answered');
 const blank=page.locator('.quiz-block[data-variant="fill-in-blank"]').first();await blank.locator('input').fill('wrong');await blank.getByRole('button',{name:'Check Answer',exact:true}).click();check((await blank.locator('.quiz-fib-correct').textContent()).includes('<img')&&await blank.locator('img').count()===0,'revealed answers treat hostile text as text');
 await page.locator('#search-trigger').click();await page.locator('#search-input').fill('rendering-probe');await page.locator('#search-results mark').first().waitFor();check(await page.locator('#search-results img').count()===0,'search snippets cannot execute lesson text');await page.keyboard.press('Escape');
 await page.locator('#flashcard-trigger').click();await page.locator('#fc-card').waitFor();check(await page.locator('#fc-card img').count()===0,'flashcard text is safely rendered');await page.locator('#fc-close').click();check(await page.evaluate(()=>!window.publicationProbe),'hostile strings never execute in public learner');
 check(await page.locator('.lesson-checklist').count()>0,'published checklist present');check(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'long literal lesson text fits narrow mobile');await page.screenshot({path:'output/playwright/publishing-learner-320.png'});
 await page.evaluate(async module=>await(await(await import(module)).sb()).auth.signOut(),qa.modules.auth);await page.goto(url);await page.getByRole('heading',{name:'Publishing Preview Photography QA',exact:true}).waitFor();check(await page.getByText('By Sam Creator',{exact:true}).isVisible(),'guest can open published course without sign-in');
 if(qa.images){
   await page.route('**/api/courses/public-image?*',route=>route.fulfill({status:503,contentType:'application/json',body:JSON.stringify({error:'Synthetic image failure'})}));await page.goto(url+'#/'+lesson);
   const figure=page.locator('[data-shared-image]').first();await figure.getByRole('button',{name:'Retry image',exact:true}).waitFor();check((await figure.textContent()).includes('Synthetic gray square'),'guest failure retains alt description');check(await page.getByRole('button',{name:'Find image',exact:true}).count()===0,'no search/substitution control on shared image');
   await page.unroute('**/api/courses/public-image?*');await figure.getByRole('button',{name:'Retry image',exact:true}).click();await figure.locator('img').waitFor({state:'visible'});check(await figure.locator('img').evaluate(i=>i.naturalWidth===1024),'guest retry recovers the published PNG');
   await page.evaluate(()=>document.documentElement.setAttribute('data-theme','dark'));await figure.screenshot({path:'output/playwright/publication-image-dark-320.png'});await page.evaluate(()=>document.documentElement.setAttribute('data-theme','light'));
 }
 await page.goto(qa.origin+'/?experience=workspace&filter=community');await page.getByRole('link',{name:'Publishing Preview Photography QA',exact:false}).waitFor();check(await page.getByRole('link',{name:'Publishing Preview Photography QA',exact:false}).count()===1,'community catalog contains one publication');
 await signIn();await page.goto(qa.origin+'/?experience=workspace&filter=mine');await page.getByText('Options',{exact:true}).click();await page.locator('.home-menu').getByRole('button',{name:'Preview for publishing',exact:true}).click();await preview.getByRole('button',{name:'Review publishing →',exact:true}).click();await publish.getByRole('button',{name:'Unpublish course',exact:true}).click();await publish.getByRole('button',{name:'Keep public',exact:true}).click();check(await publish.getByRole('heading',{name:'Public version available',exact:true}).isVisible(),'cancel unpublish preserves live course');
 await publish.getByRole('button',{name:'Unpublish course',exact:true}).click();await publish.getByRole('button',{name:'Confirm unpublish',exact:true}).click();await publish.getByText('Unpublished. Your private course is still saved.',{exact:true}).waitFor();
 check(await page.evaluate(async id=>(await fetch('/api/courses/community?courseId='+id)).status,publicId)===404,'unpublish removes future public reads');
 if(qa.images){check(await page.evaluate(async path=>(await fetch(path)).status,publicImageURL)===404,'unpublish revokes direct image requests');check(unexpected.length===0,'preview/publish/retry never invokes image generation or replacement search');}
 await page.route('**/api/courses/publish?*',async route=>{const response=await route.fetch(),body=await response.json();body.blockers=[{message:'Private images need public image sharing support.'}];await route.fulfill({response,json:body});});await publish.getByRole('button',{name:'Refresh publishing status',exact:true}).click();await publish.getByText('Not ready to publish',{exact:true}).waitFor();check(await publish.getByRole('button',{name:'Publish to Community Courses',exact:true}).isDisabled(),'image blocker is visible and prevents publication');await publish.screenshot({path:'output/playwright/publishing-blocked-320.png'});await page.unroute('**/api/courses/publish?*');
 await page.route('**/api/courses/publish?*',async route=>{const response=await route.fetch(),body=await response.json();body.reviewToken='newer-review';await route.fulfill({response,json:body});});await publish.getByRole('button',{name:'Refresh publishing status',exact:true}).click();await publish.getByText('The saved course changed.',{exact:false}).waitFor();check(await publish.getByRole('button',{name:'Publish to Community Courses',exact:true}).isDisabled(),'stale preview requires a fresh content review');await page.unroute('**/api/courses/publish?*');
 await page.evaluate(async module=>await(await(await import(module)).sb()).auth.signOut(),qa.modules.auth);await page.waitForFunction(()=>!document.querySelector('dialog'));check(await page.locator('dialog').count()===0,'sign-out closes preview and publication dialogs');
 await page.goto(url);await page.getByRole('heading',{name:'Course unavailable',exact:true}).waitFor();check(true,'old public URL has an honest unavailable page');
 check(errors.length===0,'no browser exceptions: '+errors.join('; '));
 const result={total:checks.length,checks};await page.evaluate(result=>window.__publicPreviewReport=result,result);return result;
})
