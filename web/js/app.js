import { store } from './store.js';
import { loadCourse, loadModule, loadLibrary, getCourseConfig, getCurriculum, getCurrentCourseId } from './course-loader.js';
import { renderSidebar } from './components/sidebar.js';
import { renderTopicView } from './components/topic-view.js?v=9';
import { initSearch } from './search.js';
import { initFlashcards } from './flashcards.js?v=2';
import { initChat } from './chat.js';
import { initAuth } from './auth.js?v=3';
import { initSync } from './sync.js?v=2';
import { openIntake, openIntakeForJob } from './intake.js?v=8';
import { listActiveJobs, onJobsChange, markInterruptedIfStale, removeJob } from './jobs.js';
import { ensureSW } from './sw-client.js';

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

  // Tag user-generated cards so the UI can mark them visually.
  const cards = library.courses.map(c => ({ ...c }));

  const activeJobs = listActiveJobs();

  container.innerHTML = `
    <div class="library">
      <div class="library-hero">
        <div class="library-eyebrow">Beta · Course Library</div>
        <h1 class="library-title">Learn anything.</h1>
        <p class="library-subtitle">Generated interactive courses on whatever you want to learn — with quizzes, flashcards, and an AI tutor that knows the lesson.</p>
        <div class="library-cta">
          <button class="library-cta-btn" id="generate-btn">+ Generate a new course</button>
          <span class="library-cta-note">Runs in your browser with your Anthropic key. ~$1–3 of credit per course.</span>
        </div>
      </div>

      <div class="library-jobs-host">${jobsSectionHTML(activeJobs)}</div>

      <div class="library-section">
        <h2 class="library-section-title">Available courses</h2>
        <div class="library-grid">
          ${visible.map(c => `
            <a href="?course=${encodeURIComponent(c.id)}" class="library-card ${c.user ? 'library-card--user' : ''}" style="--accent: ${c.accentColor || '#4338CA'}">
              ${c.emoji
                ? `<div class="library-card-icon library-card-icon--emoji">${c.emoji}</div>`
                : `<div class="library-card-icon"><svg width="28" height="28"><use href="#icon-${c.icon || 'target'}"/></svg></div>`}
              <h3 class="library-card-title">${c.title}</h3>
              <p class="library-card-subtitle">${c.subtitle}</p>
              <div class="library-card-meta">
                ${c.modules} module${c.modules === 1 ? '' : 's'} · ${c.topics} topic${c.topics === 1 ? '' : 's'}
                ${c.user ? ' · <span class="library-card-tag library-card-tag--mine">your course</span>' : ''}
                ${c.partial ? ' · <span class="library-card-tag">partial</span>' : ''}
              </div>
            </a>
          `).join('')}
        </div>
      </div>
    </div>`;

  container.querySelector('#generate-btn')?.addEventListener('click', openIntake);
  wireJobsSection(container);

  // Live updates: when a job's progress changes, re-render just the jobs section.
  // (If a new course just finished saving, also refresh the library list.)
  onJobsChange(() => {
    const host = container.querySelector('.library-jobs-host');
    if (!host) return;
    const newJobs = listActiveJobs();
    host.innerHTML = jobsSectionHTML(newJobs);
    wireJobsSection(container);
    // If a job finished and added a course to localStorage, refresh the catalog too.
    // (Re-rendering only the catalog grid keeps things cheap.)
    refreshLibraryCatalog(container);
  });
}

function jobsSectionHTML(jobs) {
  if (!jobs.length) return '';
  return `
    <div class="library-section library-section--jobs">
      <h2 class="library-section-title">Currently generating</h2>
      <div class="library-grid">
        ${jobs.map(j => jobCardHTML(j)).join('')}
      </div>
    </div>`;
}

function jobCardHTML(j) {
  const isFailed = j.status === 'failed';
  const isInterrupted = j.status === 'interrupted';
  const isDone = j.status === 'completed';
  const stageLabel =
    isFailed ? 'Failed'
    : isInterrupted ? 'Interrupted'
    : isDone ? 'Done'
    : ({ intake: 'Designing outline', research: 'Researching', topics: `Writing topics ${j.topicsDone}/${j.topicsTotal || '…'}`, assemble: 'Finalising', done: 'Ready' }[j.stage] || 'Working');
  const pct = j.topicsTotal ? Math.min(100, Math.round(((j.topicsDone || 0) / j.topicsTotal) * 100)) : (j.stage === 'intake' ? 5 : j.stage === 'research' ? 20 : 60);

  return `
    <div class="library-card library-card--job ${isFailed ? 'is-failed' : ''} ${isInterrupted ? 'is-interrupted' : ''}" data-job-id="${j.id}" style="--accent: ${isFailed ? '#E11D48' : '#4338CA'}">
      <div class="library-card-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          ${isFailed ? '<path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>'
            : isInterrupted ? '<path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/>'
            : '<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>'}
        </svg>
      </div>
      <h3 class="library-card-title">${escapeHTML(j.title || 'New course')}</h3>
      <p class="library-card-subtitle">${escapeHTML(stageLabel)}${j.error ? ` — ${escapeHTML(j.error)}` : ''}</p>
      <div class="library-card-progress">
        <div class="library-card-progress-bar"><div class="library-card-progress-fill" style="width: ${pct}%"></div></div>
      </div>
      <div class="library-card-meta">
        ${isFailed || isInterrupted
          ? `<button class="library-card-action" data-job-action="retry" data-job-id="${j.id}">Retry</button>
             <button class="library-card-action library-card-action--ghost" data-job-action="dismiss" data-job-id="${j.id}">Dismiss</button>`
          : `<button class="library-card-action" data-job-action="open" data-job-id="${j.id}">View progress</button>`}
      </div>
    </div>`;
}

