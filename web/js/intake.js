// Intake modal — "What do you want to learn?"
// Opens from the library's "+ Generate" button (or by clicking a running job
// card on the dashboard, to attach to that job's progress). Generation runs as
// a cloud job persisted in Supabase, with localStorage mirroring the row so the
// dashboard can show progress immediately.

import {
  hasApiKey,
  setApiKey
} from './generator/index.js?v=4';
import { flushSync, kickSync, pullSyncNow } from './sync.js?v=27';
import { createJob, updateJob, getJob, onJobsChange, removeJob } from './jobs.js?v=5';
import { cloudGenAvailable, requireCloudBackendReady, startCloudGeneration, cancelCloudGeneration, resumeCloudGeneration, restartOrStartCloudGeneration, restartCloudGenerationWithSources, reattachCloudGeneration, submitCloudReview, deleteCloudGeneration, hasSavedRequestRestartIntent, reviewPendingForAction, generationActionSnapshot } from './cloud-gen-client.js?v=92';
import { pdfToBase64, extractPdfPageThumbs, dataUrlsBytes } from './pdf-extract.js?v=1';
import { COURSE_AGENT_SEQUENCE, agentMessage, agentNameForStage } from './generator/agents.mjs?v=2';
import { getUser, onUserChange, openAccount } from './auth.js?v=33';
import { courseCanSyncToAccount } from './course-sync.js?v=31';
import { invalidateCourseCache } from './course-loader.js?v=8';
import { getUserCourse, removeUserCourse } from './user-courses.js?v=4';
import { mountReviewSourceEditor } from './review-source-editor.js?v=14';
import { researchEvidence, researchEvidenceHTML, reviewIdentity, captureReviewState, restoreReviewState } from './research-evidence.js?v=6';
import { createCourseImageClient } from './course-image-client.js?v=5';
import { briefTitle } from './brief-presentation.js?v=1';

let modal = null;
let inlineCard = null;
let inlineOwner = null;
let inlineEvents = null;
const surfaceCard = () => inlineCard || modal?.querySelector('.intake-card');
let activeSourceEditor = null;
let unsubJob = null;        // currently-rendered job's listener
let renderedJobId = null;
let reuseJobIdForSubmit = null;
let reuseExpectation = null;
const PENDING_COURSE_CREATION_KEY = 'learnable-pending-course-creation';
const PENDING_COURSE_CREATION_TTL_MS = 6 * 60 * 60 * 1000;

// PDF upload state — files the user has picked for the *current* draft.
// Reset every time renderForm() runs. Kept module-scope (not in FormData)
// because File objects don't serialize cleanly and we do the base64 +
// page-thumb extraction asynchronously after pick.
const PDF_MAX_COUNT = 5;
const PDF_MAX_BYTES = 10 * 1024 * 1024;          // 10MB per file
const PDF_THUMB_BUDGET_TOTAL = 3 * 1024 * 1024;  // 3MB total of page-thumb data URLs
let pickedPdfs = [];  // [{ id, name, sizeBytes, status, base64?, pageThumbs?, warning? }]

function ensureModal() {
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'intake-modal';
  modal.className = 'intake-modal';
  modal.style.display = 'none';
  modal.innerHTML = `<div class="intake-card" role="dialog" aria-modal="true"></div>`;
  // No backdrop-click / ESC close. Only X / Cancel.
  document.body.appendChild(modal);
  return modal;
}

function close() {
  activeSourceEditor?.destroy(); activeSourceEditor = null;
  if (unsubJob) { unsubJob(); unsubJob = null; }
  stopElapsedTimer();
  renderedJobId = null;
  reuseJobIdForSubmit = null;
  reuseExpectation = null;
  inlineEvents?.abort(); inlineEvents = null;
  if (inlineCard) inlineCard.replaceChildren();
  inlineCard = null; inlineOwner = null;
  if (modal) modal.style.display = 'none';
}

/** The workspace hosts the same renderer and actions as the legacy dialog. */
export function mountIntakeForJob(card, jobId) {
  close();
  inlineCard = card;
  inlineOwner = getUser()?.id || '';
  card.classList.add('intake-card', 'intake-card--inline');
  inlineEvents = new AbortController();
  const signal = inlineEvents.signal;
  const offlineGuard = event => {
    if (navigator.onLine !== false) return;
    const action = event.target.closest('button');
    if (event.type === 'submit' || action?.matches('[data-review-continue], [data-review-regenerate], [data-resume], [data-retry], [data-restart], [data-cancel], [data-delete], [data-editor-check], [data-editor-apply]')) {
      event.preventDefault(); event.stopImmediatePropagation();
    }
  };
  card.addEventListener('click', offlineGuard, { signal, capture: true });
  card.addEventListener('submit', offlineGuard, { signal, capture: true });
  window.addEventListener('offline', () => syncInlineConnection(card), { signal });
  window.addEventListener('online', () => syncInlineConnection(card), { signal });
  renderProgress(jobId);
  return { dispose() { if (inlineCard === card) close(); } };
}

function syncInlineConnection(card) {
  if (card !== inlineCard) return;
  if (!activeSourceEditor) card.setAttribute('aria-label', 'Course creation progress and review');
  updateGenerationActivity(card, getJob(renderedJobId));
  card.querySelectorAll('[data-review-continue], [data-review-regenerate], [data-resume], [data-retry], [data-restart], [data-cancel], [data-delete]').forEach(control => {
    if (navigator.onLine === false && !control.disabled) {
      control.dataset.offlineDisabled = 'true'; control.disabled = true;
    } else if (navigator.onLine !== false && control.dataset.offlineDisabled) {
      control.disabled = false; delete control.dataset.offlineDisabled;
    }
  });
}

function draftForPendingAuth(draft = {}) {
  return {
    topic: draft.topic || '',
    source_text: draft.source_text || '',
    source_urls: Array.isArray(draft.source_urls) ? draft.source_urls : (draft.source_urls || ''),
    goal: draft.goal || '',
    starting_point: draft.starting_point || '',
    depth: draft.depth || 'Solid foundation',
    experience: draft.experience || 'standard'
  };
}

function formDraft(form) {
  if (!form) return {};
  const fd = new FormData(form);
  return {
    topic: (fd.get('topic') || '').trim(),
    source_text: (fd.get('source_text') || '').trim(),
    source_urls: (fd.get('source_urls') || '').trim(),
    goal: (fd.get('goal') || '').trim(),
    starting_point: (fd.get('starting_point') || '').trim(),
    depth: fd.get('depth') || 'Solid foundation',
    experience: fd.get('experience') || 'standard'
  };
}

function savePendingCourseCreation(draft = {}, options = {}) {
  const payload = JSON.stringify({
    draft: draftForPendingAuth(draft),
    options: { reuseJobId: options.reuseJobId || null },
    savedAt: Date.now()
  });
  let stored = false;
  try { localStorage.setItem(PENDING_COURSE_CREATION_KEY, payload); stored = true; } catch {}
  if (!stored) {
    try { sessionStorage.setItem(PENDING_COURSE_CREATION_KEY, payload); } catch {}
  }
}

function readPendingCourseCreation() {
  try {
    const raw = readPendingCourseCreationRaw();
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed?.savedAt || Date.now() - parsed.savedAt > PENDING_COURSE_CREATION_TTL_MS) {
      clearPendingCourseCreation();
      return null;
    }
    return parsed;
  } catch {
    clearPendingCourseCreation();
    return null;
  }
}

function readPendingCourseCreationRaw() {
  let raw = null;
  try { raw = localStorage.getItem(PENDING_COURSE_CREATION_KEY); } catch {}
  if (raw) return raw;
  try { raw = sessionStorage.getItem(PENDING_COURSE_CREATION_KEY); } catch {}
  return raw;
}

function clearPendingCourseCreation() {
  try { localStorage.removeItem(PENDING_COURSE_CREATION_KEY); } catch {}
  try { sessionStorage.removeItem(PENDING_COURSE_CREATION_KEY); } catch {}
}

function hideAccountModal() {
  const authModal = document.getElementById('auth-modal');
  if (authModal) authModal.style.display = 'none';
}

function requireSignedInForCourseCreation(draft = {}, options = {}) {
  if (getUser()) return true;
  savePendingCourseCreation(draft, options);
  openAccount({ intent: 'course-generation' });
  return false;
}

/** Open the form to start a new generation. */
export function openIntake() {
  if (!requireSignedInForCourseCreation()) return;
  close();
  ensureModal();
  modal.style.display = '';
  renderForm();
}

/** Open the generation form with fields already filled by the agent home. */
export function openIntakeWithDraft(draft = {}, options = {}) {
  if (!requireSignedInForCourseCreation(draft, options)) return;
  close();
  ensureModal();
  modal.style.display = '';
  renderForm(draft, options);
}

