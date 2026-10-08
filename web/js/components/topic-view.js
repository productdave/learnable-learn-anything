import { initMatchQuiz } from './match-quiz.js?v=2';
import { store } from '../store.js?v=5';
import { getCurriculum, getCourseConfig, getCurrentCourseId, invalidateCourseCache } from '../course-loader.js?v=8';
import { logEvent } from '../sync.js?v=27';
import { getUserCourse, saveUserCourse } from '../user-courses.js?v=4';
import { mountPrivateCourseImages } from '../private-course-images.js?v=5';
import { sharedImageHTML,mountSharedCourseImages } from '../shared-course-images.js?v=3';

// Module-level context for the topic currently being rendered — used by
// quiz event handlers (which live in init helpers and don't see render-scope).
let currentCtx = null;
const quizBlueprints = new WeakMap();
function evtCtx() {
  return currentCtx ? {
    course_slug: currentCtx.courseSlug,
    module_slug: currentCtx.moduleSlug,
    topic_slug: currentCtx.topicSlug,
    topic_title: currentCtx.topicTitle
  } : {};
}
import { renderQuiz } from './quiz.js?v=9';
import { renderExercise, initExerciseInteractivity } from './exercise.js?v=3';
import { renderDiagram } from './diagram.js?v=1';
import { renderPayoffMatrix, initPayoffMatrixInteractivity } from './payoff-matrix.js';
import { renderSimulator, initSimulatorInteractivity } from './simulator.js';
import { renderPractice, initPracticeInteractivity } from './practice.js?v=5';
import { renderChecklist, initChecklists } from './checklist.js?v=3';
import { renderLearningStatus } from './learning-status.js?v=7';
import { ttsBarHTML, initTTS } from '../tts.js?v=5';

function renderSection(section, index) {
  switch (section.type) {
    case 'concept': return renderConcept(section, index);
    case 'callout': return renderCallout(section);
    case 'quiz': return renderQuiz(section);
    case 'exercise': return renderExercise(section);
    case 'takeaway': return renderTakeaway(section);
    case 'payoff-matrix': return renderPayoffMatrix(section);
    case 'simulator': return renderSimulator(section);
    case 'image': return renderImageSection(section, index);
    case 'practice': return renderPractice(section, {
      courseId: getCurrentCourseId(),
      moduleId: currentCtx?.moduleSlug,
      topicId: currentCtx?.topicSlug
    });
    case 'checklist': return renderChecklist(section, { courseId: getCurrentCourseId(), moduleId: currentCtx?.moduleSlug, topicId: currentCtx?.topicSlug });
    default: return '';
  }
}

function escapeAttr(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}

function renderImageSection(section, index) {
  if (section?.shared_image) return sharedImageHTML(section,section.src);
  if (section?.asset_id) return `<figure class="topic-image topic-image--private" data-private-image="${escapeAttr(section.asset_id)}"><img alt="${escapeAttr(section.alt)}" hidden><p data-private-image-description>${escapeAttr(section.alt)}</p><p role="status" aria-live="polite">Loading your saved image…</p><button type="button" class="home-button home-button--secondary" hidden>Retry image</button><figcaption>${section.caption ? `${escapeAttr(section.caption)} · ` : ''}AI-generated illustration</figcaption></figure>`;
  const src = section?.src || section?.url;
  if (!section || !src) return '';
  const alt = escapeAttr(section.alt || section.caption || 'Figure');
  const caption = section.caption ? escapeAttr(section.caption) : '';
  const srcTitle = section.source_title ? escapeAttr(section.source_title) : '';
  const srcUrl = section.source_url ? escapeAttr(section.source_url) : '';
  const captionHtml = caption || srcTitle
    ? `<figcaption>${caption}${caption && srcTitle ? ' ' : ''}${srcTitle
        ? `<span class="topic-image-source">— ${srcUrl ? `<a href="${srcUrl}" target="_blank" rel="noopener">${srcTitle}</a>` : srcTitle}</span>`
        : ''}</figcaption>`
    : '';
  return `
    <figure class="topic-image" data-section-index="${index}" data-src="${escapeAttr(src)}" data-source-url="${srcUrl}" data-alt="${alt}" data-caption="${caption}">
      <img src="${escapeAttr(src)}" alt="${alt}" loading="lazy">
      <div class="topic-image-fallback" aria-hidden="true">
        <div class="topic-image-fallback-label">Visual unavailable</div>
        <div class="topic-image-fallback-text">${alt}</div>
        <button class="topic-image-resolve-btn" type="button">Find image</button>
        <div class="topic-image-resolve-status" role="status" aria-live="polite"></div>
      </div>
      ${captionHtml}
    </figure>`;
}

