import { store } from '../store.js';
import { getCurriculum, getCourseConfig } from '../course-loader.js';
import { renderQuiz } from './quiz.js?v=2';
import { renderExercise, initExerciseInteractivity } from './exercise.js';
import { renderDiagram } from './diagram.js';
import { renderPayoffMatrix, initPayoffMatrixInteractivity } from './payoff-matrix.js';
import { renderSimulator, initSimulatorInteractivity } from './simulator.js';

function renderSection(section, index) {
  switch (section.type) {
    case 'concept': return renderConcept(section, index);
    case 'callout': return renderCallout(section);
    case 'quiz': return renderQuiz(section);
    case 'exercise': return renderExercise(section);
    case 'takeaway': return renderTakeaway(section);
    case 'payoff-matrix': return renderPayoffMatrix(section);
    case 'simulator': return renderSimulator(section);
    default: return '';
  }
}

function renderConcept(section, index) {
  const diagramHtml = section.diagram ? renderDiagram(section.diagram) : '';
  const id = `concept-${index}`;

  if (section.expandable) {
    return `
      <div class="concept-section expandable" id="${id}">
        <button class="concept-header" aria-expanded="false" aria-controls="${id}-body">
          <h3 class="concept-title">${section.title}</h3>
          <svg width="20" height="20" class="concept-chevron"><use href="#icon-chevron-down"/></svg>
        </button>
        <div class="concept-body" id="${id}-body" style="display:none">
          <div class="concept-content">${section.content}</div>
          ${diagramHtml}
        </div>
      </div>`;
  }

  return `
    <div class="concept-section" id="${id}">
      <h3 class="concept-title">${section.title}</h3>
      <div class="concept-content">${section.content}</div>
      ${diagramHtml}
    </div>`;
}

function renderCallout(section) {
  const icons = {
    'key-insight': 'lightbulb',
    'warning': 'alert-triangle',
    'example': 'check-circle',
    'tip': 'lightbulb'
  };
  const icon = icons[section.variant] || 'lightbulb';

  return `
    <div class="callout callout--${section.variant}">
      <div class="callout-icon">
        <svg width="20" height="20"><use href="#icon-${icon}"/></svg>
      </div>
      <div class="callout-content">
        ${section.title ? `<div class="callout-title">${section.title}</div>` : ''}
        <div class="callout-text">${section.content}</div>
      </div>
    </div>`;
}

function renderTakeaway(section) {
  return `
    <div class="takeaway">
      <div class="takeaway-header">
        <svg width="20" height="20"><use href="#icon-trophy"/></svg>
        <h3 class="takeaway-title">Key Takeaways</h3>
      </div>
      <ul class="takeaway-list">
        ${section.points.map(p => `<li>${p}</li>`).join('')}
      </ul>
    </div>`;
}

function getAdjacentTopics(moduleId, topicId) {
  const curriculum = getCurriculum();
  const mod = curriculum.modules.find(m => m.id === moduleId);
  if (!mod) return { prev: null, next: null };
  const idx = mod.topics.findIndex(t => t.id === topicId);
  const modIdx = curriculum.modules.indexOf(mod);

  let prev = null;
  let next = null;

  if (idx > 0) {
    prev = { moduleId, topicId: mod.topics[idx - 1].id, title: mod.topics[idx - 1].title, moduleName: mod.title };
  } else if (modIdx > 0) {
    const prevMod = curriculum.modules[modIdx - 1];
    const lastTopic = prevMod.topics[prevMod.topics.length - 1];
    prev = { moduleId: prevMod.id, topicId: lastTopic.id, title: lastTopic.title, moduleName: prevMod.title };
  }

  if (idx < mod.topics.length - 1) {
    next = { moduleId, topicId: mod.topics[idx + 1].id, title: mod.topics[idx + 1].title, moduleName: mod.title };
  } else if (modIdx < getCurriculum().modules.length - 1) {
    const nextMod = getCurriculum().modules[modIdx + 1];
    next = { moduleId: nextMod.id, topicId: nextMod.topics[0].id, title: nextMod.topics[0].title, moduleName: nextMod.title };
  }

  return { prev, next };
}

