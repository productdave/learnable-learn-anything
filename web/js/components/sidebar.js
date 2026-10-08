import { store } from '../store.js?v=5';
import { getCurriculum } from '../course-loader.js?v=8';
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

function progressRingSVG(progress, color, size = 32) {
  const r = (size - 4) / 2;
  const circumference = 2 * Math.PI * r;
  const offset = circumference * (1 - progress);
  const pct = Math.round(progress * 100);
  return `
    <svg width="${size}" height="${size}" class="progress-ring" aria-label="${pct}% complete">
      <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="var(--border-primary)" stroke-width="3"/>
      <circle cx="${size/2}" cy="${size/2}" r="${r}" fill="none" stroke="${color}" stroke-width="3"
        stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"
        stroke-linecap="round" transform="rotate(-90 ${size/2} ${size/2})"
        style="transition: stroke-dashoffset 0.4s ease"/>
      ${progress >= 1 ? `<polyline points="${size/2-4},${size/2} ${size/2-1},${size/2+3} ${size/2+4},${size/2-3}" fill="none" stroke="${color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>` :
        `<text x="${size/2}" y="${size/2}" text-anchor="middle" dominant-baseline="central" fill="var(--text-tertiary)" font-size="9" font-weight="600">${pct}</text>`}
    </svg>`;
}

export function renderSidebar(container) {
  const curriculum = getCurriculum();
  const state = store.get();
  const currentHash = window.location.hash.slice(2) || '';
  const [currentModule] = currentHash.split('/');
  const modules = Array.isArray(curriculum.modules) ? curriculum.modules : [];
  const overallProgress = store.getOverallProgress(modules);

  let html = `
    <div class="sidebar-header">
      <div class="sidebar-progress-summary">
        ${progressRingSVG(overallProgress, 'var(--primary)', 40)}
        <div>
          <div class="sidebar-progress-label">Overall Progress</div>
          <div class="sidebar-progress-value">${Math.round(overallProgress * 100)}% complete</div>
        </div>
      </div>
    </div>
    <nav class="sidebar-nav" aria-label="Modules">`;

  for (const mod of modules) {
    const topics = Array.isArray(mod.topics) ? mod.topics : [];
    const isExpanded = currentModule === mod.id;
    const progress = store.getModuleProgress(mod.id, topics.length);

    html += `
      <div class="sidebar-module ${isExpanded ? 'expanded' : ''}">
        <button class="sidebar-module-header" data-module="${mod.id}" aria-expanded="${isExpanded}">
          <div class="sidebar-module-left">
              ${progressRingSVG(progress, mod.color || 'var(--primary)')}
            <div>
              <span class="sidebar-module-number">Module ${mod.number}</span>
              <span class="sidebar-module-title">${esc(mod.title)}</span>
            </div>
          </div>
          <svg width="16" height="16" class="sidebar-chevron"><use href="#icon-chevron-right"/></svg>
        </button>
        <div class="sidebar-topics" ${isExpanded ? '' : 'style="display:none"'}>`;

    for (const topic of topics) {
      const isActive = currentHash === `${mod.id}/${topic.id}`;
      const isCompleted = store.isTopicCompleted(mod.id, topic.id);

      html += `
          <a href="#/${mod.id}/${topic.id}" class="sidebar-topic ${isActive ? 'active' : ''} ${isCompleted ? 'completed' : ''}">
            <span class="sidebar-topic-indicator">
              ${isCompleted ? '<svg width="14" height="14"><use href="#icon-check"/></svg>' : '<span class="sidebar-topic-dot"></span>'}
            </span>
            <span class="sidebar-topic-title">${esc(topic.title)}</span>
          </a>`;
    }

    html += `
        </div>
      </div>`;
  }

  html += `</nav>`;
  container.innerHTML = html;

  container.querySelectorAll('.sidebar-module-header').forEach(btn => {
    btn.addEventListener('click', () => {
      const moduleId = btn.dataset.module;
      const moduleEl = btn.closest('.sidebar-module');
      const topicsEl = moduleEl.querySelector('.sidebar-topics');
      const isExpanded = moduleEl.classList.contains('expanded');

      if (isExpanded) {
        moduleEl.classList.remove('expanded');
        btn.setAttribute('aria-expanded', 'false');
        topicsEl.style.display = 'none';
      } else {
        moduleEl.classList.add('expanded');
        btn.setAttribute('aria-expanded', 'true');
        topicsEl.style.display = '';
      }
    });
  });
}