function renderConcept(section, index) {
  const diagramHtml = section.diagram ? renderDiagram(section.diagram) : '';
  const id = `concept-${index}`;

  if (section.expandable) {
    return `
      <div class="concept-section expandable" id="${id}">
        <button class="concept-header" aria-expanded="false" aria-controls="${id}-body">
          <h3 class="concept-title">${escapeAttr(section.title)}</h3>
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
      <h3 class="concept-title">${escapeAttr(section.title)}</h3>
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
        ${section.title ? `<div class="callout-title">${escapeAttr(section.title)}</div>` : ''}
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
        ${section.points.map(p => `<li>${escapeAttr(p)}</li>`).join('')}
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
  store.setLesson(mod.id, topicMeta.id);
  const progress = store.bind();
  const isCompleted = store.isTopicCompleted(mod.id, topicMeta.id);
  const { prev, next } = getAdjacentTopics(mod.id, topicMeta.id);
  const topicIndex = mod.topics.indexOf(topicMeta) + 1;

  // Set the context every render so any quiz/event handler sees the right topic.
  currentCtx = {
    courseSlug: getCurrentCourseId(),
    moduleSlug: mod.id,
    topicSlug: topicMeta.id,
    topicTitle: topicData.title
  };

  let html = `
    <div class="topic-view">
      <div class="topic-breadcrumb">
        <a href="#/">Home</a>
        <svg width="14" height="14"><use href="#icon-chevron-right"/></svg>
        <span style="color: ${mod.color}">${escapeAttr(mod.title)}</span>
        <svg width="14" height="14"><use href="#icon-chevron-right"/></svg>
        <span>${escapeAttr(topicMeta.title)}</span>
      </div>

      <div class="topic-header" style="--module-color: ${mod.color}">
        <div class="topic-header-meta">
          <span class="topic-module-badge" style="background: ${mod.color}15; color: ${mod.color}">Module ${mod.number} &middot; Topic ${topicIndex}</span>
          ${topicData.estimatedMinutes ? `<span class="topic-time"><svg width="14" height="14"><use href="#icon-clock"/></svg>${topicData.estimatedMinutes} min</span>` : ''}
        </div>
        <h1 class="topic-title">${escapeAttr(topicData.title)}</h1>
        ${ttsBarHTML()}
      </div>

      <div class="topic-sections">
        ${topicData.sections.map((s, i) => renderSection(s, i)).join('')}
      </div>

      <div class="topic-complete-section">
        ${topicMeta.contentRevision && !isCompleted ? '<p class="source-help">This lesson was updated. Review the changes before marking this version complete. Your earlier learning record is retained.</p>' : ''}
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
              <span class="topic-nav-title">${escapeAttr(prev.title)}</span>
            </div>
          </a>` : '<div></div>'}
        ${next ? `
          <a href="#/${next.moduleId}/${next.topicId}" class="topic-nav-btn topic-nav-next">
            <div>
              <span class="topic-nav-label">Next</span>
              <span class="topic-nav-title">${escapeAttr(next.title)}</span>
            </div>
            <svg width="16" height="16"><use href="#icon-arrow-right"/></svg>
          </a>` : '<div></div>'}
      </div>
    </div>`;

  container.innerHTML = html;
  window.scrollTo(0, 0);
  logEvent('topic_started', evtCtx());

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
      if (!progress.isCurrent()) return;
      const wasCompleted = progress.isTopicCompleted(moduleId, topicId);

      if (wasCompleted) {
        progress.uncompleteTopic(moduleId, topicId);
        completeBtn.classList.remove('completed');
        completeBtn.innerHTML = `<svg width="20" height="20"><use href="#icon-check"/></svg> Mark as Complete`;
      } else {
        progress.completeTopic(moduleId, topicId);
        completeBtn.classList.add('completed');
        completeBtn.innerHTML = `<svg width="20" height="20"><use href="#icon-check-circle"/></svg> Completed`;
        logEvent('topic_completed', evtCtx());
      }
    });
  }

  container.querySelectorAll('.quiz-block').forEach(quizEl => {
    const quizId = quizEl.dataset.quizId;
    if (!quizId) return;
    prepareQuiz(quizEl, topicData.sections.find(section => section.type === 'quiz' && section.id === quizId));
  });

  initExerciseInteractivity(container);
  initPayoffMatrixInteractivity(container);
  initSimulatorInteractivity(container);
  initPracticeInteractivity(container);
  initChecklists(container);
  renderLearningStatus(container);
  initTopicMedia(container, { mod, topicMeta });
  initTTS(container, { title: topicData.title, moduleName: mod.title, moduleColor: mod.color, icon: mod.icon });
}

