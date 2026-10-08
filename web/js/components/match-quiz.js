// Shared by bundled, account-saved, and generated courses. Saved answers retain
// the original { pairs: { [leftText]: rightText }, checked } storage contract.
const palette = ['indigo', 'amber', 'purple', 'emerald', 'sky', 'rose'];
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

export function renderMatchQuiz(section) {
  const right = section.pairs.map((_, i) => i);
  for (let i = right.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [right[i], right[j]] = [right[j], right[i]];
  }
  const card = (i, side) => `<button type="button" class="match-card" data-side="${side}" data-index="${i}" aria-pressed="false"><span class="match-pair-label"></span><span class="match-text">${escape(section.pairs[i][side])}</span><span class="match-dot" aria-hidden="true"></span><span class="match-feedback"></span></button>`;
  return `<div class="quiz-block drag-match" data-quiz-id="${escape(section.id)}" data-variant="drag-match" data-match-pairs="${escape(JSON.stringify(section.pairs))}">
    <div class="quiz-header"><span class="quiz-badge">Match</span></div>
    <p class="quiz-question">${escape(section.question)}</p>
    <p class="quiz-hint-text">Click a term, then its match. Or drag from a dot to draw a line. Select a card again to change its match.</p>
    <div class="match-board"><svg class="match-lines" aria-hidden="true"></svg><div class="match-column match-left">${section.pairs.map((_, i) => card(i, 'left')).join('')}</div><div class="match-column match-right">${right.map(i => card(i, 'right')).join('')}</div></div>
    <div class="quiz-actions"><button type="button" class="quiz-check-btn">Check Matches</button><span class="match-count"></span></div>
    <p class="match-status" role="status" aria-live="polite">Choose a term to start.</p>
    <div class="quiz-explanation" style="display:none"><div class="quiz-explanation-content">${escape(section.explanation || 'Great job matching the concepts!')}</div></div>
  </div>`;
}

