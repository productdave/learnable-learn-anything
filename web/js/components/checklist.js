import { store } from '../store.js?v=5';
import { setSaveMessage } from './practice.js?v=5';
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export function renderChecklist(section, context = {}) {
  const key = [context.courseId, context.moduleId, context.topicId, section.id].filter(Boolean).join('/');
  const saved = store.getPracticeProgress(key), items = Array.isArray(section.items) ? section.items : [];
  return `<fieldset class="lesson-checklist" data-checklist-key="${esc(key)}"><legend>${esc(section.title)}</legend>
    <p>${esc(section.description)}</p><p class="checklist-count">${items.filter(item => saved.steps[item.id] === true).length} of ${items.length} checked</p>
    ${items.map(item => `<label class="checklist-row"><input type="checkbox" data-checklist-item="${esc(item.id)}" ${saved.steps[item.id] === true ? 'checked' : ''}><span><strong>${esc(item.label)}</strong>${item.detail ? `<small>${esc(item.detail)}</small>` : ''}</span></label>`).join('')}
    <p class="checklist-note">Use this to track your checks. It does not certify mastery or safety. You can uncheck an item at any time.</p>
    <p class="checklist-status" role="status"></p></fieldset>`;
}
export function initChecklists(container) {
  const progress = store.bind();
  for (const block of container.querySelectorAll('[data-checklist-key]')) {
    const inputs = [...block.querySelectorAll('[data-checklist-item]')];
    for (const input of inputs) input.addEventListener('change', () => {
      const result = progress.savePracticeStep(block.dataset.checklistKey, input.dataset.checklistItem, input.checked);
      block.querySelector('.checklist-count').textContent = `${inputs.filter(input => input.checked).length} of ${inputs.length} checked`;
      setSaveMessage(block.querySelector('.checklist-status'), result);
    });
  }
}
