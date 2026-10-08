import { store } from '../store.js?v=5';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));

export function renderExercise(section) {
  const saved = store.getExerciseDraft(section.id);
  const savedText = saved?.text || section.template || '';
  const savedTime = saved?.savedAt ? new Date(saved.savedAt).toLocaleString() : null;

  return `
    <div class="exercise-block" data-exercise-id="${esc(section.id)}">
      <div class="exercise-header">
        <div class="exercise-header-left">
          <svg width="20" height="20"><use href="#icon-save"/></svg>
          <h3 class="exercise-title">${esc(section.title)}</h3>
        </div>
        <span class="exercise-badge">Exercise</span>
      </div>
      <p class="exercise-prompt">${esc(section.prompt)}</p>
      ${section.hints ? `
        <div class="exercise-hints">
          <button class="exercise-hints-toggle">
            <svg width="14" height="14"><use href="#icon-lightbulb"/></svg>
            Show Hints
          </button>
          <ul class="exercise-hints-list" style="display:none">
            ${section.hints.map(h => `<li>${esc(h)}</li>`).join('')}
          </ul>
        </div>` : ''}
      <div class="exercise-editor">
        <textarea class="exercise-textarea" aria-label="${esc(section.title)} response" placeholder="Start writing here..." rows="8">${esc(savedText)}</textarea>
        <div class="exercise-footer">
          <div class="exercise-footer-left">
            <span class="exercise-word-count">0 words</span>
            ${savedTime ? `<span class="exercise-saved-time">Last saved: ${savedTime}</span>` : ''}
          </div>
          <div class="exercise-footer-right">
            <button class="exercise-reset-btn">Reset</button>
          </div>
        </div>
      </div>
    </div>`;
}

export function initExerciseInteractivity(container) {
  const progress = store.bind();
  container.querySelectorAll('.exercise-block').forEach(el => {
    const id = el.dataset.exerciseId;
    const textarea = el.querySelector('.exercise-textarea');
    const wordCount = el.querySelector('.exercise-word-count');
    let savedTimeEl = el.querySelector('.exercise-saved-time');
    const hintsToggle = el.querySelector('.exercise-hints-toggle');
    const hintsList = el.querySelector('.exercise-hints-list');
    const resetBtn = el.querySelector('.exercise-reset-btn');

    function updateWordCount() {
      const text = textarea.value.trim();
      const count = text ? text.split(/\s+/).length : 0;
      wordCount.textContent = `${count} word${count !== 1 ? 's' : ''}`;
    }

    updateWordCount();

    textarea.addEventListener('input', () => {
      textarea.dataset.edited = 'true';
      updateWordCount();
      // Save the current input immediately so leaving within the old debounce
      // window cannot lose it or move it to a different learner/course.
        const result = progress.saveExerciseDraft(id, textarea.value);
        const message = result.stale ? 'Account changed. Reopen this lesson to continue.' : result.ok ? 'Saved just now' : 'Not saved yet. Keep this page open and retry.';
        if (savedTimeEl) {
          savedTimeEl.textContent = message;
        } else {
          const footer = el.querySelector('.exercise-footer-left');
          const span = document.createElement('span');
          span.className = 'exercise-saved-time';
          span.textContent = message;
          footer.appendChild(span);
          savedTimeEl = span;
        }
        savedTimeEl.dataset.saveFailed = String(!result.ok && !result.stale);
    });

    if (hintsToggle) {
      hintsToggle.addEventListener('click', () => {
        const isVisible = hintsList.style.display !== 'none';
        hintsList.style.display = isVisible ? 'none' : '';
        hintsToggle.textContent = isVisible ? 'Show Hints' : 'Hide Hints';
      });
    }

    if (resetBtn) {
      resetBtn.addEventListener('click', () => {
        if (progress.isCurrent() && confirm('Clear your response? Your current work will be lost.')) {
          textarea.dataset.edited = 'true';
          textarea.value = '';
          updateWordCount();
          progress.saveExerciseDraft(id, textarea.value);
        }
      });
    }
  });
}
