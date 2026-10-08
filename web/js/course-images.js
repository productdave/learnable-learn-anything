import { getUser, onUserChange } from './auth.js?v=33';
import { createCourseImageClient } from './course-image-client.js?v=5';
import { homeURL, escapeHome as esc } from './home-model.js?v=7';
import { courseImageProgress, nextImageIndex, IMAGE_PROGRESS_LABELS } from './image-progress.js?v=2';
import { imageCostHTML } from './image-cost.js?v=2';

const active = request => ['queued','running','persisting'].includes(request?.status);
const sameLesson = (a,b) => a?.moduleId === b?.moduleId && a?.topicId === b?.topicId;
const messages = {
  queued:'Your request is saved and waiting to start.', running:'Generating one image. You can close this window and return to this course.',
  persisting:'The image was generated. Saving and verifying its private file…', ready:'Your image is ready to review. Your lesson has not changed.',
  failed:'This image request did not finish. Your saved lesson is unchanged.', unknown:'The outcome is unconfirmed. Check this attempt before deciding whether to generate another.',
  cancelled:'This attempt was cancelled. Your saved lesson is unchanged.', discarded:'This candidate was discarded. Your saved lesson is unchanged.',
};
const errors = { connection:'Connect an OpenAI key to generate an image.', vault:'Your secure connection is unavailable. Reconnect or try again later.', credentials:'OpenAI rejected the key. Disconnect it below, then connect a valid key.', quota:'Check your OpenAI API billing and available credits.', access:'Check that your OpenAI account can use this image model.', rate_limit:'OpenAI is limiting requests. Wait before explicitly generating another image.', moderation:'Revise the description to meet the provider’s safety requirements.', rejected:'Review the image description before generating another image.', response:'The provider did not return a usable image. Check this attempt before requesting another.', asset_missing:'The image file was not saved. Check this attempt again before requesting another.', stale:'The lesson changed. Reload its latest version before requesting a new illustration.', configuration:'Image generation is not available with the current server configuration.' };

