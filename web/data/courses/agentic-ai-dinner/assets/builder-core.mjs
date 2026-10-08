// Pure functions shared by the working browser labs and their regression checks.
// All records, prices, timestamps, and receipts are fictional teaching fixtures.
export const MENU = [
 {id:'tofu-bowl',name:'Thai tofu bowl',description:'Spicy tofu, rice, lime and herbs',vegetarian:true,available:true,fresh:true,price:1600,delivery:250,fees:100,tax:150,source:'menu-a/item-01',checked:'Sample snapshot · 18:05'},
 {id:'chicken-bowl',name:'Spicy chicken bowl',description:'Thai chili chicken with rice',vegetarian:false,available:true,fresh:true,price:1500,delivery:250,fees:100,tax:150,source:'menu-a/item-02',checked:'Sample snapshot · 18:05'},
 {id:'veg-curry',name:'Vegetable curry',description:'Vegetables and coconut curry with rice',vegetarian:true,available:true,fresh:true,price:1700,delivery:250,fees:100,tax:150,source:'menu-b/item-03',checked:'Sample snapshot · 18:10'},
 {id:'sold-out',name:'Tofu spicy Thai special',description:'Tofu Thai spicy bowl special',vegetarian:true,available:false,fresh:true,price:1200,delivery:250,fees:100,tax:150,source:'menu-b/item-04',checked:'Sample snapshot · unavailable'},
 {id:'old-menu',name:'Tofu lunch bowl',description:'Thai tofu lunch special',vegetarian:true,available:true,fresh:false,price:1100,delivery:250,fees:100,tax:150,source:'archive/item-05',checked:'Sample snapshot · stale'},
 {id:'unknown-fees',name:'Garden noodles',description:'Vegetarian noodles with herbs',vegetarian:true,available:true,fresh:true,price:1400,delivery:null,fees:100,tax:150,source:'menu-c/item-06',checked:'Sample snapshot · delivery unverified'}
];
export const money = cents => '$'+(cents/100).toFixed(2);
const integer = n => Number.isSafeInteger(n)&&n>=0;
export function total(item,quantity=1,tip=0,{omitFees=false}={}){
 if(!Number.isSafeInteger(quantity)||quantity<1||quantity>10)throw Error('Quantity must be a whole number from 1 to 10.');
 if(!integer(tip))throw Error('Tip must be a non-negative amount in cents.');
 if(![item.price,item.delivery,item.fees,item.tax].every(integer))throw Error('A price component is unknown or invalid.');
 const value=item.price*quantity+(omitFees?0:item.delivery+item.fees+item.tax)+tip;
 if(!Number.isSafeInteger(value))throw Error('Total is outside the supported range.');
 return value;
}
export function searchMenu({query='',budgetCents=2500,vegetarian=true,tipCents=0,staleTofu=false}={}, options={}){
 if(!integer(budgetCents)||budgetCents===0)throw Error('Budget must be a positive amount in cents.');
 if(!integer(tipCents))throw Error('Tip must be a non-negative amount in cents.');
 const words=String(query).toLowerCase().trim().split(/\s+/).filter(Boolean);
 const candidates=[],excluded=[];
 for(const source of MENU){
  const item={...source,fresh:source.fresh&&!(staleTofu&&source.id==='tofu-bowl')};
  const reasons=[]; let quote=null;
  if(!item.available)reasons.push('Unavailable');
  if(!item.fresh)reasons.push('Stale source');
  if(vegetarian&&!item.vegetarian)reasons.push('Does not match vegetarian requirement');
  try{quote=total(item,1,tipCents,options);if(quote>=budgetCents)reasons.push('Not strictly below budget');}catch(error){reasons.push(error.message);}
  if(reasons.length){excluded.push({...item,reasons});continue;}
  // Learning edit: change this relevance weight while preserving all checks above.
  const hay=(item.name+' '+item.description).toLowerCase();
  const score=words.reduce((n,w)=>n+(hay.includes(w)?2:0),0);
  candidates.push({...item,total:quote,score});
 }
 candidates.sort((a,b)=>b.score-a.score||a.total-b.total||a.id.localeCompare(b.id));
 return {candidates,excluded};
}
export function createState(){return {version:0,cart:null,approvedVersion:null,receipts:[],trace:[]};}
const event=(s,step,outcome)=>s.trace.push({step,outcome,version:s.version});
export function draftCart(s,{itemId='tofu-bowl',quantity=1,budgetCents=5000,priceIncreaseCents=0,tipCents=0,vegetarian=true}={}){
 const item=MENU.find(i=>i.id===itemId);
 if(!item)throw Error('Unknown item ID.');
 if(vegetarian&&!item.vegetarian)throw Error('Item does not match the vegetarian requirement.');
 if(!item.available||!item.fresh)throw Error('Item is unavailable or its source is stale.');
 if(!integer(budgetCents)||budgetCents===0||!integer(priceIncreaseCents))throw Error('Use valid positive budget and non-negative price adjustment.');
 const amount=total(item,quantity,tipCents)+priceIncreaseCents;
 if(amount>=budgetCents)throw Error('The draft is not strictly below the budget. Increase the fictional budget or reduce the quantity.');
 s.version++;s.approvedVersion=null;s.cart={itemId,quantity,total:amount,budgetCents,tipCents,vegetarian,version:s.version};
 event(s,'draft','Created a new proposal; prior approval cleared.');return s.cart;
}
export function approveCart(s){if(!s.cart)throw Error('Create a draft first.');s.approvedVersion=s.version;event(s,'review','Approved the current simulation proposal.');}
export function changeQuote(s,increaseCents=200){
 if(!s.cart)throw Error('Create a draft first.');
 if(!integer(increaseCents))throw Error('Use a non-negative change in cents.');
 s.version++;s.cart={...s.cart,total:s.cart.total+increaseCents,version:s.version};s.approvedVersion=null;
 event(s,'quote-change','Quote changed; review is required again.');
}
export function submitSimulation(s,{timeout=false,skipApproval=false}={}){
 if(!s.cart)throw Error('Create a draft first.');
 if(s.cart.total>=s.cart.budgetCents)throw Error('Current total violates the budget.');
 // skipApproval exists ONLY to demonstrate an intentionally broken evaluation variant.
 if(!skipApproval&&s.approvedVersion!==s.version){event(s,'blocked','Current version has not been approved.');throw Error('Review and approve the current cart version first.');}
 const operation='simulation-v'+s.version;
 const existing=s.receipts.find(r=>r.operation===operation);
 if(existing){event(s,'reconcile','Returned the existing simulation receipt.');return existing;}
 const receipt={id:'SIM-'+String(s.receipts.length+1).padStart(3,'0'),operation,total:s.cart.total,itemId:s.cart.itemId,quantity:s.cart.quantity,simulation:true};
 s.receipts.push(receipt);
 if(timeout){event(s,'uncertain','Simulation accepted; response timeout. Retry this unchanged proposal to reconcile.');throw Error('Simulation outcome not confirmed: response timed out after acceptance. Retry the unchanged draft.');}
 event(s,'complete','Simulation receipt created. No real order was placed.');return receipt;
}
export const ADAPTATION_CASES=[
 {id:'freshness',title:'The price changed this morning',problem:'The assistant cites yesterday’s price from an old menu.',answer:'retrieval',why:'Refresh the source and retrieval path. Fine-tuning cannot turn yesterday’s fact into today’s quote.'},
 {id:'arithmetic',title:'The total omits delivery',problem:'The item price is correct but the final sum excludes delivery.',answer:'code',why:'Fix deterministic arithmetic and add a regression case. A different model cannot repair missing terms in your calculation.'},
 {id:'format',title:'The answer is too verbose',problem:'There is no length instruction or example in the baseline prompt.',answer:'prompt',why:'Start with clear response guidance and examples, then evaluate. Training is premature before a basic baseline.'},
 {id:'state',title:'A correction erases the budget',problem:'Updating dietary preferences replaces the entire stored request.',answer:'state',why:'Fix state merging so unchanged fields survive. A prompt alone cannot repair a destructive application update.'},
 {id:'behavior',title:'A measured behavior gap remains',problem:'Prompt and schema baselines are sound, a repeated important gap remains, and consistent labeled examples plus held-out tests are available.',answer:'adapt',why:'Investigate adaptation as an experiment with quality and resource gates. Suitable examples and a measured gap make it a candidate, not a guaranteed win.'}
];
export function evaluate(variant='baseline'){
 const rows=[];
 const check=(name,critical,fn)=>{const start=performance.now();try{const detail=fn();rows.push({name,critical,passed:true,detail:detail||'Expected behavior observed.',milliseconds:performance.now()-start});}catch(e){rows.push({name,critical,passed:false,detail:e.message,milliseconds:performance.now()-start});}};
 const require=(v,m)=>{if(!v)throw Error(m);};
 const searchOpts={omitFees:variant==='omit-fees'};
 check('Vegetarian filter',true,()=>{const r=searchMenu({},searchOpts);require(r.candidates.length>0&&r.candidates.every(x=>x.vegetarian),'Non-vegetarian item admitted.');});
 check('Strict budget with all charges',true,()=>{const r=searchMenu({budgetCents:1900},searchOpts);require(r.candidates.length===0,'A fixture exceeding the real all-in cap was admitted.');});
 check('Equality does not satisfy under',true,()=>{const r=searchMenu({budgetCents:2100},searchOpts);require(!r.candidates.some(x=>x.id==='tofu-bowl'),'An item equal to or above the strict cap was admitted.');});
 check('Unavailable beats high relevance',true,()=>{const r=searchMenu({query:'tofu spicy Thai special'},searchOpts);require(!r.candidates.some(x=>x.id==='sold-out'),'Unavailable item admitted.');});
 check('Stale evidence excluded',true,()=>{const r=searchMenu({staleTofu:true},searchOpts);require(!r.candidates.some(x=>x.id==='tofu-bowl'||x.id==='old-menu'),'Stale item admitted.');});
 check('Unknown charge excluded',true,()=>{const r=searchMenu({},searchOpts);require(!r.candidates.some(x=>x.id==='unknown-fees'),'Unknown delivery treated as zero.');});
 check('Submission requires approval',true,()=>{const s=createState();draftCart(s);let blocked=false;try{submitSimulation(s,{skipApproval:variant==='skip-approval'});}catch{blocked=true;}require(blocked&&s.receipts.length===0,'Unapproved action created a receipt.');});
 check('Edit invalidates approval',true,()=>{const s=createState();draftCart(s);approveCart(s);draftCart(s,{quantity:2});let blocked=false;try{submitSimulation(s,{skipApproval:variant==='skip-approval'});}catch{blocked=true;}require(blocked,'Changed proposal was submitted under old approval.');});
 check('Retry does not duplicate',true,()=>{const s=createState();draftCart(s);approveCart(s);try{submitSimulation(s,{timeout:true});}catch{}const a=submitSimulation(s);const b=submitSimulation(s);require(s.receipts.length===1&&a.id===b.id,'Duplicate logical operation created receipts.');});
 check('Normal approved path',true,()=>{const s=createState();draftCart(s);approveCart(s);require(submitSimulation(s).simulation===true,'Missing simulation receipt.');});
 return {variant,scope:'Deterministic fictional-data components; not a live-model or production certification.',rows,passed:rows.filter(x=>x.passed).length,total:rows.length,releaseGate:rows.every(x=>!x.critical||x.passed)};
}
