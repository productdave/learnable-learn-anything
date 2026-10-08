import { getUser, onUserChange } from './auth.js?v=33';
import { createCourseRefinementClient } from './course-refinement-client.js?v=7';
import { homeURL, escapeHome as esc } from './home-model.js?v=7';

const fields = new Set(['title', 'content', 'estimatedMinutes', 'sections', 'flashcards', 'question', 'statement', 'correct', 'explanation', 'options', 'text', 'pairs', 'left', 'right', 'sentence', 'acceptable_answers', 'sample_answer', 'key_points', 'points', 'prompt', 'hints', 'guidance', 'goal', 'durationMinutes', 'equipment', 'setup', 'steps', 'instruction', 'cue', 'repetitions', 'success', 'regressions', 'progressions', 'safetyStops', 'readinessChecks', 'label', 'description', 'items', 'detail', 'src', 'alt', 'caption', 'source_title', 'source_url', 'front', 'back']);
const labels = { content: 'Lesson text', estimatedMinutes: 'Estimated minutes', correct: 'Correct answer', acceptable_answers: 'Accepted answers', sample_answer: 'Sample answer', key_points: 'Key points', durationMinutes: 'Estimated activity minutes', regressions: 'Easier alternatives', progressions: 'Harder alternatives', safetyStops: 'When to pause or stop', readinessChecks: 'Readiness checks', src: 'Saved image URL', alt: 'Image description (alt text)', source_title: 'Source name', source_url: 'Source URL', front: 'Question / front', back: 'Answer / back', cue: 'Short cue', success: 'What success looks like' };
const label = key => labels[key] || key.replace(/([A-Z])/g, ' $1').replace(/^./, s => s.toUpperCase());
const fieldOrder = [...fields];
const editableEntries = value => Object.entries(value).filter(([key]) => fields.has(key)).sort(([a], [b]) => fieldOrder.indexOf(a) - fieldOrder.indexOf(b));
const itemLabel = key => ({ flashcards: 'flashcard', steps: 'step', options: 'answer choice', pairs: 'pair', items: 'checklist item', points: 'takeaway', key_points: 'key point', acceptable_answers: 'accepted answer', readinessChecks: 'readiness check', hints: 'hint' }[key] || 'item');
const plain = value => { const template = document.createElement('template'); template.innerHTML = String(value).replace(/<\/(p|li|h[1-6])>/gi, '</$1>\n\n').replace(/<br\s*\/?>/gi, '\n'); return template.content.textContent.trim(); };
const currentValue = (payload, target) => {
  const mod = payload.curriculum.modules.find(mod => mod.id === target.moduleId), lesson = payload.modules[mod.number][target.topicId];
  return target.kind === 'lesson' ? lesson : target.kind === 'section' ? lesson.sections[target.index] : lesson.flashcards[target.index];
};
const ordered = value => Array.isArray(value) ? value.map(ordered) : value && typeof value === 'object' ? Object.fromEntries(Object.keys(value).sort().map(key => [key, ordered(value[key])])) : value;
const equalContent = (a, b) => JSON.stringify(ordered(a)) === JSON.stringify(ordered(b));