export function renderTopicView(container, topicData, mod, topicMeta) {
  const isCompleted = store.isTopicCompleted(mod.id, topicMeta.id);
  const { prev, next } = getAdjacentTopics(mod.id, topicMeta.id);
  const topicIndex = mod.topics.indexOf(topicMeta) + 1;

  let html = `
    <div class="topic-view">
      <div class="topic-breadcrumb">
        <a href="#/">Home</a>
        <svg width="14" height="14"><use href="#icon-chevron-right"/></svg>
        <span style="color: ${mod.color}">${mod.title}</span>
        <svg width="14" height="14"><use href="#icon-chevron-right"/></svg>
        <span>${topicMeta.title}</span>
      </div>

      <div class="topic-header" style="--module-color: ${mod.color}">
        <div class="topic-header-meta">
          <span class="topic-module-badge" style="background: ${mod.color}15; color: ${mod.color}">Module ${mod.number} &middot; Topic ${topicIndex}</span>
          ${topicData.estimatedMinutes ? `<span class="topic-time"><svg width="14" height="14"><use href="#icon-clock"/></svg>${topicData.estimatedMinutes} min</span>` : ''}
        </div>
        <h1 class="topic-title">${topicData.title}</h1>
      </div>

      <div class="topic-sections">
        ${topicData.sections.map((s, i) => renderSection(s, i)).join('')}
      </div>

      <div class="topic-complete-section">
        <button class="topic-complete-btn ${isCompleted ? 'completed' : ''}" id="complete-btn" data-module="${mod.id}" data-topic="${topicMeta.id}">
          <svg width="20" height="20"><use href="#icon-${isCompleted ? 'check-circle' : 'check'}"/></svg>
          ${isCompleted ? 'Completed' : 'Mark as Complete'}
        </button>
      </div>

      <div class="topic-nav">
        ${prev ? `
          <a href="#/${prev.moduleId}/${prev.topicId}" class="topic-nav-btn topic-nav-prev">
            <svg width="16" height="16"><use href="#icon-arrow-left"/></svg>
            <div>
              <span class="topic-nav-label">Previous</span>
              <span class="topic-nav-title">${prev.title}</span>
            </div>
          </a>` : '<div></div>'}
        ${next ? `
          <a href="#/${next.moduleId}/${next.topicId}" class="topic-nav-btn topic-nav-next">
            <div>
              <span class="topic-nav-label">Next</span>
              <span class="topic-nav-title">${next.title}</span>
            </div>
            <svg width="16" height="16"><use href="#icon-arrow-right"/></svg>
          </a>` : '<div></div>'}
      </div>
    </div>`;

  container.innerHTML = html;
  window.scrollTo(0, 0);

  container.querySelectorAll('.concept-header').forEach(btn => {
    btn.addEventListener('click', () => {
      const section = btn.closest('.concept-section');
      const body = section.querySelector('.concept-body');
      const isOpen = btn.getAttribute('aria-expanded') === 'true';
      btn.setAttribute('aria-expanded', !isOpen);
      body.style.display = isOpen ? 'none' : '';
      section.classList.toggle('open', !isOpen);
    });
  });

  const completeBtn = container.querySelector('#complete-btn');
  if (completeBtn) {
    completeBtn.addEventListener('click', () => {
      const moduleId = completeBtn.dataset.module;
      const topicId = completeBtn.dataset.topic;
      const wasCompleted = store.isTopicCompleted(moduleId, topicId);

      if (wasCompleted) {
        store.uncompleteTopic(moduleId, topicId);
        completeBtn.classList.remove('completed');
        completeBtn.innerHTML = `<svg width="20" height="20"><use href="#icon-check"/></svg> Mark as Complete`;
      } else {
        store.completeTopic(moduleId, topicId);
        completeBtn.classList.add('completed');
        completeBtn.innerHTML = `<svg width="20" height="20"><use href="#icon-check-circle"/></svg> Completed`;
      }
    });
  }

  container.querySelectorAll('.quiz-block').forEach(quizEl => {
    const quizId = quizEl.dataset.quizId;
    if (!quizId) return;
    initQuizInteractivity(quizEl, quizId);
  });

  initExerciseInteractivity(container);
  initPayoffMatrixInteractivity(container);
  initSimulatorInteractivity(container);
}

