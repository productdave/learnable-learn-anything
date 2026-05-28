// Intake modal — "What do you want to learn?"
// Opens from the library's "+ Generate" button, collects the brief (topic +
// optional source material + tuning fields + API key), runs the browser-side
// generator with a live progress view, saves the result, and navigates to it.

import { hasApiKey, setApiKey, generateCourse } from './generator/index.js';
import { saveUserCourse } from './user-courses.js';

let modal = null;

function ensureModal() {
  if (modal) return modal;
  modal = document.createElement('div');
  modal.id = 'intake-modal';
  modal.className = 'intake-modal';
  modal.style.display = 'none';
  modal.innerHTML = `<div class="intake-card" role="dialog" aria-modal="true"></div>`;
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  document.body.appendChild(modal);
  return modal;
}

function close() { if (modal) modal.style.display = 'none'; }

export function openIntake() {
  ensureModal();
  modal.style.display = '';
  renderForm();
}

// ---- form ---------------------------------------------------------

function renderForm() {
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
          <span class="intake-label-text">Anthropic API key — runs in your browser, never leaves your device</span>
          <input class="intake-input intake-mono" type="password" name="apiKey"
            placeholder="sk-ant-..." autocomplete="off" spellcheck="false">
          <small class="intake-help">Get one at <a href="https://console.anthropic.com/" target="_blank" rel="noopener">console.anthropic.com</a>. Roughly $1–3 of credit per course.</small>
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
  if (apiKeyInput) setApiKey(apiKeyInput);
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
  renderProgress(userBrief);
}

// ---- progress -----------------------------------------------------

function renderProgress(userBrief) {
  modal.querySelector('.intake-card').innerHTML = `
    <button class="intake-close" type="button" aria-label="Close"
      title="Close (generation will continue in the background)">
      <svg width="18" height="18"><use href="#icon-x"/></svg>
    </button>
    <h2 class="intake-title">Generating your course…</h2>
    <p class="intake-sub" data-msg>Designing the outline.</p>

    <div class="intake-stages">
      <div class="intake-stage" data-stage="intake"><span class="intake-stage-dot"></span><span>Outline</span></div>
      <div class="intake-stage" data-stage="research"><span class="intake-stage-dot"></span><span>Research</span></div>
      <div class="intake-stage" data-stage="topics"><span class="intake-stage-dot"></span><span data-topics-label>Topics</span></div>
      <div class="intake-stage" data-stage="done"><span class="intake-stage-dot"></span><span>Ready</span></div>
    </div>

    <div class="intake-outline" data-outline></div>
    <div class="intake-error" data-error style="display:none"></div>
  `;
  const card = modal.querySelector('.intake-card');
  card.querySelector('.intake-close').addEventListener('click', close);

  const setActive = (name) => {
    card.querySelectorAll('.intake-stage').forEach(el => el.classList.remove('active'));
    card.querySelector(`.intake-stage[data-stage="${name}"]`)?.classList.add('active');
  };
  const setDone = (name) => card.querySelector(`.intake-stage[data-stage="${name}"]`)?.classList.add('done');
  const msg = card.querySelector('[data-msg]');
  const outlineEl = card.querySelector('[data-outline]');
  const topicsLabel = card.querySelector('[data-topics-label]');
  const errEl = card.querySelector('[data-error]');

  setActive('intake');

  generateCourse(userBrief, (p) => {
    if (p.stage === 'intake') { setActive('intake'); msg.textContent = 'Designing the course outline…'; }
    else if (p.stage === 'intake_done') {
      setDone('intake'); setActive('research');
      const b = p.brief;
      outlineEl.innerHTML = `
        <div class="intake-outline-card">
          <div class="intake-outline-title">${b.title}</div>
          <div class="intake-outline-sub">${b.subtitle}</div>
          <ul class="intake-outline-list">
            ${b.modules.map(m => `<li><strong>${m.title}</strong><span>${m.topics.length} topic${m.topics.length === 1 ? '' : 's'}</span></li>`).join('')}
          </ul>
        </div>`;
      msg.textContent = `Researching ${b.modules.length} module${b.modules.length === 1 ? '' : 's'} in parallel…`;
    }
    else if (p.stage === 'topics') {
      setDone('research'); setActive('topics');
      topicsLabel.textContent = `Topics 0/${p.total}`;
      msg.textContent = 'Writing topic content…';
    }
    else if (p.stage === 'topic_done' || p.stage === 'topic_failed') {
      topicsLabel.textContent = `Topics ${p.done}/${p.total}`;
    }
    else if (p.stage === 'assemble') {
      setDone('topics'); msg.textContent = 'Finalising…';
    }
    else if (p.stage === 'done') {
      setDone('topics'); setActive('done'); setDone('done');
      const finalId = saveUserCourse(p.course);
      msg.textContent = 'Done! Opening your course…';
      setTimeout(() => { window.location.href = `?course=${encodeURIComponent(finalId)}`; }, 700);
    }
  }).catch(err => {
    console.error('[intake] generation failed:', err);
    errEl.style.display = ''; errEl.textContent = `Generation failed: ${err.message}`;
  });
}