export function openCourseEditor(courseId, { client = createCourseRefinementClient(), getIdentity = getUser, watchIdentity = onUserChange, onSaved = async () => {} } = {}) {
  const owner = getIdentity()?.id, opener = document.activeElement;
  const dialog = document.createElement('dialog'); dialog.className = 'course-editor'; dialog.setAttribute('aria-labelledby', 'course-editor-title');
  document.body.append(dialog);
  let base, target, draft, proposal, pendingSave, stage = 'loading', resumeStage = 'edit', saving = false, error = '', errorCode = '', dirty = false, disposed = false, ticket = 0;
  let aiAvailable = false, aiLoaded = false, aiRequest = null, aiInput = '', aiPending = null, aiBusy = false, aiError = '', aiTimer, aiTicket = 0, previewSource = 'manual';
  const aiActive = () => ['queued', 'running'].includes(aiRequest?.status);
  const sameTarget = (a, b) => !!a && !!b && a.kind === b.kind && a.moduleId === b.moduleId && a.topicId === b.topicId && a.index === b.index;
  const aiCoversDraft = () => aiRequest && !['discarded', 'applied'].includes(aiRequest.status) && sameTarget(target, aiRequest.target) && equalContent(draft, aiRequest.workingReplacement);
  const needsWarning = () => pendingSave || aiPending || dirty && !aiCoversDraft() || stage === 'ai' && aiInput.trim() && aiInput.trim() !== aiRequest?.instructions;
  const registry = new Map();
  const arrays = new Map();
  const valid = () => !disposed && getIdentity()?.id === owner;
  const beforeUnload = event => { if (needsWarning()) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  let unwatch;
  unwatch = watchIdentity?.(() => { if (!valid()) close(true); });
  function close(force = false) {
    if (disposed) return;
    if (!force && needsWarning()) {
      if (stage !== 'discard') resumeStage = stage === 'checking' ? 'edit' : stage;
      if (stage === 'checking') ticket++;
      stage = 'discard'; paint(); return;
    }
    disposed = true; ticket++; aiTicket++; clearTimeout(aiTimer); dialog.close(); dialog.remove(); unwatch?.(); window.removeEventListener('beforeunload', beforeUnload); opener?.isConnected && opener.focus();
    base = draft = proposal = pendingSave = null;
    aiRequest = aiPending = null; aiInput = '';
  }
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  function form(value, path = []) {
    if (Array.isArray(value)) {
      const name = path.at(-1), range = { flashcards: [3, 8], steps: [2, 8], options: [3, 5], pairs: [3, 6], items: [3, 8], points: [3, 6], key_points: [2, 5], acceptable_answers: [1, 6], readinessChecks: [1, 6], hints: [2, 5] }[name] || [1, 8];
      const key = `array-${arrays.size}`, editable = name !== 'sections' && value.length > 0;
      arrays.set(key, { path, range });
      return `<fieldset class="editor-group"><legend>${esc(label(name))}</legend>${value.map((item, index) => `<div class="editor-list-item">${typeof item === 'object' ? `<details ${value.length < 4 ? 'open' : ''}><summary>${esc(item.title || (item.text && item.id ? `Option ${item.id}` : item.variant || item.type) || `${label(name)} ${index + 1}`)}</summary>${form(item, [...path, index])}</details>` : form(item, [...path, index])}${editable && value.length > range[0] ? `<button type="button" data-editor-remove="${key}" data-index="${index}" aria-label="Remove ${esc(label(name))} ${index + 1}">Remove ${esc(itemLabel(name))} ${index + 1}</button>` : ''}</div>`).join('')}${editable && value.length < range[1] ? `<button type="button" data-editor-add="${key}">Add ${esc(itemLabel(name))}</button>` : ''}</fieldset>`;
    }
    if (value && typeof value === 'object') return editableEntries(value).map(([key, item]) => {
      if (key === 'correct' && value.variant === 'multiple-choice') {
        const fieldId = `editor-field-${registry.size}`; registry.set(fieldId, { path: [...path, key], type: 'string' });
        return `<label class="editor-field" for="${fieldId}"><span>Correct answer</span><select id="${fieldId}"><option value="" disabled ${value.options.some(option => option.id === item) ? '' : 'selected'}>Choose the correct answer</option>${value.options.map(option => `<option value="${esc(option.id)}" ${item === option.id ? 'selected' : ''}>${esc(option.id)}: ${esc(option.text)}</option>`).join('')}</select></label>`;
      }
      return form(item, [...path, key]);
    }).join('');
    const key = `editor-field-${registry.size}`, name = typeof path.at(-1) === 'number' ? `${label(path.at(-2))} ${path.at(-1) + 1}` : label(path.at(-1));
    const html = typeof value === 'string' && /<\/?[a-z][^>]*>/i.test(value);
    registry.set(key, { path, html, type: typeof value });
    return `<label class="editor-field" for="${key}"><span>${esc(name)}</span>${typeof value === 'boolean' ? `<select id="${key}"><option value="true" ${value ? 'selected' : ''}>True</option><option value="false" ${!value ? 'selected' : ''}>False</option></select>` : typeof value === 'number' ? `<input id="${key}" type="number" value="${value}" min="1" max="60">` : `<textarea id="${key}" rows="${String(value || '').length > 120 ? 4 : 2}" maxlength="12000">${esc(html ? plain(value) : value || '')}</textarea>`}${html ? '<small>Use plain text. Paragraph breaks will be kept.</small>' : ''}</label>`;
  }
  function readable(value) {
    if (Array.isArray(value)) return `<ol>${value.map(item => `<li>${readable(item)}</li>`).join('')}</ol>`;
    if (value && typeof value === 'object') return `<dl>${editableEntries(value).map(([key, item]) => `<dt>${esc(label(key))}</dt><dd>${readable(item)}</dd>`).join('')}</dl>`;
    return `<p>${esc(typeof value === 'string' ? plain(value) : String(value)).replace(/\n/g, '<br>')}</p>`;
  }
  function choose(value) {
    proposal = pendingSave = null; error = errorCode = ''; dirty = false;
    previewSource = 'manual'; aiError = ''; aiInput = '';
    target = value; draft = structuredClone(currentValue(base.payload, target)); stage = 'edit'; paint();
  }
  function options() {
    const result = [];
    for (const mod of base.payload.curriculum.modules || []) for (const meta of mod.topics || []) {
      const lesson = base.payload.modules?.[mod.number]?.[meta.id]; if (!lesson) continue;
      const common = { moduleId: mod.id, topicId: meta.id };
      result.push({ name: `${mod.title} · ${meta.title} — Entire lesson`, target: { ...common, kind: 'lesson' } });
      lesson.sections.forEach((section, index) => result.push({ name: `${meta.title} — ${label(section.type)} ${index + 1}: ${section.title || section.question || section.statement || ''}`, target: { ...common, kind: 'section', index } }));
      (lesson.flashcards || []).forEach((card, index) => result.push({ name: `${meta.title} — Flashcard ${index + 1}`, target: { ...common, kind: 'flashcard', index } }));
    }
    return result;
  }
  async function load(compare = false) {
    const request = ++ticket; stage = 'loading'; paint();
    try {
      const latest = await client.load(owner, courseId); if (!valid() || request !== ticket) return;
      base = latest; pendingSave = proposal = null; error = errorCode = '';
      if (compare && draft && target) { currentValue(base.payload, target); stage = 'edit'; dirty = true; error = 'Latest saved version loaded. Your proposed text is retained below. Review it again before replacing.'; paint(); }
      else { const first = options()[0]; if (!first) throw new Error('No saved lessons are available to edit.'); choose(first.target); }
      if (client.proposalStatus) refreshAI();
    } catch (err) { if (!valid()) return close(true); error = err.message; errorCode = err.code; stage = base && draft ? 'edit' : 'load-error'; paint(); }
  }
  async function preview() {
    previewSource = 'manual';
    const request = ++ticket; stage = 'checking'; error = errorCode = ''; paint();
    try {
      const result = await client.preview(owner, { courseId, target, replacement: draft, baseHash: base.baseHash }); if (!valid() || request !== ticket) return;
      proposal = result; stage = result.changed ? 'preview' : 'edit';
      if (!result.changed) { dirty = false; error = 'No content changes to save.'; }
      paint();
    } catch (err) { if (!valid()) return close(true); if (request !== ticket) return; error = err.message; errorCode = err.code; stage = 'edit'; paint(); }
  }
  function scheduleAI() {
    clearTimeout(aiTimer);
    if (valid() && aiActive()) aiTimer = setTimeout(() => refreshAI(), 4000);
  }
  function receiveAI(result) {
    aiAvailable = true; aiLoaded = true; aiRequest = result.request;
    if (aiPending?.operationId === aiRequest?.id) aiPending = null;
    scheduleAI();
  }
  async function refreshAI() {
    if (!client.proposalStatus || aiBusy || !valid()) return;
    const request = ++aiTicket;
    try {
      const result = await client.proposalStatus(owner, courseId); if (!valid() || request !== aiTicket) return;
      receiveAI(result); aiError = ''; paint(true);
    } catch (err) {
      if (!valid()) return close(true); if (request !== aiTicket) return;
      clearTimeout(aiTimer);
      if (['disabled', 'preview-disabled'].includes(err.code)) aiAvailable = false;
      else { aiAvailable = true; aiError = err.message; }
      paint(true);
    }
  }
  async function aiAction(action) {
    if (aiBusy || !valid()) return;
    if (action === 'start' && !aiPending) {
      if (!aiLoaded) { aiError = 'Check for a saved request before starting another generation.'; paint(); return; }
      const count = [...aiInput.trim()].length;
      if (count < 10 || count > 2000) { aiError = 'Describe the change in 10–2,000 characters. Your text has not been shortened.'; paint(); return; }
      if (aiActive()) { aiError = 'Check or cancel the existing request before generating another.'; paint(); return; }
      aiPending = { courseId, operationId: crypto.randomUUID(), expectedRequestId: aiRequest?.id || null, consent: true, baseHash: base.baseHash, target: structuredClone(target), instructions: aiInput.trim(), workingReplacement: structuredClone(draft) };
    }
    const request = ++aiTicket; clearTimeout(aiTimer); aiBusy = true; aiError = ''; paint();
    try {
      let result;
      if (action === 'start' || action === 'check' && aiPending) result = await client.startProposal(owner, aiPending);
      else if (action === 'check' && aiRequest?.status === 'queued') result = await client.resumeProposal(owner, { courseId, operationId: aiRequest.id });
      else if (action === 'cancel' || action === 'discard') result = await client[action === 'cancel' ? 'cancelProposal' : 'discardProposal'](owner, { courseId, operationId: aiRequest.id });
      else result = await client.proposalStatus(owner, courseId);
      if (!valid() || request !== aiTicket) return;
      receiveAI(result);
      if (action === 'discard') error = errorCode = '';
    } catch (err) {
      if (!valid()) return close(true); if (request !== aiTicket) return;
      aiError = err.message;
      if (['conflict', 'busy', 'building', 'instructions', 'validation', 'markup', 'identity', 'target', 'media', 'context_size', 'size', 'image_unavailable', 'not_found'].includes(err.code)) aiPending = null;
      if (err.code === 'conflict') errorCode = 'conflict';
    } finally {
      if (valid() && request === aiTicket) { aiBusy = false; paint(); }
    }
  }
  function recoverAI() {
    if (!aiRequest) return;
    if (dirty && !sameTarget(target, aiRequest.target)) { aiError = 'Save or discard the current manual edits before opening a suggestion for another item.'; paint(); return; }
    if (!dirty) {
      try { const saved = currentValue(base.payload, aiRequest.target); target = aiRequest.target; draft = structuredClone(aiRequest.workingReplacement || saved); dirty = !equalContent(draft, saved); }
      catch { aiError = 'The item used by this request is no longer available. Your saved course is unchanged; discard this suggestion before choosing another item.'; stage = 'ai'; paint(); return; }
    }
    aiInput = aiRequest.instructions || ''; stage = 'ai'; error = errorCode = ''; paint(); scheduleAI();
  }
  async function reviewAI() {
    if (aiBusy || aiPending || !aiRequest?.proposal) return;
    if (!sameTarget(target, aiRequest.target)) { recoverAI(); return; }
    const request = ++ticket; stage = 'checking'; error = errorCode = ''; paint();
    try {
      const checked = await client.preview(owner, { courseId, target, replacement: aiRequest.proposal.replacement, baseHash: base.baseHash });
      if (!valid() || request !== ticket) return;
      if (!checked.changed) { stage = 'ai'; aiError = 'This suggestion makes no changes to your saved content.'; }
      else { proposal = checked; previewSource = 'ai'; stage = 'preview'; if (aiRequest.baseHash !== base.baseHash) error = 'This suggestion used an earlier version. Compare it carefully with the latest saved content before replacing anything.'; }
      paint();
    } catch (err) { if (!valid()) return close(true); if (request !== ticket) return; error = err.message; errorCode = err.code; stage = 'ai'; paint(); }
  }
  function usageCopy() {
    if (!aiRequest) return '';
    const usage = aiRequest.usage?.total;
    return `<p class="editor-ai-meta">${esc(aiRequest.model?.model || 'Claude')} · ${usage ? `${Number(usage.inputTokens || 0).toLocaleString()} input / ${Number(usage.outputTokens || 0).toLocaleString()} output tokens reported. This is not a price quote.` : aiRequest.providerAttempted ? 'Usage is not confirmed; provider charges may still apply.' : 'No provider usage reported.'}</p>`;
  }
  function aiMarkup() {
    const recoverable = aiRequest && !['discarded', 'applied'].includes(aiRequest.status);
    const same = sameTarget(target, aiRequest?.target), title = options().find(option => sameTarget(option.target, target))?.name || 'Selected item';
    const status = { queued: 'Waiting to start', running: 'Preparing your suggestion', ready: 'Your suggestion is ready', stale: 'Saved content changed', failed: 'Suggestion could not be completed', cancelled: 'Request cancelled', discarded: 'Suggestion discarded', applied: 'Suggestion applied' }[aiRequest?.status];
    if (target?.kind === 'section' && draft?.type === 'image') return '<h2 tabindex="-1">Edit this image manually</h2><p>AI image creation and replacement are not available yet. You can edit the saved image link, description and caption in the manual editor.</p><button type="button" data-editor-ai-back>Back to manual editing</button>';
    return `<h2 tabindex="-1">Improve with AI</h2><p class="editor-ai-target">${esc(title)}</p>
      <p>Claude will receive this lesson, its saved research, your learning goals and your current edits. It won’t do new research or create images. Review its advice before using it.</p>
      ${aiError ? `<div class="home-notice home-notice--warning" role="alert">${esc(aiError)}${errorCode === 'conflict' ? '<button type="button" data-editor-ai-latest>Load latest and keep my text</button>' : ''}${!aiLoaded ? `<button type="button" data-editor-ai-action="check" ${aiBusy ? 'disabled' : ''}>Check for a saved request</button>` : ''}</div>` : ''}
      ${recoverable ? `<section class="editor-ai-status" aria-label="Saved AI request"><h3 aria-live="polite">${esc(status)}</h3>${!same ? '<p>This request is for a different item.</p><button type="button" data-editor-ai-recover>Open saved request</button>' : ''}<p>${esc(aiRequest.error?.message || (aiActive() ? 'You can close this editor and return. Your request and the edits used for it are saved to your account.' : 'Your saved course is unchanged until you explicitly replace the content.'))}</p>${usageCopy()}
        ${same && aiRequest.proposal ? `<p>${esc(aiRequest.proposal.explanation)}</p>${aiRequest.proposal.cautions?.length ? `<ul>${aiRequest.proposal.cautions.map(item => `<li>${esc(item)}</li>`).join('')}</ul>` : ''}<button type="button" class="home-button" data-editor-ai-review ${aiBusy || aiPending ? 'disabled' : ''}>Review AI suggestion</button>` : ''}
        ${aiActive() ? `<button type="button" data-editor-ai-action="check" ${aiBusy ? 'disabled' : ''}>Check this request</button><button type="button" data-editor-ai-action="cancel" ${aiBusy ? 'disabled' : ''}>Cancel request</button>` : `<button type="button" data-editor-ai-action="discard" ${aiBusy ? 'disabled' : ''}>Discard suggestion</button>`}</section>` : ''}
      ${aiPending ? `<p role="status">${aiBusy ? 'Sending or checking your request…' : 'The request has not been confirmed here. Checking it uses the same request ID, not a new generation.'}</p><button type="button" class="home-button" data-editor-ai-action="check" ${aiBusy ? 'disabled' : ''}>Check the same AI request</button>` : !aiActive() && (!recoverable || !aiRequest.proposal) ? `<label class="editor-field" for="editor-ai-feedback"><span id="editor-ai-label">What should change?</span><textarea id="editor-ai-feedback" rows="4" aria-labelledby="editor-ai-label" aria-describedby="editor-ai-limit editor-ai-charge" ${aiBusy ? 'disabled' : ''}>${esc(aiInput)}</textarea><small id="editor-ai-limit">${[...aiInput].length.toLocaleString()} / 2,000 characters. Minimum 10. Longer text is kept so you can shorten it.</small></label><p id="editor-ai-charge">Generate makes one request using your connected Claude API key. Provider charges apply, including when a response fails. No automatic generation retries. Your saved course stays unchanged until you review and replace the content.</p><button type="button" class="home-button" data-editor-ai-action="start" ${aiBusy ? 'disabled' : ''}>${aiBusy ? 'Checking request…' : 'Generate proposal'}</button>` : ''}
      <button type="button" data-editor-ai-back ${aiBusy ? 'disabled' : ''}>Back to manual editing</button>`;
  }
  async function accept() {
    if (saving) return;
    pendingSave ||= { courseId, target, replacement: proposal.replacement, baseHash: proposal.baseHash, operationId: crypto.randomUUID() };
    saving = true;
    stage = 'saving'; error = errorCode = ''; paint();
    try {
      const result = await client.accept(owner, pendingSave); if (!valid()) return close(true);
      dirty = false; pendingSave = null; stage = 'saved'; base.payload = result.payload;
      try { await onSaved(result, owner); } catch { error = 'Saved to your account, but this browser could not refresh its copy. Reopen the course after syncing.'; }
      if (!valid()) return close(true); paint();
    } catch (err) {
      if (!valid()) return close(true); error = err.message; errorCode = err.code;
      if (['conflict', 'building', 'validation', 'media', 'markup', 'identity', 'not_found'].includes(err.code)) { pendingSave = null; stage = 'edit'; }
      else stage = 'uncertain';
      paint();
    } finally { saving = false; }
  }
  function paint(preserveFocus = false) {
    if (disposed) return;
    const focused = preserveFocus && dialog.contains(document.activeElement) ? document.activeElement : null;
    const focusId = focused?.id, selectionStart = focused?.selectionStart, selectionEnd = focused?.selectionEnd;
    const focusAttribute = focused?.getAttributeNames().find(name => name.startsWith('data-editor-'));
    const focusValue = focusAttribute ? focused.getAttribute(focusAttribute) : null;
    const disclosures = preserveFocus ? [...dialog.querySelectorAll('details')].map(el => el.open) : [];
    registry.clear(); arrays.clear();
    const busy = ['loading', 'checking', 'saving'].includes(stage), list = base ? options() : [];
    const selection = list.findIndex(item => sameTarget(item.target, target));
    let content = '';
    if (stage === 'discard') content = `<h2 tabindex="-1">Keep your changes?</h2><p>${pendingSave || aiPending ? 'A request may already have reached your account. Check the same request before starting another. Text not included in that request will be lost on closing.' : 'Closing will discard the unsaved edits in this window. Your saved course will not change.'}</p><button type="button" data-editor-keep>Keep editing</button><button type="button" data-editor-discard>Close editor</button>`;
    else if (stage === 'loading') content = '<p role="status">Loading your saved account course…</p>';
    else if (stage === 'load-error') content = '<button type="button" data-editor-load>Try again</button>';
    else if (stage === 'ai') content = aiMarkup();
    else if (stage === 'saved') content = `<h2 tabindex="-1">Change saved</h2><p>The private account copy was updated. Other lessons and their progress are unchanged. This has not published the course.</p><a class="home-button" href="${esc(homeURL({ course: courseId }) + `#/${target.moduleId}/${target.topicId}`)}" data-editor-open>Open updated lesson</a><button type="button" data-editor-new>Edit another item</button>`;
    else if (['preview', 'saving', 'uncertain'].includes(stage)) content = `<h2 tabindex="-1">Review your change</h2><div class="editor-comparison"><section><h3>Currently saved</h3>${readable(currentValue(base.payload, target))}</section><section><h3>Proposed replacement</h3>${readable(proposal.replacement)}</section></div><div class="editor-impact"><p>Only this ${target.kind === 'lesson' ? 'lesson' : 'item'} will be replaced. Other lessons stay unchanged. ${proposal.impact.interactions} changed interactions and ${proposal.impact.flashcards} changed flashcards will start fresh; this lesson will need a new completion check. Earlier learning records are retained.</p><p>Check the accuracy and practical guidance before saving. High-stakes topics need qualified review.</p></div><button type="button" class="home-button" data-editor-accept ${busy ? 'disabled' : ''}>${stage === 'saving' ? 'Saving…' : stage === 'uncertain' ? 'Check the same save' : `Replace this ${target.kind === 'lesson' ? 'lesson' : 'item'}`}</button><button type="button" data-editor-back ${busy || pendingSave ? 'disabled' : ''}>Keep editing</button>`;
    else content = `<label class="editor-field">What would you like to change?<select data-editor-target ${dirty || busy || aiPending ? 'disabled' : ''}>${list.map((item, index) => `<option value="${index}" ${index === selection ? 'selected' : ''}>${esc(item.name)}</option>`).join('')}</select></label><p>Make changes below, then preview them before replacing saved content. Manual editing does not run AI.</p>${aiAvailable ? `<div class="editor-ai-entry"><button type="button" id="editor-ai-entry" data-editor-ai-open ${busy ? 'disabled' : ''}>Ask AI to improve this</button>${aiRequest && !['discarded', 'applied'].includes(aiRequest.status) ? '<button type="button" data-editor-ai-recover>Continue saved AI request</button>' : ''}${aiPending ? '<p>A request is unconfirmed. Open AI suggestions to check the same request.</p>' : ''}${aiError ? `<p role="status">${esc(aiError)}</p>` : ''}</div>` : ''}<button type="button" data-editor-reset ${dirty ? '' : 'hidden'}>Discard edits to choose another item</button><form data-editor-form><fieldset ${busy ? 'disabled' : ''}>${form(draft)}</fieldset><button type="submit" class="home-button" ${busy ? 'disabled' : ''}>${busy ? 'Checking…' : 'Preview change'}</button></form>`;
    if (previewSource === 'ai' && ['preview', 'saving', 'uncertain'].includes(stage)) content = `<div class="editor-ai-status"><p><strong>AI suggestion</strong> · ${esc(aiRequest?.proposal?.explanation || 'Review before replacing saved content.')}</p>${usageCopy()}${dirty ? `<details><summary>Your manual draft is kept until you replace this content</summary>${readable(draft)}</details>` : ''}</div>${content}`;
    dialog.innerHTML = `<header><div><span class="home-eyebrow">Edit private course</span><h1 id="course-editor-title" tabindex="-1">${esc(base?.payload?.config?.title || 'Make changes')}</h1></div><button type="button" data-editor-close aria-label="Close course editor">×</button></header>${error ? `<div class="home-notice home-notice--warning" role="alert">${esc(error)}${errorCode === 'conflict' ? '<button type="button" data-editor-latest>Load latest and keep my text</button>' : ''}</div>` : ''}<div class="editor-body">${content}</div>`;
    dialog.querySelector('[data-editor-close]')?.addEventListener('click', () => close());
    dialog.querySelector('[data-editor-discard]')?.addEventListener('click', () => close(true));
    dialog.querySelector('[data-editor-keep]')?.addEventListener('click', () => { stage = saving ? 'saving' : pendingSave ? 'uncertain' : resumeStage; paint(); });
    dialog.querySelector('[data-editor-load]')?.addEventListener('click', () => load());
    dialog.querySelector('[data-editor-latest]')?.addEventListener('click', () => load(true));
    dialog.querySelector('[data-editor-new]')?.addEventListener('click', () => load());
    dialog.querySelector('[data-editor-open]')?.addEventListener('click', () => close(true));
    dialog.querySelector('[data-editor-ai-open]')?.addEventListener('click', () => { stage = 'ai'; paint(); });
    dialog.querySelectorAll('[data-editor-ai-recover]').forEach(button => button.addEventListener('click', recoverAI));
    dialog.querySelector('[data-editor-ai-back]')?.addEventListener('click', () => { stage = 'edit'; paint(); });
    dialog.querySelector('[data-editor-ai-latest]')?.addEventListener('click', () => load(true));
    dialog.querySelector('[data-editor-ai-review]')?.addEventListener('click', reviewAI);
    dialog.querySelectorAll('[data-editor-ai-action]').forEach(button => button.addEventListener('click', () => aiAction(button.dataset.editorAiAction)));
    dialog.querySelector('#editor-ai-feedback')?.addEventListener('input', event => {
      aiInput = event.target.value; const count = [...aiInput].length;
      dialog.querySelector('#editor-ai-limit').textContent = `${count.toLocaleString()} / 2,000 characters. Minimum 10. Longer text is kept so you can shorten it.`;
      if (aiError.startsWith('Describe the change in ') && count >= 10 && count <= 2000) { aiError = ''; dialog.querySelector('.editor-body [role="alert"]')?.remove(); }
    });
    dialog.querySelector('[data-editor-target]')?.addEventListener('change', event => choose(list[Number(event.target.value)].target));
    dialog.querySelector('[data-editor-reset]')?.addEventListener('click', () => choose(target));
    dialog.querySelector('[data-editor-back]')?.addEventListener('click', () => { stage = 'edit'; paint(); });
    dialog.querySelector('[data-editor-accept]')?.addEventListener('click', accept);
    dialog.querySelector('[data-editor-form]')?.addEventListener('submit', event => { event.preventDefault(); preview(); });
    const clearItem = value => Array.isArray(value) ? value.map(clearItem) : value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).map(([key, item]) => [key, key === 'id' ? `item-${crypto.randomUUID().slice(0, 8)}` : clearItem(item)])) : typeof value === 'boolean' ? false : typeof value === 'number' ? value : '';
    dialog.querySelectorAll('[data-editor-add], [data-editor-remove]').forEach(button => button.addEventListener('click', () => {
      const entry = arrays.get(button.dataset.editorAdd || button.dataset.editorRemove); if (!entry) return;
      const list = entry.path.reduce((value, key) => value[key], draft);
      if (button.dataset.editorAdd && list.length < entry.range[1]) list.push(clearItem(list.at(-1)));
      else if (button.dataset.editorRemove && list.length > entry.range[0]) list.splice(Number(button.dataset.index), 1);
      dirty = true; proposal = null; paint();
    }));
    dialog.querySelector('[data-editor-form]')?.addEventListener('input', event => {
      const field = registry.get(event.target.id); if (!field) return;
      let value = event.target.value;
      if (field.type === 'number') value = Number(value);
      else if (field.type === 'boolean') value = value === 'true';
      else if (field.html) value = value.split(/\n\s*\n/).map(part => `<p>${esc(part).replace(/\n/g, '<br>')}</p>`).join('');
      const parent = field.path.slice(0, -1).reduce((value, key) => value[key], draft); parent[field.path.at(-1)] = value;
      dirty = true; proposal = null;
      dialog.querySelector('[data-editor-reset]').hidden = false;
      const picker = dialog.querySelector('[data-editor-target]'); if (picker) picker.disabled = true;
    });
    if (preserveFocus) dialog.querySelectorAll('details').forEach((el, index) => { if (index < disclosures.length) el.open = disclosures[index]; });
    const restore = focusId ? dialog.querySelector(`#${CSS.escape(focusId)}`) : focusAttribute ? dialog.querySelector(`[${focusAttribute}="${CSS.escape(focusValue)}"]`) : null;
    if (preserveFocus && restore) { restore.focus(); if (typeof selectionStart === 'number' && restore.setSelectionRange) restore.setSelectionRange(selectionStart, selectionEnd); }
    else if (!busy && !preserveFocus) (dialog.querySelector('h2[tabindex]') || dialog.querySelector('#course-editor-title'))?.focus();
  }
  paint(); dialog.showModal(); load();
  return { close, dialog };
}
