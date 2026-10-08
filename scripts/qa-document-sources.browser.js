(async page => {
  const checks = [], errors = [];
  const check = (value, message) => { if (!value) throw new Error(message); checks.push(message); };
  page.on('pageerror', error => errors.push(error.message));
  await page.route('**/qa-document-sources', route => route.fulfill({ contentType:'text/html', body:'<!doctype html><html lang="en"><head><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/styles/tokens.css"><link rel="stylesheet" href="/styles/base.css"><link rel="stylesheet" href="/styles/themes.css"><link rel="stylesheet" href="/styles/home.css?v=11"></head><body class="home-mode" data-experience="workspace"><main class="app-main"><div class="app-main-inner" id="content"></div></main></body></html>' }));
  await page.goto('http://127.0.0.1:4173/qa-document-sources');
  await page.evaluate(async () => {
    const {createSetupController} = await import('/js/course-setup.js?v=6');
    const {createDraftStore} = await import('/js/draft-store.js?v=3');
    const {setupDraft} = await import('/js/setup-model.js?v=1');
    const q = window.__sourcesQA = { user:{id:'source-qa-owner',email:'learner@example.test'}, starts:[], opens:[], connected:true, issues:[], failure:false };
    q.sources = { files:[
      { id:'pdf', name:'Photography workshop.pdf', kind:'pdf', status:'ready', characters:104, pages:2, warnings:['Selectable text only: diagrams and images are not read. Columns, tables and reading order may differ from the original.'], text:'Start with natural light.\n\nPlace your subject near a window. Look at the direction of the light.' },
      { id:'word', name:'Workshop transcript.docx', kind:'docx', status:'ready', characters:80, warnings:['Text only: images and complex layout are not included. Check that important content is present and in the right order.'], text:'Instructor: Start with one subject.\n\n中文 notes 🏊\n<script>window.__unsafeDocument = true</script>' }
    ], characters:242, limit:48000, complete:true, requiresReview:true, digest:'a'.repeat(64) };
    q.readiness = () => ({ ready:q.connected && !q.issues.length && q.sources.complete, connected:q.connected, issues:q.issues, sources:structuredClone(q.sources), enabled:true, model:'claude-sonnet-4-5' });
    q.store = createDraftStore({dbName:`learnable-source-qa-${crypto.randomUUID()}`});
    q.id = `setup-qa-${crypto.randomUUID()}`;
    const draft = setupDraft('A practical introduction to photography'); draft.brief.audience='New photographers'; draft.step='review';
    draft.sources.files=q.sources.files.map(f=>({id:f.id,name:f.name,blob:new Blob(['synthetic original'])}));
    await q.store.save({id:q.id,...draft},{ownerId:q.user.id,expectedRevision:0});
    q.controller=createSetupController({store:q.store,getOwner:()=>q.user?.id,getIdentity:()=>q.user,
      accountClient:{save:async()=>({revision:1,contentHash:'qa-hash',updatedAt:new Date().toISOString()}),list:async()=>({drafts:[]})},
      generationClient:{check:async()=>q.readiness(),connect:async()=>{q.connected=true;},disconnect:async()=>{q.connected=false;},start:async(owner,id,revision,digest)=>{ q.starts.push(digest); if(q.failure) throw Object.assign(new Error('Review the extracted source text again before creating your course plan.'),{readiness:q.readiness(),code:'source-review-required'}); return {jobId:'synthetic-job'}; }},
      openJob:async id=>q.opens.push(id),navigate:url=>{const params=new URLSearchParams(url);return q.controller.render(document.querySelector('#content'),q.id,params.get('step'));}
    });
    q.show=()=>q.controller.render(document.querySelector('#content'),q.id,'create');
    await q.show();
  });
  const start = () => page.getByRole('button',{name:'Create course plan →',exact:true});
  const consent = () => page.getByRole('checkbox',{name:'I’ve checked the extracted text and want to use it.'});
  const fits = () => page.evaluate(()=>document.documentElement.scrollWidth <= innerWidth);
  await page.getByRole('heading',{name:'Check your source text'}).waitFor();
  check(await start().isDisabled(), 'generation disabled until explicit text review');
  check(await page.getByText('Text ready',{exact:true}).count()===2, 'every readable file has a plain-language status');
  check(await page.evaluate(()=>window.__sourcesQA.starts.length===0), 'saving and extracting never start AI');
  await page.getByText('Preview text from Workshop transcript.docx',{exact:true}).click();
  check((await page.getByLabel('Extracted text from Workshop transcript.docx',{exact:true}).textContent()).includes('<script>'), 'preview shows literal document markup');
  check(await page.evaluate(()=>window.__unsafeDocument===undefined), 'document markup is never executed');
  check(await page.evaluate(()=>document.querySelector('.setup-source-review').compareDocumentPosition(document.querySelector('.setup-create-provider')) & Node.DOCUMENT_POSITION_FOLLOWING), 'source review precedes provider and generation consent');
  await page.setViewportSize({width:1440,height:1100});
  await page.screenshot({path:'output/playwright/document-sources-1440.png',fullPage:true});
  await page.setViewportSize({width:390,height:844});
  check(await fits(), 'file previews fit 390px mobile');
  await page.screenshot({path:'output/playwright/document-sources-390.png',fullPage:true});
  await page.setViewportSize({width:320,height:568});
  check(await fits(), 'file previews fit narrow 320px mobile');
  await consent().focus(); await page.keyboard.press('Space');
  check(await start().isEnabled(), 'keyboard confirmation enables creation');
  await start().click(); await page.waitForFunction(()=>window.__sourcesQA.opens.length===1);
  check(await page.evaluate(()=>window.__sourcesQA.starts[0]===window.__sourcesQA.sources.digest), 'start sends only the acknowledged server digest');
  await page.evaluate(()=>window.__sourcesQA.show());
  await consent().waitFor();
  check(!await consent().isChecked() && await start().isDisabled(), 'returning to creation requires fresh review, not a persisted browser checkbox');
  await consent().check();
  await page.evaluate(()=>{window.__sourcesQA.sources.digest='b'.repeat(64);window.__sourcesQA.failure=true;});
  await start().click();
  await page.getByText('Review the extracted source text again before creating your course plan.',{exact:true}).waitFor();
  check(await start().isDisabled() && !await consent().isChecked(), 'server conflict invalidates acknowledgement and disables start');
  check(await page.locator('[data-creation-error]').evaluate(el=>el===document.activeElement), 'source conflict receives keyboard focus');
  await page.getByRole('button',{name:'Recheck sources and connection'}).click();
  await consent().waitFor();
  check(!await consent().isChecked(), 'recheck does not silently acknowledge changed text');
  await page.evaluate(async()=>{const q=window.__sourcesQA;q.failure=false;q.sources.files.push({id:'bad',name:'Scanned field guide.pdf',kind:'pdf',status:'error',message:'This PDF has no selectable text. Scanned pages and images need OCR first. Export a searchable PDF or paste a transcript into Notes.'});q.sources.complete=false;q.sources.digest=null;q.issues=[{fileId:'bad',step:'context',text:'Scanned file needs OCR'}];await q.show();});
  await page.getByText('Needs attention',{exact:true}).waitFor();
  check(await page.getByText('Text ready',{exact:true}).count()===2 && await start().count()===0, 'one bad file blocks start while preserving both good results');
  check(await page.getByRole('link',{name:'Replace file or use Notes'}).isVisible() && await page.getByRole('button',{name:'Check again',exact:true}).isEnabled(), 'failed extraction has contextual repair and safe retry');
  check(await consent().count()===0, 'cannot approve incomplete extraction');
  check(await page.getByRole('heading',{level:1}).evaluate(el=>el===document.activeElement), 'incomplete source checks restore focus even without a confirmation checkbox');
  await page.setViewportSize({width:390,height:844});
  check(await fits(), 'error recovery fits mobile');
  await page.screenshot({path:'output/playwright/document-sources-error-390.png',fullPage:true});
  await page.evaluate(async()=>{const q=window.__sourcesQA;q.sources.files.pop();q.sources.complete=true;q.sources.digest='b'.repeat(64);q.issues=[];await q.show();});
  await consent().waitFor();
  check(await start().isDisabled(), 'repaired selection still needs explicit review');
  await page.evaluate(async()=>{const q=window.__sourcesQA;q.connected=false;await q.show();});
  await page.getByLabel('Claude API key',{exact:true}).waitFor();
  await consent().check();
  await page.getByLabel('Claude API key',{exact:true}).fill('sk-ant-synthetic-QA');
  await page.getByRole('button',{name:'Connect Claude',exact:true}).click();
  await start().waitFor();
  check(await consent().isChecked() && await start().isEnabled(), 'connecting preserves review only when server digest is unchanged');
  check(await page.evaluate(()=>window.__sourcesQA.starts.length===2), 'connecting does not start or retry generation');
  check(errors.length===0, 'no uncaught browser errors');
  return {checks,total:checks.length,mode:'real controller, IndexedDB and styles; service doubles; no paid AI calls'};
})
