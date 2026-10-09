// Design-only state explorer. No fetch, storage, credentials or AI calls.
const scenarios = {
  home: ['Your Courses', 'F-01', 'Account access and balance are understandable before the learner starts. Reading stays available.'],
  setup: ['Course setup', 'F-01 / F-02', 'Keep the existing setup sequence. All material and source choices belong to a saved revision.'],
  quote: ['Review cost and start', 'F-02', 'Show an estimate and a maximum. Confirming holds credits; it does not authorize an unlimited course.'],
  outline: ['Review the course plan', 'F-03', 'A durable outline and known charge are saved before pausing. Scope changes need a fresh estimate.'],
  research: ['Review the research', 'F-04', 'Show source provenance, useful additions and material gaps. Approval starts only the remaining authorized work.'],
  creating: ['Creation progress', 'F-05 / F-06', 'Counts reflect persisted results. This screen has no timer that invents progress. Use the prototype controls to explore completion.'],
  partial: ['Partial draft, safe to resume', 'F-07', 'This fixture is a known pre-dispatch interruption. Resume is allowed because no charge is uncertain.'],
  complete: ['Draft ready', 'F-07 / F-08', 'Only show complete after the promised draft and assets are durably saved. Release the unused hold.'],
  reader: ['Private course reader', 'F-09', 'The draft is ready for human review. Ordinary learning remains usable without spending credits. Tutor scope is a separate decision.'],
  usage: ['Account and usage', 'F-08', 'Available + held + used reconcile to granted credits. Provider costs and learner debits are separate.'],
  insufficient: ['Insufficient credits', 'F-02 / E-07', 'No paid call or hold starts. Complimentary-credit pilot has no buy-credits checkout.'],
  expired: ['Quote expired', 'F-02 / E-05', 'Refreshing an estimate is free. New consent is required if scope or the maximum changes.'],
  renewal: ['Returning after a long review', 'F-04 / E-16', 'Saved research and its debit remain. Unstarted holds have expired; quote remaining work without rewriting the job.'],
  unknown: ['Checking a charge', 'F-07 / E-27', 'Retain the uncertain hold. Do not offer Resume or buy a replacement while the outcome is unknown.'],
  paused: ['Platform creation paused', 'F-01 / E-10', 'Provider access and platform funds are Learnable concerns for this cohort. No user API-key prompt.'],
  source: ['A source needs attention', 'F-04 / E-13', 'Repair or explicitly remove the source. Its absence must not be hidden by a green readiness check.'],
  legacy: ['An older creator-funded course', 'F-01 / E-04', 'Old jobs keep their original funding. They are not silently moved to the pilot balance.'],
  cancel: ['Cancel remaining creation', 'F-07 / E-28', 'Keep saved work. A dispatched response can still arrive; cancellation does not guarantee a zero charge.'],
  cancelling: ['Cancellation pending', 'F-07 / E-26', 'Stop scheduling, then reconcile in-flight work. Do not release an uncertain reservation.'],
  cancelled: ['Cancellation confirmed', 'F-07', 'This fixture represents a known outcome. Saved work remains and only confirmed unused credits are released.'],
  noaccess: ['No pilot access', 'F-01 / E-01', 'Make access status distinct from a provider-key or billing failure. Setup and existing courses remain available.'],
  balanceerror: ['Balance could not be checked', 'F-01 / E-02', 'An unavailable balance is not zero. Starting remains unavailable until the authoritative check succeeds.']
};
const balances = {home:[500,0,0],setup:[500,0,0],quote:[500,0,0],outline:[420,75,5],research:[420,65,15],creating:[420,48,32],partial:[420,48,32],complete:[438,0,62],reader:[438,0,62],insufficient:[30,0,0],expired:[500,0,0],renewal:[485,0,15],unknown:[420,48,32],paused:[500,0,0],source:[500,0,0],legacy:[500,0,0],cancel:[420,32,48],cancelling:[420,32,48],cancelled:[452,0,48],noaccess:['—','—','—'],balanceerror:['—','—','—']};
let current='home', shownBalance=[...balances.home], jobState=null, accessGate=null, renewalPending=false;
const jobStates=new Set(['outline','research','creating','partial','complete','renewal','unknown','cancel','cancelling','cancelled']);
function selectFixture(name) {
  current=scenarios[name]?name:'home';
  shownBalance=[...(balances[current]||balances.complete)];
  jobState=jobStates.has(current)?current:(current==='reader'?'complete':null);
  accessGate=['insufficient','paused','noaccess','balanceerror'].includes(current)?current:null;
  renewalPending=current==='renewal';
  render(current);
  history.replaceState(null,'',`#${current}`);
}
function navigate(name) {
  if(name==='quote' && accessGate) name=accessGate;
  if(name==='quote' && jobState) name=['outline','research','renewal'].includes(jobState)?'renewal':jobState;
  if(name==='creating' && accessGate) name=accessGate;
  if(name==='creating' && renewalPending && current!=='renewal') name='renewal';
  if(name==='outline') { shownBalance=[420,75,5]; jobState=name; }
  if(current==='renewal' && name==='research' && Number(shownBalance[2])<15) { shownBalance=[420,65,15]; renewalPending=false; jobState='research'; }
  if(name==='research' && current==='outline' && renewalPending) name='renewal';
  if(name==='research' && current==='outline') { shownBalance=[420,65,15]; jobState=name; }
  if(name==='creating') {
    const used=Math.max(Number(shownBalance[2]),32);
    shownBalance=[420,80-used,used]; jobState=name; renewalPending=false;
  }
  if(name==='renewal') {
    shownBalance=[Number(shownBalance[0])+Number(shownBalance[1]),0,shownBalance[2]];
    renewalPending=true; jobState=name;
  }
  if(name==='cancel' || name==='cancelling') jobState=name;
  render(name);
  history.replaceState(null,'',`#${name}`);
}
const screen=document.querySelector('#screen');
const btn=(text,to,secondary=false)=>`<button class="${secondary?'secondary':'primary'}" data-go="${to}">${text}</button>`;
const actions=(...items)=>`<div class="actions">${items.join('')}</div>`;
const notice=(title,body,warning=false)=>`<div class="notice${warning?' warning':''}"><strong>${title}</strong><p>${body}</p></div>`;
const heading=(title,sub='',label='Private course creation')=>`<div class="eyebrow">${label}</div><h1 tabindex="-1">${title}</h1>${sub?`<p class="subtitle">${sub}</p>`:''}`;
const metrics=()=>`<div class="grid">${shownBalance.map((v,i)=>`<div class="metric"><span>${['Available','Held','Used'][i]}</span><strong>${v}</strong></div>`).join('')}</div>`;
const course=()=>'<div class="book">Practical photography</div><p>For a beginner who wants to use light and composition with a phone camera.</p><div class="tabs"><span>3 lessons</span><span>Quizzes</span><span>Flashcards</span><span>Useful illustrations</span></div>';
const costCard=()=>'<div class="card"><div class="price"><div><small>Estimated course use</small><strong>50–80 credits</strong></div><div><small>Maximum you authorize</small><strong>80 credits</strong></div></div><p class="small">Includes the plan, research, lessons, selected learning tools and useful illustrations. This example estimate expires 24 hours after issue. Editing the scope requires a new estimate. These values are not live prices.</p><div class="line"><span>Available now</span><strong>500 credits</strong></div><div class="line"><span>Held when you start</span><strong>80 credits</strong></div><div class="line"><span>Available after the hold</span><strong>420 credits</strong></div></div>';
const stages=()=>`<div class="card"><h2>What is saved</h2><div class="stage"><span class="dot">✓</span>Course plan approved</div><div class="stage"><span class="dot">✓</span>Research approved</div><div class="stage"><span class="dot active">2</span>2 of 3 lessons saved</div><div class="stage"><span class="dot">○</span>Refinement and illustrations still to finish</div></div>`;
function render(name) {
  current=scenarios[name]?name:'home';
  document.querySelector('#scenario').value=current;
  const [label,feature,note]=scenarios[current];
  document.querySelector('#note-title').textContent=label;
  document.querySelector('#note-body').textContent=note;
  document.querySelector('#note-feature').textContent=feature;
  document.querySelector('#note-balance').textContent=`${shownBalance[0]} available · ${shownBalance[1]} held · ${shownBalance[2]} used`;
  let body='';
  if(current==='home') body=heading('Your Courses','Turn a learning goal into a useful first draft.','Your workspace')+`<div class="row"><span class="badge">${accessGate==='noaccess'?'Invitation required':accessGate==='balanceerror'?'Credit check unavailable':'Pilot access · complimentary credits'}</span>${btn('Create course','setup')}</div>${accessGate?notice('Creation needs attention',scenarios[accessGate][0],true):''}`+metrics()+`<div class="card"><h2>Your next course</h2><p>Your saved setups and private courses live here. Reading and learning progress do not use credits.</p>${jobState?btn(jobState==='complete'?'Open photography draft':'Continue photography course',jobState==='complete'?'reader':jobState,true):btn('Continue photography setup','setup',true)}</div>`;
  if(current==='setup') body=heading('Review your course setup','Keep what matters to the learner. You can edit this before starting.')+'<div class="steps"><span>Goal</span><span>Experience</span><span>Context</span><strong>Review</strong></div><label class="field"><span>What is the course about?</span><textarea>Learn to use light and composition for better phone photographs.</textarea></label><label class="field"><span>Who is it for?</span><input value="A beginner with a phone camera"></label><div class="card"><h2>Experience and sources</h2><p>One short module · three lessons · quizzes and flashcards · purposeful illustrations</p><p>1 note and 1 source link selected. Source inspection is complete.</p><p class="small">In the real app, an edit changes the setup revision and invalidates its previous quote. This prototype does not save edits.</p></div>'+actions(btn('Review cost','quote'),btn('Save for later','home',true));
  if(current==='quote') body=heading('Ready to create your course?','Learnable handles the AI connections. You will review the plan and research before the full draft is written.')+course()+costCard()+notice('A hold is not a final charge','We hold up to 80 credits when you start. Only valid work saved for you uses credits. Unused credits are released when the outcome is confirmed.')+'<p class="small">Your selected notes and source content are sent to AI providers through OpenRouter to create this private draft. You will be able to review the course plan and research before the full draft is written.</p><label class="check"><input type="checkbox" id="consent"><span>I authorize up to 80 complimentary credits for this course.</span></label>'+actions('<button class="primary" data-go="outline" id="create" disabled>Create course</button>',btn('Keep editing','setup',true));
  if(current==='outline') body=heading('Review your course plan','The first part is saved. Check the direction before research starts.')+'<span class="badge">Waiting for your review</span><div class="card"><h2>Practical photography</h2><ol class="list"><li>Notice the direction of the light</li><li>Keep the composition simple</li><li>Compare and improve your photographs</li></ol><p class="small">Assumption: you can practise with an ordinary object near indirect window light.</p></div>'+metrics()+notice('Your maximum is unchanged','5 credits used for the saved plan; up to 75 remain held for the rest. A larger course or new revision needs an updated estimate.')+actions(btn('Approve plan','research'),btn('Review remaining estimate','renewal',true));
  if(current==='research') body=heading('Review the research','Check the evidence and the assumptions before the lessons are written.')+'<span class="badge">Waiting for your review</span><div class="card"><h2>What the course will use</h2><p><strong>Your note:</strong> compare one object from two camera positions.</p><p><strong>Selected source:</strong> the photography reference you supplied. This prototype uses a placeholder; the app must show the real citation and source excerpt.</p><p><strong>Suggested addition:</strong> a simple comparison exercise to help you describe the effect of changing the angle.</p></div>'+notice('One assumption to review','The draft assumes an indoor practice space with indirect daylight. Adjust the context if that does not fit.')+metrics()+actions(btn('Approve research and build draft','creating'),btn('Change sources','source',true));
  if(current==='creating') body=heading('Creating your course','You can leave this page. The app will keep your saved progress.')+'<span class="badge">Writing lessons</span><p class="small">Saved results, not a time-based estimate</p><div class="progress" aria-hidden="true"><div style="width:45%"></div></div>'+stages()+metrics()+actions(btn('Back to Your Courses','home',true),btn('Cancel remaining work','cancel',true));
  if(current==='partial') body=heading('Your draft is partly ready','The saved lessons are available. One lesson and the planned illustrations still need to finish.')+notice('Creation stopped before the next request','No charge is pending for the next step. Resume will keep the completed work and use the existing authorized limit.',true)+stages()+metrics()+actions(btn('Resume course creation','creating'),btn('View saved lessons','reader',true),btn('Cancel remaining work','cancel',true));
  if(current==='complete') body=heading('Your course draft is ready','Read through it and decide what you want to refine.','Private draft')+'<span class="badge">All requested materials saved</span><div class="card">'+course()+'</div>'+metrics()+notice('62 credits used · 18 released','Your 80-credit hold is closed. The receipt shows what was saved for you. Reading does not use more credits.')+actions(btn('Open course draft','reader'),btn('View usage receipt','usage',true));
  if(current==='reader') body=(jobState && jobState!=='complete'?notice('Partial draft · saved lesson','This lesson is available. The rest of the course is not complete, and its existing credit hold is unchanged.',true):'')+heading('Notice the direction of the light','Lesson 1 · Practical photography','Private learning draft')+'<div class="reader-note"><strong>Try a small comparison</strong><p>Place an ordinary object near indirect window light. Take a photograph, move to another side, and compare where the shadows fall.</p></div><div class="card"><h2>What changed?</h2><p>Describe the light and dark sides of the object. Keep the setup steady so you can notice the effect of your camera position.</p><p class="small">Illustrative prototype content. A real course must retain its actual sources, saved assets and review flags.</p></div>'+notice('Course tutor is not included in this pilot','You can use the saved lessons, quizzes and flashcards. You do not need an AI account to read the course.')+actions(btn('Your Courses','home',true),btn('Account & credits','usage',true));
  if(current==='usage') body=heading('Account & credits','Your pilot credits are complimentary and have no stated cash value.','Your account')+metrics()+`<p class="small">Held credits are reserved, not a final charge. This view uses the balance from the state you just explored.</p><div class="card receipt"><h2>Example completed-course receipt</h2><p class="small">Independent example: 80 held, 62 used, 18 released.</p><table><thead><tr><th>Saved work</th><th>Credits</th></tr></thead><tbody><tr><td>Course plan</td><td>5</td></tr><tr><td>Research</td><td>10</td></tr><tr><td>Lessons and learning tools</td><td>30</td></tr><tr><td>Refinement and illustrations</td><td>17</td></tr><tr><td><strong>Total used</strong></td><td><strong>62</strong></td></tr><tr><td>Unused hold released</td><td>18</td></tr></tbody></table></div><p class="small">Example support reference: COURSE-DEMO-01. A real history lists each course, grant, hold, debit and release once.</p>`+actions(btn('Your Courses','home',true));
  if(current==='insufficient') body=heading('More credits are needed for this course','Your setup is saved. Nothing has started.')+metrics()+notice('30 available · up to 80 needed','Reduce the course scope or contact the pilot owner about complimentary credits. This pilot does not sell credit bundles.',true)+actions(btn('Edit course scope','setup'),btn('Back to Your Courses','home',true));
  if(current==='expired') body=heading('Check the estimate again','This quote is no longer current. Your setup is still saved.')+notice('No new work has started','Refresh the estimate before confirming a maximum. Any already saved work keeps its original usage record.',true)+actions(btn('Refresh estimate','quote'),btn('Keep editing','setup',true));
  if(current==='renewal') body=heading('Your reviewed work is still saved','This example releases an expired hold and quotes the remaining work.')+metrics()+notice('Review the remaining estimate',`${shownBalance[2]} credits were used for saved work. The old unstarted hold is released. Continuing needs a new authorization for the remaining work.`,true)+`<div class="card"><h2>Remaining work</h2><p>Any remaining research, lessons, learning tools, refinement and useful illustrations.</p><p>Illustrative renewed maximum: ${80-Number(shownBalance[2])} credits. Already saved work is not purchased again.</p></div>`+actions(btn('Authorize remaining work',Number(shownBalance[2])<15?'research':'creating'),'<button class="secondary" id="keep-reviewing">Keep reviewing</button>');
  if(current==='unknown') body=heading('We’re checking a charge','Your saved work is safe. We need to confirm the last request before continuing.')+metrics()+notice('48 credits remain held','They have not become a final charge. Starting a replacement now could buy the same work twice. You can view saved work or check this status.',true)+'<p class="small">Support reference: COURSE-DEMO-01. In this fixture, checking status stays pending; it does not invent a confirmed outcome.</p>'+actions(btn('Check status','unknown'),btn('View saved work','reader',true));
  if(current==='paused') body=heading('Course creation is temporarily paused','You can keep editing your setup or read your saved courses.')+notice('Your credits are kept','Learnable needs to restore creation access. You do not need to connect or add funds to an AI provider.',true)+metrics()+actions(btn('Check again','paused'),btn('Keep editing','setup',true));
  if(current==='source') body=heading('One source needs attention','Your setup is saved. Review this item before continuing.')+notice('Photography notes.pdf could not be read','Reattach a readable original or explicitly remove this source. The app must not pretend it was included.',true)+actions(btn('Return to Context','setup'),btn('Review current setup','setup',true));
  if(current==='legacy') body=heading('This course uses your earlier AI connection','New pilot courses use Learnable credits. This saved job keeps the funding method you started with.')+notice('The saved course has not moved to Learnable funding','Manage the earlier connection to continue this older job. Its lessons and usage are retained. The pilot balance is separate.',true)+actions('<button class="primary" id="legacy-info">About this connection</button>',btn('Create a new pilot course','setup',true))+'<p id="legacy-detail" class="small" hidden>The live product opens a legacy connection screen for this owned job. No key is requested or stored by this prototype.</p>';
  if(current==='cancel') body=heading('Cancel the remaining work?','Your saved lessons and sources will stay available.')+notice('Saved work can still use credits','We stop new requests. If something is already running, we will confirm its result before closing the hold. Cancellation is not a promise of an immediate full release.',true)+metrics()+actions(btn('Cancel remaining creation','cancelling'),btn('Keep creating','creating',true));
  if(current==='cancelling') body=heading('Stopping new work','Your saved results are kept while the final request status is checked.')+notice('The hold is still open','We will release only the part confirmed as unused. If the outcome is uncertain, the course moves to Checking a charge.')+metrics()+actions(btn('Check status','cancelling'),btn('View saved work','reader',true));
  if(current==='cancelled') body=heading('Remaining creation is cancelled','The saved part of your course is still available.')+metrics()+notice('48 credits used · 32 released','This example has a confirmed outcome. No request is left pending. Starting a revised course requires a new estimate.')+actions(btn('Open saved work','reader'),btn('View usage','usage',true));
  if(current==='noaccess') body=heading('Course creation is by invitation','You can save a setup and use courses already available to you.')+notice('This account does not have pilot access yet','No provider account or key is needed to request an invitation. Contact the pilot owner; this prototype sends no message.')+actions(btn('Keep editing a setup','setup'),btn('Your Courses','home',true));
  if(current==='balanceerror') body=heading('We couldn’t check your credits','Your setup is saved. We need an up-to-date balance before starting.')+metrics()+notice('Nothing has started','An unavailable balance does not mean you have zero credits. Check again when the account service is available.',true)+actions(btn('Check balance again','balanceerror'),btn('Keep editing','setup',true));
  screen.innerHTML=`<main class="content">${body}</main>`;
  screen.querySelector('h1')?.focus({preventScroll:true});
  document.querySelector('#keep-reviewing')?.addEventListener('click',()=>{render(Number(shownBalance[2])<15?'outline':'research');history.replaceState(null,'',`#${current}`);});
  const consent=document.querySelector('#consent');
  consent?.addEventListener('change',()=>{document.querySelector('#create').disabled=!consent.checked;});
  document.querySelector('#legacy-info')?.addEventListener('click',()=>{document.querySelector('#legacy-detail').hidden=false;});
  document.title=`${label} — Learnable experience prototype`;
}
document.querySelector('#scenario').innerHTML=Object.entries(scenarios).map(([id,[label]])=>`<option value="${id}">${label}</option>`).join('');
document.querySelector('#scenario').addEventListener('change',e=>selectFixture(e.target.value));
document.querySelector('#reset').addEventListener('click',()=>selectFixture('home'));
document.querySelector('#show-complete').addEventListener('click',()=>selectFixture('complete'));
document.addEventListener('click',e=>{
  const button=e.target.closest('[data-go]');
  if(button&&!button.disabled) navigate(button.dataset.go);
  const link=e.target.closest('a[href^="#"]');
  if(link) {e.preventDefault();navigate(link.getAttribute('href').slice(1));}
});
window.addEventListener('hashchange',()=>navigate(location.hash.slice(1)));
selectFixture(location.hash.slice(1)||'home');