function initTopicMedia(container, context) {
  mountPrivateCourseImages(container, getCurrentCourseId());
  mountSharedCourseImages(container);
  container.querySelectorAll('.topic-image:not([data-private-image]):not([data-shared-image]) img').forEach(img => {
    const figure = img.closest('.topic-image');
    const markFailed = () => {
      if (img.dataset.failed === 'true') return;
      img.dataset.failed = 'true';
      img.removeAttribute('src');
      img.setAttribute('aria-hidden', 'true');
      if (figure) {
        figure.classList.add('topic-image--failed');
        resolveTopicImage(figure, context);
      }
    };
    img.addEventListener('error', markFailed, { once: true });
    if (img.complete && img.naturalWidth === 0) markFailed();
  });

  container.querySelectorAll('.topic-image-resolve-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const figure = btn.closest('.topic-image');
      if (figure) resolveTopicImage(figure, context, { force: true });
    });
  });
}

async function resolveTopicImage(figure, context, { force = false } = {}) {
  if (!figure || (!force && figure.dataset.resolveStarted === 'true')) return;
  figure.dataset.resolveStarted = 'true';
  figure.classList.add('topic-image--resolving');
  const status = figure.querySelector('.topic-image-resolve-status');
  const btn = figure.querySelector('.topic-image-resolve-btn');
  if (status) status.textContent = 'Finding a usable copy...';
  if (btn) btn.disabled = true;

  try {
    const res = await fetch('/api/media/resolve-image', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        src: figure.dataset.src || '',
        sourceUrl: figure.dataset.sourceUrl || '',
        alt: figure.dataset.alt || '',
        caption: figure.dataset.caption || ''
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.src) throw new Error(data?.error || `Image repair failed (${res.status})`);

    const img = figure.querySelector('img');
    if (img) {
      img.dataset.failed = 'false';
      img.removeAttribute('aria-hidden');
      img.src = data.src;
    }
    figure.classList.remove('topic-image--failed');
    const saved = persistResolvedImage(context, Number(figure.dataset.sectionIndex), data.src, data.originalUrl || figure.dataset.src || '');
    if (status) status.textContent = saved ? 'Image embedded and saved.' : 'Image embedded for this view.';
  } catch (err) {
    figure.dataset.resolveStarted = 'false';
    if (status) status.textContent = err?.message || 'Could not find a usable image.';
    if (btn) {
      btn.disabled = false;
      btn.textContent = 'Try again';
    }
  } finally {
    figure.classList.remove('topic-image--resolving');
  }
}

function persistResolvedImage(context, sectionIndex, dataUrl, originalUrl) {
  const courseId = getCurrentCourseId();
  if (!courseId || !context?.mod || !context?.topicMeta || !dataUrl) return false;
  const course = getUserCourse(courseId);
  if (!course?.modules) return false;
  const next = JSON.parse(JSON.stringify(course));
  const topic = next.modules?.[context.mod.number]?.[context.topicMeta.id];
  const section = topic?.sections?.[sectionIndex];
  if (!section || section.type !== 'image') return false;
  section.original_src = section.original_src || originalUrl || section.src || section.url || '';
  section.src = dataUrl;
  delete section.url;
  delete section.ref_kind;
  saveUserCourse(next, {
    _brief: next._brief,
    _research: next._research,
    createdByUserId: next.createdByUserId,
    createdBy: next.createdBy
  });
  invalidateCourseCache(courseId);
  return true;
}