/** Open the progress view for an already-running (or interrupted) job. */
export function openIntakeForJob(jobId) {
  if (document.body.dataset.experience === 'workspace') {
    if (inlineCard && renderedJobId === jobId) return;
    close();
    history.pushState(null, '', `?workspace=${encodeURIComponent(jobId)}`);
    window.dispatchEvent(new PopStateEvent('popstate'));
    return;
  }
  close();
  ensureModal();
  modal.style.display = '';
  renderProgress(jobId);
}

// ---- form ---------------------------------------------------------

function renderForm(draft = {}, options = {}) {
  stopElapsedTimer();
  if (unsubJob) { unsubJob(); unsubJob = null; }
  renderedJobId = null;
  reuseJobIdForSubmit = options.reuseJobId || null;
  reuseExpectation = options.expected || (reuseJobIdForSubmit ? generationActionSnapshot(getJob(reuseJobIdForSubmit)) : null);
  pickedPdfs = [];  // fresh draft = fresh file list
  surfaceCard().innerHTML = `
    ${inlineCard ? '<button type="button" class="intake-cancel" data-back-progress>← Back to progress</button>' : `<button class="intake-close" type="button" aria-label="Close">
      <svg width="18" height="18"><use href="#icon-x"/></svg>
    </button>`}
    <h2 class="intake-title">What do you want to learn?</h2>
    <p class="intake-sub">A topic, question, or skill. Or paste your own source material below.</p>

    <form class="intake-form">
      <label class="intake-label">
        <span class="intake-label-text">Topic or question</span>
        <textarea class="intake-input intake-textarea" name="topic" rows="3"
          placeholder="e.g. How to make pour-over coffee at home"></textarea>
      </label>

      <details class="intake-section" open>
        <summary>Add source material <span class="intake-summary-hint">(optional — PDFs, text, or URLs)</span></summary>
        <p class="intake-help">Drop in your own notes, slide decks, or articles and the generator will blend them with broader web research. URLs get fetched and used as primary sources.</p>

        <div class="intake-label">
          <span class="intake-label-text">PDF files</span>
          <div class="intake-dropzone" data-dropzone>
            <input class="intake-file-input" type="file" accept="application/pdf" multiple data-file-input>
            <div class="intake-dropzone-prompt">
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              <span class="intake-dropzone-label">Drop PDFs here or <span class="intake-dropzone-link">click to choose</span></span>
              <span class="intake-dropzone-hint">Up to ${PDF_MAX_COUNT} files · 10MB each · pages embed as diagrams in the course</span>
            </div>
          </div>
          <div class="intake-file-list" data-file-list></div>
        </div>

        <label class="intake-label">
          <span class="intake-label-text">Pasted text / notes</span>
          <textarea class="intake-input intake-textarea" name="source_text" rows="5"
            placeholder="Paste the article, transcript, or notes you want to learn from."></textarea>
        </label>
        <label class="intake-label">
          <span class="intake-label-text">Source URLs (one per line)</span>
          <textarea class="intake-input intake-textarea intake-mono" name="source_urls" rows="3"
            placeholder="https://example.com/article\nhttps://another.com/post"></textarea>
        </label>
      </details>

      <details class="intake-section">
        <summary>Tune it for you <span class="intake-summary-hint">(optional)</span></summary>
        <label class="intake-label">
          <span class="intake-label-text">Your goal</span>
          <input class="intake-input" type="text" name="goal"
            placeholder="e.g. Brew café-quality coffee for friends">
        </label>
        <label class="intake-label">
          <span class="intake-label-text">Where you're starting from</span>
          <input class="intake-input" type="text" name="starting_point"
            placeholder="e.g. Beginner — just bought a V60">
        </label>
        <label class="intake-label">
          <span class="intake-label-text">How deep do you want to go?</span>
          <select class="intake-input" name="depth">
            <option value="Quick overview">Quick overview (1 module, ~5 topics)</option>
            <option value="Solid foundation" selected>Solid foundation (3 modules, ~12 topics)</option>
            <option value="Deep dive">Deep dive (full course, 6 modules)</option>
          </select>
        </label>
        <label class="intake-label">
          <span class="intake-label-text">Course experience</span>
          <select class="intake-input" name="experience">
            <option value="standard" selected>Standard — lessons, quizzes, flashcards</option>
            <option value="hands_on_interactive">Hands-on interactive — visuals, practice checklists, readiness tracking & quizzes</option>
          </select>
          <small class="intake-help">Best for physical skills, procedures, coaching, and anything learned by doing. Visuals come from supplied or researched sources when available.</small>
        </label>
      </details>

      ${hasApiKey() ? '' : `
        <label class="intake-label intake-key-row">
          <span class="intake-label-text">Anthropic API key</span>
          <input class="intake-input intake-mono" type="password" name="apiKey"
            placeholder="sk-ant-..." autocomplete="off" spellcheck="false">
          <small class="intake-help">Saved to your account so cloud agents can keep running when this browser is closed. <a href="https://console.anthropic.com/" target="_blank" rel="noopener">Get one</a> — roughly $1–3 of credit per course.</small>
        </label>
      `}

      <div class="intake-runmode" data-runmode>
        <!-- Filled in by renderRunMode() once we know whether the user is signed in -->
      </div>

      <div class="intake-actions">
        <button type="button" class="intake-cancel">Cancel</button>
        <button type="submit" class="intake-submit">Start with Curriculum Designer</button>
      </div>
      <div class="intake-error" data-error style="display:none"></div>
    </form>
  `;
  const card = surfaceCard();
  const form = card.querySelector('.intake-form');
  if (form) {
    form.elements.topic.value = draft.topic || '';
    form.elements.source_text.value = draft.source_text || '';
    form.elements.source_urls.value = Array.isArray(draft.source_urls)
      ? draft.source_urls.join('\n')
      : (draft.source_urls || '');
    form.elements.goal.value = draft.goal || '';
    form.elements.starting_point.value = draft.starting_point || '';
    form.elements.depth.value = draft.depth || 'Solid foundation';
    form.elements.experience.value = draft.experience || 'standard';
  }
  const back = () => inlineCard && reuseJobIdForSubmit ? renderProgress(reuseJobIdForSubmit) : close();
  card.querySelector('.intake-close')?.addEventListener('click', close);
  card.querySelector('[data-back-progress]')?.addEventListener('click', back);
  card.querySelector('.intake-actions .intake-cancel').addEventListener('click', back);
  card.querySelector('.intake-form').addEventListener('submit', onSubmit);
  wireDropzone(card);
  renderRunMode(card);
}

/** Shows that the next generation will run in the account-owned cloud pipeline. */
function renderRunMode(card) {
  const host = card.querySelector('[data-runmode]');
  if (!host) return;
  host.innerHTML = `
    <div class="intake-runmode-pill intake-runmode-pill--cloud">
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>
      Signed-in human review workflow · saves to your account when complete
    </div>`;
}

// ---- PDF dropzone --------------------------------------------------

function wireDropzone(card) {
  const dz = card.querySelector('[data-dropzone]');
  const input = card.querySelector('[data-file-input]');
  if (!dz || !input) return;

  // Click anywhere on the dropzone opens the picker (except on the input
  // itself, which already triggers natively).
  dz.addEventListener('click', (e) => {
    if (e.target === input) return;
    input.click();
  });

  input.addEventListener('change', () => {
    if (input.files && input.files.length) ingestFiles(card, Array.from(input.files));
    input.value = ''; // allow re-picking the same file later
  });

  ['dragenter', 'dragover'].forEach(ev =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('is-dragging'); }));
  ['dragleave', 'drop'].forEach(ev =>
    dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('is-dragging'); }));
  dz.addEventListener('drop', (e) => {
    const files = Array.from(e.dataTransfer?.files || []).filter(f => f.type === 'application/pdf' || /\.pdf$/i.test(f.name));
    if (files.length) ingestFiles(card, files);
  });
}

async function ingestFiles(card, files) {
  const errEl = card.querySelector('[data-error]');
  function showErr(msg) {
    if (!errEl) return;
    errEl.style.display = '';
    errEl.textContent = msg;
  }
  function clearErr() {
    if (errEl) { errEl.style.display = 'none'; errEl.textContent = ''; }
  }
  clearErr();

  for (const file of files) {
    if (pickedPdfs.length >= PDF_MAX_COUNT) {
      showErr(`Up to ${PDF_MAX_COUNT} PDFs per course. Remove one to add more.`);
      break;
    }
    if (file.size > PDF_MAX_BYTES) {
      showErr(`"${file.name}" is ${(file.size / 1_000_000).toFixed(1)}MB — over the 10MB limit.`);
      continue;
    }
    const entry = {
      id: 'pdf_' + Math.random().toString(36).slice(2, 9),
      name: file.name,
      sizeBytes: file.size,
      status: 'processing'
    };
    pickedPdfs.push(entry);
    renderFileList(card);
    try {
      // Per-file thumb byte budget is the remaining total budget.
      const usedThumbBytes = pickedPdfs.reduce((n, p) => n + dataUrlsBytes(p.pageThumbs || []), 0);
      const remaining = Math.max(200_000, PDF_THUMB_BUDGET_TOTAL - usedThumbBytes);
      const [base64, thumbResult] = await Promise.all([
        pdfToBase64(file),
        extractPdfPageThumbs(file, { perFileBytes: remaining })
      ]);
      entry.base64 = base64;
      entry.pageThumbs = thumbResult.pageThumbs;
      entry.warning = thumbResult.warning;
      entry.status = 'ready';
    } catch (err) {
      entry.status = 'error';
      entry.error = err.message || String(err);
    }
    renderFileList(card);
  }
}

