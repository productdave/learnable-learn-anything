import { sourceEditorHTML, mountSourceEditor } from './source-editor.js?v=9';
import { renderSetupSourceReview } from './setup-source-review.js?v=5';
import { createReviewSourceClient } from './review-source-client.js?v=12';
import { escapeHome as esc } from './home-model.js?v=7';
import { getUser } from './auth.js?v=33';

export function mountReviewSourceEditor(host, { jobId, feedback = '', onBack, onStarted, client = createReviewSourceClient(), owner = getUser()?.id } = {}) {
  const controller = new AbortController();
  host.setAttribute('aria-label', 'Adjust sources');
  controller.signal.addEventListener('abort', () => host.removeAttribute('aria-label'), { once: true });
  let state, checked = null, busy = false, submitting = false, dirty = false;
  host.innerHTML = `<div class="review-source-workspace"><h2 tabindex="-1" data-source-review-title>Adjust your sources</h2><p class="review-source-impact">Your course plan stays the same. We’ll recheck research for every module, then ask you to review it before writing lessons. Rechecking uses your connected AI provider and may incur charges.</p><p data-editor-status role="status">Loading your current sources…</p><div data-editor-body></div><div data-editor-error role="alert"></div><div class="intake-actions"><button type="button" class="intake-cancel" data-editor-back>Back to research review</button><button type="button" class="intake-submit" data-editor-check hidden>Check source changes</button><button type="button" class="intake-submit" data-editor-apply hidden>Use sources and recheck research</button></div></div>`;
  host.querySelector('[data-source-review-title]').focus();
  const status = host.querySelector('[data-editor-status]'), error = host.querySelector('[data-editor-error]');
  const check = host.querySelector('[data-editor-check]'), apply = host.querySelector('[data-editor-apply]'), back = host.querySelector('[data-editor-back]');
  function setBusy(value, text = '') {
    busy = value; status.textContent = text;
    const fieldset = host.querySelector('fieldset'); if (fieldset) fieldset.disabled = value;
    check.disabled = value; apply.disabled = value || (checked?.sources.requiresReview && !host.querySelector('[data-source-reviewed]')?.checked);
    back.disabled = submitting;
  }
  function invalidate() {
    dirty = true; checked = null; check.hidden = false; apply.hidden = true;
    host.querySelector('[data-editor-preview]').innerHTML = '';
    error.textContent = ''; status.textContent = 'Changes are not applied yet. Check them when you’re ready.';
  }
  function leave() {
    if (submitting) return;
    if (dirty && !confirm('Discard these source edits? Your accepted sources and research will stay unchanged. Files already uploaded remain private in your account.')) return;
    controller.abort(); onBack();
  }
  back.addEventListener('click', leave, { signal: controller.signal });
  window.addEventListener('beforeunload', event => {
    if (dirty || submitting) { event.preventDefault(); event.returnValue = ''; }
  }, { signal: controller.signal });
  host.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); leave(); return; }
    if (event.key !== 'Tab') return;
    if (host.classList.contains('intake-card--inline')) return; // A page section must not trap keyboard focus.
    const controls = [...host.querySelectorAll('button, input, textarea, select, summary, [tabindex="0"]')].filter(el => !el.disabled && el.offsetParent !== null);
    const target = event.shiftKey && document.activeElement === controls[0] ? controls.at(-1) : !event.shiftKey && document.activeElement === controls.at(-1) ? controls[0] : null;
    if (target) { event.preventDefault(); target.focus(); }
  }, { signal: controller.signal });
  check.addEventListener('click', async () => {
    if (busy || !state) return;
    error.textContent = ''; setBusy(true, 'Checking sources and reading files. No AI work has started.');
    try {
      const result = await client.check(owner, jobId, state, state.draft);
      if (controller.signal.aborted) return;
      checked = result;
      const preview = host.querySelector('[data-editor-preview]');
      preview.innerHTML = renderSetupSourceReview(result.sources, { context: 'review' });
      if (result.issues.length) {
        error.textContent = result.issues.map(item => item.text).join(' '); setBusy(false, 'Some sources need attention. Your accepted research is unchanged.');
      } else {
        check.hidden = true; apply.hidden = false;
        setBusy(false, 'Source changes checked. Confirm below to use them and recheck research.');
        preview.querySelector('[data-source-reviewed]')?.addEventListener('change', () => setBusy(false, status.textContent), { signal: controller.signal });
        (preview.querySelector('[data-source-reviewed]') || apply).focus();
      }
    } catch (cause) { if (!controller.signal.aborted) { error.textContent = cause.message; setBusy(false, 'Your edits are still here.'); } }
  }, { signal: controller.signal });
  apply.addEventListener('click', async () => {
    if (busy || !checked || apply.disabled) return;
    submitting = true; error.textContent = ''; setBusy(true, 'Applying your sources and starting the research recheck…');
    try {
      await client.apply(owner, jobId, checked.changes, feedback);
      if (controller.signal.aborted) return;
      dirty = false; controller.abort(); await onStarted();
    } catch (cause) { if (!controller.signal.aborted) { submitting = false; error.textContent = cause.message; setBusy(false, 'Return to the latest review if this request was already accepted.'); } }
  }, { signal: controller.signal });
  client.read(owner, jobId).then(result => {
    if (controller.signal.aborted) return;
    state = result;
    host.querySelector('[data-editor-body]').innerHTML = `<fieldset class="review-source-fields setup-card">${sourceEditorHTML({ context: 'review' })}</fieldset>${result.legacyFiles.length ? `<p class="source-help">Original PDFs kept with this course: ${result.legacyFiles.map(file => esc(file.name)).join(', ')}.</p>` : ''}<div data-editor-preview></div>`;
    mountSourceEditor(host.querySelector('.setup-sources'), { draft: state.draft, changed: invalidate, fileState: file => file.blob ? 'Original available' : 'Original unavailable — reattach', signal: controller.signal, context: 'review' });
    status.textContent = 'Accepted sources loaded. Changes take effect only when you confirm a research recheck.';
    check.hidden = false;
  }).catch(cause => { if (!controller.signal.aborted) { error.textContent = cause.message; status.textContent = 'Your accepted sources are unchanged. Return to review and try again.'; } });
  return { owner, close: leave, destroy: () => controller.abort() };
}
