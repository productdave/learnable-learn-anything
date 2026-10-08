import { store } from '../store.js?v=5';

const SKILL_STATES = [
  ['not_started', 'Not yet'],
  ['with_help', 'With help'],
  ['independent_once', 'Once independently'],
  ['independent_consistently', 'Consistent']
];

function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, char => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;'
  }[char]));
}

function renderList(items, className) {
  if (!Array.isArray(items) || items.length === 0) return '';
  return `<ul class="${className}">${items.map(item => `<li>${escapeHtml(item)}</li>`).join('')}</ul>`;
}

export function renderPractice(section, context = {}) {
  const practiceKey = [
    context.courseId,
    context.moduleId,
    context.topicId,
    section.id
  ].filter(Boolean).join('/');
  const saved = store.getPracticeProgress(practiceKey);
  const durationSeconds = Math.max(1, Number(section.durationMinutes) || 15) * 60;
  const general = section.context === 'general';
  const learning = general || section.context === 'learning';

  return `
    <section class="practice-block" data-practice-key="${escapeHtml(practiceKey)}" data-learning="${learning}" data-duration-seconds="${durationSeconds}">
      ${!learning ? `<div class="practice-safety" role="note" aria-label="Pool safety reminder">
        <strong>Stay within arm's reach.</strong>
        <span>Keep constant attention on your child, even with a lifeguard present. Stop immediately if she is distressed, cold, unusually tired, coughing repeatedly, or struggling to breathe.</span>
      </div>` : ''}

      <div class="practice-header">
        <div>
          <span class="practice-eyebrow">${learning ? 'Guided practice' : 'Poolside practice'}</span>
          <h3>${escapeHtml(section.title)}</h3>
          <p>${escapeHtml(section.goal)}</p>
        </div>
        <div class="practice-timer" aria-label="Practice timer">
          <span class="practice-timer-value" aria-label="Time remaining">${String(Math.floor(durationSeconds / 60)).padStart(2, '0')}:00</span>
          <small>Optional timer · pause anytime</small>
          <div class="practice-timer-actions">
            <button type="button" data-timer-action="start">Start</button>
            <button type="button" data-timer-action="pause" disabled>Pause</button>
            <button type="button" data-timer-action="reset">Reset</button>
          </div>
        </div>
      </div>

      ${learning ? `<div class="practice-safety" role="note" aria-label="Practice guidance"><strong>Before you start</strong><span>${escapeHtml(section.guidance || 'Use fictional information. Follow the steps, inspect the result, and record what you can explain independently.')}</span></div>` : ''}
      ${general ? `<div class="practice-stop-rules"><h4>When to pause or stop</h4>${renderList(section.safetyStops, 'practice-compact-list')}</div>` : ''}
      <div class="practice-prep">
        <div>
          <h4>Bring</h4>
          ${renderList(section.equipment, 'practice-compact-list')}
        </div>
        <div>
          <h4>Set up</h4>
          <p>${escapeHtml(section.setup)}</p>
        </div>
      </div>

      <ol class="practice-steps">
        ${(section.steps || []).map((step, index) => {
          const checked = saved.steps?.[index] === true;
          return `
            <li class="${checked ? 'is-complete' : ''}">
              <label class="practice-step-check">
                <input type="checkbox" data-step-index="${index}" ${checked ? 'checked' : ''}>
                <span aria-hidden="true"></span>
                <span class="sr-only">Mark ${escapeHtml(step.title)} complete</span>
              </label>
              <div class="practice-step-body">
                <div class="practice-step-title">${index + 1}. ${escapeHtml(step.title)}</div>
                <p>${escapeHtml(step.instruction)}</p>
                <dl>
                  <div><dt>${learning ? 'Focus' : 'Say'}</dt><dd>“${escapeHtml(step.cue)}”</dd></div>
                  ${step.repetitions ? `<div><dt>Try</dt><dd>${escapeHtml(step.repetitions)}</dd></div>` : ''}
                  <div><dt>Success</dt><dd>${escapeHtml(step.success)}</dd></div>
                </dl>
              </div>
            </li>`;
        }).join('')}
      </ol>

      <div class="practice-adjustments">
        <details>
          <summary>Make it easier</summary>
          ${renderList(section.regressions, 'practice-compact-list')}
        </details>
        <details>
          <summary>Make it harder</summary>
          ${renderList(section.progressions, 'practice-compact-list')}
        </details>
        ${!general ? `<details class="practice-stop-details">
          <summary>${learning ? 'If you get stuck' : 'Stop rules'}</summary>
          ${renderList(section.safetyStops, 'practice-compact-list')}
        </details>` : ''}
      </div>

      <div class="practice-readiness">
        <h4>${learning ? 'Check in with yourself' : 'Readiness check'}</h4>
        <p>${learning ? 'Choose what you can do today. This is self-assessment, not proof of mastery or safety. Revisit the example if you need help.' : 'Move on only when these are calm and repeatable. A completed session is not the same as a mastered skill.'}</p>
        ${(section.readinessChecks || []).map(check => {
          const selected = saved.skills?.[check.id] || 'not_started';
          return `
            <label class="practice-skill-row">
              <span>${escapeHtml(check.label)}</span>
              <select data-skill-id="${escapeHtml(check.id)}" aria-label="${escapeHtml(check.label)} progress">
                ${SKILL_STATES.map(([value, label]) => `<option value="${value}" ${selected === value ? 'selected' : ''}>${label}</option>`).join('')}
              </select>
            </label>`;
        }).join('')}
      </div>
      <div class="practice-save-status" role="status" aria-live="polite"></div>
    </section>`;
}

