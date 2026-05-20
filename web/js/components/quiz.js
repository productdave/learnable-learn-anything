import { store } from '../store.js';

export function renderQuiz(section) {
  switch (section.variant) {
    case 'multiple-choice': return renderMultipleChoice(section);
    case 'drag-match': return renderDragMatch(section);
    case 'true-false': return renderTrueFalse(section);
    case 'fill-in-blank': return renderFillInBlank(section);
    case 'short-answer': return renderShortAnswer(section);
    default: return '';
  }
}

function renderTrueFalse(section) {
  return `
    <div class="quiz-block" data-quiz-id="${section.id}" data-variant="true-false" data-correct="${section.correct}">
      <div class="quiz-header">
        <span class="quiz-badge">True or False</span>
      </div>
      <p class="quiz-question quiz-tf-statement">${section.statement}</p>
      <div class="quiz-tf-options">
        <button class="quiz-tf-btn" data-option="true">
          <span class="quiz-tf-letter">T</span>
          <span class="quiz-tf-text">True</span>
          <span class="quiz-option-icon"></span>
        </button>
        <button class="quiz-tf-btn" data-option="false">
          <span class="quiz-tf-letter">F</span>
          <span class="quiz-tf-text">False</span>
          <span class="quiz-option-icon"></span>
        </button>
      </div>
      <div class="quiz-actions">
        <button class="quiz-check-btn" disabled>Check Answer</button>
      </div>
      <div class="quiz-explanation" style="display:none">
        <div class="quiz-explanation-content">${section.explanation || ''}</div>
      </div>
    </div>`;
}

function renderFillInBlank(section) {
  // Split the sentence at the ___ marker for a clean input slot.
  const parts = section.sentence.split('___');
  const before = parts[0] || '';
  const after = parts.slice(1).join('___') || '';

  return `
    <div class="quiz-block" data-quiz-id="${section.id}" data-variant="fill-in-blank"
         data-acceptable='${JSON.stringify(section.acceptable_answers)}'>
      <div class="quiz-header">
        <span class="quiz-badge">Fill in the Blank</span>
      </div>
      <p class="quiz-fib-sentence">
        <span class="quiz-fib-before">${before}</span>
        <input type="text" class="quiz-fib-input" placeholder="…" autocomplete="off" spellcheck="false"/>
        <span class="quiz-fib-after">${after}</span>
      </p>
      <div class="quiz-actions">
        <button class="quiz-check-btn" disabled>Check Answer</button>
      </div>
      <div class="quiz-explanation" style="display:none">
        <div class="quiz-fib-correct"></div>
        <div class="quiz-explanation-content">${section.explanation || ''}</div>
      </div>
    </div>`;
}

function renderShortAnswer(section) {
  const keyPoints = (section.key_points || []).map(p => `<li>${p}</li>`).join('');
  return `
    <div class="quiz-block" data-quiz-id="${section.id}" data-variant="short-answer">
      <div class="quiz-header">
        <span class="quiz-badge">Open-Ended</span>
      </div>
      <p class="quiz-question">${section.question}</p>
      <textarea class="quiz-sa-input" rows="5" placeholder="Write your answer here. There's no single right answer — you'll compare against a sample."></textarea>
      <div class="quiz-actions">
        <button class="quiz-check-btn" disabled>Reveal Sample Answer</button>
      </div>
      <div class="quiz-explanation quiz-sa-reveal" style="display:none">
        <div class="quiz-sa-label">Sample answer</div>
        <div class="quiz-sa-sample">${section.sample_answer || ''}</div>
        ${keyPoints ? `<div class="quiz-sa-label">Did your answer cover these?</div><ul class="quiz-sa-keypoints">${keyPoints}</ul>` : ''}
        ${section.explanation ? `<div class="quiz-explanation-content">${section.explanation}</div>` : ''}
      </div>
    </div>`;
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