function initQuizInteractivity(quizEl, quizId) {
  const saved = store.getQuizAnswer(quizId);
  const variant = quizEl.dataset.variant;

  if (variant === 'multiple-choice') initMultipleChoice(quizEl, quizId, saved);
  else if (variant === 'drag-match') initDragMatch(quizEl, quizId, saved);
  else if (variant === 'true-false') initTrueFalse(quizEl, quizId, saved);
  else if (variant === 'fill-in-blank') initFillInBlank(quizEl, quizId, saved);
  else if (variant === 'short-answer') initShortAnswer(quizEl, quizId, saved);
}

function initTrueFalse(quizEl, quizId, saved) {
  const btns = quizEl.querySelectorAll('.quiz-tf-btn');
  const checkBtn = quizEl.querySelector('.quiz-check-btn');
  const correct = quizEl.dataset.correct; // 'true' or 'false' (string from data attr)
  let selected = saved?.selected || null;

  if (saved?.selected) {
    const savedBtn = quizEl.querySelector(`.quiz-tf-btn[data-option="${saved.selected}"]`);
    if (savedBtn) {
      savedBtn.classList.add('selected');
      if (saved.correct !== undefined) showTFResult(quizEl, saved.selected, correct);
    }
  }

  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      if (quizEl.classList.contains('answered')) return;
      btns.forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selected = btn.dataset.option;
      if (checkBtn) checkBtn.disabled = false;
    });
  });

  if (checkBtn) {
    checkBtn.addEventListener('click', () => {
      if (!selected) return;
      const isCorrect = selected === correct;
      store.saveQuizAnswer(quizId, { selected, correct: isCorrect });
      showTFResult(quizEl, selected, correct);
    });
  }
}

function showTFResult(quizEl, selected, correct) {
  quizEl.classList.add('answered');
  quizEl.querySelectorAll('.quiz-tf-btn').forEach(btn => {
    if (btn.dataset.option === correct) btn.classList.add('correct');
    else if (btn.dataset.option === selected && selected !== correct) btn.classList.add('incorrect');
  });
  const explanation = quizEl.querySelector('.quiz-explanation');
  if (explanation) explanation.style.display = '';
  const checkBtn = quizEl.querySelector('.quiz-check-btn');
  if (checkBtn) checkBtn.style.display = 'none';
}

function normaliseFIB(s) {
  return (s || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.,!?;:]+$/, '');
}

function initFillInBlank(quizEl, quizId, saved) {
  const input = quizEl.querySelector('.quiz-fib-input');
  const checkBtn = quizEl.querySelector('.quiz-check-btn');
  const acceptable = JSON.parse(quizEl.dataset.acceptable || '[]').map(normaliseFIB);

  if (saved?.answer) {
    input.value = saved.answer;
    if (saved.checked) showFIBResult(quizEl, saved.answer, saved.correct, acceptable);
  }

  input.addEventListener('input', () => {
    if (checkBtn) checkBtn.disabled = !input.value.trim();
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !checkBtn.disabled) {
      e.preventDefault();
      checkBtn.click();
    }
  });

  if (checkBtn) {
    checkBtn.addEventListener('click', () => {
      const answer = input.value;
      const isCorrect = acceptable.includes(normaliseFIB(answer));
      store.saveQuizAnswer(quizId, { answer, correct: isCorrect, checked: true });
      showFIBResult(quizEl, answer, isCorrect, acceptable);
    });
  }
}

function showFIBResult(quizEl, answer, isCorrect, acceptable) {
  quizEl.classList.add('answered', isCorrect ? 'correct' : 'incorrect');
  const input = quizEl.querySelector('.quiz-fib-input');
  if (input) input.disabled = true;
  const correctEl = quizEl.querySelector('.quiz-fib-correct');
  if (correctEl) {
    correctEl.innerHTML = isCorrect
      ? `<strong>✓ Correct.</strong>`
      : `<strong>✗ Not quite.</strong> Acceptable answer${acceptable.length > 1 ? 's' : ''}: <em>${acceptable.join(' / ')}</em>`;
  }
  const explanation = quizEl.querySelector('.quiz-explanation');
  if (explanation) explanation.style.display = '';
  const checkBtn = quizEl.querySelector('.quiz-check-btn');
  if (checkBtn) checkBtn.style.display = 'none';
}

