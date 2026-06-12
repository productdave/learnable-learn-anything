// Intake modal — "What do you want to learn?"
// Opens from the library's "+ Generate" button (or by clicking a running job
// card on the dashboard, to attach to that job's progress). The generation
// itself runs as a registered "job" persisted to localStorage so the dashboard
// can show progress even when the modal is closed, and survive accidental
// dismissal. (A real page refresh kills the in-flight API calls — those jobs
// land as 'interrupted' with a Retry option.)

import { hasApiKey, setApiKey, getApiKey, generateCourse } from './generator/index.js';
import { saveUserCourse } from './user-courses.js';
import { kickSync } from './sync.js?v=2';
import { createJob, updateJob, getJob, onJobsChange, removeJob } from './jobs.js';
import { startGeneration as swStart, cancelGeneration as swCancel, resumeFromCheckpoint as swResume, hasCheckpoint } from './sw-client.js';
import { cloudGenAvailable, startCloudGeneration, cancelCloudGeneration, resumeCloudGeneration } from './cloud-gen-client.js?v=2';
import { pdfToBase64, extractPdfPageThumbs, dataUrlsBytes } from './pdf-extract.js?v=1';

let modal = null;
let unsubJob = null;        // currently-rendered job's listener
let renderedJobId = null;

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
  if (unsubJob) { unsubJob(); unsubJob = null; }
  stopElapsedTimer();
  renderedJobId = null;
  if (modal) modal.style.display = 'none';
}

/** Open the form to start a new generation. */
export function openIntake() {
  ensureModal();
  modal.style.display = '';
  renderForm();
}

/** Open the progress view for an already-running (or interrupted) job. */
export function openIntakeForJob(jobId) {
  ensureModal();
  modal.style.display = '';
  renderProgress(jobId);
}

// ---- form ---------------------------------------------------------

function renderForm() {
  if (unsubJob) { unsubJob(); unsubJob = null; }
  renderedJobId = null;
  pickedPdfs = [];  // fresh draft = fresh file list
  modal.querySelector('.intake-card').innerHTML = `
    <button class="intake-close" type="button" aria-label="Close">
      <svg width="18" height="18"><use href="#icon-x"/></svg>
    </button>
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
      </details>

      ${hasApiKey() ? '' : `
        <label class="intake-label intake-key-row">
          <span class="intake-label-text">Anthropic API key</span>
          <input class="intake-input intake-mono" type="password" name="apiKey"
            placeholder="sk-ant-..." autocomplete="off" spellcheck="false">
          <small class="intake-help">Runs in your browser, never leaves your device. <a href="https://console.anthropic.com/" target="_blank" rel="noopener">Get one</a> — roughly $1–3 of credit per course.</small>
        </label>
      `}

      <div class="intake-runmode" data-runmode>
        <!-- Filled in by renderRunMode() once we know whether the user is signed in -->
      </div>

      <div class="intake-actions">
        <button type="button" class="intake-cancel">Cancel</button>
        <button type="submit" class="intake-submit">Generate course</button>
      </div>
      <div class="intake-error" data-error style="display:none"></div>
    </form>
  `;
  const card = modal.querySelector('.intake-card');
  card.querySelector('.intake-close').addEventListener('click', close);
  card.querySelector('.intake-cancel').addEventListener('click', close);
  card.querySelector('.intake-form').addEventListener('submit', onSubmit);
  wireDropzone(card);
  renderRunMode(card);
}

/** Shows whether the next generation will run in cloud (durable) or browser
 *  (won't survive a refresh). Signals to the user before they click Generate. */
function renderRunMode(card) {
  const host = card.querySelector('[data-runmode]');
  if (!host) return;
  if (cloudGenAvailable()) {
    host.innerHTML = `
      <div class="intake-runmode-pill intake-runmode-pill--cloud">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 10h-1.26A8 8 0 1 0 9 20h9a5 5 0 0 0 0-10z"/></svg>
        Cloud generation · survives refresh + tab close
      </div>`;
  } else {
    host.innerHTML = `
      <div class="intake-runmode-pill intake-runmode-pill--browser">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/></svg>
        Browser-only · sign in for cloud generation that survives refresh
      </div>`;
  }
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

function onSubmit(e) {
  e.preventDefault();
  const fd = new FormData(e.target);
  const apiKeyInput = (fd.get('apiKey') || '').trim();
  if (apiKeyInput) { setApiKey(apiKeyInput); kickSync(); }
  const err = e.target.querySelector('[data-error]');
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

  // Slim shape sent to the SW + generator. base64 is heavy (used only for the
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
    tone: 'conversational',
    source_text: sourceText || undefined,
    source_urls: sourceUrls,
    pdfs   // [{ file_index, name, base64, pageThumbs }]
  };

  const job = createJob(userBrief);
  startGeneration(job.id, userBrief);
  renderProgress(job.id);
}