export function initMatchQuiz(root, { saved, isCurrent = () => true, save = () => {}, onCheck = () => {} } = {}) {
  const data = JSON.parse(root.dataset.matchPairs);
  const board = root.querySelector('.match-board'), svg = root.querySelector('.match-lines');
  const status = root.querySelector('.match-status'), cards = [...root.querySelectorAll('.match-card')];
  const pairs = new Map(), used = new Set();
  // Validate old progress against current content; repeated right labels use an
  // unused occurrence, and grading accepts equivalent labels.
  data.forEach((p, i) => {
    const text = saved?.pairs?.[p.left];
    const j = data.findIndex((other, k) => other.right === text && !used.has(k));
    if (j >= 0) { pairs.set(i, j); used.add(j); }
  });
  let checked = !!saved?.checked && pairs.size === data.length;
  let active = null, drag = null, suppressClick = false, disposed = false;
  const cardFor = (side, i) => cards.find(c => c.dataset.side === side && Number(c.dataset.index) === i);
  const correct = i => data[pairs.get(i)]?.right === data[i].right;
  const announce = message => { status.textContent = message; };
  const persist = () => {
    if (!isCurrent()) return;
    save({ pairs: Object.fromEntries([...pairs].map(([i,j]) => [data[i].left, data[j].right])), checked });
  };
  const point = (side, i) => {
    const r = cardFor(side,i).querySelector('.match-dot').getBoundingClientRect(), b = board.getBoundingClientRect();
    return { x:r.left+r.width/2-b.left, y:r.top+r.height/2-b.top };
  };
  const line = (a,b,i,pending=false) => {
    const p = document.createElementNS('http://www.w3.org/2000/svg','path'), mid=(a.x+b.x)/2;
    p.setAttribute('d',`M ${a.x} ${a.y} C ${mid} ${a.y}, ${mid} ${b.y}, ${b.x} ${b.y}`);
    p.setAttribute('class', `match-line match-color-${palette[i % palette.length]}${pending ? ' is-pending' : ''}`);
    svg.append(p);
  };
  function draw() {
    if (disposed) return;
    svg.replaceChildren();
    pairs.forEach((j,i) => line(point('left',i),point('right',j),i));
    if (drag) {
      const b=board.getBoundingClientRect();
      line(point(drag.side,drag.index),{x:drag.x-b.left,y:drag.y-b.top},drag.index,true);
    }
  }
  function render() {
    cards.forEach(card => {
      const side=card.dataset.side, i=Number(card.dataset.index);
      const left=side==='left'?i:[...pairs].find(([,j])=>j===i)?.[0];
      const linked=left!==undefined && pairs.has(left);
      const partner=linked?(side==='left'?data[pairs.get(left)].right:data[left].left):null;
      card.className=`match-card${linked ? ' is-linked match-color-'+palette[left % palette.length] : ''}`;
      card.setAttribute('aria-pressed',String(active?.side===side&&active.index===i));
      card.setAttribute('aria-label',data[i][side]+(linked?`. Pair ${left+1}. Matched with ${partner}.`:'. Not matched.')+(checked&&linked?(correct(left)?' Correct.':' Try another match.'):''));
      card.querySelector('.match-pair-label').textContent=linked?`Pair ${left+1}`:side==='left'?`Term ${i+1}`:'Description';
      const feedback=card.querySelector('.match-feedback');
      feedback.textContent=checked&&side==='left'?(correct(i)?'✓ Correct':'↻ Try another match'):'';
      feedback.classList.toggle('is-incorrect',checked&&side==='left'&&!correct(i));
    });
    root.querySelector('.match-count').textContent=`${pairs.size} of ${data.length} connected`;
    root.querySelector('.quiz-explanation').style.display=checked&&[...pairs.keys()].every(correct)?'':'none';
    draw();
  }
  function result() {
    const n=[...pairs.keys()].filter(correct).length;
    announce(n===data.length?'All matches correct.':`${n} of ${data.length} correct. Select a term, then another description to change its match.`);
  }
  function connect(i,j) {
    if (!isCurrent()) return;
    const displaced=[...pairs].find(([k,v])=>k!==i&&v===j)?.[0];
    if(displaced!==undefined)pairs.delete(displaced);
    pairs.set(i,j);active=null;checked=false;render();persist();
    announce(`${data[i].left} connected to ${data[j].right}.${displaced!==undefined?' '+data[displaced].left+' now needs a new match.':''}`);
  }
  const events = new AbortController();
  cards.forEach(card => {
    const side=card.dataset.side,index=Number(card.dataset.index),dot=card.querySelector('.match-dot');
    card.addEventListener('click',e=>{
      if((suppressClick&&e.detail!==0)||!isCurrent())return;
      if(active&&active.side!==side){connect(side==='left'?index:active.index,side==='right'?index:active.index);return;}
      active=active?.side===side&&active.index===index?null:{side,index};render();
      announce(active?`Now choose the matching ${side==='left'?'description':'term'}.`:'Selection cleared.');
    },{signal:events.signal});
    dot.addEventListener('pointerdown',e=>{
      if(!isCurrent()||e.button!==0)return;
      e.preventDefault();root.dataset.engaged='true';active={side,index};drag={side,index,x:e.clientX,y:e.clientY};dot.setPointerCapture(e.pointerId);render();
    },{signal:events.signal});
    dot.addEventListener('pointermove',e=>{if(drag){drag.x=e.clientX;drag.y=e.clientY;draw();}},{signal:events.signal});
    dot.addEventListener('pointerup',e=>{
      if(!drag)return;
      const origin=drag;drag=null;suppressClick=true;setTimeout(()=>suppressClick=false,0);
      const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('.match-card');
      if(target&&root.contains(target)&&target.dataset.side!==origin.side){
        connect(origin.side==='left'?origin.index:Number(target.dataset.index),origin.side==='right'?origin.index:Number(target.dataset.index));
      }else{render();announce('Choose the matching card, or drag its dot to the other column.');}
    },{signal:events.signal});
    dot.addEventListener('pointercancel',()=>{drag=null;active=null;render();announce('Connection cancelled. Choose a term to continue.');},{signal:events.signal});
  });
  root.addEventListener('keydown',e=>{if(e.key==='Escape'){drag=null;active=null;render();announce('Selection cleared.');}},{signal:events.signal});
  root.querySelector('.quiz-check-btn').addEventListener('click',()=>{
    if(!isCurrent())return;
    if(pairs.size<data.length){announce(`Connect all terms before checking. ${data.length-pairs.size} still need a match.`);return;}
    checked=true;render();result();persist();onCheck();
  },{signal:events.signal});
  const resize=new ResizeObserver(draw);resize.observe(board);
  // Navigation and account refresh both replace lesson DOM. Release observers
  // and handlers when this particular quiz leaves the document.
  const removal=new MutationObserver(()=>{if(!root.isConnected)cleanup();});
  removal.observe(document.body,{childList:true,subtree:true});
  function cleanup(){disposed=true;resize.disconnect();removal.disconnect();events.abort();}
  render();if(checked)result();
  return cleanup;
}
