import { COMPONENT_LABELS } from './setup-model.js?v=7';
import { escapeHome as esc } from './home-model.js?v=7';
import { CREATION_COMPONENTS, creationComponents } from './generator/component-policy.mjs?v=3';
import { imageCostHTML } from './image-cost.js?v=2';

export const COMPONENT_DESCRIPTIONS = {
  checklists: 'Reusable checks to prepare for a task or review your work.',
  quizzes: 'Check understanding with questions throughout each lesson.',
  flashcards: 'Review key ideas with question-and-answer cards.'
};
export function componentSetupIssues(components) {
  const unavailable = components.filter(value => !CREATION_COMPONENTS.includes(value) && value !== 'practice');
  return unavailable.length ? [{ step: 'experience', component: unavailable[0], text: 'This setup contains unsupported materials. Return to Experience to review your choices.' }] : [];
}
export function courseImageInfoHTML() {
  return `<span class="setup-image-label">${esc(COMPONENT_LABELS.images)}</span><details class="setup-image-info" data-course-image-info><summary aria-label="About course images and costs"><span class="setup-info-icon" aria-hidden="true">i</span></summary><div class="setup-image-info-content"><button type="button" class="setup-image-info-close" data-image-info-close aria-label="Close course image information">×</button><strong>Images that help you learn</strong><p>Learnable plans and creates instructional images as part of your course. A diagram, comparison or illustration is added where it explains something more clearly; lessons that work better as text do not need one.</p>${imageCostHTML()}<p>Creating your course includes its planned images, billed to your connected OpenAI account separately from Claude. There is no separate image-creation step or per-image approval. Review the completed draft, including its illustrations, before relying on it.</p></div></details>`;
}

// Native details supplies the expanded state and Enter/Space interaction. Keep
// dismissal shared across Experience, Review and Create without changing a draft.
export function mountCourseImageInfo(root, { signal } = {}) {
  const doc = root.ownerDocument;
  const close = (info, focus = false) => {
    info.removeAttribute('open');
    if (focus) info.querySelector('summary')?.focus();
  };
  doc.addEventListener('click', event => {
    for (const info of root.querySelectorAll('[data-course-image-info][open]')) {
      if (event.target.closest?.('[data-image-info-close]') && info.contains(event.target)) close(info, true);
      else if (!info.contains(event.target)) close(info);
    }
  }, { signal });
  doc.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const info = root.querySelector('[data-course-image-info][open]');
    if (!info) return;
    event.preventDefault();
    close(info, info.contains(doc.activeElement));
  }, { signal });
}
export function componentSummaryHTML(components) {
  const included = creationComponents(components);
  const omitted = CREATION_COMPONENTS.filter(value => !included.includes(value));
  return `<div class="setup-component-summary" aria-label="Course materials"><div class="setup-materials-line"><strong>Included:</strong><span>${included.filter(value => value !== 'images').map(value => esc(COMPONENT_LABELS[value])).join(', ')},</span><div class="setup-image-meta">${courseImageInfoHTML()}</div></div>${omitted.length ? `<p><strong>Not included:</strong> ${omitted.map(value => esc(COMPONENT_LABELS[value])).join(', ')}.</p>` : ''}${componentSetupIssues(components).map(issue => `<p class="setup-field-error">${esc(issue.text)}</p>`).join('')}</div>`;
}