function prepareQuiz(quizEl, section) {
  quizBlueprints.set(quizEl, section);
  quizEl.dataset.appliedAnswer = JSON.stringify(store.getQuizAnswer(quizEl.dataset.quizId));
  // Do not replace an answer the learner has started but not yet submitted.
  const engaged = () => { quizEl.dataset.engaged = 'true'; };
  quizEl.addEventListener('input', engaged, { once: true });
  quizEl.addEventListener('click', engaged, { once: true });
  initQuizInteractivity(quizEl, quizEl.dataset.quizId);
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

export function refreshLearningControls(container) {
  const progress = store.bind();
  const complete = container.querySelector('#complete-btn');
  if (complete) {
    const checked = progress.isTopicCompleted(complete.dataset.module, complete.dataset.topic);
    complete.classList.toggle('completed', checked);
    complete.innerHTML = `<svg width="20" height="20"><use href="#icon-${checked ? 'check-circle' : 'check'}"/></svg> ${checked ? 'Completed' : 'Mark as Complete'}`;
  }
  for (const block of container.querySelectorAll('[data-practice-key], [data-checklist-key]')) {
    const saved = progress.getPracticeProgress(block.dataset.practiceKey || block.dataset.checklistKey);
    for (const input of block.querySelectorAll('[data-step-index], [data-checklist-item]')) {
      input.checked = saved.steps[input.dataset.stepIndex ?? input.dataset.checklistItem] === true;
      input.closest('li')?.classList.toggle('is-complete', input.checked);
    }
    for (const select of block.querySelectorAll('[data-skill-id]')) select.value = saved.skills[select.dataset.skillId] || 'not_started';
    const count = block.querySelector('.checklist-count');
    if (count) { const inputs = [...block.querySelectorAll('[data-checklist-item]')]; count.textContent = `${inputs.filter(input => input.checked).length} of ${inputs.length} checked`; }
  }
  // A first account pull can finish after the lesson has rendered. Hydrate idle
  // controls then, without replacing active work or restarting practice timers.
  for (const quiz of container.querySelectorAll('.quiz-block')) {
    const answer = JSON.stringify(progress.getQuizAnswer(quiz.dataset.quizId));
    const section = quizBlueprints.get(quiz);
    if (!section || quiz.dataset.engaged || quiz.contains(document.activeElement) || answer === quiz.dataset.appliedAnswer) continue;
    const template = document.createElement('template'); template.innerHTML = renderQuiz(section);
    const next = template.content.firstElementChild; quiz.replaceWith(next); prepareQuiz(next, section);
  }
  for (const block of container.querySelectorAll('.exercise-block')) {
    const input = block.querySelector('textarea'), saved = progress.getExerciseDraft(block.dataset.exerciseId);
    if (!input || !saved || input.dataset.edited || input === document.activeElement) continue;
    input.value = saved.text;
    const count = saved.text.trim() ? saved.text.trim().split(/\s+/).length : 0;
    block.querySelector('.exercise-word-count').textContent = `${count} word${count === 1 ? '' : 's'}`;
  }
  renderLearningStatus(container);
}

function initQuizRetry(quizEl, progress, resetAnswer) {
  const retryBtn = quizEl.querySelector('.quiz-retry-btn');
  retryBtn?.addEventListener('click', () => {
    if (!progress.isCurrent() || !quizEl.classList.contains('answered')) return;
    quizEl.classList.remove('answered', 'correct', 'incorrect');
    quizEl.querySelector('.quiz-explanation').style.display = 'none';
    retryBtn.style.display = 'none';
    const checkBtn = quizEl.querySelector('.quiz-check-btn');
    checkBtn.style.display = '';
    checkBtn.disabled = true;
    // Keep the saved result until the learner submits a replacement attempt.
    resetAnswer();
  });
}

function focusQuizFeedback(quizEl) {
  // Only explicit submissions move focus. Saved-answer hydration must not.
  quizEl.querySelector('.quiz-explanation')?.focus();
}

function initTrueFalse(quizEl, quizId, saved) {
  const progress = store.bind();
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

  initQuizRetry(quizEl, progress, () => {
    selected = null;
    btns.forEach(btn => btn.classList.remove('selected', 'correct', 'incorrect'));
    btns[0]?.focus();
  });

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
      if (!progress.isCurrent()) return;
      if (!selected || quizEl.classList.contains('answered')) return;
      const isCorrect = selected === correct;
      progress.saveQuizAnswer(quizId, { selected, correct: isCorrect });
      logEvent('quiz_answered', { ...evtCtx(), quiz_id: quizId, variant: 'true-false', correct: isCorrect });
      showTFResult(quizEl, selected, correct);
      focusQuizFeedback(quizEl);
    });
  }
}

function showTFResult(quizEl, selected, correct) {
  quizEl.classList.add('answered');
  quizEl.querySelector('.quiz-result-message').textContent = selected === correct
    ? 'Correct.' : `Not quite. The correct answer is ${correct === 'true' ? 'True' : 'False'}.`;
  quizEl.querySelectorAll('.quiz-tf-btn').forEach(btn => {
    if (btn.dataset.option === correct) btn.classList.add('correct');
    else if (btn.dataset.option === selected && selected !== correct) btn.classList.add('incorrect');
  });
  const explanation = quizEl.querySelector('.quiz-explanation');
  if (explanation) explanation.style.display = '';
  const checkBtn = quizEl.querySelector('.quiz-check-btn');
  if (checkBtn) checkBtn.style.display = 'none';
  const retryBtn = quizEl.querySelector('.quiz-retry-btn');
  if (retryBtn) retryBtn.style.display = selected === correct ? 'none' : '';
}

