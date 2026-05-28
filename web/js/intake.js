// Intake modal — "What do you want to learn?"
// Opens from the library's "+ Generate" button (or by clicking a running job
// card on the dashboard, to attach to that job's progress). The generation
// itself runs as a registered "job" persisted to localStorage so the dashboard
// can show progress even when the modal is closed, and survive accidental
// dismissal. (A real page refresh kills the in-flight API calls — those jobs
// land as 'interrupted' with a Retry option.)

import { hasApiKey, setApiKey, generateCourse } from './generator/index.js';
import { saveUserCourse } from './user-courses.js';
import { kickSync } from './sync.js?v=2';
import { createJob, updateJob, getJob, onJobsChange, removeJob } from './jobs.js';

let modal = null;
let unsubJob = null;        // currently-rendered job's listener
let renderedJobId = null;

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

      <details class="intake-section">
        <summary>Add source material <span class="intake-summary-hint">(optional — paste text or URLs)</span></summary>
        <p class="intake-help">If you've already got an article, transcript, or notes you want the course built from, paste them here. URLs (one per line) get fetched and used as primary sources.</p>
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

  if (!topic && !sourceText && !sourceUrls.length) {
    err.style.display = ''; err.textContent = 'Enter a topic, paste some text, or add a URL.';
    return;
  }

  const userBrief = {
    topic: topic || '(infer from source material)',
    goal: (fd.get('goal') || '').trim() || undefined,
    starting_point: (fd.get('starting_point') || '').trim() || undefined,
    depth: fd.get('depth') || 'Solid foundation',
    tone: 'conversational',
    source_text: sourceText || undefined,
    source_urls: sourceUrls
  };

  const job = createJob(userBrief);
  startGeneration(job.id, userBrief);
  renderProgress(job.id);
}

// Kicks off the generator promise and threads progress into the job.
// The promise runs independently of the modal; closing the modal doesn't
// cancel it.
function startGeneration(jobId, userBrief) {
  generateCourse(userBrief, (p) => {
    if (p.stage === 'intake')      updateJob(jobId, { stage: 'intake',  message: 'Designing the outline…' });
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
  }).then(course => {
    const savedId = saveUserCourse(course);
    updateJob(jobId, { status: 'completed', stage: 'done', message: 'Done!', savedCourseId: savedId });
    // If the user is still watching this job's modal, jump them into the course
    // via SPA navigation (no full reload, so any other background work keeps running).
    if (renderedJobId === jobId) {
      setTimeout(() => {
        close();
        history.pushState(null, '', `?course=${encodeURIComponent(savedId)}`);
        window.dispatchEvent(new PopStateEvent('popstate'));
      }, 700);
    }
  }).catch(err => {
    updateJob(jobId, { status: 'failed', error: err.message || String(err) });
    console.error('[intake] generation failed:', err);
  });
}

// ---- progress view (reads live from the job in localStorage) -----

function renderProgress(jobId) {
  renderedJobId = jobId;
  const card = modal.querySelector('.intake-card');
  const job = getJob(jobId);
  card.innerHTML = progressHTML(job);
  card.querySelector('.intake-close').addEventListener('click', close);
  card.querySelector('[data-retry]')?.addEventListener('click', () => retry(jobId));
  card.querySelector('[data-dismiss]')?.addEventListener('click', () => { removeJob(jobId); close(); });

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
  return `
    <button class="intake-close" type="button" aria-label="Close"
      title="Close (generation keeps running in the background)">
      <svg width="18" height="18"><use href="#icon-x"/></svg>
    </button>
    <h2 class="intake-title" data-job-title>${escape(job?.title || 'Generating your course…')}</h2>
    <p class="intake-sub" data-msg>${escape(job?.message || '')}</p>

    <div class="intake-stages">
      ${stageHTML('intake', 'Outline', stage, status)}
      ${stageHTML('research', 'Research', stage, status)}
      ${stageHTML('topics', `Topics ${job?.topicsTotal ? `${job.topicsDone}/${job.topicsTotal}` : ''}`.trim(), stage, status, 'topics-label')}
      ${stageHTML('done', 'Ready', stage, status)}
    </div>

    <div class="intake-outline" data-outline>${outlineHTML(job)}</div>
    <div class="intake-error" data-error style="${status === 'failed' || status === 'interrupted' ? '' : 'display:none'}">
      ${status === 'failed' ? escape('Generation failed: ' + (job.error || 'unknown error')) : ''}
      ${status === 'interrupted' ? 'Generation was interrupted (page refresh or closed tab). The in-flight calls were lost.' : ''}
    </div>
    ${status === 'failed' || status === 'interrupted' ? `
      <div class="intake-actions">
        <button type="button" class="intake-cancel" data-dismiss>Dismiss</button>
        <button type="button" class="intake-submit" data-retry>Retry</button>
      </div>
    ` : ''}`;
}

function updateProgressUI(card, job) {
  // Light-touch: re-render the whole inner sheet from the latest job state.
  // The modal stays open across re-renders; only its contents swap.
  card.innerHTML = progressHTML(job);
  card.querySelector('.intake-close').addEventListener('click', close);
  card.querySelector('[data-retry]')?.addEventListener('click', () => retry(job.id));
  card.querySelector('[data-dismiss]')?.addEventListener('click', () => { removeJob(job.id); close(); });
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
