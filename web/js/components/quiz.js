import { renderMatchQuiz } from './match-quiz.js?v=2';
import { store } from '../store.js?v=5';
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

export function renderQuiz(section) {
  switch (section.variant) {
    case 'multiple-choice': return renderMultipleChoice(section);
    case 'drag-match': return renderMatchQuiz(section);
    case 'true-false': return renderTrueFalse(section);
    case 'fill-in-blank': return renderFillInBlank(section);
    case 'short-answer': return renderShortAnswer(section);
    default: return '';
  }
}

function renderTrueFalse(section) {
  return `
    <div class="quiz-block" data-quiz-id="${esc(section.id)}" data-variant="true-false" data-correct="${esc(section.correct)}">
      <div class="quiz-header">
        <span class="quiz-badge">True or False</span>
      </div>
      <p class="quiz-question quiz-tf-statement">${esc(section.statement)}</p>
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
      <div class="quiz-explanation" tabindex="-1" role="group" aria-label="Answer feedback" style="display:none">
        <p class="quiz-result-message"></p>
        <div class="quiz-explanation-content">${esc(section.explanation || '')}</div>
        <button class="quiz-retry-btn" type="button" style="display:none">Try Again</button>
      </div>
    </div>`;
}

function renderFillInBlank(section) {
  // Split the sentence at the ___ marker for a clean input slot.
  const parts = section.sentence.split('___');
  const before = parts[0] || '';
  const after = parts.slice(1).join('___') || '';

  return `
    <div class="quiz-block" data-quiz-id="${esc(section.id)}" data-variant="fill-in-blank"
         data-acceptable='${esc(JSON.stringify(section.acceptable_answers))}'>
      <div class="quiz-header">
        <span class="quiz-badge">Fill in the Blank</span>
      </div>
      <p class="quiz-fib-sentence">
        <span class="quiz-fib-before">${esc(before)}</span>
        <input type="text" class="quiz-fib-input" aria-label="${esc(`Fill in the blank: ${section.sentence.replace('___', '[blank]')}`)}" placeholder="…" autocomplete="off" spellcheck="false"/>
        <span class="quiz-fib-after">${esc(after)}</span>
      </p>
      <div class="quiz-actions">
        <button class="quiz-check-btn" disabled>Check Answer</button>
      </div>
      <div class="quiz-explanation" tabindex="-1" role="group" aria-label="Answer feedback" style="display:none">
        <div class="quiz-fib-correct"></div>
        <div class="quiz-explanation-content">${esc(section.explanation || '')}</div>
        <button class="quiz-retry-btn" type="button" style="display:none">Try Again</button>
      </div>
    </div>`;
}

function renderShortAnswer(section) {
  const keyPoints = (section.key_points || []).map(p => `<li>${esc(p)}</li>`).join('');
  return `
    <div class="quiz-block" data-quiz-id="${esc(section.id)}" data-variant="short-answer">
      <div class="quiz-header">
        <span class="quiz-badge">Open-Ended</span>
      </div>
      <p class="quiz-question">${esc(section.question)}</p>
      <textarea class="quiz-sa-input" aria-label="${esc(section.question)}" rows="5" placeholder="Write your answer here. There's no single right answer — you'll compare against a sample."></textarea>
      <div class="quiz-actions">
        <button class="quiz-check-btn" disabled>Reveal Sample Answer</button>
      </div>
      <div class="quiz-explanation quiz-sa-reveal" tabindex="-1" role="group" aria-label="Sample answer and review points" style="display:none">
        <div class="quiz-sa-label">Sample answer</div>
        <div class="quiz-sa-sample">${esc(section.sample_answer || '')}</div>
        ${keyPoints ? `<div class="quiz-sa-label">Did your answer cover these?</div><ul class="quiz-sa-keypoints">${keyPoints}</ul>` : ''}
        ${section.explanation ? `<div class="quiz-explanation-content">${esc(section.explanation)}</div>` : ''}
      </div>
    </div>`;
}

function renderMultipleChoice(section) {
  const saved = store.getQuizAnswer(section.id);

  return `
    <div class="quiz-block" data-quiz-id="${esc(section.id)}" data-variant="multiple-choice" data-correct="${esc(section.correct)}">
      <div class="quiz-header">
        <span class="quiz-badge">Quiz</span>
      </div>
      <p class="quiz-question">${esc(section.question)}</p>
      <div class="quiz-options">
        ${section.options.map(opt => `
          <button class="quiz-option" data-option="${esc(opt.id)}">
            <span class="quiz-option-letter">${esc(opt.id.toUpperCase())}</span>
            <span class="quiz-option-text">${esc(opt.text)}</span>
            <span class="quiz-option-icon"></span>
          </button>
        `).join('')}
      </div>
      <div class="quiz-actions">
        <button class="quiz-check-btn" disabled>Check Answer</button>
      </div>
      <div class="quiz-explanation" tabindex="-1" role="group" aria-label="Answer feedback" style="display:none">
        <p class="quiz-result-message"></p>
        <div class="quiz-explanation-content">${esc(section.explanation || '')}</div>
        <button class="quiz-retry-btn" type="button" style="display:none">Try Again</button>
      </div>
    </div>`;
}