function renderFileList(card) {
  const list = card.querySelector('[data-file-list]');
  if (!list) return;
  if (!pickedPdfs.length) { list.innerHTML = ''; return; }
  list.innerHTML = pickedPdfs.map(p => {
    let meta;
    if (p.status === 'processing') meta = `<span class="intake-file-status">Reading…</span>`;
    else if (p.status === 'error')  meta = `<span class="intake-file-status intake-file-status--error">Error: ${escape(p.error || 'failed')}</span>`;
    else meta = `<span class="intake-file-status">${p.pageThumbs?.length || 0} page${p.pageThumbs?.length === 1 ? '' : 's'} · ${(p.sizeBytes / 1_000_000).toFixed(1)}MB${p.warning ? ' · ' + escape(p.warning) : ''}</span>`;
    return `
      <div class="intake-file-chip" data-pdf-id="${p.id}">
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
        <div class="intake-file-meta">
          <div class="intake-file-name">${escape(p.name)}</div>
          ${meta}
        </div>
        <button type="button" class="intake-file-remove" data-pdf-remove="${p.id}" aria-label="Remove ${escape(p.name)}">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </div>`;
  }).join('');
  list.querySelectorAll('[data-pdf-remove]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.pdfRemove;
      pickedPdfs = pickedPdfs.filter(p => p.id !== id);
      renderFileList(card);
    });
  });
}

async function onSubmit(e) {
  e.preventDefault();
  if (!getUser()) {
    savePendingCourseCreation(formDraft(e.target), { reuseJobId: reuseJobIdForSubmit, expected: reuseExpectation });
    const err = e.target.querySelector('[data-error]');
    if (err) {
      err.style.display = '';
      err.textContent = 'Sign in first so this generated course can save to your account.';
    }
    openAccount({ intent: 'course-generation' });
    return;
  }
  const fd = new FormData(e.target);
  const apiKeyInput = (fd.get('apiKey') || '').trim();
  if (apiKeyInput) { setApiKey(apiKeyInput); kickSync(); }
  const err = e.target.querySelector('[data-error]');
  if (!hasApiKey()) {
    try { await pullSyncNow(); } catch {}
  }
  if (!hasApiKey()) {
    err.style.display = ''; err.textContent = 'An Anthropic API key is required.';
    return;
  }
  const topic = (fd.get('topic') || '').trim();
  const sourceText = (fd.get('source_text') || '').trim();
  const sourceUrls = (fd.get('source_urls') || '').split('\n').map(s => s.trim()).filter(Boolean);
  const readyPdfs = pickedPdfs.filter(p => p.status === 'ready' && p.base64);
  const stillProcessing = pickedPdfs.some(p => p.status === 'processing');
  const failed = pickedPdfs.filter(p => p.status === 'error');

  if (stillProcessing) {
    err.style.display = ''; err.textContent = 'Still reading PDFs — give it a second.';
    return;
  }
  if (failed.length && !readyPdfs.length && !topic && !sourceText && !sourceUrls.length) {
    err.style.display = ''; err.textContent = `Couldn't read ${failed.length} PDF${failed.length === 1 ? '' : 's'}. Try a different file or paste text instead.`;
    return;
  }
  if (!topic && !sourceText && !sourceUrls.length && !readyPdfs.length) {
    err.style.display = ''; err.textContent = 'Enter a topic, paste some text, add a URL, or upload a PDF.';
    return;
  }

  try {
    err.style.display = 'none';
    await flushSync();
  } catch (syncErr) {
    err.style.display = '';
    err.textContent = `Could not save your API key before starting: ${syncErr.message || syncErr}`;
    return;
  }

  try {
    await requireCloudBackendReady({ force: true });
  } catch (cloudErr) {
    err.style.display = '';
    err.textContent = cloudErr.message || String(cloudErr);
    return;
  }

  // Slim shape sent to the cloud generator. base64 is heavy (used only for the
  // Anthropic document blocks). pageThumbs are data URLs (used by the renderer
  // for inline image sections that reference PDF pages).
  const pdfs = readyPdfs.map((p, i) => ({
    file_index: i,
    name: p.name,
    base64: p.base64,
    pageThumbs: p.pageThumbs || []
  }));

  const userBrief = {
    topic: topic || '(infer from source material)',
    goal: (fd.get('goal') || '').trim() || undefined,
    starting_point: (fd.get('starting_point') || '').trim() || undefined,
    depth: fd.get('depth') || 'Solid foundation',
    experience: fd.get('experience') || 'standard',
    tone: 'conversational',
    source_text: sourceText || undefined,
    source_urls: sourceUrls,
    pdfs   // [{ file_index, name, base64, pageThumbs }]
  };

  const reusableJobId = reuseJobIdForSubmit;
  const expected = reuseExpectation;
  reuseJobIdForSubmit = null;
  reuseExpectation = null;
  const replacingSources = !!(reusableJobId && getJob(reusableJobId)?.needsSourceReattach);
  // Source replacement owns its optimistic state after preflight. Keep the last
  // real checkpoint available if the server rejects it and refresh is offline.
  const job = replacingSources ? getJob(reusableJobId) : reusableJobId
    ? (updateJob(reusableJobId, {
        brief: userBrief,
        runner: 'cloud',
        status: 'running',
        stage: 'intake',
        error: null,
        needsSourceReattach: false,
        message: agentMessage('intake'),
        topicsDone: 0,
        topicsTotal: 0,
        outline: null,
        review: null,
        failures: []
      }) || createJob(userBrief))
    : createJob(userBrief);
  startReviewableGeneration(job.id, userBrief, { replacingSources, expected });
  renderProgress(job.id);
}

async function startReviewableGeneration(jobId, userBrief, options = {}) {
  if (!getUser()) {
    updateJob(jobId, { status: 'failed', error: 'Sign in first so this generated course can save to your account.' });
    openAccount({ intent: 'course-generation' });
    return;
  }
  if (!cloudGenAvailable()) {
    updateJob(jobId, { status: 'failed', error: 'Cloud generation is unavailable. Open the hosted app and sign in again.' });
    return;
  }
  if (!options.replacingSources) updateJob(jobId, { runner: 'cloud', status: 'running', stage: 'intake', message: agentMessage('intake') });
  try {
    if (options.replacingSources) {
      await restartCloudGenerationWithSources(jobId, userBrief, '', options.expected);
    } else {
      await startCloudGeneration(jobId, userBrief);
    }
  } catch (err) {
    if (err.code === 'GENERATION_CHANGED') {
      updateJob(jobId, { error: err.message || String(err) });
      return;
    }
    try {
      if (await reattachCloudGeneration(jobId)) return;
    } catch {}
    updateJob(jobId, { status: 'failed', error: err.message || String(err) });
  }
}

onUserChange((user) => {
  if (inlineCard && inlineOwner !== (user?.id || '')) close();
  if (activeSourceEditor && activeSourceEditor.owner !== user?.id) close();
  if (!user) return;
  // A contextual setup callback must not consume or open an unrelated legacy
  // request. Keep the old intent available in its own flow until normal expiry.
  const inSetup = () => {
    const params = new URLSearchParams(location.search);
    return !!params.get('draft');
  };
  if (inSetup()) return;
  const pending = readPendingCourseCreation();
  if (!pending) return;
  setTimeout(() => {
    if (inSetup() || getUser()?.id !== user.id) return;
    clearPendingCourseCreation();
    hideAccountModal();
    openIntakeWithDraft(pending.draft || {}, pending.options || {});
  }, 0);
});

// Watch the rendered job — if it just completed, auto-jump into the course.
onJobsChange(() => {
  // The new workspace owns navigation. Finishing a background course must not
  // close a different draft or redirect away from the user's current activity.
  if (document.body.dataset.experience === 'workspace') return;
  if (!renderedJobId) return;
  const j = getJob(renderedJobId);
  if (j && j.status === 'completed' && j.savedCourseId && j.courseInstalled && !autoJumpedFor.has(renderedJobId)) {
    autoJumpedFor.add(renderedJobId);
    setTimeout(() => {
      close();
      history.pushState(null, '', `?course=${encodeURIComponent(j.savedCourseId)}`);
      window.dispatchEvent(new PopStateEvent('popstate'));
    }, 700);
  }
});
const autoJumpedFor = new Set();

