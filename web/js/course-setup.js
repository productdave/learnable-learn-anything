import { draftExport } from './draft-store.js?v=5';
import { createSetupSessions } from './setup-session.js?v=8';
import { createSetupSignIn } from './setup-signin.js?v=14';
import { createSetupCreation } from './setup-create.js?v=13';
import { createSetupGenerationClient } from './setup-generation-client.js?v=9';
import { createSetupAccountClient, sendSetupSignInLink } from './setup-account-client.js?v=12';
import { createSetupHandoffs, accountSetupURL } from './setup-handoff.js?v=6';
import { getUser } from './auth.js?v=33';
import { SETUP_STEPS, FORMATS, COMPONENT_LABELS, setupURL, setupIssues, sourceCounts } from './setup-model.js?v=7';
import { mountCourseDescription } from './course-description.js?v=1';
import { briefPreviewHTML, briefTitle } from './brief-presentation.js?v=1';
import { sourceEditorHTML, mountSourceEditor } from './source-editor.js?v=9';
import { escapeHome as esc, homeURL } from './home-model.js?v=7';
import { COMPONENT_DESCRIPTIONS, componentSummaryHTML, componentSetupIssues, courseImageInfoHTML, mountCourseImageInfo } from './setup-components.js?v=10';
import { creationComponents } from './generator/component-policy.mjs?v=3';
import { materialDefaults, defaultsPanelHTML, mountDefaultsPanel } from './setup-defaults.js?v=9';
import { mergeUnfinishedSetups } from './setup-list.js?v=5';
import { confirmDraftDeletion } from './delete-draft.js?v=5';

