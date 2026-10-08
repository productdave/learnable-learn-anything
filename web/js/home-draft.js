import { createDraftStore, draftExport } from './draft-store.js?v=5';

const draftStore = createDraftStore();
const SETUP_HINT = 'Next: choose your learning experience and add optional sources.';
export function homeDraftHTML() {
  return `<div class="home-draft">
    <div class="home-draft-row"><span data-draft-status role="status" aria-live="off">${SETUP_HINT}</span></div>
    <div class="home-draft-recovery" data-draft-recovery hidden>
      <button type="button" class="home-button home-button--secondary" data-draft-retry>Try again</button>
      <button type="button" class="home-button home-button--secondary" data-draft-fork hidden>Keep both ideas</button>
      <button type="button" class="home-button home-button--secondary" data-draft-continue>Continue setup</button>
      <button type="button" class="home-draft-link" data-draft-download>Download a copy</button>
      <p>Continue setup or download your text before closing this page.</p>
    </div>
    <details class="home-draft-details" hidden><summary>Recover earlier text</summary>
      <p>These unfinished ideas are available in this browser. They are not created courses.</p>
      <div data-draft-history></div>
      <button type="button" class="home-draft-link" data-draft-remove hidden>Remove this earlier text</button>
      <div data-draft-confirm hidden><p>Remove this idea from this browser? No course or other idea will be deleted.</p>
        <button type="button" class="home-button home-button--secondary" data-draft-confirm-remove>Remove idea</button>
        <button type="button" class="home-button home-button--secondary" data-draft-keep>Keep idea</button></div>
    </details>
  </div>`;
}