// ---- progress view (reads live from the job in localStorage) -----

let elapsedTimer = null;
function startElapsedTimer(jobId) {
  stopElapsedTimer();
  elapsedTimer = setInterval(() => {
    if (!surfaceCard() || (!inlineCard && modal.style.display === 'none')) { stopElapsedTimer(); return; }
    const job = getJob(jobId);
    if (!job || (job.status !== 'running' && job.status !== 'cancelling')) { stopElapsedTimer(); return; }
    const el = surfaceCard().querySelector('[data-elapsed]');
    if (el && job.startedAt) el.textContent = formatElapsed(Date.now() - job.startedAt) + ' elapsed';
    updateGenerationActivity(surfaceCard(), job);
  }, 1000);
}
function stopElapsedTimer() {
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
}

function hasCloudCheckpoint(job) {
  return !!(job?.runner === 'cloud' && job?.checkpoint?.brief);
}

function needsSourceReattach(job) {
  return !!job?.needsSourceReattach;
}

function needsApiKey(job) {
  return !!job?.needsApiKey;
}

function pendingRestart(job) {
  if (!job || !['failed', 'interrupted', 'timed_out', 'partial'].includes(job.status)) return false;
  if (job.pendingRestart) return true;
  return hasSavedRequestRestartIntent(job);
}

function renderProgress(jobId) {
  activeSourceEditor?.destroy(); activeSourceEditor = null;
  renderedJobId = jobId;
  const card = surfaceCard();
  const job = getJob(jobId);
  card.innerHTML = progressHTML(job);
  card.dataset.reviewIdentity = reviewIdentity(job);
  wireProgressActions(card, jobId, generationActionSnapshot(job));
  syncInlineConnection(card);
  startElapsedTimer(jobId);

  if (unsubJob) unsubJob();
  unsubJob = onJobsChange(() => {
    if (surfaceCard() !== card) return;
    const j = getJob(jobId);
    if (!j) { close(); return; }
    updateProgressUI(card, j);
  });
}

function progressHTML(job) {
  const stage = job?.stage || 'intake';
  const refining = hasVisualDesignerPass(job);
  const status = job?.status || 'running';
  const isRunning = status === 'running';
  const isCancelling = status === 'cancelling';
  const isFailed = status === 'failed';
  const isInterrupted = status === 'interrupted';
  const isTimedOut = status === 'timed_out';
  const isPartial = status === 'partial';
  const isReview = status === 'review_curriculum' || status === 'review_research';
  const canResume = hasCloudCheckpoint(job);
  const mustReattach = needsSourceReattach(job);
  const needsKey = needsApiKey(job);
  const wantsRestart = pendingRestart(job);
  const canRestart = !!(job?.runner === 'cloud' && (canResume || isPartial) && !mustReattach && !needsKey && !wantsRestart);
  const recoveryAction = needsKey ? 'api-key' : (mustReattach ? 'reattach' : (wantsRestart ? 'restart' : (canResume || isPartial ? 'resume' : 'retry')));
  const recoveryLabel = needsKey ? 'Add API key' : (mustReattach ? 'Reattach source files' : (wantsRestart ? 'Restart from request' : (['design', 'images'].includes(stage) ? 'Resume course creation' : isPartial ? 'Retry missing topics' : (canResume ? 'Resume' : 'Retry'))));
  const pct = computeProgressPct(job);
  const elapsed = job?.startedAt ? formatElapsed(Date.now() - job.startedAt) : '';
  return `
    ${inlineCard ? '' : `<button class="intake-close" type="button" aria-label="Close"
      title="Close (generation keeps running in the background)">
      <svg width="18" height="18"><use href="#icon-x"/></svg>
    </button>`}
    <${inlineCard ? 'h1' : 'h2'} class="intake-title" data-job-title tabindex="-1">${escape(briefTitle(job?.title, 'Generating your course…'))}</${inlineCard ? 'h1' : 'h2'}>
    <p class="intake-sub" data-msg role="status">${escape(job?.message || '')}</p>
    ${!isReview ? `<div class="intake-agent-roster">
      ${COURSE_AGENT_SEQUENCE.map(agent => `
        <div class="intake-agent ${agent.stage === stage || (agent.id === 'visualDesigner' && stage === 'images') || (agent.id === 'practiceDesigner' && stage === 'topics') ? 'active' : ''}">
          <span>${escape(agent.name)}</span>
          <small>${escape(agent.short)}</small>
        </div>`).join('')}
    </div>` : ''}

    ${isRunning || isCancelling ? `
      <div class="intake-progress">
        <div class="intake-progress-meta">
          <span class="intake-progress-pct"><span data-pct>${pct}%</span>${job?.runner === 'cloud' ? '<small class="generation-progress-estimate">Estimated progress</small>' : ''}</span>
          ${elapsed ? `<span class="intake-progress-elapsed" data-elapsed>${escape(elapsed)} elapsed</span>` : ''}
        </div>
        <div class="intake-progress-bar"><div class="intake-progress-fill" style="width: ${pct}%"></div></div>
      </div>` : ''}

    ${generationActivityHTML(job)}

    <div class="intake-stages">
      ${stageHTML('intake', refining ? 'Plan' : 'Curriculum review', stage, status)}
      ${stageHTML('research', refining ? 'Research' : 'Research review', stage, status)}
      ${stageHTML('topics', `Lessons ${job?.topicsTotal ? `${job.topicsDone}/${job.topicsTotal}` : ''}`.trim(), stage, status, 'topics-label')}
      ${refining ? stageHTML('design', `Refine${job?.designProgress ? ` ${job.designProgress.completed || 0}/${job.designProgress.total || 0}` : ''}`, stage, status) : ''}
      ${refining || job?.brief?.materials_policy === 'integrated-visuals-v2' || job?.checkpoint?.brief?.materials_policy === 'integrated-visuals-v2' || stage === 'images' ? stageHTML('images', `Images${job?.imageProgress ? ` ${job.imageProgress.completed || 0}/${job.imageProgress.planned || 0}` : ''}`, stage, status) : ''}
      ${stageHTML('done', 'Ready', stage, status)}
    </div>

    <div class="intake-outline" data-outline>${outlineHTML(job)}</div>
    ${status === 'review_research' && job?.runner === 'cloud' ? '<div class="intake-source-entry"><button type="button" class="intake-cancel" data-adjust-sources>Adjust sources</button><p class="source-help">Add or change notes, links and files before writing lessons.</p></div>' : ''}
    ${isReview ? reviewHTML(job) : ''}
    ${(job?.failures || []).length ? failuresHTML(job.failures) : ''}
    <div class="intake-error" data-error role="status" style="${needsKey || isFailed || isInterrupted || isTimedOut || isPartial || (isReview && job?.error) ? '' : 'display:none'}">
      ${isReview && !needsKey && job?.error ? escape(job.error) : ''}
      ${needsKey ? escape(wantsRestart ? 'Generation is waiting for an Anthropic API key. Add it to your account, then restart from the saved request.' : 'Generation is waiting for an Anthropic API key. Add it to your account, then resume from the saved checkpoint.') : ''}
      ${!needsKey && isFailed ? escape((mustReattach ? 'Source upload failed: ' : 'Generation failed: ') + (job.error || 'unknown error')) : ''}
      ${!needsKey && isInterrupted ? (canResume ? 'Generation was interrupted. Your progress is saved — Resume to pick up where it stopped.' : 'Generation was interrupted before the curriculum checkpoint. Retry keeps your original request and starts the curriculum step again.') : ''}
      ${!needsKey && isTimedOut ? (canResume ? 'Generation timed out in the cloud. Your checkpoint is saved — Resume to pick up where it stopped.' : 'Generation timed out before a checkpoint. Restart keeps your request and source context.') : ''}
      ${isPartial ? stage === 'design' ? 'Lesson refinement still needs attention. Your saved draft and completed refinements are kept. Resume course creation to continue the same job.' : stage === 'images' ? 'Some planned images still need attention. Your lessons and saved images are kept. Resume course creation to continue from these results.' : 'Some lessons failed, but the partial course is saved. Retry missing topics, or restart from the saved request if the checkpoint needs a cleaner rebuild.' : ''}
      ${stage === 'design' && !isPartial && (isFailed || isInterrupted || isTimedOut) ? ' Your saved draft and completed refinements are kept. Resume continues this same course creation; it does not start a new course.' : ''}
    </div>
    ${stage === 'images' && !needsKey && (isFailed || isPartial || isInterrupted || isTimedOut) ? `<details class="intake-image-connection" data-image-connection-recovery><summary>Check your OpenAI connection</summary><p>If the message says your connection or key is unavailable, reconnect here. For billing or access issues, check your OpenAI account first. Your saved lessons and images are kept.</p><form data-image-reconnect><label class="intake-label" for="intake-image-key">OpenAI API key</label><input class="intake-input" id="intake-image-key" type="password" autocomplete="off" spellcheck="false" required placeholder="sk-…"><button type="submit" class="intake-cancel">Connect OpenAI</button></form><p data-image-connection-notice role="status">Connecting checks your key without creating an image. Then use Resume course creation below to continue.</p></details>` : ''}
    ${job?.reviewRecovery?.feedback ? `<details class="intake-review-recovery" open><summary>Your unsent feedback (previous version)</summary><p>The course changed before this feedback was sent. It has not been applied to the new version. Copy anything you still want to use after reviewing the changes.</p><label class="intake-label">Unsent feedback<textarea class="intake-input intake-textarea" readonly rows="3" data-stale-feedback>${escape(job.reviewRecovery.feedback)}</textarea></label></details>` : ''}
    ${isReview && needsKey ? `
      <div class="intake-actions">
        <button type="button" class="intake-submit" data-api-key>Add API key</button>
      </div>
    ` : ''}
    ${isRunning ? `
      <div class="intake-actions">
        <button type="button" class="intake-cancel intake-cancel--danger" data-cancel>Cancel generation</button>
      </div>
    ` : ''}
    ${isCancelling ? `
      <div class="intake-actions">
        <span class="intake-cancel" aria-disabled="true">Draining…</span>
      </div>
    ` : ''}
    ${isFailed || isInterrupted || isTimedOut || isPartial ? `
      <div class="intake-actions">
        <button type="button" class="intake-cancel intake-cancel--danger" data-delete>Delete</button>
        ${canRestart ? '<button type="button" class="intake-cancel" data-restart>Restart from request</button>' : ''}
        <button type="button" class="intake-submit" data-${recoveryAction}>${recoveryLabel}</button>
      </div>
    ` : ''}`;
}