const labels = { goal: 'Goal', experience: 'Experience', context: 'Context', review: 'Review' };
const titles = { goal: 'What would you like to learn or teach?', experience: 'Choose how the learning happens', context: 'Make it fit your real world', review: 'Review your course setup' };
const descriptions = { goal: 'Start with the outcome and who you’re helping. You can change anything later.', experience: 'Choose a learning approach and the materials you want included.', context: 'Add constraints and any material you want the course to draw from.', review: 'Check the details before creating your course.' };
const linkHome = homeURL({ filter: 'mine' });
const action = (name, label, secondary = true) => `<button type="button" class="home-button${secondary ? ' home-button--secondary' : ''}" data-setup-action="${name}">${label}</button>`;
function field(draft, name, label, { rows = 0, placeholder = '', help = '', required = false } = {}) {
  const description = name === 'topic';
  const attributes = `id="setup-${name}" data-brief-field="${name}" ${description ? 'class="course-description"' : ''} ${required ? 'required' : ''} aria-describedby="setup-${name}-help ${description ? 'setup-topic-count ' : ''}setup-${name}-error"`;
  return `<div class="setup-field"><label for="setup-${name}">${label}${required ? ' <span class="setup-required">Required</span>' : ' <span class="setup-optional">Optional</span>'}</label>${rows ? `<textarea ${attributes} rows="${rows}" placeholder="${esc(placeholder)}">${esc(draft.brief[name])}</textarea>` : `<input ${attributes} value="${esc(draft.brief[name])}" placeholder="${esc(placeholder)}">`}${description ? '<p class="course-description-count" id="setup-topic-count"></p>' : ''}<p class="source-help" id="setup-${name}-help">${help}</p><p class="setup-field-error" id="setup-${name}-error" ${description ? 'aria-live="polite"' : ''}></p></div>`;
}
function goalHTML(draft) {
  return field(draft, 'topic', 'What is the course about?', { required: true, rows: 3, placeholder: 'e.g. Help my four-year-old get comfortable in the water', help: 'Describe the topic and what you want covered. You can add more detail in Goal and Context.' })
    + field(draft, 'audience', 'Who is it for?', { required: true, rows: 2, placeholder: 'e.g. A parent teaching a four-year-old beginner', help: 'Include age or experience level when it affects how the course should be taught.' })
    + field(draft, 'goal', 'What should they be able to do?', { rows: 3, placeholder: 'Describe a useful, realistic outcome…' })
    + field(draft, 'starting_point', 'What do they already know?', { rows: 2, placeholder: 'e.g. Complete beginner, comfortable with splashing' });
}
export function experienceHTML(draft) {
  return `<fieldset class="setup-choices"><legend>Learning approach</legend><div class="setup-choice-grid">${Object.entries(FORMATS).map(([value, [label, detail]]) => `<label class="setup-choice"><input type="radio" name="format" data-brief-field="experience" value="${value}" ${draft.brief.experience === value ? 'checked' : ''}><span><strong>${label}</strong><span>${detail}</span></span></label>`).join('')}</div></fieldset>
    <div class="setup-field"><label for="setup-depth">How much depth?</label><select id="setup-depth" data-brief-field="depth">${['Quick introduction', 'Solid foundation', 'Deep dive'].map(value => `<option ${draft.brief.depth === value ? 'selected' : ''}>${value}</option>`).join('')}</select></div>
    <section class="setup-included-materials" data-image-setup aria-labelledby="setup-included-title"><h2 id="setup-included-title">Included in every course</h2><div class="setup-materials-line"><span>Step-by-step lessons</span><span aria-hidden="true">·</span><div class="setup-image-meta">${courseImageInfoHTML()}</div></div></section>
    <fieldset class="setup-choices"><legend>Optional learning tools</legend><p class="source-help">Add checklists, quizzes or flashcards. Lessons and useful instructional images are part of course creation.</p><div class="setup-component-grid">${Object.entries(COMPONENT_DESCRIPTIONS).map(([value, detail]) => `<label class="setup-check"><input type="checkbox" data-component="${value}" ${draft.components.includes(value) ? 'checked' : ''}><span><strong>${COMPONENT_LABELS[value]}</strong><small>${detail}</small></span></label>`).join('')}</div></fieldset>`;
}
function contextHTML(draft) {
  return field(draft, 'context', 'Anything else the course should take into account?', { rows: 4, placeholder: 'e.g. 15-minute sessions, equipment available, accessibility needs or safety constraints', help: 'Avoid personal information you don’t need to include.' })
    + `<aside class="setup-safety"><strong>A note on safety</strong><p>For health, child safety or other high-stakes topics, a generated course needs authoritative sources and qualified review. Don’t rely on it as your only guidance.</p></aside>` + sourceEditorHTML();
}
export function reviewHTML(draft, user) {
  const issues = [...setupIssues(draft), ...componentSetupIssues(draft.components)], counts = sourceCounts(draft);
  const summary = (title, step, body) => `<section class="setup-review-section"><div class="source-item-head"><h2>${title}</h2><a class="home-draft-link" href="${esc(setupURL(draft.id, step))}">Edit ${title.toLowerCase()}</a></div>${body}</section>`;
  return `${issues.length ? `<div class="home-notice home-notice--warning"><div><strong>${issues.length} ${issues.length === 1 ? 'thing' : 'things'} to check</strong><ul>${issues.map(issue => `<li>${esc(issue.text)}</li>`).join('')}</ul></div>${action('fix', 'Review first issue')}</div>` : '<div class="setup-ready"><span aria-hidden="true">✓</span><div><strong>Your setup is complete</strong><p>Review the details below, then create your course.</p></div></div>'}
    ${summary('Goal', 'goal', `${briefPreviewHTML(draft.brief.topic, { label: 'course description', fallback: 'No topic yet' })}<dl><dt>For</dt><dd>${briefPreviewHTML(draft.brief.audience, { label: 'audience' })}</dd><dt>Outcome</dt><dd>${briefPreviewHTML(draft.brief.goal, { label: 'outcome' })}</dd><dt>Starting point</dt><dd>${briefPreviewHTML(draft.brief.starting_point, { label: 'starting point' })}</dd></dl>`)}
    ${summary('Experience', 'experience', `<p>${esc(FORMATS[draft.brief.experience]?.[0] || 'Choose a learning approach')} · ${esc(draft.brief.depth)}</p>${componentSummaryHTML(draft.components)}`)}
    ${summary('Context', 'context', `${briefPreviewHTML(draft.brief.context, { label: 'context', fallback: 'No extra constraints added.' })}<p>${counts.notes} ${counts.notes === 1 ? 'note' : 'notes'} · ${counts.links} ${counts.links === 1 ? 'link' : 'links'} · ${counts.files} ${counts.files === 1 ? 'file' : 'files'}</p>${counts.notes + counts.links + counts.files ? `<details class="setup-source-overview"><summary>Review source material</summary><ul class="setup-source-summary">${draft.sources.notes.filter(n => n.text.trim()).map(n => `<li><strong>Note · ${esc(briefTitle(n.title, 'Untitled note'))}</strong>${briefPreviewHTML(n.text, { label: 'note text' })}</li>`).join('')}${draft.sources.links.filter(l => l.url.trim()).map(l => `<li>Link${briefPreviewHTML(l.url, { label: 'link URL', preview: 160 })}</li>`).join('')}${draft.sources.files.map(f => `<li>File · ${esc(f.name)}</li>`).join('')}</ul></details>` : ''}`)}
    <p class="setup-create-context">${user ? `Signed in as <strong>${esc(user.email || 'your account')}</strong>. Your course will be saved to this account.` : 'You’ll sign in when you create your course so it can be saved to your account.'}</p>
    <p class="source-help">Next, check your AI connections and create your course. You’ll review the plan and research, then Learnable will create your lessons, learning tools and useful images together.</p>`;
}

