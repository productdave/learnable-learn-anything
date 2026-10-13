import { escapeHome as esc } from './home-model.js?v=7';

export const HISTORY_STAGES={intake:'Plan',research:'Research',topics:'Lessons',design:'Refinement',images:'Images',assemble:'Final checks',done:'Complete'};
const stageRoles={intake:'Curriculum Designer',research:'Researcher',topics:'Lesson / Learning Designer',design:'Visual Designer',images:'Image generation',assemble:'Reviewer',done:'Course'};
const taskStages={curriculum:'intake',research:'research',lesson:'topics',visual_review:'design',visual_refinement:'design',images:'images'};
const groups={all:'All activity',saved:'Checkpoints and handoffs',issues:'Issues',provider:'Provider responses'};
const time=value=>Number.isFinite(Date.parse(value))?new Date(value).toLocaleString():'Time not recorded';
const number=value=>Number.isSafeInteger(value)&&value>=0?value.toLocaleString():null;
const stageOf=event=>Object.hasOwn(HISTORY_STAGES,event.details?.stage)?event.details.stage:taskStages[event.details?.task||event.details?.usage?.task]||'unknown';
const artifactStages=['intake','research','topics','design'];
const eventGroup=event=>event.event==='operation.failed'||event.event==='image.preflight_failed'?'issues':event.event==='provider.response'?'provider':['checkpoint.changed','stage.saved'].includes(event.event)?'saved':'other';

export function historyModel(detail,{stage='all',execution='all',activity='all',limit=40}={}) {
  // Only the bounded, owner-checked, redacted API response reaches this presenter.
  // Never infer missing transitions, a retry, or a completed handoff from ordering alone.
  const seen=new Set();
  const events=(detail.events||[]).filter(e=>{if(e.id&&seen.has(e.id))return false;if(e.id)seen.add(e.id);return true;})
    .map((e,index)=>({...e,order:index,stage:stageOf(e),group:eventGroup(e)}))
    .sort((a,b)=>{const at=Date.parse(a.at),bt=Date.parse(b.at);return (Number.isFinite(at)?at:Infinity)-(Number.isFinite(bt)?bt:Infinity)||String(a.id||'').localeCompare(String(b.id||''))||a.order-b.order;});
  const executions=[...new Set(events.map(e=>e.runId).filter(Boolean))];
  if(detail.currentExecutionId&&!executions.includes(detail.currentExecutionId))executions.push(detail.currentExecutionId);
  const executionLabel=id=>id?`Execution ${executions.indexOf(id)+1}${id===detail.currentExecutionId?' · current':''}`:'Execution not recorded';
  stage=stage==='unknown'||Object.hasOwn(HISTORY_STAGES,stage)?stage:'all';
  execution=execution==='unknown'||executions.includes(execution)?execution:'all';
  activity=Object.hasOwn(groups,activity)?activity:'all';
  const filtered=events.filter(e=>(stage==='all'||e.stage===stage)&&(execution==='all'||(execution==='unknown'?!e.runId:e.runId===execution))&&(activity==='all'||e.group===activity));
  limit=Math.min(500,Math.max(40,Number.isSafeInteger(limit)?limit:40));
  return {events,executions,executionLabel,stage,execution,activity,filtered,visible:filtered.slice(-limit),hidden:Math.max(0,filtered.length-limit),limit};
}