// Kicks off the generator and threads progress into the job. Tries the
// service worker first (survives refresh + tab close); falls back to in-page
// generation (current behavior — survives modal close + SPA nav but dies on
// refresh) if the SW isn't available.
//
// The auto-jump-into-the-new-course on completion is observed via a
// onJobsChange subscription rather than a Promise chain, so it works whether
// the SW or the in-page path produced the result.
async function startGeneration(jobId, userBrief) {
  // Preferred path: cloud worker (Vercel function + Supabase Realtime).
  // Survives refresh + tab close because the work runs on the server. Requires
  // the user to be signed in (so the function has an Anthropic key to read
  // from user_state, and so Supabase RLS can scope the row).
  if (cloudGenAvailable()) {
    try {
      await startCloudGeneration(jobId, userBrief);
      return; // updates flow in via Realtime → applyJobRow → updateJob
    } catch (err) {
      console.warn('[intake] cloud path failed, falling back to SW:', err.message);
      updateJob(jobId, { message: `Cloud generation unavailable (${err.message}). Falling back to local SW…` });
    }
  }
  // Fallback: existing Service Worker path. Used when the user isn't signed
  // in or when the cloud function errored. Doesn't survive tab close.
  try {
    await swStart(jobId, userBrief, getApiKey());
  } catch (err) {
    console.warn('[intake] SW path unavailable, falling back to in-page generation:', err.message);
    updateJob(jobId, { runner: 'page' });
    runInPageGeneration(jobId, userBrief);
  }
}

function runInPageGeneration(jobId, userBrief) {
  generateCourse(userBrief, (p) => {
    if (p.stage === 'fetching_urls') {
      const t = p.total || 0, d = p.done || 0;
      updateJob(jobId, { stage: 'intake', message: t > 1 ? `Reading ${d}/${t} source URLs…` : 'Reading source URL…' });
    }
    else if (p.stage === 'intake')      updateJob(jobId, { stage: 'intake',  message: 'Designing the outline…' });
    else if (p.stage === 'intake_done') {
      const b = p.brief;
      updateJob(jobId, {
        stage: 'research',
        message: `Researching ${b.modules.length} module${b.modules.length === 1 ? '' : 's'} in parallel…`,
        title: b.title,
        outline: {
          title: b.title,
          subtitle: b.subtitle,
          modules: b.modules.map(m => ({ title: m.title, topicCount: m.topics.length }))
        }
      });
    }
    else if (p.stage === 'topics') updateJob(jobId, { stage: 'topics', message: 'Writing topic content…', topicsDone: 0, topicsTotal: p.total });
    else if (p.stage === 'topic_done' || p.stage === 'topic_failed') updateJob(jobId, { stage: 'topics', topicsDone: p.done, topicsTotal: p.total });
    else if (p.stage === 'assemble') updateJob(jobId, { stage: 'assemble', message: 'Finalising…' });
  }).then(({ course, brief, research }) => {
    const savedId = saveUserCourse(course, { _brief: brief, _research: research });
    // Classify outcome: all topics OK → completed; some OK + some missing →
    // partial (retry surface activates); zero topics OK → failed.
    const failedTopics = course.failedTopics || [];
    const failedCount = failedTopics.length;
    let totalTopics = 0;
    for (const m of (course.curriculum?.modules || [])) totalTopics += (m.topics || []).length;
    let status, message;
    if (failedCount === 0)                { status = 'completed'; message = 'Done!'; }
    else if (failedCount >= totalTopics)  { status = 'failed';    message = `Generation failed — no topics produced (${failedCount} errors).`; }
    else                                  { status = 'partial';   message = `${totalTopics - failedCount} of ${totalTopics} topics done — ${failedCount} failed.`; }
    updateJob(jobId, { status, stage: 'done', message, savedCourseId: savedId, failedCount, totalTopics });
  }).catch(err => {
    updateJob(jobId, { status: 'failed', error: err.message || String(err) });
    console.error('[intake] in-page generation failed:', err);
  });
}

// Watch the rendered job — if it just completed, auto-jump into the course.
// This works regardless of which path (SW or in-page) finished the work.
onJobsChange(() => {
  if (!renderedJobId) return;
  const j = getJob(renderedJobId);
  if (j && j.status === 'completed' && j.savedCourseId && !autoJumpedFor.has(renderedJobId)) {
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
    if (!modal || modal.style.display === 'none') { stopElapsedTimer(); return; }
    const job = getJob(jobId);
    if (!job || (job.status !== 'running' && job.status !== 'cancelling')) { stopElapsedTimer(); return; }
    const el = modal.querySelector('[data-elapsed]');
    if (el && job.startedAt) el.textContent = formatElapsed(Date.now() - job.startedAt) + ' elapsed';
  }, 1000);
}
function stopElapsedTimer() {
  if (elapsedTimer) { clearInterval(elapsedTimer); elapsedTimer = null; }
}