export function createSetupController({ getOwner, navigate, store, getIdentity = getUser, defaultsClient = materialDefaults, accountClient = createSetupAccountClient(), sendLink = sendSetupSignInLink, createCourse = null, generationClient = createSetupGenerationClient(), openJob = async () => { throw new Error('Your creation progress is saved. Return to Your Courses to continue.'); } } = {}) {
  let host = null, session = null, events = null, editor = null, renderVersion = 0, focusIssue = null, busy = false;
  const sessions = createSetupSessions({ getOwner, store, notify: current => { if (session === current && active()) updateSave(); } });
  const handoffs = createSetupHandoffs();
  const account = createSetupSignIn({ sessions, handoffs, getUser: getIdentity, sendLink, navigate });
  const creation = createSetupCreation({ sessions, getUser: getIdentity, accountClient, client: generationClient, navigate, openJob });
  let focusCreate = false, defaultsPanel = null, startRequest = null, deleting = null;
  const active = () => !!host?.querySelector('[data-setup-root]') && session?.owner === (getOwner() || null);
  const beforeUnload = event => { if (sessions.hasUnsaved()) { event.preventDefault(); event.returnValue = ''; } };
  window.addEventListener('beforeunload', beforeUnload);
  function updateSave() {
    if (!active()) return;
    const conflict = ['conflict', 'expired', 'incompatible', 'deleted'].includes(session.error?.code);
    const status = host.querySelector('[data-setup-save]');
    status.textContent = session.error ? session.error.code === 'deleted' ? 'This draft was deleted in another tab. You can start a separate setup with these edits.' : conflict ? 'Another version was saved, or this draft expired. Your edits are still here.' : 'Not saved on this device. Keep this page open, retry, or download your text.'
      : '';
    status.setAttribute('aria-live', session.error ? 'polite' : 'off');
    host.querySelector('[data-setup-recovery]').hidden = !session.error;
    host.querySelector('[data-setup-action="retry"]').hidden = conflict;
    host.querySelector('[data-setup-action="fork"]').hidden = !conflict;
    host.querySelector('.setup-savebar').classList.toggle('setup-savebar--warning', !!session.error);
    host.querySelector('.setup-savebar').hidden = !session.error;
    const originals = host.querySelector('[data-original-notice]');
    if (originals) {
      originals.hidden = !session.draft.sources.files.some(file => !file.blob);
      if (originals.hidden) originals.querySelector('[data-original-retry-message]').textContent = '';
    }
    editor?.update();
  }
  function fileState(file) {
    if (!file.blob) return 'Reattach needed';
    return session.error ? 'Not saved — keep the original' : 'Attached';
  }
  function dispose() {
    deleting?.close(); deleting = null;
    if (session) void sessions.flush(session);
    events?.abort(); events = null; editor = null; host = null; session = null; renderVersion++;
    defaultsPanel = null;
    startRequest = null;
    account.dispose();
    creation.dispose();
  }
  async function deleteDraft(id) {
    if(deleting)return deleting.result;
    const owner=getOwner()||null;
    const dialog=confirmDraftDeletion({getOwner,
      prepare:async()=>{
        const snapshot=await sessions.deletionSnapshot(id);
        let remote=null;
        if(owner){try{remote=await accountClient.read(owner,id);}catch(error){if(error.code!=='missing')throw error;}}
        if(owner!==(getOwner()||null))throw new Error('Your account changed. Reopen the draft before deleting.');
        return {...snapshot,title:snapshot.title||remote?.payload?.brief?.topic||'Untitled course',accountRevision:remote?.revision||0};
      },
      remove:async snapshot=>{
        await sessions.remove(snapshot,()=>owner?accountClient.remove(owner,id,snapshot.accountRevision):Promise.resolve());
        handoffs.clear(id);account.forget(id);
      }
    });
    deleting=dialog;
    const removed=await dialog.result;if(deleting===dialog)deleting=null;
    if(removed){
      const notice=document.createElement('div');notice.className='draft-delete-toast';notice.setAttribute('role','status');
      document.body.append(notice);notice.textContent='Draft deleted. Your other courses are unchanged.';
      setTimeout(()=>notice.remove(),7000);
    }
    return removed;
  }
  async function render(container, id, requestedStep) {
    dispose(); host = container;
    if (typeof id !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(id)) {
      container.innerHTML = `<div class="home-experience home-empty"><h1>Setup unavailable</h1><p>This setup address is invalid. No saved data has been changed.</p><a class="home-button" href="${linkHome}">Back to Your Courses</a></div>`;
      return;
    }
    const signInRequested = requestedStep === 'account';
    const version = renderVersion, openingOwner = getOwner();
    container.innerHTML = '<div class="home-experience home-loading" role="status">Opening your saved setup…</div>';
    let result;
    try {
      result = await sessions.open(id);
      const owner = getOwner();
      // Only the exact setup selected at Create may follow an email sign-in.
      if (owner && result.status === 'missing' && handoffs.read(id)?.guest) {
        const selected = await sessions.selectedGuest(id);
        if (version !== renderVersion || owner !== getOwner()) return;
        if (selected.status === 'found') {
          try { result = { status: 'found', session: await sessions.claim(selected.session) }; }
          catch (error) {
            // The email callback and original tab may attach simultaneously.
            // Adopt only an already-committed record for this same account.
            if (version !== renderVersion || owner !== getOwner()) return;
            result = await sessions.open(id);
            if (result.status !== 'found') throw error;
          }
          handoffs.clear(id); account.forget(id);
        } else result = selected.status === 'missing' ? await sessions.open(id) : selected;
      }
      if (owner && ['missing', 'expired'].includes(result.status)) {
        const backup = await accountClient.restore(owner, id);
        if (version !== renderVersion || owner !== getOwner()) return;
        const restored = await sessions.restoreAccount(id, backup.draft, backup.cloud);
        if (restored) result = { status: 'found', session: restored };
      }
    } catch (error) { result = { status: error.code === 'missing' ? 'missing' : 'unavailable' }; }
    if (version !== renderVersion || openingOwner !== getOwner()) return;
    if (result.status !== 'found') {
      const detail = result.status === 'deleted' ? 'This draft was deleted. Your other courses are unchanged. Start a new setup from Your Courses.' : result.status === 'expired' ? 'This unfinished setup has expired. If you kept a copy of your text, you can use it to start again.' : result.status === 'unavailable' || result.status === 'unsaved-guest' ? 'We couldn’t recover this setup safely. Keep the original tab open and retry there. Your saved data has not been intentionally changed.' : result.status === 'incompatible' ? 'This setup needs a newer version of Learnable. It has not been changed.' : 'This setup may belong to another account or browser. Return to the browser where you started and use Create course to sign in again. Other guest setups are never imported automatically.';
      container.innerHTML = `<div class="home-experience"><a class="home-back" href="${linkHome}">← Your Courses</a><div class="home-empty"><h1>Setup unavailable</h1><p>${detail}</p><a class="home-button home-button--secondary" href="${esc(setupURL(id, requestedStep))}">Try again</a><a class="home-button home-button--secondary" href="${esc(accountSetupURL(id))}">Sign in or recover account setup</a><a class="home-button" href="${linkHome}">Back to Your Courses</a></div></div>`;
      if (signInRequested && !getIdentity()) account.show(container, id, null);
      return;
    }
    session = result.session;
    const materials = creationComponents(session.draft.components);
    if (JSON.stringify(materials) !== JSON.stringify(session.draft.components)) {
      session.draft.components = materials;
      sessions.edit(session);
    }
    if (requestedStep === 'create') {
      if (!getIdentity()) { navigate(accountSetupURL(id)); return; }
      creation.render(container, session); return;
    }
    const step = signInRequested ? 'review' : SETUP_STEPS.includes(requestedStep) ? requestedStep : session.draft.step;
    if (signInRequested && getIdentity()) history.replaceState(null, '', setupURL(id, 'review'));
    if (session.draft.step !== step) { session.draft.step = step; sessions.edit(session); }
    events = new AbortController();
    const signal = events.signal, draft = session.draft, stepIndex = SETUP_STEPS.indexOf(step);
    document.title = `${labels[step]} · Course setup | Learnable`;
    container.innerHTML = `<div class="home-experience course-setup" data-setup-root><div class="setup-topline"><a class="home-back" href="${linkHome}">← Your Courses</a><details class="home-menu"><summary>Draft options</summary><button type="button" data-setup-action="delete">Delete draft</button></details></div>
      <nav class="setup-steps" aria-label="Course setup steps">${SETUP_STEPS.map((value, index) => `<a href="${esc(setupURL(id, value))}" ${step === value ? 'aria-current="step"' : ''}><span aria-hidden="true">${index + 1}</span>${labels[value]}</a>`).join('')}</nav>
      <header class="setup-heading"><span class="home-eyebrow">Step ${stepIndex + 1} of 4 · ${labels[step]}</span><h1 tabindex="-1">${titles[step]}</h1><p>${descriptions[step]}</p></header>
      <div class="setup-savebar"><div class="home-draft-row"><span data-setup-save role="status" aria-live="off"></span>${action('download', 'Download setup')}</div><div class="setup-recovery" data-setup-recovery hidden>${action('retry', 'Retry saving')}${action('fork', 'Save as a separate setup')}<p>You can still edit and move between steps. Closing this tab may lose unsaved changes.</p></div>
        </div>
      <form class="setup-card" novalidate>${step === 'goal' ? goalHTML(draft) : step === 'experience' ? experienceHTML(draft) : step === 'context' ? contextHTML(draft) : reviewHTML({ ...draft, id }, getIdentity())}
      ${session.record?.cloud ? `<div class="home-notice home-notice--warning" data-original-notice ${draft.sources.files.some(file => !file.blob) ? '' : 'hidden'}><p>Some account originals couldn’t be downloaded. Their filenames are preserved. Reattach them or retry downloading from your account.</p>${action('restore-files', 'Retry account originals')}<p data-original-retry-message role="status"></p></div>` : ''}
      <footer class="setup-footer">${stepIndex ? `<a class="home-button home-button--secondary" href="${esc(setupURL(id, SETUP_STEPS[stepIndex - 1]))}">← Back</a>` : `<a class="home-draft-link" href="${linkHome}">Back to Your Courses</a>`}${step === 'review' ? action('create', 'Create course →', false) : `<button class="home-button" type="submit">${step === 'context' ? 'Review setup' : `Continue to ${labels[SETUP_STEPS[stepIndex + 1]]}`} →</button>`}</footer>${step === 'review' ? '<p class="setup-field-error" data-create-message role="status" tabindex="-1"></p>' : ''}</form></div>`;
    mountCourseImageInfo(host, { signal });
    if (step === 'goal') mountCourseDescription(host.querySelector('#setup-topic'), {
      counter: host.querySelector('#setup-topic-count'), error: host.querySelector('#setup-topic-error'), signal
    });
    const changed = () => sessions.edit(session);
    if (getIdentity()?.id === session.owner && ['experience', 'review'].includes(step)) {
      const anchor = step === 'experience' ? host.querySelector('.setup-component-grid').closest('fieldset') : host.querySelectorAll('.setup-review-section')[1];
      anchor.insertAdjacentHTML(step === 'experience' ? 'afterend' : 'beforeend', defaultsPanelHTML());
      const current = session;
      defaultsPanel = mountDefaultsPanel(host.querySelector('.setup-defaults'), {
        owner: current.owner, client: defaultsClient, signal, notice: current.materialsNotice, allowApply: step === 'experience',
        active: () => session === current && active(), getComponents: () => draft.components,
        apply(components) {
          draft.components = creationComponents(components); changed();
          for (const input of host.querySelectorAll('[data-component]')) input.checked = draft.components.includes(input.dataset.component);
        }
      });
    }
    if (step === 'context') editor = mountSourceEditor(host.querySelector('.setup-sources'), { draft, changed, fileState, signal, initialKind: session.sourceKind, onKind: kind => { session.sourceKind = kind; } });
    host.addEventListener('input', event => {
      if (!active()) return;
      const name = event.target.dataset.briefField, component = event.target.dataset.component;
      if (name) { draft.brief[name] = event.target.value; changed(); }
      if (component) {
        draft.components = creationComponents(event.target.checked ? [...draft.components, component] : draft.components.filter(value => value !== component));
        changed();
        defaultsPanel?.update();
      }
      if (name && !host.querySelector(`#setup-${name}-error`)?.dataset.descriptionIssue && event.target.getAttribute('aria-invalid') === 'true' && event.target.value.trim()) { event.target.removeAttribute('aria-invalid'); host.querySelector(`#setup-${name}-error`).textContent = ''; }
    }, { signal });
    host.addEventListener('submit', event => {
      if (!event.target.matches('.setup-card') || !active()) return;
      event.preventDefault();
      if (step === 'review') { host.querySelector('[data-setup-action="create"]').click(); return; }
      const issue = setupIssues(draft).find(issue => step === 'context' || issue.step === step);
      if (issue) { showIssue(issue); return; }
      navigate(setupURL(session.id, SETUP_STEPS[stepIndex + 1]));
    }, { signal });
    host.addEventListener('click', async event => {
      const name = event.target.closest('[data-setup-action]')?.dataset.setupAction;
      if (!name || !active()) return;
      if (name === 'download') {
        const url = URL.createObjectURL(new Blob([draftExport(draft)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'learnable-setup.json'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000); return;
      }
      if (name === 'fix') { showIssue(setupIssues(draft)[0] || componentSetupIssues(draft.components)[0]); return; }
      if (name === 'delete') {
        const current=session;if(busy)return;
        if(await deleteDraft(id) && session===current && active()) navigate(linkHome);
        return;
      }
      if (busy) return; busy = true;
      const current = session;
      try {
        if (name === 'restore-files') {
          const button = host.querySelector('[data-setup-action="restore-files"]'); button.disabled = true;
          const message = host.querySelector('[data-original-retry-message]'); message.textContent = 'Checking your account originals…';
          try {
            const backup = await accountClient.restore(current.owner, current.id);
            if (session !== current || !active()) return;
            if (backup.cloud.revision !== current.record.cloud.revision) throw new Error('This setup changed in your account. Your edits are still here; keep them before opening the other version.');
            let restored = 0;
            for (const file of draft.sources.files) {
              const original = backup.draft.sources.files.find(item => item.id === file.id && item.name === file.name && item.size === file.size);
              if (!file.blob && original?.blob) { file.blob = original.blob; restored++; }
            }
            if (!restored) throw new Error('The missing originals are still unavailable. Retry later or reattach your own copies.');
            sessions.edit(current); await sessions.flush(current);
            if (session === current && active()) navigate(setupURL(current.id, current.draft.step));
          } catch (error) { if (session === current && active()) { message.textContent = error.message; button.disabled = false; } }
        }
        if (name === 'create') {
          const issue = setupIssues(draft)[0] || componentSetupIssues(draft.components)[0];
          if (issue) showIssue(issue);
          else {
            const button = host.querySelector('[data-setup-action="create"]');
            const message = host.querySelector('[data-create-message]');
            button.disabled = true; message.textContent = '';
            try {
              if (!getIdentity()) { focusCreate = true; await account.begin(current); }
              else {
                if (!await sessions.flush(current)) return;
                if (!active() || current.owner !== getIdentity()?.id) return;
                if (createCourse) await createCourse({ id: current.id, ownerId: current.owner, draft: structuredClone(current.draft) });
                else creation.begin(current);
              }
            } catch (error) { if (session === current && active()) { message.textContent = error.message || 'Couldn’t start your course. Please try again.'; message.focus(); } }
            finally { button.disabled = false; }
          }
        }
        if (name === 'retry') await sessions.flush(current);
        if (name === 'fork') {
          const copy = await sessions.fork(current);
          if (copy && session === current && active()) navigate(setupURL(copy.id, copy.draft.step));
        }
      } finally { busy = false; }
    }, { signal });
    updateSave();
    window.scrollTo({ top: 0, behavior: 'instant' });
    host.querySelector('h1').focus({ preventScroll: true });
    if (focusCreate && step === 'review') { host.querySelector('[data-setup-action="create"]')?.focus(); focusCreate = false; }
    if (signInRequested && !getIdentity()) { focusCreate = true; account.show(container, id, session); }
    if (focusIssue) { const issue = focusIssue; focusIssue = null; showIssue(issue); }
  }
  function showIssue(issue) {
    if (!issue || !active()) return;
    if (issue.type) session.sourceKind = issue.type;
    if (session.draft.step !== issue.step || issue.type) { focusIssue = { ...issue, type: undefined }; navigate(setupURL(session.id, issue.step)); return; }
    if (issue.component) {
      host.querySelector(`[data-component="${issue.component}"]`)?.focus();
    } else if (issue.field) {
      const input = host.querySelector(`[data-brief-field="${issue.field}"]`);
      host.querySelector(`#setup-${issue.field}-error`).textContent = issue.text;
      input.setAttribute('aria-invalid', 'true'); input.focus();
    } else {
      const row = [...host.querySelectorAll('[data-source-id]')].find(row => row.dataset.sourceId === issue.source);
      const control = row?.querySelector('textarea') || row?.querySelector('input:not([type="file"])') || row?.querySelector('button') || host.querySelector('h1');
      // Rendering resets the step's scroll. Reveal the feedback as well as its
      // input; native focus scrolling alone can leave the error below the fold.
      control?.focus({ preventScroll: true });
      (row || control)?.scrollIntoView({ block: 'center', behavior: 'instant' });
    }
  }
  return {
    render, dispose, deleteDraft, async list() {
      const owner = getOwner(), local = await sessions.list();
      if (!owner) return local;
      try {
        const remote = await accountClient.list(owner);
        if (owner !== getOwner()) return { drafts: [] };
        const drafts = await mergeUnfinishedSetups(local.drafts, remote.drafts);
        if (owner !== getOwner()) return { drafts: [] };
        return { ...local, drafts, limit: remote.limit };
      } catch { return { ...local, accountError: true }; }
    },
    async start(brief = {}) {
      if (busy || startRequest) return;
      const version = renderVersion, owner = getOwner() || null;
      const request = {}; startRequest = request;
      try {
        let components = Array.isArray(brief.components) ? [...brief.components] : undefined, materialsNotice = '';
        if (owner && !components) {
          try { components = (await defaultsClient.load(owner)).components; }
          catch { materialsNotice = 'This setup started with standard materials because your account defaults couldn’t be loaded. Your account defaults have not been changed.'; }
        }
        if (version !== renderVersion || owner !== (getOwner() || null)) return;
        const current = await sessions.start(brief, { components, materialsNotice });
        if (version === renderVersion && current.owner === (getOwner() || null)) navigate(setupURL(current.id));
      }
      finally { if (startRequest === request) startRequest = null; }
    }
  };
}