function eventCopy(event) {
  const d=event.details||{},stage=HISTORY_STAGES[event.stage]||'Stage not recorded';
  const saved=d.saved==='confirmed'?' Save confirmed.':d.saved==='unconfirmed'?' Save not confirmed.':'';
  const count=number(d.completed)!==null&&number(d.total)!==null?` ${number(d.completed)} of ${number(d.total)} recorded.`:'';
  const checkpointCounts=[number(d.completed)!==null&&number(d.total)!==null?`${number(d.completed)}/${number(d.total)} lessons saved`:null,number(d.refined)!==null?`${number(d.refined)} refinements`:null,number(d.images)!==null?`${number(d.images)} images`:null].filter(Boolean).join(' · ');
  const transition=event.event==='checkpoint.changed'&&Object.hasOwn(HISTORY_STAGES,d.previousStage)&&Object.hasOwn(HISTORY_STAGES,d.stage)&&d.previousStage!==d.stage;
  if(transition)return {title:`${HISTORY_STAGES[d.previousStage]} → ${HISTORY_STAGES[d.stage]}`,body:`Stage change recorded${d.status?' · '+d.status.replaceAll('_',' '):''}.${count}`,handoff:d.previousStage};
  if(event.event==='stage.saved')return {title:`${stage} saved`,body:`A saved result was recorded.${count}${saved}`,handoff:event.stage};
  if(event.event==='checkpoint.changed')return {title:d.handoff==='pending'?'Automatic continuation queued':d.handoff==='running'?'Automatic continuation checkpoint':d.handoff==='held'?'Automatic continuation held':'Checkpoint updated',body:`${stage}${d.status?' · '+d.status.replaceAll('_',' '):''}. ${checkpointCounts}${number(d.handoffSequence)!==null?' · handoff '+number(d.handoffSequence):''}`};
  if(event.event==='provider.response')return {title:'Provider response recorded',body:`${d.usage?.provider||d.provider||'Provider'} · ${d.usage?.model||d.model||'model not recorded'}. A response alone does not confirm a saved result.`};
  if(event.event==='operation.failed')return {title:'Operation stopped with an issue',body:d.error?.code?`Reference: ${d.error.code}. Inspect the recorded details before retrying.`:'No structured cause was recorded.'};
  if(event.event==='image.preflight_failed')return {title:'Image preparation stopped',body:d.error?.code?`Reference: ${d.error.code}.`:'Inspect the recorded preparation details.'};
  if(event.event==='run.started')return {title:'Worker execution started',body:'This can be an automatic continuation or an owner-initiated attempt.'};
  if(event.event==='run.stopped')return {title:'Worker execution ended',body:'This event alone does not mean the course completed or failed.'};
  return {title:'Recorded event',body:event.event||'Event type not recorded'};
}

function eventHTML(event,model,detail) {
  const copy=eventCopy(event),d=event.details||{},artifact=(detail.handoffs||[]).find((h,i)=>(h.stage||artifactStages[i])===copy.handoff&&h.available);
  const artifactIndex=artifact?detail.handoffs.indexOf(artifact):-1;
  const tokens=d.usage?['inputTokens','outputTokens','cacheCreationInputTokens','cacheReadInputTokens'].reduce((sum,k)=>sum+(Number.isSafeInteger(d.usage[k])&&d.usage[k]>=0?d.usage[k]:0),0):null;
  const related=d.operationId&&event.runId?model.events.filter(e=>e.runId===event.runId&&e.details?.operationId===d.operationId).length:0;
  return `<li class="admin-history-event" data-history-kind="${event.group}"><span class="admin-history-dot" aria-hidden="true">${event.group==='issues'?'!':''}</span><div class="admin-history-event-body"><div class="admin-history-event-heading"><h3>${esc(copy.title)}</h3><time>${esc(time(event.at))}</time></div>
    <p class="admin-history-meta">${esc(stageRoles[event.stage]||'Role not recorded')} · ${esc(model.executionLabel(event.runId))}</p><p>${esc(copy.body)}</p>
    ${tokens!==null?`<p class="admin-history-meta">${number(tokens)} returned tokens · not a dollar charge</p>`:''}
    ${artifactIndex>=0?`<a class="admin-history-output-link" data-history-output="${artifactIndex}" href="#admin-handoff-${artifactIndex}">View latest ${esc(artifact.label.toLowerCase())} <span aria-hidden="true">↓</span></a>`:''}
    <details><summary>Recorded details</summary>${related>1?`<p class="admin-muted">${related} events share this operation ID within this execution. Shared IDs connect evidence; they do not determine how many calls were charged.</p>`:''}<pre>${esc(JSON.stringify({event:event.event,at:event.at,executionId:event.runId||null,build:event.build,...d},null,2))}</pre></details></div></li>`;
}