function renderProgress(jobId) {
  renderedJobId = jobId;
  const card = modal.querySelector('.intake-card');
  const job = getJob(jobId);
  card.innerHTML = progressHTML(job);
  wireProgressActions(card, jobId);
  startElapsedTimer(jobId);

  if (unsubJob) unsubJob();
  unsubJob = onJobsChange(() => {
    const j = getJob(jobId);
    if (!j) { close(); return; }
    updateProgressUI(card, j);
  });
}

function progressHTML(job) {
  const stage = job?.stage || 'intake';
  const status = job?.status || 'running';
  const isRunning = status === 'running';
  const isCancelling = status === 'cancelling';
  const isFailed = status === 'failed';
  const isInterrupted = status === 'interrupted';
  const canResume = hasCheckpoint(job);
  const pct = computeProgressPct(job);
  const elapsed = job?.startedAt ? formatElapsed(Date.now() - job.startedAt) : '';
  return `
    <button class="intake-close" type="button" aria-label="Close"
      title="Close (generation keeps running in the background)">
      <svg width="18" height="18"><use href="#icon-x"/></svg>
    </button>
    <h2 class="intake-title" data-job-title>${escape(job?.title || 'Generating your course…')}</h2>
    <p class="intake-sub" data-msg>${escape(job?.message || '')}</p>

    ${isRunning || isCancelling ? `
      <div class="intake-progress">
        <div class="intake-progress-meta">
          <span class="intake-progress-pct" data-pct>${pct}%</span>
          ${elapsed ? `<span class="intake-progress-elapsed" data-elapsed>${escape(elapsed)} elapsed</span>` : ''}
        </div>
        <div class="intake-progress-bar"><div class="intake-progress-fill" style="width: ${pct}%"></div></div>
      </div>` : ''}

    <div class="intake-stages">
      ${stageHTML('intake', 'Outline', stage, status)}
      ${stageHTML('research', 'Research', stage, status)}
      ${stageHTML('topics', `Topics ${job?.topicsTotal ? `${job.topicsDone}/${job.topicsTotal}` : ''}`.trim(), stage, status, 'topics-label')}
      ${stageHTML('done', 'Ready', stage, status)}
    </div>

    <div class="intake-outline" data-outline>${outlineHTML(job)}</div>
    ${(job?.failures || []).length ? failuresHTML(job.failures) : ''}
    <div class="intake-error" data-error style="${isFailed || isInterrupted ? '' : 'display:none'}">
      ${isFailed ? escape('Generation failed: ' + (job.error || 'unknown error')) : ''}
      ${isInterrupted ? (canResume ? 'Generation was interrupted. Your progress is saved — Resume to pick up where it stopped.' : 'Generation was interrupted (page refresh or closed tab). No progress was saved — Retry restarts from scratch.') : ''}
    </div>
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
    ${isFailed || isInterrupted ? `
      <div class="intake-actions">
        <button type="button" class="intake-cancel intake-cancel--danger" data-delete>Delete</button>
        <button type="button" class="intake-submit" data-${canResume ? 'resume' : 'retry'}>${canResume ? 'Resume' : 'Retry'}</button>
      </div>
    ` : ''}`;
}

function updateProgressUI(card, job) {
  // Light-touch: re-render the whole inner sheet from the latest job state.
  // The modal stays open across re-renders; only its contents swap.
  card.innerHTML = progressHTML(job);
  wireProgressActions(card, job.id);
}

function wireProgressActions(card, jobId) {
  card.querySelector('.intake-close')?.addEventListener('click', close);
  card.querySelector('[data-retry]')?.addEventListener('click', () => retry(jobId));
  card.querySelector('[data-resume]')?.addEventListener('click', async () => {
    // Route by where the job actually ran — a cloud resume for an SW job
    // 404s, an SW resume for a cloud job no-ops. Both leave the user stuck.
    const job = getJob(jobId);
    if (job?.runner === 'cloud' && cloudGenAvailable()) {
      try { await resumeCloudGeneration(jobId); return; }
      catch (err) { console.warn('[intake] cloud resume failed:', err.message); }
    }
    const ok = await swResume(jobId);
    if (!ok) retry(jobId);
  });
  card.querySelector('[data-cancel]')?.addEventListener('click', () => {
    if (!confirm('Cancel this generation? Anything created so far will be discarded.')) return;
    const job = getJob(jobId);
    if (job?.runner === 'cloud') cancelCloudGeneration(jobId);
    else swCancel(jobId);
    close();
  });
  card.querySelector('[data-delete]')?.addEventListener('click', () => {
    if (!confirm('Delete this generation? Any partial work will be lost.')) return;
    const j = getJob(jobId);
    if (j?.savedCourseId) {
      import('./user-courses.js').then(m => m.removeUserCourse(j.savedCourseId));
    }
    removeJob(jobId);
    close();
  });
}