// Honest liveness, separate from completed work and browser connectivity. There
// are no provider calls here and no time-based increments of the progress bar.
function hasVisualDesignerPass(job) {
  return job?.brief?.visual_designer_policy === 'learner-experience-v1'
    || job?.checkpoint?.brief?.visual_designer_policy === 'learner-experience-v1'
    || job?.stage === 'design';
}

function generationActivityModel(job, now = Date.now(), online = globalThis.navigator?.onLine !== false) {
  if (job?.runner !== 'cloud' || ['completed', 'cancelled'].includes(job.status)) return null;
  const cp = job.checkpoint || {};
  const savedLessons = Object.values(cp.topicsByKey || {}).filter(Boolean).length;
  const savedResearch = Object.values(cp.researchByModule || {}).filter(Boolean).length;
  const total = job.topicsTotal || 0;
  const imageProgress = job.imageProgress || cp.imageProgress;
  const designProgress = job.designProgress || cp.designProgress;
  const refinements = designProgress ? `${designProgress.completed || 0} of ${designProgress.total || total} lesson refinements saved` : 'No lesson refinements saved yet';
  const saved = job.stage === 'design'
    ? `${savedLessons} lesson${savedLessons === 1 ? '' : 's'} saved · ${refinements}${designProgress?.reviewed ? ' · course-wide review saved' : ''}`
    : imageProgress && job.stage === 'images'
    ? `${savedLessons} lesson${savedLessons === 1 ? '' : 's'} · ${imageProgress.completed || 0} of ${imageProgress.planned || 0} planned images saved${imageProgress.omitted ? ` · ${imageProgress.omitted} ${imageProgress.omitted === 1 ? 'lesson needs' : 'lessons need'} no image` : ''}`
    : savedLessons
    ? `${savedLessons}${total >= savedLessons ? ` of ${total}` : ''} lesson${savedLessons === 1 ? '' : 's'} saved`
    : savedResearch ? `${savedResearch} research module${savedResearch === 1 ? '' : 's'} saved`
    : cp.brief ? 'Course plan saved' : 'No results saved yet';
  const validTime = value => Number.isFinite(value) && value > 0 && value <= now + 30_000;
  const heartbeat = validTime(job.heartbeatAt) ? job.heartbeatAt : null;
  const lastRead = validTime(job.cloudSeenAt) ? job.cloudSeenAt : null;
  const observation = job.activityObservation;
  const observedAt = validTime(observation?.changedAt) ? observation.changedAt : null;
  const since = validTime(observation?.since) ? observation.since : null;
  const model = {
    state: 'waiting', title: ({ intake: 'Planning your course', research: 'Researching your course', topics: 'Writing lessons', design: 'Refining lessons', images: hasVisualDesignerPass(job) ? 'Creating illustrations' : 'Creating instructional images', assemble: 'Saving your course' })[job.stage] || 'Preparing your course',
    status: 'Waiting for an update', summary: 'Waiting for a confirmed response from the generator.',
    checked: heartbeat ? activityAge(now - heartbeat) : 'Not available yet', saved,
    observed: observedAt ? `Latest saved-result change seen ${activityAge(now - observedAt)}` : '',
    note: job.stage === 'design' ? 'Progress updates when a refinement is saved. This copy and layout pass is not a rendered visual inspection or human approval.' : job.stage === 'images' ? 'Progress updates as planned images are saved. Lessons without a useful visual do not need an image.' : job.stage === 'topics' ? 'The percentage updates as lessons finish.' : 'Progress updates when a stage or result is saved.'
  };
  if (['failed', 'timed_out', 'interrupted', 'partial'].includes(job.status)) {
    return { ...model, state: 'attention', title: job.status === 'partial' ? 'Part of your course needs attention' : 'Generation needs attention', status: 'Action needed', summary: 'Review the message and recovery options below. Saved results are retained.' };
  }
  if (['review_curriculum', 'review_research'].includes(job.status)) {
    return { ...model, state: 'review', title: 'Ready for your review', status: 'Waiting for you', summary: 'Generation is paused for your approval. This is not a stall.', note: 'Review the saved work below before continuing.' };
  }
  if (job.status === 'cancelling') {
    return { ...model, state: 'stopping', title: 'Stopping generation', status: 'Cancellation requested', summary: 'Waiting for active work to stop. Saved results are retained.' };
  }
  const lastTaskTitle = `Last task: ${model.title.toLowerCase()}`;
  if (!online) return { ...model, title: lastTaskTitle, state: 'offline', status: 'Connection lost', summary: 'Your course may still be generating. We’ll check its latest status when you reconnect.' };
  if (!lastRead || now - lastRead > 30_000) {
    return { ...model, title: lastTaskTitle, state: 'disconnected', status: 'Updates unavailable', summary: 'We can’t confirm the latest status. Your course may still be generating; this page will check again.' };
  }
  if (job.serverStatus === 'queued') return { ...model, title: 'Waiting for the generator', state: 'queued', status: 'Waiting to start', summary: 'Your request is saved. Waiting for the generator to begin or continue.' };
  if (!heartbeat) return { ...model, title: lastTaskTitle };
  if (now - heartbeat > 150_000 || (Number.isFinite(job.leaseExpiresAt) && job.leaseExpiresAt > 0 && job.leaseExpiresAt <= now)) {
    return { ...model, title: lastTaskTitle, state: 'stale', status: 'No recent update', summary: 'The generator hasn’t responded recently. We’re checking for an update; a failure has not been confirmed.' };
  }
  if (since && now - since >= 5 * 60_000) {
    return { ...model, state: 'slow', status: 'Taking longer', summary: 'The generator is responding, but no new saved result has been seen for 5 minutes or more.' };
  }
  return { ...model, state: 'responding', status: 'Generator responding', summary: job.stage === 'design' ? designProgress?.reviewed ? 'Refining learner-facing copy and lesson structure, checking selected learning materials and saving the revised draft before illustrations.' : 'Reviewing the complete saved draft for clear explanations, consistent language and a useful learning sequence.' : job.stage === 'images' ? 'Creating the images chosen to explain your lessons and saving them directly in the course.' : job.stage === 'topics' ? hasVisualDesignerPass(job) ? 'Building lesson content and your selected learning checks. Refinement and illustrations follow the complete saved draft.' : 'Building lesson content, your selected materials and a useful visual plan. Lessons may be processed together.' : 'The generator recently responded. Completed work is saved as it goes.' };
}

function activityAge(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1000));
  if (seconds < 5) return 'just now';
  if (seconds < 60) return `${seconds} seconds ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? '' : 's'} ago`;
  const hours = Math.floor(minutes / 60);
  return `${hours} hour${hours === 1 ? '' : 's'} ago`;
}