export function adminHistoryHTML(detail,coverage={},options={}) {
  const model=historyModel(detail,options),total=model.events.length;
  return `<section class="admin-card admin-history" aria-labelledby="admin-history-title"><div class="admin-history-heading"><div><h2 id="admin-history-title">Course-run history</h2><p>Follow the recorded work, then inspect what each agent passed on.</p></div><a data-history-saved href="#admin-handoffs">Saved outputs <span aria-hidden="true">↓</span></a></div>
    <div class="admin-history-checkpoint"><span>Latest saved checkpoint</span><strong>${esc(HISTORY_STAGES[detail.job.stage]||detail.job.stage)} · ${esc(detail.job.status.replaceAll('_',' '))}</strong><span>${number(detail.job.completed)||'0'}/${number(detail.job.total)||'0'} lessons · ${number(detail.job.refined)||'0'} ${detail.job.refined===1?'refinement':'refinements'} · ${number(detail.job.images)||'0'} ${detail.job.images===1?'image':'images'}</span></div>
    <p class="admin-coverage-note">Oldest to newest within the loaded records. Executions include automatic continuations, not just retries. Events describe recorded work, not live provider status.</p>
    ${coverage.eventsTruncated?'<div class="admin-notice" role="status">Partial history: only the latest 500 retained events were loaded. Earlier events may be missing.</div>':''}
    ${coverage.logsAvailable===false?'<div class="admin-notice" role="status">Detailed logs are unavailable. Saved checkpoints and outputs remain available; missing events cannot be reconstructed.</div>':''}
    ${coverage.runtimeLoggingEnabled===false?'<p class="admin-coverage-note">Runtime detail logging is off. Some checkpoint events may still be retained.</p>':''}
    <div class="admin-history-filters"><label>Stage<select data-history-stage><option value="all" ${model.stage==='all'?'selected':''}>All stages (${total})</option>${[...Object.entries(HISTORY_STAGES),['unknown','Stage not recorded']].map(([key,label])=>`<option value="${key}" ${model.stage===key?'selected':''}>${label} (${model.events.filter(e=>e.stage===key).length})</option>`).join('')}</select></label><label>Worker execution<select data-history-execution><option value="all">All recorded executions</option>${model.executions.map(id=>`<option value="${esc(id)}" ${model.execution===id?'selected':''}>${esc(model.executionLabel(id))}</option>`).join('')}${model.events.some(e=>!e.runId)?`<option value="unknown" ${model.execution==='unknown'?'selected':''}>Execution not recorded</option>`:''}</select></label><label>Activity<select data-history-activity>${Object.entries(groups).map(([key,label])=>`<option value="${key}" ${model.activity===key?'selected':''}>${label}</option>`).join('')}</select></label></div>
    <p class="admin-history-count" role="status">${model.visible.length} of ${model.filtered.length} matching events shown${model.hidden?' · showing the most recent slice':''}. ${total} events loaded in total.</p>
    ${model.stage!=='all'||model.execution!=='all'||model.activity!=='all'?'<button class="home-button home-button--secondary" type="button" data-history-clear>Clear history filters</button>':''}
    ${model.hidden?`<button class="home-button home-button--secondary" type="button" data-history-more>Show earlier events (${model.hidden} more)</button>`:''}
    ${model.visible.length?`<ol class="admin-history-timeline">${model.visible.map(e=>eventHTML(e,model,detail)).join('')}</ol>`:`<div class="admin-history-empty"><h3>${total?'No events match these filters':'No historical events recorded'}</h3><p>${total?'Clear the filters to see the loaded history.':'The latest checkpoint is shown above. Older events cannot be reconstructed, and missing usage does not mean no charge.'}</p></div>`}
    <details class="admin-history-raw"><summary>Raw event log · ${total} loaded events</summary><p class="admin-muted">Same redacted records, oldest to newest. History filters do not change this evidence.</p><pre>${esc(JSON.stringify(model.events.map(({order,group,stage,...e})=>e),null,2))}</pre></details>
    </section><section class="admin-card" id="admin-handoffs" aria-labelledby="admin-handoff-title"><h2 id="admin-handoff-title" tabindex="-1">Agent handoffs and saved outputs</h2><p>These are latest saved artifacts, not hidden reasoning or a live chat between agents. They are not historical snapshots. An available output does not prove the next agent used it.</p>
    ${(detail.handoffs||[]).map((item,index)=>`<details class="admin-handoff" id="admin-handoff-${index}"><summary><span>${esc(item.from)} → ${esc(item.to)}</span><small>${item.available?'Saved output available':'Not recorded'}</small></summary><h3>${esc(item.label)}</h3>${item.available?`<p class="admin-muted">${esc(item.source)}${item.truncated?' Preview shortened for readability.':''}</p><pre>${esc(JSON.stringify(item.value,null,2))}</pre>`:'<p>No saved output is available in these records. This does not prove the stage never ran.</p>'}</details>`).join('')||'<p>No saved handoff outputs are available in these records.</p>'}<a class="admin-history-output-link" data-history-return href="#admin-history-title">↑ Back to history</a></section>`;
}