function initShortAnswer(quizEl, quizId, saved) {
  const input = quizEl.querySelector('.quiz-sa-input');
  const checkBtn = quizEl.querySelector('.quiz-check-btn');
  const reveal = quizEl.querySelector('.quiz-sa-reveal');

  if (saved?.answer) input.value = saved.answer;
  if (saved?.revealed) {
    reveal.style.display = '';
    if (checkBtn) checkBtn.style.display = 'none';
    input.disabled = true;
  }

  input.addEventListener('input', () => {
    if (checkBtn) checkBtn.disabled = !input.value.trim();
  });

  if (checkBtn) {
    checkBtn.addEventListener('click', () => {
      const answer = input.value;
      store.saveQuizAnswer(quizId, { answer, revealed: true });
      reveal.style.display = '';
      checkBtn.style.display = 'none';
      input.disabled = true;
    });
  }
}

function initMultipleChoice(quizEl, quizId, saved) {
  const options = quizEl.querySelectorAll('.quiz-option');
  const checkBtn = quizEl.querySelector('.quiz-check-btn');
  const correct = quizEl.dataset.correct;
  let selected = saved?.selected || null;

  if (saved?.selected) {
    const savedOpt = quizEl.querySelector(`[data-option="${saved.selected}"]`);
    if (savedOpt) {
      savedOpt.classList.add('selected');
      if (saved.correct !== undefined) {
        showMCResult(quizEl, saved.selected, correct);
      }
    }
  }

  options.forEach(opt => {
    opt.addEventListener('click', () => {
      if (quizEl.classList.contains('answered')) return;
      options.forEach(o => o.classList.remove('selected'));
      opt.classList.add('selected');
      selected = opt.dataset.option;
      if (checkBtn) checkBtn.disabled = false;
    });
  });

  if (checkBtn) {
    checkBtn.addEventListener('click', () => {
      if (!selected) return;
      const isCorrect = selected === correct;
      store.saveQuizAnswer(quizId, { selected, correct: isCorrect });
      showMCResult(quizEl, selected, correct);
    });
  }
}

function showMCResult(quizEl, selected, correct) {
  quizEl.classList.add('answered');
  const options = quizEl.querySelectorAll('.quiz-option');
  options.forEach(opt => {
    if (opt.dataset.option === correct) {
      opt.classList.add('correct');
    } else if (opt.dataset.option === selected && selected !== correct) {
      opt.classList.add('incorrect');
    }
  });
  const explanation = quizEl.querySelector('.quiz-explanation');
  if (explanation) explanation.style.display = '';
  const checkBtn = quizEl.querySelector('.quiz-check-btn');
  if (checkBtn) checkBtn.style.display = 'none';

  const retryBtn = quizEl.querySelector('.quiz-retry-btn');
  if (retryBtn && selected !== correct) retryBtn.style.display = '';
}