// Independent of library paints. Late loads/saves cannot replace typed text or
// populate the next account's Home. The optional store supports failure tests.
export function mountHomeDraft(form, { getOwner, store = draftStore, continueUnsaved = () => {}, onValueChange = () => {} } = {}) {
  const owner = getOwner() || null;
  const input = form.querySelector('#home-outcome');
  const host = form.querySelector('.home-draft');
  const status = host.querySelector('[data-draft-status]');
  const recovery = host.querySelector('[data-draft-recovery]');
  const details = host.querySelector('.home-draft-details');
  const fork = host.querySelector('[data-draft-fork]');
  const retry = host.querySelector('[data-draft-retry]');
  const events = new AbortController();
  const options = { signal: events.signal };
  let record = null, history = [], loaded = false, conflict = false, disposed = false;
  let savedText = null, edited = false, pending = null, actionBusy = false;
  const sameOwner = () => (getOwner() || null) === owner;
  const active = () => !disposed && sameOwner();
  const content = value => ({ step: 'home', brief: { topic: value }, sources: { notes: [], links: [], files: [] } });
  const newId = () => `idea-${crypto.randomUUID()}`;

  function message(value, problem = false) {
    if (!active()) return;
    status.setAttribute('aria-live', problem ? 'polite' : 'off');
    status.textContent = value;
    host.classList.toggle('home-draft--warning', problem);
    const focused = document.activeElement;
    if (!problem && focused && (recovery.contains(focused) || details.contains(focused))) input.focus();
    recovery.hidden = !problem;
    details.hidden = !problem || !history.length;
    if (!problem) details.open = false;
    fork.hidden = !conflict;
    retry.hidden = conflict;
  }
  function savedMessage(restored = false) {
    message(restored ? 'Your unfinished idea is here. Continue setup or edit it.' : SETUP_HINT);
  }
  function updateHistory() {
    if (!active()) return;
    const list = host.querySelector('[data-draft-history]');
    list.replaceChildren();
    for (const item of history) {
      if (item.id === record?.id || !item.brief.topic.trim()) continue;
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'home-draft-history-item';
      button.dataset.restoreIdea = item.id;
      button.textContent = `Restore: ${Array.from(item.brief.topic).slice(0, 80).join('')}${Array.from(item.brief.topic).length > 80 ? '…' : ''}`;
      list.append(button);
    }
    host.querySelector('[data-draft-remove]').hidden = !record;
    details.hidden = !host.classList.contains('home-draft--warning') || !history.length;
  }
  function failure(error) {
    conflict = ['conflict', 'expired', 'incompatible'].includes(error?.code);
    message(conflict ? 'Your earlier idea changed or expired. Your current text is still here. Keep both ideas or continue setup.'
      : 'We couldn’t preserve your latest text for later. It is still here.', true);
  }

  async function load() {
    try {
      const result = await store.list(owner);
      if (!sameOwner()) return false;
      history = result.drafts.filter(draft => draft.step === 'home');
      record = history[0] || null; loaded = true;
      if (record) {
        savedText = record.brief.topic;
        if (!edited && !input.value) { input.value = savedText; onValueChange(); savedMessage(true); }
        else if (input.value === savedText) savedMessage();
        else {
          conflict = true;
          message('An earlier idea is available. Your current text is unchanged. Keep both ideas or continue setup.', true);
        }
      } else {
        savedText = '';
        message(result.expiredCount ? 'An earlier unfinished idea has expired. Enter a new idea to continue.'
          : result.incompatibleCount ? 'Some unfinished ideas need a newer version of Learnable. They have not been changed.'
            : SETUP_HINT, !!result.incompatibleCount);
      }
      updateHistory(); return true;
    } catch (error) { failure(error); return false; }
  }
  const ready = load();

  async function flush() {
    await ready;
    if (!sameOwner() || !loaded || conflict) return false;
    if (pending) return pending;
    pending = (async () => {
      while (sameOwner() && input.value !== savedText) {
        const value = input.value;
        if (!record && !value) { savedText = ''; break; }
        message(SETUP_HINT);
        try {
          const next = await store.save({ id: record?.id || newId(), ...content(value) }, { ownerId: owner, expectedRevision: record?.revision || 0 });
          record = next; savedText = value;
          history = [next, ...history.filter(item => item.id !== next.id)];
          if (input.value === value) { savedMessage(); updateHistory(); }
        } catch (error) { failure(error); return false; }
      }
      return true;
    })().finally(() => { pending = null; });
    return pending;
  }

  async function saveSeparate() {
    if (!active()) return false;
    if (pending) await pending;
    if (!active()) return false;
    const value = input.value;
    try {
      const next = await store.save({ id: newId(), ...content(value) }, { ownerId: owner });
      if (!active()) return false;
      record = next; savedText = value; conflict = false; loaded = true;
      history = [next, ...history];
      try { history = (await store.list(owner)).drafts.filter(draft => draft.step === 'home'); } catch { /* The new idea is already committed. Keep known history if listing fails. */ }
      if (!active()) return false;
      savedMessage(); updateHistory();
      if (input.value !== value) return flush();
      return true;
    } catch (error) { failure(error); return false; }
  }

  input.addEventListener('input', () => { edited = true; void flush(); }, options);
  form.addEventListener('click', async event => {
    const button = event.target.closest('button');
    if (!button || !host.contains(button) || !active()) return;
    if (button.matches('[data-draft-download]')) {
      // Snapshot the current text, not a possibly stale last-successful save.
      const blob = new Blob([draftExport(content(input.value))], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'learnable-idea.json'; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
      return;
    }
    if (actionBusy) return;
    actionBusy = true;
    try {
    if (button.matches('[data-draft-continue]')) continueUnsaved(input.value);
    if (button.matches('[data-draft-retry]')) {
      if (!loaded) await load();
      await flush();
    }
    if (button.matches('[data-draft-fork]')) {
      button.disabled = true; await saveSeparate(); button.disabled = false;
    }
    if (button.dataset.restoreIdea) {
      if (input.value !== savedText && !(await saveSeparate())) return;
      try {
        const result = await store.load(button.dataset.restoreIdea, owner);
        if (!active()) return;
        if (result.status !== 'found') { failure({ code: result.status }); return; }
        record = result.draft; savedText = record.brief.topic; input.value = savedText; onValueChange(); conflict = false;
        savedMessage(true); updateHistory(); input.focus();
      } catch (error) { failure(error); }
    }
    const confirm = host.querySelector('[data-draft-confirm]');
    if (button.matches('[data-draft-remove]')) { confirm.hidden = false; host.querySelector('[data-draft-confirm-remove]').focus(); }
    if (button.matches('[data-draft-keep]')) { confirm.hidden = true; host.querySelector('[data-draft-remove]').focus(); }
    if (button.matches('[data-draft-confirm-remove]') && record) {
      // Flush edits first, then delete only the exact record/revision confirmed.
      if (!(await flush()) || !active()) return;
      const deleting = record;
      const deletingText = input.value;
      button.disabled = true;
      input.readOnly = true;
      try {
        await store.remove(deleting.id, { ownerId: owner, expectedRevision: deleting.revision });
        if (!active()) return;
        history = history.filter(item => item.id !== deleting.id);
        record = null; savedText = ''; conflict = false;
        if (input.value === deletingText) { input.value = ''; onValueChange(); }
        confirm.hidden = true; message('Earlier text removed from this browser. No course was deleted.');
        updateHistory(); input.focus();
        if (input.value) void flush();
      } catch (error) { failure(error); }
      finally { button.disabled = false; input.readOnly = false; }
    }
    } finally { actionBusy = false; }
  }, options);
  return {
    ready, flush,
    dispose() { void flush(); disposed = true; events.abort(); }
  };
}