function generationActivityHTML(job) {
  const model = generationActivityModel(job);
  if (!model) return '';
  return `<section class="generation-activity" data-generation-activity data-state="${model.state}" aria-label="Generation activity">
    <div class="generation-activity-heading"><h3><span class="generation-activity-spinner" aria-hidden="true"></span><span data-activity-title>${escape(model.title)}</span></h3><span class="generation-activity-status" data-activity-status role="status" aria-atomic="true">${escape(model.status)}</span></div>
    <p class="generation-activity-summary" data-activity-summary>${escape(model.summary)}</p>
    <dl class="generation-activity-facts">
      <div><dt title="The generator’s last confirmed response, not the time this page refreshed.">Last checked</dt><dd data-activity-checked aria-live="off">${escape(model.checked)}</dd></div>
      <div><dt>Last saved result</dt><dd data-activity-saved>${escape(model.saved)}</dd><dd class="generation-activity-observed" data-activity-observed aria-live="off" ${model.observed ? '' : 'hidden'}>${escape(model.observed)}</dd></div>
    </dl>
    <p class="generation-activity-note" data-activity-note>${escape(model.note)}</p>
  </section>`;
}

function updateGenerationActivity(card, job) {
  const panel = card?.querySelector('[data-generation-activity]');
  const model = generationActivityModel(job);
  if (!panel || !model) return;
  panel.dataset.state = model.state;
  for (const key of ['title', 'status', 'summary', 'checked', 'saved', 'observed', 'note']) {
    const node = panel.querySelector(`[data-activity-${key}]`);
    if (node && node.textContent !== model[key]) node.textContent = model[key];
    if (key === 'observed' && node) node.hidden = !model[key];
  }
}

function updateProgressUI(card, job) {
  // Realtime updates must not replace source inputs while someone is editing.
  // The server checks the exact checkpoint again before accepting any edits.
  if (activeSourceEditor) return;
  if (card !== surfaceCard()) return;
  const identity = reviewIdentity(job);
  const state = captureReviewState(card, identity);
  const focused = card.contains(document.activeElement);
  const scroll = inlineCard ? window.scrollY : null;
  // Keep the password input in the DOM during read-only progress refreshes.
  // Never copy its value to job state, browser storage or a persisted checkpoint.
  const imageConnection = job.stage === 'images' && ['failed', 'partial', 'interrupted', 'timed_out'].includes(job.status)
    ? card.querySelector('[data-image-connection-recovery]') : null;
  const imageFocus = imageConnection?.contains(document.activeElement) ? document.activeElement : null;
  const imageSelection = imageFocus && typeof imageFocus.selectionStart === 'number' ? [imageFocus.selectionStart, imageFocus.selectionEnd] : null;
  card.innerHTML = progressHTML(job);
  if (imageConnection) card.querySelector('[data-image-connection-recovery]')?.replaceWith(imageConnection);
  card.dataset.reviewIdentity = identity;
  wireProgressActions(card, job.id, generationActionSnapshot(job));
  restoreReviewState(card, state);
  if (imageFocus?.isConnected) { imageFocus.focus({ preventScroll: true }); if (imageSelection) imageFocus.setSelectionRange(...imageSelection); }
  else if (focused && !state) card.querySelector('[data-job-title]')?.focus({ preventScroll: true });
  if (scroll !== null) window.scrollTo?.(0, scroll);
  syncInlineConnection(card);
  if (['running', 'cancelling'].includes(job.status)) startElapsedTimer(job.id);
  else stopElapsedTimer();
}

function wireProgressActions(card, jobId, expected) {
  const imageForm = card.querySelector('[data-image-reconnect]');
  if (imageForm && !imageForm.dataset.wired) {
    imageForm.dataset.wired = 'true';
    imageForm.addEventListener('submit', async event => {
      event.preventDefault();
      const owner = getUser()?.id, input = imageForm.querySelector('input'), button = imageForm.querySelector('button');
      const notice = imageForm.closest('[data-image-connection-recovery]').querySelector('[data-image-connection-notice]');
      if (button.disabled || !owner || getJob(jobId)?.ownerId !== owner) return;
      const key = input.value.trim();
      if (!key) { input.focus(); return; }
      input.value = ''; input.disabled = true; button.disabled = true; notice.textContent = 'Checking your OpenAI connection…';
      try {
        await createCourseImageClient().connect(owner, key);
        if (getUser()?.id === owner && imageForm.isConnected) notice.textContent = 'OpenAI connected. No image was generated. Use Resume course creation to continue the saved work.';
      } catch (error) {
        if (getUser()?.id === owner && imageForm.isConnected) notice.textContent = error.message || 'Couldn’t connect OpenAI. Your saved course is unchanged.';
      } finally { input.disabled = false; button.disabled = false; }
    });
  }
  card.querySelector('[data-adjust-sources]')?.addEventListener('click', () => {
    if (activeSourceEditor || reviewActionIsBusy(card)) return;
    const feedback = card.querySelector('[data-review-feedback]')?.value || '';
    const identity = reviewIdentity(getJob(jobId));
    const reviewState = captureReviewState(card, identity);
    activeSourceEditor = mountReviewSourceEditor(card, { jobId, feedback,
      onBack: () => {
        if (surfaceCard() !== card) return;
        activeSourceEditor = null;
        const job = getJob(jobId);
        if (job) {
          updateProgressUI(card, job);
          if (reviewIdentity(job) === identity) restoreReviewState(card, reviewState);
          card.querySelector('[data-adjust-sources]')?.focus();
        } else close();
      },
      onStarted: async () => {
        if (surfaceCard() !== card) return;
        activeSourceEditor = null;
        try { await reattachCloudGeneration(jobId); }
        catch { updateJob(jobId, { error: 'Your source changes were accepted, but progress could not be refreshed. Reopen this course to check the latest research.' }); }
        if (surfaceCard() !== card) return;
        const job = getJob(jobId); if (job) updateProgressUI(card, job); else close();
      }
    });
  });
  card.querySelector('.intake-close')?.addEventListener('click', close);
  card.querySelector('[data-api-key]')?.addEventListener('click', () => openAccount({ intent: 'course-generation', jobId }));
  card.querySelector('[data-retry]')?.addEventListener('click', () => retry(jobId, expected));
  card.querySelector('[data-reattach]')?.addEventListener('click', () => {
    const job = getJob(jobId);
    renderForm(job?.brief || {}, { reuseJobId: jobId, expected });
    const err = surfaceCard()?.querySelector('[data-error]');
    if (err) {
      err.style.display = '';
      err.textContent = 'The original PDFs were not saved because upload failed. Reattach the source files, then start again.';
    }
  });
  card.querySelector('[data-resume]')?.addEventListener('click', async () => {
    const job = getJob(jobId);
    if (job?.runner === 'cloud' && cloudGenAvailable()) {
      try { await resumeCloudGeneration(jobId, expected); return; }
      catch (err) { updateJob(jobId, { error: err.message || String(err) }); return; }
    }
    await retry(jobId, expected);
  });
  card.querySelector('[data-restart]')?.addEventListener('click', async () => {
    if (!confirm('Restart from the saved request? Learnable keeps your source context and human feedback, then rebuilds the course from the curriculum step.')) return;
    await restart(jobId, expected);
  });
  card.querySelector('[data-cancel]')?.addEventListener('click', async () => {
    if (!confirm('Cancel this generation? Anything created so far will be discarded.')) return;
    const job = getJob(jobId);
    if (job?.runner === 'cloud') {
      try { await cancelCloudGeneration(jobId, expected); if (surfaceCard() === card && !inlineCard) close(); }
      catch (err) { updateJob(jobId, { ...(!err.reattached ? { status: job.status } : {}), error: err.message || String(err) }); }
    } else {
      removeJob(jobId);
      close();
    }
  });
  card.querySelector('[data-delete]')?.addEventListener('click', async () => {
    if (!confirm('Delete this generation? Any partial work will be lost.')) return;
    const j = getJob(jobId);
    let deletedCourseId = j?.runner === 'cloud' ? null : (j?.savedCourseId || null);
    if (j?.runner === 'cloud') {
      try {
        const result = await deleteCloudGeneration(jobId, expected);
        deletedCourseId = result?.deletedCourseId || null;
      }
      catch (err) {
        if (!err.reattached) updateJob(jobId, { status: j.status, error: err.message || String(err) });
        return;
      }
    } else {
      removeJob(jobId);
    }
    if (deletedCourseId) {
      removeUserCourseForCurrentAccount(deletedCourseId);
    }
    if (surfaceCard() === card) close();
  });
  card.querySelector('[data-review-continue]')?.addEventListener('click', async () => {
    if (reviewActionIsBusy(card)) return;
    const feedback = card.querySelector('[data-review-feedback]')?.value || '';
    const job = getJob(jobId);
    if (job?.runner === 'cloud') {
      const action = expected.status === 'review_curriculum' ? 'approve_curriculum' : 'approve_research';
      setReviewActionPending(card, action);
      try { await submitCloudReview(jobId, action, feedback, expected); }
      catch (err) { updateJob(jobId, { reviewPending: null, error: err.message || String(err), ...(err.code === 'GENERATION_CHANGED' && feedback.trim() ? { reviewRecovery: { feedback } } : {}) }); }
      return;
    }
    await retryCloudFromLocalMirror(jobId, feedback);
  });
  card.querySelector('[data-review-regenerate]')?.addEventListener('click', async () => {
    if (reviewActionIsBusy(card)) return;
    const feedback = card.querySelector('[data-review-feedback]')?.value || '';
    const job = getJob(jobId);
    if (job?.runner === 'cloud') {
      const action = expected.status === 'review_curriculum' ? 'revise_curriculum' : 'rerun_research';
      setReviewActionPending(card, action);
      try { await submitCloudReview(jobId, action, feedback, expected); }
      catch (err) { updateJob(jobId, { reviewPending: null, error: err.message || String(err), ...(err.code === 'GENERATION_CHANGED' && feedback.trim() ? { reviewRecovery: { feedback } } : {}) }); }
      return;
    }
    await retryCloudFromLocalMirror(jobId, feedback);
  });
}