export function openCourseImages(courseId, { client = createCourseImageClient(), courses = { load: client.loadCourse }, getIdentity = getUser, watchIdentity = onUserChange, onSaved = async () => {}, preferUnfinished = false } = {}) {
  const owner = getIdentity()?.id, opener = document.activeElement, dialog = document.createElement('dialog');
  dialog.className = 'course-editor image-editor'; dialog.setAttribute('aria-labelledby','image-editor-title'); document.body.append(dialog);
  let base, lessons = [], selected = 0, requests = [], quote, request = null, connected = false, enabled = false;
  let prompt = '', alt = '', caption = '', consent = false, chargeAck = false, reviewed = false;
  let busy = false, loading = true, dirty = false, disposed = false, error = '', notice = '', mode = 'describe', closeWarning = false, showKey = false;
  let pendingStart = null, pendingAccept = null, timer, ticket = 0, unwatch, coverageOpen = false, chosen = false, costDetailsOpen = false;
  const urls = new Map(), loadingAssets = new Set(), assetErrors = new Set();
  const target = () => lessons[selected]?.target;
  const currentLesson = () => lessons[selected]?.lesson;
  const currentImage = () => currentLesson()?.sections.find(section => section.type === 'image' && section.image_slot === 'instruction');
  const valid = () => !disposed && getIdentity()?.id === owner;
  const warn = () => dirty || pendingStart || pendingAccept;
  const beforeUnload = event => { if (warn()) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload',beforeUnload);
  function close(force = false) {
    if (disposed) return;
    if (!force && warn()) { closeWarning = true; paint(); return; }
    disposed = true; ticket++; clearTimeout(timer); unwatch?.(); window.removeEventListener('beforeunload',beforeUnload);
    for (const url of urls.values()) URL.revokeObjectURL(url); urls.clear();
    dialog.close(); dialog.remove(); if (opener?.isConnected) opener.focus();
    prompt = alt = caption = ''; base = pendingStart = pendingAccept = null;
  }
  unwatch = watchIdentity?.(() => { if (!valid()) close(true); });
  dialog.addEventListener('cancel',event => { event.preventDefault(); close(); });
  function setLessons() {
    lessons = base.payload.curriculum.modules.flatMap(mod => mod.topics.filter(topic => base.payload.modules?.[mod.number]?.[topic.id]).map(topic => ({ target:{ moduleId:mod.id,topicId:topic.id }, title:topic.title, moduleTitle:mod.title, lesson:base.payload.modules[mod.number][topic.id] })));
  }
  function coverageHTML() {
    const progress=courseImageProgress(base.payload,requests), next=nextImageIndex(progress.rows,progress.rows.findIndex(row=>sameLesson(row.target,target())));
    return `<section class="image-coverage" aria-labelledby="image-coverage-title"><h3 id="image-coverage-title">Image progress</h3><p><strong>${progress.saved} of ${progress.total} lessons have a saved generated image</strong></p>
      <p class="source-help">${progress.review} awaiting review · ${progress.generating} in progress · ${progress.attention} need attention${progress.blocked ? ` · ${progress.blocked} lessons not saved` : ''}. Candidates do not change your course until you accept them.</p>
      <details ${coverageOpen?'open':''} data-image-coverage><summary>View all lessons</summary><ul>${progress.rows.map((row,index)=>`<li><div><span class="source-help">${esc(row.moduleTitle)}</span><button id="image-coverage-${index}" type="button" data-image-action="choose" data-index="${index}" ${!row.available||busy||pendingStart||pendingAccept?'disabled':''} ${sameLesson(row.target,target())?'aria-current="true"':''}>${esc(row.title)}</button></div><span class="image-coverage-state">${IMAGE_PROGRESS_LABELS[row.state]}${row.image && row.state!=='saved'?' · Current image kept':''}</span></li>`).join('')}</ul></details>
      ${next>=0?`<button type="button" data-image-action="next" ${busy||pendingStart||pendingAccept?'disabled':''}>Next image →</button><p class="source-help">Opens the next lesson needing an image or review. Nothing is generated or charged.</p>`:''}</section>`;
  }
  async function asset(id) {
    if (!id || urls.has(id) || loadingAssets.has(id) || assetErrors.has(id)) return;
    loadingAssets.add(id);
    try { const blob = await client.asset(owner,courseId,id); if (valid()) urls.set(id,URL.createObjectURL(blob)); }
    catch { if (valid()) assetErrors.add(id); }
    finally { loadingAssets.delete(id); if (valid()) paint(); }
  }
  function figure(id, description, title) {
    return `<figure class="image-preview"><figcaption>${esc(title)}</figcaption>${urls.has(id) ? `<img src="${esc(urls.get(id))}" alt="${esc(description)}">` : `<div class="image-placeholder" role="status">${assetErrors.has(id) ? 'The private image could not be loaded.' : 'Loading private image…'}</div>${assetErrors.has(id) ? `<button type="button" data-image-action="asset" data-id="${esc(id)}">Retry image loading</button>` : ''}`}</figure>`;
  }
  function planHTML() {
    const locked = busy || !!pendingStart;
    return `<section class="image-step"><h3>1. Describe the illustration</h3><p>Include the teaching point, what should be visible and anything to avoid. Only this description is sent to OpenAI; your source files are not attached.</p>
      <label class="editor-field" for="image-prompt"><span id="image-prompt-label">Image description</span><textarea id="image-prompt" aria-labelledby="image-prompt-label" rows="5" aria-describedby="image-prompt-count" ${locked ? 'disabled' : ''}>${esc(prompt)}</textarea><small id="image-prompt-count">${[...prompt].length.toLocaleString()} / 4,000 characters</small></label>
      <label class="editor-field" for="image-alt"><span id="image-alt-label">Alternative text</span><textarea id="image-alt" aria-labelledby="image-alt-label" rows="2" aria-describedby="image-alt-count" ${locked ? 'disabled' : ''}>${esc(alt)}</textarea><small id="image-alt-count">${[...alt].length} / 300 characters · You can refine this after seeing the image.</small></label>
      ${quote ? `<div class="image-cost"><strong>Creator-funded · Your OpenAI account</strong><p>1 image · ${esc(quote.size)} · ${esc(quote.quality)} quality · PNG</p>${imageCostHTML({ count: 1, settings: quote, detailsOpen: costDetailsOpen })}<details><summary>Model details</summary><p>${esc(quote.model)}</p><p>Learnable will not switch to another payer.</p></details></div>` : ''}
      ${enabled && !connected || showKey ? connectionHTML() : enabled ? `<p class="image-connection">OpenAI connected <button type="button" class="image-link" data-image-action="disconnect" ${busy ? 'disabled' : ''}>Disconnect</button></p>` : ''}
      ${enabled ? `<label class="image-check"><input id="image-consent" type="checkbox" ${consent ? 'checked' : ''} ${locked ? 'disabled' : ''}><span>Generate one image and bill my connected OpenAI API account.</span></label>
      ${request?.mayHaveCharged ? `<label class="image-check"><input id="image-charge" type="checkbox" ${chargeAck ? 'checked' : ''} ${locked ? 'disabled' : ''}><span>The previous attempt may already have been charged. This is a new, separately charged request.</span></label>` : ''}
      <div class="editor-actions"><button type="button" class="home-button home-button--primary" data-image-action="generate" ${locked || !connected || !quote ? 'disabled' : ''}>${busy ? 'Confirming request…' : request ? 'Generate 1 replacement' : 'Generate 1 image'}</button>${pendingStart ? '<button type="button" data-image-action="check-start">Check same request</button>' : ''}</div>` : `<div class="image-status"><p>New image generation is not enabled here yet. Existing saved images and review candidates are unchanged.</p><button type="button" data-image-action="reload">Check availability</button></div>`}
    </section>`;
  }
  function connectionHTML() {
    return `<section class="image-connect" aria-labelledby="image-connect-title"><h4 id="image-connect-title">Connect OpenAI for course images</h4><p>OpenAI bills your API account. Your key is encrypted in your account and is never saved in browser storage or course content. Connecting does not generate an image.</p><label class="editor-field" for="image-key"><span id="image-key-label">OpenAI API key</span><input id="image-key" aria-labelledby="image-key-label" type="password" autocomplete="off" spellcheck="false" placeholder="sk-…" ${busy ? 'disabled' : ''}></label><button type="button" data-image-action="connect" ${busy ? 'disabled' : ''}>Connect OpenAI</button></section>`;
  }
  function reviewHTML() {
    return `<section class="image-step"><h3>2. Review the candidate</h3><p>AI-generated · Private. Check the visual details against the lesson.</p>
      <div class="image-comparison">${currentImage() && currentImage().asset_id !== request.id ? figure(currentImage().asset_id,currentImage().alt,'Currently in the lesson') : ''}${figure(request.id,alt,'Candidate — not yet in the lesson')}</div>
      <p>Check technique, labels and details. For child safety, health or other high-stakes teaching, get qualified review.</p>
      <label class="editor-field" for="image-alt"><span id="image-alt-label">Alternative text</span><textarea id="image-alt" aria-labelledby="image-alt-label" rows="2" aria-describedby="image-alt-count" ${busy || pendingAccept ? 'disabled' : ''}>${esc(alt)}</textarea><small id="image-alt-count">${[...alt].length} / 300 characters · Describe what this image actually shows.</small></label>
      <label class="editor-field" for="image-caption"><span id="image-caption-label">Caption (optional)</span><textarea id="image-caption" aria-labelledby="image-caption-label" rows="2" ${busy || pendingAccept ? 'disabled' : ''}>${esc(caption)}</textarea><small id="image-caption-count">${[...caption].length} / 500 characters</small></label>
      ${request.stale ? '<p class="editor-error" role="alert">The lesson changed after this image was requested. Discard this candidate to plan an image for the latest lesson. It cannot replace newer content.</p>' : ''}
      <h3>3. Use it in your lesson</h3><p>Only this lesson’s generated illustration will be replaced. Other content stays the same. The lesson’s completion status will reset so the changed material can be reviewed again.</p>
      <label class="image-check"><input id="image-reviewed" type="checkbox" ${reviewed ? 'checked' : ''} ${busy || pendingAccept ? 'disabled' : ''}><span>I have checked the image and alternative text for accuracy, accessibility and safe instruction.</span></label>
      <div class="editor-actions"><button type="button" class="home-button home-button--primary" data-image-action="accept" ${busy || request.stale || !urls.has(request.id) ? 'disabled' : ''}>${busy ? 'Saving image…' : pendingAccept ? 'Check same save' : 'Use this image'}</button><button type="button" data-image-action="discard" ${busy || pendingAccept ? 'disabled' : ''}>Discard candidate</button></div>
    </section>`;
  }
  function requestHTML() {
    if (!request) return '';
    if (request.accepted) return `<section class="image-status"><h3>${currentImage()?.asset_id === request.id ? 'Image added to the lesson' : 'Previously accepted image'}</h3><p>${currentImage()?.asset_id === request.id ? 'Saved to your account. Generating another image will keep this one in place until you accept its replacement.' : 'The lesson has changed since this image was accepted. Open it to review what is currently saved.'}</p><a class="home-button home-button--secondary" href="${esc(homeURL({ course:courseId }) + `#/${target().moduleId}/${target().topicId}`)}" data-image-open>Open updated lesson →</a>${mode !== 'describe' ? '<button type="button" data-image-action="replace">Generate a replacement</button>' : ''}</section>`;
    if (request.status === 'ready') return '<p class="image-ready" role="status">Candidate ready · Your lesson is unchanged</p>';
    return `<section class="image-status" role="status" aria-live="polite"><h3>${({ ready:'Ready for your review', queued:'Request saved', running:'Generating image', persisting:'Saving image', failed:'Image needs attention', unknown:'Check this attempt', cancelled:'Attempt cancelled', discarded:'Candidate discarded' })[request.status] || 'Image request'}</h3><p>${esc(messages[request.status] || '')}</p>${request.error && errors[request.error] ? `<p>${esc(errors[request.error])}</p>` : ''}${request.mayHaveCharged && request.status !== 'ready' ? '<p>OpenAI may already have processed and charged this attempt. Checking its status does not generate another image.</p>' : ''}
      ${active(request) || request.needsRecovery ? `<div class="editor-actions"><button type="button" data-image-action="check" ${busy ? 'disabled' : ''}>Check this attempt</button>${request.status === 'queued' ? '<button type="button" data-image-action="resume">Start saved request</button>' : ''}<button type="button" data-image-action="cancel" ${busy ? 'disabled' : ''}>Cancel attempt</button></div>` : ''}
      ${request.usage ? '<details><summary>Provider usage reported</summary><p>Usage is recorded with this request, not a confirmed invoice. Check your OpenAI billing for charges.</p></details>' : ''}
    </section>`;
  }
  function paint() {
    if (!valid()) return;
    const focused = dialog.contains(document.activeElement) ? document.activeElement : null, focusId = focused?.id, focusAction = focused?.dataset.imageAction, selection = focused && 'selectionStart' in focused && focused.type !== 'checkbox' ? [focused.selectionStart,focused.selectionEnd] : null, scroll = dialog.scrollTop;
    const keyField = dialog.querySelector('#image-key');
    dialog.innerHTML = `<header class="editor-header"><div><p class="image-eyebrow">Private course studio</p><h2 id="image-editor-title">Course images</h2><p>${base ? esc(base.payload.config.title) : 'Loading your saved course…'}</p></div><button type="button" data-image-action="close" aria-label="Close course images">×</button></header>
      ${closeWarning ? `<section class="image-status"><h3>Leave image editing?</h3><p>${pendingAccept ? 'The save is unconfirmed. Reopen this course to check which image is saved.' : pendingStart ? 'The request may have started. Reopen Course images to find the saved attempt; do not immediately create another.' : 'Your unsent description or review edits will be lost. Saved requests and course images remain in your account.'}</p><div class="editor-actions"><button type="button" data-image-action="stay">Keep editing</button><button type="button" data-image-action="leave">Leave</button></div></section>` : `
      ${error ? `<div class="editor-error" role="alert" tabindex="-1" id="image-error">${esc(error)}</div>` : ''}${notice ? `<p class="image-notice" role="status">${esc(notice)}</p>` : ''}
      ${loading ? '<p role="status">Loading saved lessons and image requests…</p>' : !base || !lessons.length ? '<p>No editable saved lessons are available.</p><button type="button" data-image-action="reload">Try again</button>' : `
        ${coverageHTML()}
        <label class="editor-field" for="image-lesson"><span id="image-lesson-label">Choose a lesson</span><select id="image-lesson" aria-labelledby="image-lesson-label" ${busy || pendingStart || pendingAccept ? 'disabled' : ''}>${lessons.map((item,index) => `<option value="${index}" ${index === selected ? 'selected' : ''}>${esc(item.moduleTitle)} · ${esc(item.title)}</option>`).join('')}</select></label>
        <p class="source-help">Generated images are private. Public image publishing is not part of this preview.</p>
        ${requestHTML()}${request?.status === 'ready' && !request.accepted && mode !== 'describe' ? reviewHTML() : !active(request) && mode === 'describe' ? planHTML() : ''}
        ${!request && currentImage() ? figure(currentImage().asset_id,currentImage().alt,'Currently in the lesson') : ''}
      `}`}`;
    // Preserve the password input node during unrelated preview paints; never
    // copy its secret into state, HTML strings, storage or a course payload.
    if (keyField && dialog.querySelector('#image-key')) { keyField.disabled = busy; dialog.querySelector('#image-key').replaceWith(keyField); }
    if (focusId || focusAction) { const next = dialog.querySelector(focusId ? `#${focusId}` : `[data-image-action="${focusAction}"]`); next?.focus({ preventScroll:true }); if (selection && next?.setSelectionRange) next.setSelectionRange(...selection); }
    dialog.scrollTop = scroll;
    if (request?.status === 'ready') asset(request.id);
    if (currentImage()?.asset_id) asset(currentImage().asset_id);
  }
  function putRequest(value) { request = value; requests = requests.filter(item => !sameLesson(item.target,value.target) || item.slot !== 'instruction'); requests.push(value); }
  function schedule() {
    clearTimeout(timer);
    if (!active(request) || disposed) return;
    timer = setTimeout(async () => {
      if (!valid() || busy) return schedule();
      const id = request.id;
      try { const result = await client.action(owner,{ courseId,operationId:id,action:'reconcile' }); if (!valid() || request?.id !== id) return; putRequest(result.request); if (request.status === 'ready') { mode = 'review'; alt = request.alt; reviewed = false; } else if (!active(request)) mode = 'describe'; paint(); }
      catch (err) { if (valid()) { error = err.message; paint(); return; } }
      schedule();
    },2000);
  }
  async function choose(index) {
    const run = ++ticket; clearTimeout(timer); selected = index; quote = null; error = notice = ''; consent = chargeAck = reviewed = false; dirty = false;
    request = requests.find(item => item.slot === 'instruction' && sameLesson(item.target,target())) || null;
    prompt = request?.prompt || `Create a clear instructional illustration for the lesson “${lessons[selected].title}”. Show the main teaching point accurately, with a simple uncluttered composition. Avoid decorative or misleading details.`;
    alt = request?.alt || `Illustration for ${lessons[selected].title}`; caption = ''; mode = request?.status === 'ready' ? 'review' : 'describe';
    paint();
    try { const result = await client.inspect(owner,courseId,target()); if (!valid() || run !== ticket) return; quote = result.funding; quote.baseHash = result.baseHash; enabled = true; }
    catch (err) { if (!valid() || run !== ticket) return; enabled = false; if (!['disabled','preview-disabled'].includes(err.code)) error = err.message; }
    if (!valid() || run !== ticket) return; paint(); schedule();
  }
  async function load({ preserve = false } = {}) {
    const retained = preserve && dirty ? { target:target(),prompt,alt,caption } : null;
    loading = true; error = ''; paint();
    try {
      const [saved, inventory] = await Promise.all([courses.load(owner,courseId),client.list(owner,courseId)]);
      if (!valid()) return; base = saved; requests = inventory; setLessons();
      try { const status = await client.connection(owner); if (!valid()) return; connected = status.connected === true; } catch { connected = false; }
      loading = false; if (lessons.length) {
        if(preferUnfinished&&!chosen){const rows=courseImageProgress(base.payload,requests).rows,next=nextImageIndex(rows);const index=lessons.findIndex(item=>sameLesson(item.target,rows[next]?.target));if(index>=0)selected=index;}
        chosen=true;
        await choose(Math.min(selected,lessons.length - 1));
        if (valid() && retained && sameLesson(retained.target,target())) { ({ prompt,alt,caption } = retained); dirty = true; paint(); }
      } else paint();
    } catch (err) { if (valid()) { loading = false; error = err.message; paint(); } }
  }
  async function act(action, button) {
    if (action === 'close') return close();
    if (action === 'leave') return close(true);
    if (action === 'stay') { closeWarning = false; paint(); return; }
    if (busy) return;
    if (action === 'asset') { assetErrors.delete(button.dataset.id); return asset(button.dataset.id); }
    if (action === 'reload') return load({ preserve:true });
    if (action === 'next' || action === 'choose') {
      if (pendingStart || pendingAccept) return;
      if (dirty) { error='Finish or close your current image edits before switching lessons.';paint();dialog.querySelector('#image-error')?.focus();return; }
      const rows=courseImageProgress(base.payload,requests).rows, current=rows.findIndex(row=>sameLesson(row.target,target()));
      const index=action==='next'?nextImageIndex(rows,current):Number(button.dataset.index);
      const lessonIndex=lessons.findIndex(lesson=>sameLesson(lesson.target,rows[index]?.target));
      if(lessonIndex>=0 && rows[index]?.available){await choose(lessonIndex);if(valid())dialog.querySelector('#image-lesson')?.focus();}
      return;
    }
    if (action === 'replace') { mode = 'describe'; consent = chargeAck = false; quote = null; await choose(selected); mode = 'describe'; paint(); return; }
    busy = true; error = notice = '';
    try {
      if (action === 'connect') {
        let key = dialog.querySelector('#image-key')?.value.trim() || ''; dialog.querySelector('#image-key').value = ''; paint();
        try { const result = await client.connect(owner,key); if (!valid()) return; connected = result.connected === true; showKey = false; notice = 'OpenAI connected. No image has been generated. Review the request, then confirm generation. This check does not confirm available credits or image-generation permission.'; } finally { key = ''; }
      } else if (action === 'disconnect') {
        paint(); await client.disconnect(owner); if (!valid()) return; connected = false; consent = false; notice = 'OpenAI disconnected. Saved images are unchanged.';
      } else if (action === 'generate' || action === 'check-start') {
        if (!pendingStart) {
          if (!prompt.trim() || [...prompt.trim()].length > 4000 || !alt.trim() || [...alt.trim()].length > 300) throw new Error('Add an image description (up to 4,000 characters) and alternative text (up to 300 characters).');
          if (!consent || request?.mayHaveCharged && !chargeAck) throw new Error('Confirm who pays and acknowledge any previous charge before generating.');
          pendingStart = { action:'start',courseId,operationId:crypto.randomUUID(),expectedRequestId:request?.id || null,target:target(),slot:'instruction',prompt:prompt.trim(),alt:alt.trim(),baseHash:quote.baseHash,fundingHash:quote.hash,consent:true,acknowledgePossibleCharge:chargeAck };
        }
        paint(); const result = await client.action(owner,pendingStart); if (!valid()) return;
        putRequest(result.request); pendingStart = null; dirty = false; mode = 'review'; consent = chargeAck = false;
      } else if (action === 'accept') {
        if (!pendingAccept) {
          if (!reviewed || !alt.trim() || [...alt.trim()].length > 300 || [...caption.trim()].length > 500) throw new Error('Review the illustration and add accurate alternative text (up to 300 characters). Captions can contain up to 500 characters.');
          pendingAccept = { action:'accept',courseId,operationId:request.id,acceptanceId:crypto.randomUUID(),alt:alt.trim(),caption:caption.trim(),reviewed:true };
        }
        paint(); const result = await client.action(owner,pendingAccept); if (!valid()) return;
        pendingAccept = null; dirty = false; base = result; setLessons(); putRequest({ ...request,accepted:true });
        notice = 'Image saved to your lesson. No additional image was generated.';
        try { await onSaved(result,owner); } catch { if (valid()) notice = 'Your image is saved to your account. Reload the course to refresh this view.'; }
      } else if (['check','resume','cancel','discard'].includes(action)) {
        paint(); const result = await client.action(owner,{ courseId,operationId:request.id,action:action === 'check' ? 'reconcile' : action }); if (!valid()) return;
        putRequest(result.request); if (request.status === 'ready') mode = 'review';
        else if (!active(request)) {
          mode = 'describe'; dirty = false;
          // Discarding a stale candidate starts from fresh saved context, not
          // the revision from before the creator's other edit.
          if (action === 'discard') {
            base = await courses.load(owner,courseId); if (!valid()) return; setLessons();
            try { const latest = await client.inspect(owner,courseId,target()); if (!valid()) return; quote = { ...latest.funding,baseHash:latest.baseHash }; }
            catch { quote = null; enabled = false; }
          }
        }
      }
    } catch (err) {
      if (!valid()) return; error = err.message;
      if (err.code && !['unavailable','asset'].includes(err.code)) { pendingStart = null; pendingAccept = null; }
    } finally {
      if (valid()) { busy = false; paint(); if (error) dialog.querySelector('#image-error')?.focus(); schedule(); }
    }
  }
  dialog.addEventListener('click',event => {
    const button = event.target.closest('[data-image-action]'); if (button) act(button.dataset.imageAction,button);
    if (event.target.closest('[data-image-open]')) close(true);
  });
  dialog.addEventListener('input',event => {
    const el = event.target;
    if (error && !pendingStart && !pendingAccept && el.id !== 'image-key') { error = ''; dialog.querySelector('#image-error')?.remove(); }
    if (el.id === 'image-prompt') { prompt = el.value; dirty = true; dialog.querySelector('#image-prompt-count').textContent = `${[...prompt].length.toLocaleString()} / 4,000 characters`; }
    if (el.id === 'image-alt') { alt = el.value; dirty = true; reviewed = false; dialog.querySelector('#image-alt-count').textContent = `${[...alt].length} / 300 characters`; const check = dialog.querySelector('#image-reviewed'); if (check) check.checked = false; }
    if (el.id === 'image-caption') { caption = el.value; dirty = true; dialog.querySelector('#image-caption-count').textContent = `${[...caption].length} / 500 characters`; }
    if (el.id === 'image-consent') consent = el.checked;
    if (el.id === 'image-charge') chargeAck = el.checked;
    if (el.id === 'image-reviewed') reviewed = el.checked;
  });
  dialog.addEventListener('change',event => {
    if (event.target.id !== 'image-lesson') return;
    if (dirty) { event.target.value = selected; error = 'Finish or close your current image edits before switching lessons.'; paint(); return; }
    choose(Number(event.target.value));
  });
  dialog.addEventListener('toggle',event=>{
    if(event.target.matches('[data-image-coverage]'))coverageOpen=event.target.open;
    if(event.target.matches('[data-image-cost-details]'))costDetailsOpen=event.target.open;
  },true);
  paint(); dialog.showModal(); load();
  return { dialog,close };
}
