import { store } from '../store.js';

export function renderExercise(section) {
  const saved = store.getExerciseDraft(section.id);
  const savedText = saved?.text || section.template || '';
  const savedTime = saved?.savedAt ? new Date(saved.savedAt).toLocaleString() : null;

  return `
    <div class="exercise-block" data-exercise-id="${section.id}">
      <div class="exercise-header">
        <div class="exercise-header-left">
          <svg width="20" height="20"><use href="#icon-save"/></svg>
          <h3 class="exercise-title">${section.title}</h3>
        </div>
        <span class="exercise-badge">Exercise</span>
      </div>
      <p class="exercise-prompt">${section.prompt}</p>
      ${section.hints ? `
        <div class="exercise-hints">
          <button class="exercise-hints-toggle">
            <svg width="14" height="14"><use href="#icon-lightbulb"/></svg>
            Show Hints
          </button>
          <ul class="exercise-hints-list" style="display:none">
            ${section.hints.map(h => `<li>${h}</li>`).join('')}
          </ul>
        </div>` : ''}
      <div class="exercise-editor">
        <textarea class="exercise-textarea" placeholder="Start writing here..." rows="8">${savedText}</textarea>
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
  container.querySelectorAll('.exercise-block').forEach(el => {
    const id = el.dataset.exerciseId;
    const textarea = el.querySelector('.exercise-textarea');
    const wordCount = el.querySelector('.exercise-word-count');
    const savedTimeEl = el.querySelector('.exercise-saved-time');
    const hintsToggle = el.querySelector('.exercise-hints-toggle');
    const hintsList = el.querySelector('.exercise-hints-list');
    const resetBtn = el.querySelector('.exercise-reset-btn');
    let saveTimeout;

    function updateWordCount() {
      const text = textarea.value.trim();
      const count = text ? text.split(/\s+/).length : 0;
      wordCount.textContent = `${count} word${count !== 1 ? 's' : ''}`;
    }

    updateWordCount();

    textarea.addEventListener('input', () => {
      updateWordCount();
      clearTimeout(saveTimeout);
      saveTimeout = setTimeout(() => {
        store.saveExerciseDraft(id, textarea.value);
        if (savedTimeEl) {
          savedTimeEl.textContent = `Saved just now`;
        } else {
          const footer = el.querySelector('.exercise-footer-left');
          const span = document.createElement('span');
          span.className = 'exercise-saved-time';
          span.textContent = 'Saved just now';
          footer.appendChild(span);
        }
      }, 500);
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
        if (confirm('Reset to the original template? Your current work will be lost.')) {
          const section = findExerciseData(id);
          textarea.value = section?.template || '';
          updateWordCount();
          store.saveExerciseDraft(id, textarea.value);
        }
      });
    }
  });
}

function findExerciseData(exerciseId) {
  return null;
}