function normaliseFIB(s) {
  return (s || '').toLowerCase().trim().replace(/\s+/g, ' ').replace(/[.,!?;:]+$/, '');
}

function initFillInBlank(quizEl, quizId, saved) {
  const progress = store.bind();
  const input = quizEl.querySelector('.quiz-fib-input');
  const checkBtn = quizEl.querySelector('.quiz-check-btn');
  const acceptable = JSON.parse(quizEl.dataset.acceptable || '[]').map(normaliseFIB);

  if (saved?.answer) {
    input.value = saved.answer;
    if (saved.checked) showFIBResult(quizEl, saved.answer, saved.correct, acceptable);
  }

  initQuizRetry(quizEl, progress, () => {
    input.disabled = false;
    input.value = '';
    quizEl.querySelector('.quiz-fib-correct').textContent = '';
    input.focus();
  });

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
      if (!progress.isCurrent()) return;
      const answer = input.value;
      if (!answer.trim() || quizEl.classList.contains('answered')) return;
      const isCorrect = acceptable.includes(normaliseFIB(answer));
      progress.saveQuizAnswer(quizId, { answer, correct: isCorrect, checked: true });
      logEvent('quiz_answered', { ...evtCtx(), quiz_id: quizId, variant: 'fill-in-blank', correct: isCorrect });
      showFIBResult(quizEl, answer, isCorrect, acceptable);
      focusQuizFeedback(quizEl);
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
      : `<strong>✗ Not quite.</strong> Acceptable answer${acceptable.length > 1 ? 's' : ''}: <em>${escapeAttr(acceptable.join(' / '))}</em>`;
  }
  const explanation = quizEl.querySelector('.quiz-explanation');
  if (explanation) explanation.style.display = '';
  const checkBtn = quizEl.querySelector('.quiz-check-btn');
  if (checkBtn) checkBtn.style.display = 'none';
  const retryBtn = quizEl.querySelector('.quiz-retry-btn');
  if (retryBtn) retryBtn.style.display = isCorrect ? 'none' : '';
}

function initShortAnswer(quizEl, quizId, saved) {
  const progress = store.bind();
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
      if (!progress.isCurrent()) return;
      const answer = input.value;
      if (!answer.trim() || input.disabled) return;
      progress.saveQuizAnswer(quizId, { answer, revealed: true });
      logEvent('quiz_answered', { ...evtCtx(), quiz_id: quizId, variant: 'short-answer', correct: null });
      reveal.style.display = '';
      checkBtn.style.display = 'none';
      input.disabled = true;
      focusQuizFeedback(quizEl);
    });
  }
}

function initMultipleChoice(quizEl, quizId, saved) {
  const progress = store.bind();
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

  initQuizRetry(quizEl, progress, () => {
    selected = null;
    options.forEach(opt => opt.classList.remove('selected', 'correct', 'incorrect'));
    options[0]?.focus();
  });

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
      if (!progress.isCurrent()) return;
      if (!selected || quizEl.classList.contains('answered')) return;
      const isCorrect = selected === correct;
      progress.saveQuizAnswer(quizId, { selected, correct: isCorrect });
      logEvent('quiz_answered', { ...evtCtx(), quiz_id: quizId, variant: 'multiple-choice', correct: isCorrect });
      showMCResult(quizEl, selected, correct);
      focusQuizFeedback(quizEl);
    });
  }
}

function showMCResult(quizEl, selected, correct) {
  quizEl.classList.add('answered');
  const options = quizEl.querySelectorAll('.quiz-option');
  const correctOption = [...options].find(opt => opt.dataset.option === correct);
  quizEl.querySelector('.quiz-result-message').textContent = selected === correct
    ? 'Correct.' : `Not quite. The correct answer is ${correctOption?.querySelector('.quiz-option-text')?.textContent || correct}.`;
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
  if (retryBtn) retryBtn.style.display = selected === correct ? 'none' : '';
}

function initDragMatch(quizEl, quizId, saved) {
  const progress = store.bind();
  const context = evtCtx();
  initMatchQuiz(quizEl, {
    saved,
    isCurrent: () => progress.isCurrent(),
    save: answer => progress.saveQuizAnswer(quizId, answer),
    onCheck: () => logEvent('quiz_answered', { ...context, quiz_id: quizId, variant: 'drag-match' })
  });
}
