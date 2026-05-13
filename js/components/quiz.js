import { store } from '../store.js';

export function renderQuiz(section) {
  if (section.variant === 'multiple-choice') {
    return renderMultipleChoice(section);
  } else if (section.variant === 'drag-match') {
    return renderDragMatch(section);
  }
  return '';
}

function renderMultipleChoice(section) {
  const saved = store.getQuizAnswer(section.id);

  return `
    <div class="quiz-block" data-quiz-id="${section.id}" data-variant="multiple-choice" data-correct="${section.correct}">
      <div class="quiz-header">
        <span class="quiz-badge">Quiz</span>
      </div>
      <p class="quiz-question">${section.question}</p>
      <div class="quiz-options">
        ${section.options.map(opt => `
          <button class="quiz-option" data-option="${opt.id}">
            <span class="quiz-option-letter">${opt.id.toUpperCase()}</span>
            <span class="quiz-option-text">${opt.text}</span>
            <span class="quiz-option-icon"></span>
          </button>
        `).join('')}
      </div>
      <div class="quiz-actions">
        <button class="quiz-check-btn" disabled>Check Answer</button>
        <button class="quiz-retry-btn" style="display:none" onclick="this.closest('.quiz-block').classList.remove('answered');this.closest('.quiz-block').querySelectorAll('.quiz-option').forEach(o=>{o.classList.remove('selected','correct','incorrect')});this.style.display='none';this.previousElementSibling.style.display='';this.previousElementSibling.disabled=true;this.closest('.quiz-block').querySelector('.quiz-explanation').style.display='none'">Try Again</button>
      </div>
      <div class="quiz-explanation" style="display:none">
        <div class="quiz-explanation-content">${section.explanation || ''}</div>
      </div>
    </div>`;
}

function renderDragMatch(section) {
  const shuffledRight = [...section.pairs].sort(() => Math.random() - 0.5);
  const correctPairs = {};
  section.pairs.forEach(p => { correctPairs[p.left] = p.right; });

  return `
    <div class="quiz-block drag-match" data-quiz-id="${section.id}" data-variant="drag-match" data-correct-pairs='${JSON.stringify(correctPairs)}'>
      <div class="quiz-header">
        <span class="quiz-badge">Match</span>
      </div>
      <p class="quiz-question">${section.question}</p>
      <p class="quiz-hint-text">Click a term on the left, then click its match on the right. Or drag and drop.</p>
      <div class="drag-match-container">
        <div class="drag-match-column">
          ${section.pairs.map(p => `
            <div class="drag-left-item" data-left="${p.left}" draggable="true">
              ${p.left}
            </div>
          `).join('')}
        </div>
        <div class="drag-match-column">
          ${shuffledRight.map(p => `
            <div class="drag-right-item" data-right="${p.right}">
              ${p.right}
            </div>
          `).join('')}
        </div>
      </div>
      <div class="quiz-actions">
        <button class="quiz-check-btn" disabled>Check Matches</button>
      </div>
      <div class="quiz-explanation" style="display:none">
        <div class="quiz-explanation-content">${section.explanation || 'Great job matching the concepts!'}</div>
      </div>
    </div>`;
}