function wireJobsSection(container) {
  container.querySelectorAll('[data-job-action]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      const id = btn.dataset.jobId;
      const action = btn.dataset.jobAction;
      if (action === 'open' || action === 'retry') openIntakeForJob(id);
      else if (action === 'dismiss') removeJob(id);
    });
  });
}

async function refreshLibraryCatalog(container) {
  try {
    const lib = await loadLibrary();
    const visible = lib.courses.filter(c => !c.internal);
    const grid = container.querySelector('.library-section:not(.library-section--jobs) .library-grid');
    if (!grid) return;
    grid.innerHTML = visible.map(c => `
      <a href="?course=${encodeURIComponent(c.id)}" class="library-card ${c.user ? 'library-card--user' : ''}" style="--accent: ${c.accentColor || '#4338CA'}">
        <div class="library-card-icon"><svg width="28" height="28"><use href="#icon-${c.icon || 'target'}"/></svg></div>
        <h3 class="library-card-title">${c.title}</h3>
        <p class="library-card-subtitle">${c.subtitle}</p>
        <div class="library-card-meta">
          ${c.modules} module${c.modules === 1 ? '' : 's'} · ${c.topics} topic${c.topics === 1 ? '' : 's'}
          ${c.user ? ' · <span class="library-card-tag library-card-tag--mine">your course</span>' : ''}
          ${c.partial ? ' · <span class="library-card-tag">partial</span>' : ''}
        </div>
      </a>`).join('');
  } catch {}
}

function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setShellForLibrary() {
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

function setShellForCourse() {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.style.display = '';
  const menuBtn = document.getElementById('mobile-menu-toggle');
  if (menuBtn) menuBtn.style.display = '';
  for (const id of ['search-trigger', 'flashcard-trigger', 'chat-trigger']) {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  }
}

// SPA router state — tracks the current view so we know when to re-init chrome.
let currentMode = null;          // null | 'library' | 'course'
let currentCourseSlug = null;
let courseChromeBooted = false;  // initSearch/Flashcards/Chat/MobileMenu only need wiring once

function initCourseChromeOnce() {
  if (courseChromeBooted) return;
  initMobileMenu();
  initSearch();
  initFlashcards();
  initChat();
  courseChromeBooted = true;
}

async function renderForCurrentURL() {
  const courseId = getCurrentCourseId();
  const content = document.getElementById('content');

  if (!courseId) {
    setShellForLibrary();
    currentMode = 'library';
    currentCourseSlug = null;
    await renderLibrary(content);
    return;
  }

  // Course mode. If we're entering a new course (from library or a switch),
  // load its data + flip the shell. Otherwise (same course, hash-only nav)
  // just rerender the route.
  if (currentMode !== 'course' || currentCourseSlug !== courseId) {
    try {
      const { config } = await loadCourse(courseId);
      applyCourseConfigToShell(config);
    } catch {
      setShellForLibrary();
      content.innerHTML =
        `<div class="empty-state"><p>Course not found: <code>${courseId}</code>. <a href="/">Back to library</a>.</p></div>`;
      currentMode = 'library';
      currentCourseSlug = null;
      return;
    }
    setShellForCourse();
    initCourseChromeOnce();
    currentMode = 'course';
    currentCourseSlug = courseId;
  }
  renderRoute();
}

/** Internal navigation that preserves the JS context (so background work survives). */
function navigateTo(url) {
  if (url === window.location.pathname + window.location.search + window.location.hash) {
    renderForCurrentURL();
    return;
  }
  history.pushState(null, '', url);
  renderForCurrentURL();
}

// Hijack same-origin <a> clicks so we never trigger a full page reload.
function installLinkInterceptor() {
  document.addEventListener('click', (e) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return;
    const link = e.target.closest('a[href]');
    if (!link) return;
    if (link.target && link.target !== '_self') return;
    const href = link.getAttribute('href');
    if (!href) return;
    // Skip external and protocol URLs.
    if (/^(https?:|mailto:|tel:)/i.test(href)) return;
    // Hash-only changes within the same path: let hashchange handle topic nav.
    if (href.startsWith('#')) return;

    e.preventDefault();
    navigateTo(href);
  });
}

async function init() {
  await loadIcons();
  initTheme();
  markInterruptedIfStale();
  await initAuth();
  initSync();
  ensureSW(); // fire-and-forget — registers /sw.js + installs the global progress listener

  await renderForCurrentURL();

  installLinkInterceptor();
  window.addEventListener('popstate', renderForCurrentURL);
  window.addEventListener('hashchange', () => {
    // Hash drives the topic route inside a course view; library mode ignores it.
    if (currentMode === 'course') renderRoute();
  });

  store.subscribe(() => {
    if (currentMode === 'course') renderSidebar(document.getElementById('sidebar'));
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
      const active = document.activeElement;
      if (active && active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA') {
        e.preventDefault();
        document.getElementById('search-trigger')?.click();
      }
    }
  });
}

init();
