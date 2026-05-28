import { store } from './store.js';
import { loadCourse, loadModule, loadLibrary, getCourseConfig, getCurriculum, getCurrentCourseId } from './course-loader.js';
import { renderSidebar } from './components/sidebar.js';
import { renderTopicView } from './components/topic-view.js?v=8';
import { initSearch } from './search.js';
import { initFlashcards } from './flashcards.js?v=2';
import { initChat } from './chat.js';
import { initAuth } from './auth.js';
import { initSync } from './sync.js';

async function loadIcons() {
  try {
    const resp = await fetch(`assets/icons.svg?v=${Date.now()}`);
    const text = await resp.text();
    document.getElementById('icons').innerHTML = text;
  } catch { /* icons will fallback gracefully */ }
}

/**
 * Apply course config to the static HTML shell — document title, search /
 * chat placeholders, chat header, etc. This is the bridge between the JSON
 * course config and the index.html shell.
 */
function applyCourseConfigToShell(config) {
  if (config.documentTitle) document.title = config.documentTitle;

  // Learnable always wears its own brand in the header. Course-specific
  // identity goes into the sub-line only. The legacy `brandHeader` /
  // `brandHeaderLogoLink` fields from Phase 0 courses are intentionally
  // ignored so generated courses don't carry over upstream branding.
  const headerSub = document.querySelector('.header-logo-sub');
  if (headerSub && config.name) headerSub.textContent = config.name;

  // Header logo always points back to the library.
  const logoLink = document.querySelector('.header-logo');
  if (logoLink) logoLink.setAttribute('href', '/');

  const searchInput = document.getElementById('search-input');
  if (searchInput && config.searchPlaceholder) searchInput.setAttribute('placeholder', config.searchPlaceholder);

  const chatInput = document.querySelector('.chat-input');
  if (chatInput && config.chatPlaceholder) chatInput.setAttribute('placeholder', config.chatPlaceholder);

  const chatTitle = document.querySelector('.chat-header-title');
  if (chatTitle && config.chatAssistantName) {
    // Preserve the sparkle SVG, only swap the trailing text node
    const svg = chatTitle.querySelector('svg');
    chatTitle.textContent = '';
    if (svg) chatTitle.appendChild(svg);
    chatTitle.appendChild(document.createTextNode(' ' + config.chatAssistantName));
  }
}

function renderDashboard(container) {
  const curriculum = getCurriculum();
  const config = getCourseConfig();
  const overallProgress = store.getOverallProgress(curriculum.modules);
  const totalTopics = curriculum.modules.reduce((sum, m) => sum + m.topics.length, 0);
  const completedTopics = curriculum.modules.reduce((sum, m) => {
    const prog = store.get().progress?.[m.id];
    return sum + (prog ? Object.values(prog).filter(t => t.completed).length : 0);
  }, 0);

  let html = `
    <div class="dashboard">
      <div class="dashboard-hero">
        <div class="dashboard-eyebrow">${config.eyebrow || ''}</div>
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
        <p class="dashboard-cta-text">${config.dashboardCTA || ''}</p>
      </div>
    </div>`;

  container.innerHTML = html;
}

async function renderRoute() {
  const hash = window.location.hash.slice(2) || '';
  const content = document.getElementById('content');
  const sidebar = document.getElementById('sidebar');
  const curriculum = getCurriculum();

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
    const moduleData = await loadModule(moduleId);
    if (!moduleData) {
      content.innerHTML = `<div class="empty-state"><p>Module content is being prepared. Check back soon.</p></div>`;
      return;
    }
    const topicData = moduleData[topicId];
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
  const overlay = document.getElementById('sidebar-overlay');

  function openSidebar() {
    sidebar.classList.add('open');
    overlay.classList.add('visible');
    toggle.querySelector('use').setAttribute('href', '#icon-x');
    document.body.style.overflow = 'hidden';
  }

  function closeSidebar() {
    sidebar.classList.remove('open');
    overlay.classList.remove('visible');
    toggle.querySelector('use').setAttribute('href', '#icon-menu');
    document.body.style.overflow = '';
  }

  toggle.addEventListener('click', () => {
    sidebar.classList.contains('open') ? closeSidebar() : openSidebar();
  });

  overlay.addEventListener('click', closeSidebar);

  sidebar.addEventListener('click', (e) => {
    if (e.target.closest('.sidebar-topic')) closeSidebar();
  });
}

async function renderLibrary(container) {
  let library;
  try {
    library = await loadLibrary();
  } catch {
    container.innerHTML = `<div class="empty-state"><p>Course library not available.</p></div>`;
    return;
  }
  const visible = library.courses.filter(c => !c.internal);

  container.innerHTML = `
    <div class="library">
      <div class="library-hero">
        <div class="library-eyebrow">Beta · Course Library</div>
        <h1 class="library-title">Learn anything.</h1>
        <p class="library-subtitle">Generated interactive courses on whatever you want to learn — with quizzes, flashcards, and an AI tutor that knows the lesson.</p>
        <div class="library-cta">
          <button class="library-cta-btn" disabled title="Coming soon">+ Generate a new course</button>
          <span class="library-cta-note">Generation from the web ships next. For now, browse the courses below.</span>
        </div>
      </div>

      <div class="library-section">
        <h2 class="library-section-title">Available courses</h2>
        <div class="library-grid">
          ${visible.map(c => `
            <a href="?course=${c.id}" class="library-card" style="--accent: ${c.accentColor || '#4338CA'}">
              <div class="library-card-icon">
                <svg width="28" height="28"><use href="#icon-${c.icon || 'target'}"/></svg>
              </div>
              <h3 class="library-card-title">${c.title}</h3>
              <p class="library-card-subtitle">${c.subtitle}</p>
              <div class="library-card-meta">
                ${c.modules} module${c.modules === 1 ? '' : 's'} · ${c.topics} topic${c.topics === 1 ? '' : 's'}
                ${c.partial ? ' · <span class="library-card-tag">partial</span>' : ''}
              </div>
            </a>
          `).join('')}
        </div>
      </div>
    </div>`;
}

function setShellForLibrary() {
  // Hide course-specific chrome: sidebar + course-only header buttons.
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.style.display = 'none';
  const menuBtn = document.getElementById('mobile-menu-toggle');
  if (menuBtn) menuBtn.style.display = 'none';
  for (const id of ['search-trigger', 'flashcard-trigger', 'chat-trigger']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  document.title = 'Learnable';
}

async function init() {
  await loadIcons();
  initTheme();
  await initAuth();   // no-op until Supabase is configured
  initSync();         // mirrors localStorage progress ↔ Supabase when signed in

  const courseId = getCurrentCourseId();

  // Library mode — no course selected. Render the catalog and exit.
  if (!courseId) {
    setShellForLibrary();
    await renderLibrary(document.getElementById('content'));
    return;
  }

  // Course mode — load and render as normal.
  try {
    const { config } = await loadCourse(courseId);
    applyCourseConfigToShell(config);
  } catch {
    setShellForLibrary();
    document.getElementById('content').innerHTML =
      `<div class="empty-state"><p>Course not found: <code>${courseId}</code>. <a href="/">Back to library</a>.</p></div>`;
    return;
  }

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