function stageHTML(name, label, currentStage, status, dataAttr) {
  const order = ['intake', 'research', 'topics', 'assemble', 'done'];
  const ix = order.indexOf(name);
  const cur = order.indexOf(currentStage);
  let cls = '';
  if (status === 'completed' || (cur > ix)) cls = 'done';
  else if (cur === ix && status === 'running') cls = 'active';
  else if (status === 'failed' || status === 'interrupted') cls = '';
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

function retry(jobId) {
  const j = getJob(jobId);
  if (!j) { close(); return; }
  // Mark the existing record as running again and restart from scratch using the same brief.
  updateJob(jobId, { status: 'running', stage: 'intake', message: 'Retrying…', error: null, topicsDone: 0, topicsTotal: 0, outline: null });
  startGeneration(jobId, j.brief);
  renderProgress(jobId);
}

function escape(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/** Overall progress as 0..100 based on which stages have happened.
 *  Stages get rough weights, then within Stage 3 we lerp with topics done.
 *  Stage budget: fetch 0–5 · intake 5–15 · research 15–35 · topics 35–95 · assemble 95–100. */
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

  if (stage === 'intake')   return cp.brief ? 15 : 10;
  if (stage === 'research') {
    if (!modulesTotal) return 20;
    return Math.round(15 + 20 * Math.min(1, modulesDone / modulesTotal));
  }
  if (stage === 'topics') {
    if (!topicsTotal) return 35;
    return Math.round(35 + 60 * Math.min(1, topicsDone / topicsTotal));
  }
  if (stage === 'assemble') return 97;
  if (stage === 'done')     return 100;
  return 5;
}

function formatElapsed(ms) {
  if (!Number.isFinite(ms) || ms < 0) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60), rs = s % 60;
  return `${m}m ${rs.toString().padStart(2, '0')}s`;
}

/** Collapsible "Failures (N)" section that shows each topic error in full.
 *  Deduped by module/topic (keeping the most recent attempt) so retries don't
 *  inflate the count — "22 topics failed" on a 12-topic course confuses. */
function failuresHTML(rawFailures) {
  if (!rawFailures || !rawFailures.length) return '';
  const byKey = new Map();
  for (const f of rawFailures) byKey.set(`${f.moduleId}/${f.topicId}`, f); // later entries win
  const failures = [...byKey.values()];
  return `
    <details class="intake-failures">
      <summary>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>
        </svg>
        ${failures.length} topic${failures.length === 1 ? '' : 's'} failed — click for details
      </summary>
      <ul class="intake-failures-list">
        ${failures.map(f => failureItemHTML(f)).join('')}
      </ul>
    </details>`;
}

function failureItemHTML(f) {
  const att = (f.attempts || []).map((a, i) => {
    if (a.kind === 'schema') {
      return `<li class="intake-failure-attempt"><strong>Attempt ${i + 1} (schema):</strong> <code>${escape(a.message)}</code>${a.issues?.length ? `<ul class="intake-failure-issues">${a.issues.map(x => `<li>${escape(x)}</li>`).join('')}${a.more ? `<li class="intake-failure-more">… and ${a.more} more</li>` : ''}</ul>` : ''}</li>`;
    }
    if (a.kind === 'api') {
      return `<li class="intake-failure-attempt"><strong>Attempt ${i + 1} (API ${escape(String(a.status))}${a.type ? ` ${escape(a.type)}` : ''}):</strong> <code>${escape(a.message)}</code></li>`;
    }
    return `<li class="intake-failure-attempt"><strong>Attempt ${i + 1}:</strong> <code>${escape(a.message || 'unknown')}</code></li>`;
  }).join('');
  const moduleTopic = `${escape(f.moduleId)} / ${escape(f.topicId)}`;
  return `
    <li class="intake-failure">
      <div class="intake-failure-head">
        <div class="intake-failure-title">${escape(f.topicTitle || f.topicId)}</div>
        <div class="intake-failure-meta">${moduleTopic}</div>
      </div>
      <div class="intake-failure-summary">${escape(f.error || 'unknown')}</div>
      ${att ? `<ul class="intake-failure-attempts">${att}</ul>` : ''}
    </li>`;
}