function reviewActionIsBusy(card) {
  return card.querySelector('.intake-review-card')?.dataset.reviewBusy === 'true';
}

function setReviewActionPending(card, action) {
  const pending = reviewPendingForAction(action);
  const reviewCard = card.querySelector('.intake-review-card');
  const buttons = reviewCard?.querySelectorAll('[data-review-continue], [data-review-regenerate]');
  const clicked = reviewCard?.querySelector(action === 'revise_curriculum' || action === 'rerun_research'
    ? '[data-review-regenerate]'
    : '[data-review-continue]');
  const status = reviewCard?.querySelector('[data-review-status]');
  reviewCard?.classList.add('is-pending');
  if (reviewCard) reviewCard.dataset.reviewBusy = 'true';
  reviewCard?.querySelector('[data-review-feedback]')?.setAttribute('disabled', '');
  buttons?.forEach(button => {
    button.setAttribute('aria-disabled', 'true');
  });
  if (clicked) {
    clicked.classList.add('is-loading');
    clicked.textContent = pending.continueLabel || pending.regenerateLabel || 'Working...';
  }
  if (status) {
    status.hidden = false;
    status.textContent = pending.status;
  }
}

function removeUserCourseForCurrentAccount(courseId) {
  if (!courseId) return false;
  const course = getUserCourse(courseId);
  const user = getUser();
  if (!courseCanSyncToAccount(course, user?.email || '', user?.id || '')) return false;
  removeUserCourse(courseId);
  invalidateCourseCache(courseId);
  return true;
}

function stageHTML(name, label, currentStage, status, dataAttr) {
  const order = ['intake', 'research', 'topics', 'design', 'images', 'assemble', 'done'];
  const ix = order.indexOf(name);
  const cur = order.indexOf(currentStage);
  let cls = '';
  if (status === 'completed' || (cur > ix)) cls = 'done';
  else if (cur === ix && (status === 'running' || (status === 'review_curriculum' && name === 'intake') || (status === 'review_research' && name === 'research'))) cls = 'active';
  else if (status === 'failed' || status === 'interrupted' || status === 'timed_out') cls = '';
  return `<div class="intake-stage ${cls}" data-stage="${name}">
    <span class="intake-stage-dot"></span>
    <span ${dataAttr ? `data-${dataAttr}` : ''}>${escape(label)}</span>
  </div>`;
}

function outlineHTML(job) {
  if (!job?.outline) return '';
  const o = job.outline;
  return `
    <div class="intake-outline-card">
      <div class="intake-outline-title">${escape(o.title || '')}</div>
      <div class="intake-outline-sub">${escape(o.subtitle || '')}</div>
      <ul class="intake-outline-list">
        ${o.modules.map(m => `<li><strong>${escape(m.title)}</strong><span>${m.topicCount} topic${m.topicCount === 1 ? '' : 's'}</span></li>`).join('')}
      </ul>
    </div>`;
}

function reviewHTML(job) {
  if (job.status === 'review_curriculum') return curriculumReviewHTML(job.review?.brief, job.reviewHistory || [], job.reviewPending);
  if (job.status === 'review_research') return researchReviewHTML(job, job.reviewHistory || [], job.reviewPending);
  return '';
}

function curriculumReviewHTML(brief, reviewHistory = [], pending = null) {
  if (!brief) return '';
  return `
    <div class="intake-review-card ${pending ? 'is-pending' : ''}" data-review-busy="${!!pending}">
      <div class="intake-review-kicker">${escape(agentNameForStage('intake'))} checkpoint</div>
      <h3>Does this course direction feel right?</h3>
      <p>${escape(brief.subtitle || '')}</p>
      ${reviewHistoryHTML(reviewHistory)}
      <div class="intake-review-meta">
        <span>${escape((brief.scope || '').replace('_', ' ') || 'course')}</span>
        <span>${brief.modules?.length || 0} module${brief.modules?.length === 1 ? '' : 's'}</span>
        <span>${(brief.modules || []).reduce((n, m) => n + (m.topics?.length || 0), 0)} topics</span>
      </div>
      ${brief.components?.includes('images') ? `<p class="source-help intake-image-plan">${brief.visual_designer_policy === 'learner-experience-v1' ? 'After all lessons and selected learning checks are saved, the Visual Designer refines the copy and presentation, then creates and saves useful illustrations from that revised draft. Text-only lessons are intentional when no image would help. Final checks are not human approval or rendered visual inspection.' : brief.materials_policy === 'integrated-visuals-v2' ? 'Instructional images are part of this course. As lessons are written, Learnable decides where a visual explains the teaching point, then creates and saves those images automatically. Text-only lessons are intentional when no image would help.' : 'This saved request uses the earlier image workflow. Its existing work is retained; this review does not start additional image charges.'}</p>` : ''}
      <div class="intake-review-list">
        ${(brief.modules || []).map(mod => `
          <section>
            <strong>Module ${mod.number}: ${escape(mod.title)}</strong>
            <p>${escape(mod.description || '')}</p>
            <ul>${(mod.topics || []).map(t => `<li>${escape(t.title)}</li>`).join('')}</ul>
          </section>`).join('')}
      </div>
      ${reviewActionsHTML('Approve curriculum and research', 'Revise curriculum', { pending })}
    </div>`;
}

function researchReviewHTML(job, reviewHistory = [], pending = null) {
  const evidence = researchEvidence(job);
  const hasCompleteResearch = evidence.complete;
  return `
    <div class="intake-review-card ${pending ? 'is-pending' : ''}" data-review-busy="${!!pending}">
      <div class="intake-review-kicker">${escape(agentNameForStage('research'))} checkpoint</div>
      <h3>Review the research and sources</h3>
      <p>${hasCompleteResearch
        ? 'Check the lesson ideas and evidence before approving lesson writing.'
        : evidence.modules.length ? `${evidence.missing} module${evidence.missing === 1 ? ' is' : 's are'} missing research. Rerun research with feedback before writing lessons.` : 'No module research is available. Rerun research before writing lessons.'}</p>
      ${reviewHistoryHTML(reviewHistory)}
      ${researchEvidenceHTML(evidence)}
      ${reviewActionsHTML('Approve research and write lessons', 'Rerun research', {
        continueDisabled: !hasCompleteResearch,
        continueTitle: hasCompleteResearch ? '' : 'Rerun incomplete research before lesson writing.',
        pending
      })}
    </div>`;
}

function reviewHistoryHTML(history = []) {
  const entries = (Array.isArray(history) ? history : [])
    .filter(entry => entry?.feedback)
    .slice(-3);
  if (!entries.length) return '';
  return `
    <div class="intake-review-history">
      <strong>Previous feedback</strong>
      <ul>
        ${entries.map(entry => `<li><span>${escape(reviewActionLabel(entry.action))}</span>${escape(entry.feedback)}</li>`).join('')}
      </ul>
    </div>`;
}

function reviewActionLabel(action = '') {
  return ({
    approve_curriculum: 'Approved curriculum',
    revise_curriculum: 'Revised curriculum',
    approve_research: 'Approved research',
    rerun_research: 'Reran research',
    restart_generation: 'Restarted'
  })[action] || 'Feedback';
}