export function initPracticeInteractivity(container) {
  const progress = store.bind();
  container.querySelectorAll('.practice-block').forEach(block => {
    const practiceKey = block.dataset.practiceKey;
    const duration = Number(block.dataset.durationSeconds) || 900;
    const timerValue = block.querySelector('.practice-timer-value');
    const startButton = block.querySelector('[data-timer-action="start"]');
    const pauseButton = block.querySelector('[data-timer-action="pause"]');
    const resetButton = block.querySelector('[data-timer-action="reset"]');
    const status = block.querySelector('.practice-save-status');
    let remaining = duration;
    let timerId = null;

    const paintTimer = () => {
      const minutes = Math.floor(remaining / 60);
      const seconds = remaining % 60;
      timerValue.textContent = `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    };
    const stopTimer = () => {
      if (timerId) window.clearInterval(timerId);
      timerId = null;
      startButton.disabled = false;
      pauseButton.disabled = true;
    };

    startButton.addEventListener('click', () => {
      if (timerId || !progress.isCurrent()) return;
      startButton.disabled = true;
      pauseButton.disabled = false;
      status.textContent = block.dataset.learning === 'true' ? 'Timer running. Follow the stop rules and pause whenever needed.' : 'Timer running. Keep watching your child—not the screen.';
      timerId = window.setInterval(() => {
        if (!block.isConnected || !progress.isCurrent() || document.hidden) { stopTimer(); status.textContent = 'Timer paused.'; return; }
        remaining = Math.max(0, remaining - 1);
        paintTimer();
        if (remaining === 0) {
          stopTimer();
          status.textContent = block.dataset.learning === 'true' ? 'Timer finished. Pause and reflect; the timer does not mark the activity complete.' : 'Practice time is up. Finish with an easy success and leave the water together.';
        }
      }, 1000);
    });
    pauseButton.addEventListener('click', () => {
      stopTimer();
      status.textContent = 'Timer paused.';
    });
    resetButton.addEventListener('click', () => {
      stopTimer();
      remaining = duration;
      paintTimer();
      status.textContent = 'Timer reset.';
    });

    block.querySelectorAll('[data-step-index]').forEach(input => {
      input.addEventListener('change', () => {
        const result = progress.savePracticeStep(practiceKey, Number(input.dataset.stepIndex), input.checked);
        input.closest('li')?.classList.toggle('is-complete', input.checked);
        setSaveMessage(status, result);
      });
    });

    block.querySelectorAll('[data-skill-id]').forEach(select => {
      select.addEventListener('change', () => {
        setSaveMessage(status, progress.savePracticeSkill(practiceKey, select.dataset.skillId, select.value));
      });
    });
  });
}

export function saveMessage(result) {
  if (result.stale) return 'Account changed. Reopen this lesson to continue.';
  return result.ok ? 'Progress saved on this device.' : 'Progress is not saved yet. Keep this page open and retry saving below.';
}

export function setSaveMessage(node, result) {
  node.dataset.saveFailed = String(!result.ok && !result.stale);
  node.textContent = saveMessage(result);
}
