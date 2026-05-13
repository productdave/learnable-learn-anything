import { store } from './store.js';
import { curriculum } from '../data/curriculum.js';
import { renderSidebar } from './components/sidebar.js';
import { renderTopicView } from './components/topic-view.js';
import { initSearch } from './search.js';
import { initFlashcards } from './flashcards.js';
import { initChat } from './chat.js';

async function loadIcons() {
  try {
    const resp = await fetch(`assets/icons.svg?v=${Date.now()}`);
    const text = await resp.text();
    document.getElementById('icons').innerHTML = text;
  } catch { /* icons will fallback gracefully */ }
}

function getModuleData(moduleId) {
  const map = {
    'ai-foundations': () => import('../data/modules/module-1.js'),
    'business-translation': () => import('../data/modules/module-2.js'),
    'evaluation-deployment': () => import('../data/modules/module-3.js'),
    'portfolio-building': () => import('../data/modules/module-4.js'),
    'pitch-preparation': () => import('../data/modules/module-5.js')
  };
  return map[moduleId]?.();
}

function renderDashboard(container) {
  const overallProgress = store.getOverallProgress(curriculum.modules);
  const totalTopics = curriculum.modules.reduce((sum, m) => sum + m.topics.length, 0);
  const completedTopics = curriculum.modules.reduce((sum, m) => {
    const prog = store.get().progress?.[m.id];
    return sum + (prog ? Object.values(prog).filter(t => t.completed).length : 0);
  }, 0);

  let html = `
    <div class="dashboard">
      <div class="dashboard-hero">
        <h1 class="dashboard-title">${curriculum.title}</h1>
        <p class="dashboard-subtitle">${curriculum.subtitle}</p>
        <div class="dashboard-stats">
          <div class="dashboard-stat">
            <span class="dashboard-stat-value">${curriculum.modules.length}</span>
            <span class="dashboard-stat-label">Modules</span>
          </div>
          <div class="dashboard-stat">
            <span class="dashboard-stat-value">${totalTopics}</span>
            <span class="dashboard-stat-label">Topics</span>
          </div>
          <div class="dashboard-stat">
            <span class="dashboard-stat-value">${completedTopics}</span>
            <span class="dashboard-stat-label">Completed</span>
          </div>
          <div class="dashboard-stat">
            <span class="dashboard-stat-value">${Math.round(overallProgress * 100)}%</span>
            <span class="dashboard-stat-label">Progress</span>
          </div>
        </div>
      </div>

      <div class="dashboard-modules">
        <h2 class="dashboard-section-title">Your Learning Path</h2>
        <div class="module-cards">`;

  for (const mod of curriculum.modules) {
    const progress = store.getModuleProgress(mod.id, mod.topics.length);
    const completedCount = Math.round(progress * mod.topics.length);

    html += `
          <a href="#/${mod.id}/${mod.topics[0].id}" class="module-card" style="--module-color: ${mod.color}">
            <div class="module-card-header">
              <div class="module-card-icon">
                <svg width="24" height="24"><use href="#icon-${mod.icon}"/></svg>
              </div>
              <span class="module-card-number">Module ${mod.number}</span>
            </div>
            <h3 class="module-card-title">${mod.title}</h3>
            <p class="module-card-desc">${mod.description}</p>
            <div class="module-card-footer">
              <div class="module-card-progress-bar">
                <div class="module-card-progress-fill" style="width: ${progress * 100}%"></div>
              </div>
              <span class="module-card-progress-text">${completedCount}/${mod.topics.length} topics</span>
            </div>
          </a>`;
  }

  html += `
        </div>
      </div>

      <div class="dashboard-cta">
        <p class="dashboard-cta-text">Each module builds on the last. Start with AI Foundations to build your mental model, then translate that into product decisions.</p>
      </div>
    </div>`;

  container.innerHTML = html;
}

async function renderRoute() {
  const hash = window.location.hash.slice(2) || '';
  const content = document.getElementById('content');
  const sidebar = document.getElementById('sidebar');

  renderSidebar(sidebar);

  if (!hash || hash === '') {
    renderDashboard(content);
    return;
  }

  const [moduleId, topicId] = hash.split('/');

  if (!topicId) {
    const mod = curriculum.modules.find(m => m.id === moduleId);
    if (mod) {
      window.location.hash = `#/${moduleId}/${mod.topics[0].id}`;
    }
    return;
  }

  const mod = curriculum.modules.find(m => m.id === moduleId);
  if (!mod) {
    renderDashboard(content);
    return;
  }

  const topicMeta = mod.topics.find(t => t.id === topicId);
  if (!topicMeta) {
    window.location.hash = `#/${moduleId}/${mod.topics[0].id}`;
    return;
  }

  try {
    const moduleData = await getModuleData(moduleId);
    if (!moduleData) {
      content.innerHTML = `<div class="empty-state"><p>Module content is being prepared. Check back soon.</p></div>`;
      return;
    }
    const topicData = moduleData.default?.[topicId] || moduleData[Object.keys(moduleData).find(k => k !== 'default')]?.[topicId];
    if (!topicData) {
      content.innerHTML = `<div class="empty-state"><p>Topic content is being prepared. Check back soon.</p></div>`;
      return;
    }
    renderTopicView(content, topicData, mod, topicMeta);
  } catch (e) {
    content.innerHTML = `<div class="empty-state"><p>Module content is being prepared. Check back soon.</p></div>`;
  }
}

function initTheme() {
  const theme = store.getTheme();
  document.documentElement.setAttribute('data-theme', theme);
  updateThemeIcons(theme);

  document.getElementById('theme-toggle').addEventListener('click', () => {
    store.toggleTheme();
    updateThemeIcons(store.getTheme());
  });
}

function updateThemeIcons(theme) {
  const light = document.querySelector('.theme-icon-light');
  const dark = document.querySelector('.theme-icon-dark');
  if (theme === 'dark') {
    light.style.display = 'none';
    dark.style.display = '';
  } else {
    light.style.display = '';
    dark.style.display = 'none';
  }
}

function initMobileMenu() {
  const toggle = document.getElementById('mobile-menu-toggle');
  const sidebar = document.getElementById('sidebar');

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('open');
    const icon = toggle.querySelector('use');
    if (sidebar.classList.contains('open')) {
      icon.setAttribute('href', '#icon-x');
    } else {
      icon.setAttribute('href', '#icon-menu');
    }
  });

  sidebar.addEventListener('click', (e) => {
    if (e.target.closest('.sidebar-topic')) {
      sidebar.classList.remove('open');
      toggle.querySelector('use').setAttribute('href', '#icon-menu');
    }
  });
}

async function init() {
  await loadIcons();
  initTheme();
  initMobileMenu();
  initSearch();
  initFlashcards();
  initChat();

  window.addEventListener('hashchange', renderRoute);
  renderRoute();

  store.subscribe(() => {
    renderSidebar(document.getElementById('sidebar'));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
      const active = document.activeElement;
      if (active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA') {
        e.preventDefault();
        document.getElementById('search-trigger').click();
      }
    }
  });
}

init();