function reviewActionsHTML(continueLabel, regenerateLabel, options = {}) {
  const pending = options.pending || null;
  const pendingIsRegenerate = pending?.action === 'revise_curriculum' || pending?.action === 'rerun_research';
  const continueText = pending && !pendingIsRegenerate ? (pending.continueLabel || 'Working...') : continueLabel;
  const regenerateText = pending && pendingIsRegenerate ? (pending.regenerateLabel || 'Working...') : regenerateLabel;
  const controlsDisabled = !!pending;
  return `
    <label class="intake-label intake-review-feedback">
      <span class="intake-label-text">Feedback for the agent</span>
      <textarea class="intake-input intake-textarea" data-review-feedback rows="4"
        ${controlsDisabled ? 'disabled aria-disabled="true"' : ''}
        placeholder="Add anything to fix, remove, emphasise, or use as extra context before continuing."></textarea>
    </label>
    <div class="intake-review-status" data-review-status aria-live="polite" ${pending ? '' : 'hidden'}>${pending ? escape(pending.status) : ''}</div>
    <div class="intake-actions">
      <button type="button" class="intake-cancel ${pending && pendingIsRegenerate ? 'is-loading' : ''}" data-review-regenerate
        ${controlsDisabled ? 'aria-disabled="true"' : ''}>${escape(regenerateText)}</button>
      <button type="button" class="intake-submit ${pending && !pendingIsRegenerate ? 'is-loading' : ''}" data-review-continue
        ${options.continueDisabled ? 'disabled aria-disabled="true"' : (controlsDisabled ? 'aria-disabled="true"' : '')}
        ${options.continueTitle ? `title="${escape(options.continueTitle)}"` : ''}>${escape(continueText)}</button>
    </div>`;
}

async function retry(jobId, expected = generationActionSnapshot(getJob(jobId))) {
  if (!requireSignedInForCourseCreation()) return;
  const j = getJob(jobId);
  if (!j) { close(); return; }
  if (needsSourceReattach(j)) {
    renderForm(j.brief || {}, { reuseJobId: jobId, expected });
    const err = surfaceCard()?.querySelector('[data-error]');
    if (err) {
      err.style.display = '';
      err.textContent = 'The saved source files could not be used. Reattach the PDFs, then start again.';
    }
    return;
  }
  try {
    await restartOrStartCloudGeneration(jobId, j.brief, '', expected);
  } catch (err) {
    updateJob(jobId, { error: err.message || String(err) });
  }
}

async function restart(jobId, expected = generationActionSnapshot(getJob(jobId))) {
  if (!requireSignedInForCourseCreation()) return;
  const j = getJob(jobId);
  if (!j) { close(); return; }
  if (!cloudGenAvailable()) {
    updateJob(jobId, { error: 'Cloud generation is unavailable. Open the hosted app and sign in again.' });
    return;
  }
  try {
    await restartOrStartCloudGeneration(jobId, j.brief, '', expected);
  } catch (err) {
    updateJob(jobId, { error: err.message || String(err) });
  }
}

async function retryCloudFromLocalMirror(jobId, feedback = '') {
  const j = getJob(jobId);
  if (!j?.brief) {
    updateJob(jobId, { error: 'This older generation has no saved request. Start a new cloud course instead.' });
    return;
  }
  if (!cloudGenAvailable()) {
    updateJob(jobId, { error: 'Cloud generation is unavailable. Open the hosted app and sign in again.' });
    return;
  }
  try {
    await restartOrStartCloudGeneration(jobId, j.brief, feedback);
  } catch (err) {
    updateJob(jobId, { error: err.message || String(err) });
  }
}

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Checkpoint-weighted estimate, never elapsed time or a quality assessment.
 *  New drafts reserve 65–80 for refinement and 80–95 for illustrations.
 *  Only the completed job status reaches 100. Legacy weights stay unchanged. */
function computeProgressPct(job) {
  if (!job) return 0;
  if (job.status === 'completed') return 100;
  if (job.status === 'failed' || job.status === 'interrupted') return 0;
  const stage = job.stage || 'intake';
  const cp = job.checkpoint || {};
  const modulesTotal = job.outline?.modules?.length || cp.brief?.modules?.length || 0;
  const modulesDone  = Object.keys(cp.researchByModule || {}).length;
  const topicsDone   = job.topicsDone || 0;
  const topicsTotal  = job.topicsTotal || (cp.brief?.modules || []).reduce((n, m) => n + (m.topics?.length || 0), 0) || 0;
  const integrated = job.brief?.materials_policy === 'integrated-visuals-v2' || cp.brief?.materials_policy === 'integrated-visuals-v2' || stage === 'images';
  const refining = hasVisualDesignerPass(job);

  if (stage === 'intake')   return cp.brief ? 15 : 10;
  if (stage === 'research') {
    if (!modulesTotal) return 20;
    return Math.round(15 + 20 * Math.min(1, modulesDone / modulesTotal));
  }
  if (stage === 'topics') {
    if (!topicsTotal) return 35;
    return Math.round(35 + (refining ? 30 : integrated ? 40 : 60) * Math.min(1, topicsDone / topicsTotal));
  }
  if (stage === 'design') {
    const progress = job.designProgress || cp.designProgress;
    const ratio = Number.isFinite(progress?.total) && progress.total > 0 && Number.isFinite(progress.completed)
      ? Math.min(1, Math.max(0, progress.completed) / progress.total) : 0;
    return Math.round(65 + 15 * ratio);
  }
  if (stage === 'images') {
    const progress = job.imageProgress || cp.imageProgress;
    const start = refining ? 80 : 75;
    if (!progress || !Number.isFinite(progress.planned) || !Number.isFinite(progress.completed)) return start;
    return Math.round(start + (95 - start) * (progress.planned > 0 ? Math.min(1, Math.max(0, progress.completed) / progress.planned) : 1));
  }
  if (stage === 'assemble') return 97;
  if (stage === 'done')     return 99;
  return 5;
}

function formatElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rs = s % 60;
  return `${m}m ${rs.toString().padStart(2, '0')}s`;
}

/** Collapsible "Failures (N)" section that shows each research/topic error.
 *  Deduped by module/stage/topic (keeping the most recent attempt) so retries
 *  don't inflate the count. */
function failuresHTML(rawFailures) {
  if (!rawFailures || !rawFailures.length) return '';
  const byKey = new Map();
  for (const f of rawFailures) byKey.set(failureKey(f), f); // later entries win
  const failures = [...byKey.values()];
  return `
    <details class="intake-failures">
      <summary>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        ${failures.length} generation issue${failures.length === 1 ? '' : 's'} — click for details
      </summary>
      <ul class="intake-failures-list">
        ${failures.map(f => failureItemHTML(f)).join('')}
      </ul>
    </details>`;
}

function failureKey(f) {
  if (f?.stage === 'design' || f?.kind === 'design') return `${f?.moduleId || 'course'}/${f?.topicId || '__review__'}/design`;
  return f?.stage === 'research' || f?.kind === 'research' || !f?.topicId
    ? `${f?.moduleId || 'module'}/__research__`
    : `${f.moduleId}/${f.topicId}`;
}

function failureItemHTML(f) {
  const material = /Checklists are selected:/.test(f.error || '') ? 'checklist' : /Practice activities are selected:/.test(f.error || '') ? 'practice activity' : null;
  const att = (f.attempts || []).map((a, i) => {
    if (a.kind === 'schema') {
      return `<li class="intake-failure-attempt"><strong>Attempt ${i + 1} (schema):</strong> <code>${escape(a.message)}</code>${a.issues?.length ? `<ul class="intake-failure-issues">${a.issues.map(x => `<li>${escape(x)}</li>`).join('')}${a.more ? `<li class="intake-failure-more">… and ${a.more} more</li>` : ''}</ul>` : ''}</li>`;
    }
    if (a.kind === 'api') {
      return `<li class="intake-failure-attempt"><strong>Attempt ${i + 1} (API ${escape(String(a.status))}${a.type ? ` ${escape(a.type)}` : ''}):</strong> <code>${escape(a.message)}</code></li>`;
    }
    return `<li class="intake-failure-attempt"><strong>Attempt ${i + 1}:</strong> <code>${escape(a.message || 'unknown')}</code></li>`;
  }).join('');
  const isDesign = f.stage === 'design' || f.kind === 'design';
  const isResearch = !isDesign && (f.stage === 'research' || f.kind === 'research' || !f.topicId);
  const moduleTopic = isDesign ? `${escape(f.moduleId || 'course')}${f.topicId ? ` / ${escape(f.topicId)}` : ''} / refinement` : isResearch
    ? `${escape(f.moduleId)} / research`
    : `${escape(f.moduleId)} / ${escape(f.topicId)}`;
  return `
    <li class="intake-failure">
      <div class="intake-failure-head">
        <div class="intake-failure-title">${escape(isDesign ? (f.topicTitle || 'Lesson refinement') : isResearch ? (f.moduleTitle || 'Research') : (f.topicTitle || f.topicId))}</div>
        <div class="intake-failure-meta">${moduleTopic}</div>
      </div>
      <div class="intake-failure-summary">${escape(f.error || 'unknown')}</div>
      ${material ? `<p class="source-help">A required ${material} is missing or invalid in this lesson. Retry rebuilds this lesson, not just the ${material}; other saved lessons stay available.</p>` : ''}
      ${att ? `<ul class="intake-failure-attempts">${att}</ul>` : ''}
    </li>`;
}