function initDragMatch(quizEl, quizId, saved) {
  const leftItems = quizEl.querySelectorAll('.drag-left-item');
  const rightItems = quizEl.querySelectorAll('.drag-right-item');
  const checkBtn = quizEl.querySelector('.quiz-check-btn');
  let pairs = saved?.pairs || {};
  let selectedLeft = null;

  if (saved?.pairs && saved.checked) {
    showDragResult(quizEl, saved.pairs, quizEl.dataset.correctPairs);
    return;
  }

  leftItems.forEach(item => {
    item.addEventListener('click', () => {
      if (quizEl.classList.contains('answered')) return;
      leftItems.forEach(i => i.classList.remove('selecting'));
      item.classList.add('selecting');
      selectedLeft = item.dataset.left;
    });
  });

  rightItems.forEach(item => {
    item.addEventListener('click', () => {
      if (quizEl.classList.contains('answered') || !selectedLeft) return;
      Object.entries(pairs).forEach(([l, r]) => {
        if (l === selectedLeft || r === item.dataset.right) {
          delete pairs[l];
          quizEl.querySelector(`[data-left="${l}"]`)?.classList.remove('paired');
          quizEl.querySelector(`[data-right="${r}"]`)?.classList.remove('paired');
        }
      });

      pairs[selectedLeft] = item.dataset.right;
      quizEl.querySelector(`[data-left="${selectedLeft}"]`).classList.add('paired');
      item.classList.add('paired');

      const pairIndex = Object.keys(pairs).indexOf(selectedLeft);
      const colors = getCourseConfig().moduleColorAccents || ['#4338CA', '#D97706', '#059669', '#8B5CF6', '#0EA5E9'];
      const color = colors[pairIndex % colors.length];
      quizEl.querySelector(`[data-left="${selectedLeft}"]`).style.borderLeftColor = color;
      item.style.borderLeftColor = color;

      leftItems.forEach(i => i.classList.remove('selecting'));
      selectedLeft = null;

      if (checkBtn && Object.keys(pairs).length === leftItems.length) {
        checkBtn.disabled = false;
      }
    });
  });

  leftItems.forEach(item => {
    item.setAttribute('draggable', 'true');
    item.addEventListener('dragstart', (e) => {
      e.dataTransfer.setData('text/plain', item.dataset.left);
      item.classList.add('dragging');
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
    });
  });

  rightItems.forEach(item => {
    item.addEventListener('dragover', (e) => {
      e.preventDefault();
      item.classList.add('drag-over');
    });
    item.addEventListener('dragleave', () => {
      item.classList.remove('drag-over');
    });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      item.classList.remove('drag-over');
      const leftVal = e.dataTransfer.getData('text/plain');
      if (quizEl.classList.contains('answered')) return;

      Object.entries(pairs).forEach(([l, r]) => {
        if (l === leftVal || r === item.dataset.right) {
          delete pairs[l];
          quizEl.querySelector(`[data-left="${l}"]`)?.classList.remove('paired');
          quizEl.querySelector(`[data-right="${r}"]`)?.classList.remove('paired');
        }
      });

      pairs[leftVal] = item.dataset.right;
      quizEl.querySelector(`[data-left="${leftVal}"]`).classList.add('paired');
      item.classList.add('paired');

      const pairIndex = Object.keys(pairs).indexOf(leftVal);
      const colors = getCourseConfig().moduleColorAccents || ['#4338CA', '#D97706', '#059669', '#8B5CF6', '#0EA5E9'];
      const color = colors[pairIndex % colors.length];
      quizEl.querySelector(`[data-left="${leftVal}"]`).style.borderLeftColor = color;
      item.style.borderLeftColor = color;

      if (checkBtn && Object.keys(pairs).length === leftItems.length) {
        checkBtn.disabled = false;
      }
    });
  });

  if (checkBtn) {
    checkBtn.addEventListener('click', () => {
      const correctPairs = JSON.parse(quizEl.dataset.correctPairs || '{}');
      store.saveQuizAnswer(quizId, { pairs, checked: true });
      showDragResult(quizEl, pairs, correctPairs);
    });
  }
}

function showDragResult(quizEl, pairs, correctPairsStr) {
  const correctPairs = typeof correctPairsStr === 'string' ? JSON.parse(correctPairsStr) : correctPairsStr;
  quizEl.classList.add('answered');

  Object.entries(pairs).forEach(([left, right]) => {
    const leftEl = quizEl.querySelector(`[data-left="${left}"]`);
    const rightEl = quizEl.querySelector(`[data-right="${right}"]`);
    if (correctPairs[left] === right) {
      leftEl?.classList.add('correct');
      rightEl?.classList.add('correct');
    } else {
      leftEl?.classList.add('incorrect');
      rightEl?.classList.add('incorrect');
    }
  });

  const checkBtn = quizEl.querySelector('.quiz-check-btn');
  if (checkBtn) checkBtn.style.display = 'none';
  const explanation = quizEl.querySelector('.quiz-explanation');
  if (explanation) explanation.style.display = '';
}
