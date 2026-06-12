import { store } from './store.js';
import { loadCourse, loadModule, loadLibrary, getCourseConfig, getCurriculum, getCurrentCourseId, invalidateCourseCache } from './course-loader.js';
import { renderSidebar } from './components/sidebar.js';
import { renderTopicView } from './components/topic-view.js?v=9';
import { initSearch } from './search.js';
import { initFlashcards } from './flashcards.js?v=2';
import { initChat } from './chat.js';
import { initAuth, getUser, onUserChange } from './auth.js?v=5';
import { initSync } from './sync.js?v=2';
import { openIntake, openIntakeForJob } from './intake.js?v=16';
import { listActiveJobs, onJobsChange, markInterruptedIfStale, removeJob, getJob as getJobLazy } from './jobs.js';
import { ensureSW, resumeMissing, cancelGeneration as swCancel, resumeFromCheckpoint as swResume, hasCheckpoint } from './sw-client.js';
import { cloudGenAvailable, cancelCloudGeneration, resumeCloudGeneration, rehydrateCloudSubscriptions } from './cloud-gen-client.js?v=2';
import { getUserCourse, removeUserCourse, canDeleteCourse, _setCurrentUserEmailFromAuth, _onCoursesChanged } from './user-courses.js';
import { initCourseSync, syncCoursesNow } from './course-sync.js?v=1';

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
      content.innerHTML = missingContentHTML(moduleId, topicMeta);
      wireMissingContent(content);
      return;
    }
    const topicData = moduleData[topicId];
    if (!topicData) {
      content.innerHTML = missingContentHTML(moduleId, topicMeta);
      wireMissingContent(content);
      return;
    }
    renderTopicView(content, topicData, mod, topicMeta);
  } catch (e) {
    content.innerHTML = missingContentHTML(moduleId, topicMeta);
    wireMissingContent(content);
  }
}

/** Empty-state shown when a topic's content didn't get generated. For user-
 *  generated courses with saved brief+research, offer surgical retry. For
 *  bundled courses (or older user courses missing the resume bundles), show
 *  the plain "being prepared" message. */
function missingContentHTML(moduleId, topicMeta) {
  const courseId = getCurrentCourseId();
  const saved = courseId ? getUserCourse(courseId) : null;
  if (!saved) {
    return `<div class="empty-state"><p>Topic content is being prepared. Check back soon.</p></div>`;
  }
  const canResume = !!(saved._brief && saved._research);
  const failedTopics = saved.failedTopics || [];
  const failedCount = failedTopics.length;

  if (canResume) {
    return `
      <div class="empty-state missing-topic">
        <div class="missing-topic-icon">
          <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
            <circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>
          </svg>
        </div>
        <h2 class="missing-topic-title">This topic didn't finish generating</h2>
        <p class="missing-topic-body">
          ${failedCount > 1
            ? `${failedCount} topics in this course failed. The outline and research are saved — you can retry just the missing ones without re-paying for the rest.`
            : `The outline and research are saved — you can retry just this missing topic without re-paying for the rest.`}
        </p>
        <div class="missing-topic-actions">
          <button class="library-card-action" data-missing-action="retry">Retry missing topic${failedCount > 1 ? 's' : ''}</button>
          <a class="library-card-action library-card-action--ghost" href="/">Back to library</a>
        </div>
        <p class="missing-topic-note">Common cause: the previous attempt ran out of Anthropic credits. Top up before retrying.</p>
      </div>`;
  }

  // No saved brief — predates the resume feature, or generation never completed Stage 1.
  return `
    <div class="empty-state missing-topic">
      <div class="missing-topic-icon">
        <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>
        </svg>
      </div>
      <h2 class="missing-topic-title">This topic didn't finish generating</h2>
      <p class="missing-topic-body">
        This course was created before in-place retry was supported, so the outline can't be re-used. You'll need to regenerate it from scratch.
      </p>
      <div class="missing-topic-actions">
        <a class="library-card-action" href="/">Back to library</a>
      </div>
    </div>`;
}

function wireMissingContent(container) {
  const btn = container.querySelector('[data-missing-action="retry"]');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    btn.disabled = true;
    btn.textContent = 'Starting…';
    try {
      const newJobId = await resumeMissing(getCurrentCourseId());
      if (newJobId) {
        // Send the user back to the library where the in-progress card shows the retry.
        window.location.href = '/';
      } else {
        btn.textContent = 'Nothing to retry';
      }
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Retry missing topics';
      alert(`Couldn't retry: ${err.message}`);
    }
  });
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
          ${visible.map(c => libraryCardHTML(c)).join('')}
        </div>
      </div>
    </div>`;

  container.querySelector('#generate-btn')?.addEventListener('click', openIntake);
  wireLibraryCards(container);
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
  const isCancelling = j.status === 'cancelling';
  const isFailed = j.status === 'failed';
  const isInterrupted = j.status === 'interrupted';
  const isPartial = j.status === 'partial';
  const isDone = j.status === 'completed';
  const canResume = hasCheckpoint(j);

  // Subtitle / progress label by state.
  let stageLabel;
  if (isCancelling) stageLabel = j.message || 'Cancelling…';
  else if (isFailed) stageLabel = 'Failed';
  else if (isInterrupted) stageLabel = canResume ? 'Interrupted — resume to keep your progress' : 'Interrupted (page refresh or closed tab)';
  else if (isPartial) stageLabel = `${(j.totalTopics || 0) - (j.failedCount || 0)} of ${j.totalTopics || 0} topics done · ${j.failedCount || 0} failed`;
  else if (isDone) stageLabel = 'Done';
  else stageLabel = ({ intake: 'Designing outline', research: 'Researching', topics: `Writing topics ${j.topicsDone}/${j.topicsTotal || '…'}`, assemble: 'Finalising', done: 'Ready' }[j.stage] || 'Working');

  const pct = isPartial
    ? Math.round(((j.totalTopics - j.failedCount) / Math.max(1, j.totalTopics)) * 100)
    : (j.topicsTotal ? Math.min(100, Math.round(((j.topicsDone || 0) / j.topicsTotal) * 100)) : (j.stage === 'intake' ? 5 : j.stage === 'research' ? 20 : 60));

  const accent = isFailed ? '#E11D48' : (isPartial || isCancelling || isInterrupted) ? '#D97706' : '#4338CA';
  const iconPath =
    isFailed ? '<path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>'
    : isInterrupted ? '<path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/>'
    : isPartial ? '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>'
    : '<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>';

  let actionsHTML;
  if (isCancelling) {
    actionsHTML = `<span class="library-card-action library-card-action--ghost" aria-disabled="true">Draining…</span>`;
  } else if (isPartial && j.savedCourseId) {
    actionsHTML = `
      <button class="library-card-action" data-job-action="retry-missing" data-course-id="${j.savedCourseId}">Retry missing topics</button>
      <a class="library-card-action library-card-action--ghost" href="?course=${encodeURIComponent(j.savedCourseId)}">Open as-is</a>
      ${(j.failures || []).length ? `<button class="library-card-action library-card-action--ghost" data-job-action="open" data-job-id="${j.id}">View errors</button>` : ''}
      <button class="library-card-action library-card-action--danger" data-job-action="delete-partial" data-job-id="${j.id}" data-course-id="${j.savedCourseId}">Delete</button>`;
  } else if (isFailed || isInterrupted) {
    const retryLabel = canResume ? 'Resume' : 'Retry';
    const retryAction = canResume ? 'resume' : 'retry';
    actionsHTML = `
      <button class="library-card-action" data-job-action="${retryAction}" data-job-id="${j.id}">${retryLabel}</button>
      ${(j.failures || []).length ? `<button class="library-card-action library-card-action--ghost" data-job-action="open" data-job-id="${j.id}">View errors</button>` : ''}
      <button class="library-card-action library-card-action--danger" data-job-action="delete-job" data-job-id="${j.id}">Delete</button>`;
  } else {
    // Running.
    actionsHTML = `
      <button class="library-card-action" data-job-action="open" data-job-id="${j.id}">View progress</button>
      <button class="library-card-action library-card-action--danger" data-job-action="cancel" data-job-id="${j.id}">Cancel</button>`;
  }

  return `
    <div class="library-card library-card--job ${isFailed ? 'is-failed' : ''} ${isInterrupted ? 'is-interrupted' : ''} ${isPartial ? 'is-partial' : ''}" data-job-id="${j.id}" style="--accent: ${accent}">
      <div class="library-card-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg>
      </div>
      <h3 class="library-card-title">${escapeHTML(j.title || 'New course')}</h3>
      <p class="library-card-subtitle">${escapeHTML(stageLabel)}${j.error && !isPartial ? ` — ${escapeHTML(j.error)}` : ''}</p>
      <div class="library-card-progress">
        <div class="library-card-progress-bar"><div class="library-card-progress-fill" style="width: ${pct}%"></div></div>
      </div>
      <div class="library-card-meta">${actionsHTML}</div>
    </div>`;
}

function wireJobsSection(container) {
  container.querySelectorAll('[data-job-action]').forEach(btn => {
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const id = btn.dataset.jobId;
      const action = btn.dataset.jobAction;
      if (action === 'open' || action === 'retry') {
        openIntakeForJob(id);
      } else if (action === 'resume') {
        // Resume from checkpoint — route by where the job actually ran.
        // (Sending a cloud resume for an SW job 404s; an SW resume for a
        // cloud job no-ops. Both leave the user stuck.)
        const job = getJobLazy(id);
        if (job?.runner === 'cloud' && cloudGenAvailable()) {
          try { await resumeCloudGeneration(id); openIntakeForJob(id); return; }
          catch (err) { console.warn('[dashboard] cloud resume failed:', err.message); }
        }
        const ok = await swResume(id);
        if (ok) openIntakeForJob(id);
        else openIntakeForJob(id);  // fallback opens the modal, which can full-restart
      } else if (action === 'cancel') {
        if (!confirm('Cancel this generation? Anything created so far will be discarded.')) return;
        const job = getJobLazy(id);
        if (job?.runner === 'cloud') cancelCloudGeneration(id);
        else swCancel(id);
      } else if (action === 'delete-job') {
        if (!confirm('Delete this generation? Any partial work is discarded — this cannot be undone.')) return;
        const j = getJobLazy(id);
        if (j?.savedCourseId) {
          try { removeUserCourse(j.savedCourseId); invalidateCourseCache(j.savedCourseId); } catch {}
        }
        removeJob(id);
      } else if (action === 'delete-partial') {
        if (!confirm('Delete this partial course and its job? Any topics that did get generated will be lost.')) return;
        const courseId = btn.dataset.courseId;
        try { removeUserCourse(courseId); invalidateCourseCache(courseId); } catch {}
        removeJob(id);
      } else if (action === 'dismiss') {
        removeJob(id);
      } else if (action === 'retry-missing') {
        const courseId = btn.dataset.courseId;
        try {
          const newJobId = await resumeMissing(courseId);
          if (newJobId) openIntakeForJob(newJobId);
        } catch (err) {
          alert(`Couldn't retry missing topics: ${err.message}`);
        }
      }
    });
  });
}

async function refreshLibraryCatalog(container) {
  try {
    const lib = await loadLibrary();
    const visible = lib.courses.filter(c => !c.internal);
    const grid = container.querySelector('.library-section:not(.library-section--jobs) .library-grid');
    if (!grid) return;
    grid.innerHTML = visible.map(c => libraryCardHTML(c)).join('');
    wireLibraryCards(container);
  } catch {}
}

/** Single-source-of-truth card render — used by both the initial library
 *  paint and the post-job-change refresh so the delete affordance is
 *  consistent everywhere. */
function libraryCardHTML(c) {
  const iconHtml = c.emoji
    ? `<div class="library-card-icon library-card-icon--emoji">${c.emoji}</div>`
    : `<div class="library-card-icon"><svg width="28" height="28"><use href="#icon-${c.icon || 'target'}"/></svg></div>`;
  const deleteBtn = canDeleteCourse(c)
    ? `<button class="library-card-delete" data-delete-course="${escapeHTML(c.id)}" data-course-title="${escapeHTML(c.title)}" aria-label="Delete ${escapeHTML(c.title)}" title="Delete course">
         <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
       </button>`
    : '';
  return `
    <a href="?course=${encodeURIComponent(c.id)}" class="library-card ${c.user ? 'library-card--user' : ''}" style="--accent: ${c.accentColor || '#4338CA'}">
      ${deleteBtn}
      ${iconHtml}
      <h3 class="library-card-title">${escapeHTML(c.title)}</h3>
      <p class="library-card-subtitle">${escapeHTML(c.subtitle || '')}</p>
      <div class="library-card-meta">
        ${c.modules} module${c.modules === 1 ? '' : 's'} · ${c.topics} topic${c.topics === 1 ? '' : 's'}
        ${c.user ? ' · <span class="library-card-tag library-card-tag--mine">your course</span>' : ''}
        ${c.partial ? ' · <span class="library-card-tag">partial</span>' : ''}
      </div>
    </a>`;
}

function wireLibraryCards(container) {
  container.querySelectorAll('[data-delete-course]').forEach(btn => {
    btn.addEventListener('click', (e) => {
      // The delete button lives inside an <a> wrapping the whole card; stop
      // the click from navigating to the course.
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.deleteCourse;
      const title = btn.dataset.courseTitle || 'this course';
      if (!confirm(`Delete "${title}"? This removes the course from your library. This can't be undone.`)) return;
      try {
        removeUserCourse(id);
        invalidateCourseCache(id);
      } catch (err) {
        alert(`Couldn't delete: ${err.message || err}`);
        return;
      }
      // Re-render so the card vanishes immediately.
      refreshLibraryCatalog(container);
    });
  });
}

// Identity comes from Supabase auth — sync the email into user-courses.js so
// canDeleteCourse / saveUserCourse stamping has it available synchronously
// (called from the library card render path on every paint).
function bridgeAuthIdentity() {
  _setCurrentUserEmailFromAuth(getUser()?.email || '');
  onUserChange((u) => {
    _setCurrentUserEmailFromAuth(u?.email || '');
    // Re-render the library so delete affordances update with the new identity.
    if (currentMode === 'library') renderForCurrentURL();
  });
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
  // Re-run the watchdog while the page is open — otherwise a job whose runner
  // died (SW replaced by a deploy, cloud function timed out, cancel that never
  // landed) shows "running"/"Draining…" forever until a manual refresh.
  setInterval(markInterruptedIfStale, 30 * 1000);
  await initAuth();
  bridgeAuthIdentity();
  initSync();
  initCourseSync();
  // Re-subscribe to any in-flight cloud generations from before this page
  // load. If the user refreshed mid-generation, this restores live progress.
  rehydrateCloudSubscriptions().catch(() => {});
  // When a cloud pull installs / removes courses, refresh the library so the
  // new cards show up without a page reload.
  _onCoursesChanged(() => {
    if (currentMode === 'library') refreshLibraryCatalog(document.getElementById('content'));
  });
  // Library re-render when courses get imported via the account modal.
  // After import, also kick a sync so the freshly-pasted courses land in cloud.
  window.addEventListener('learnable-courses-imported', () => {
    if (currentMode === 'library') renderForCurrentURL();
    syncCoursesNow().catch(() => {});
  });
  // Cloud pull installed or removed courses on the library page — refresh the
  // catalog so the user sees their cards without having to interact first.
  // Distinct from `-imported` so this listener doesn't kick another pull.
  window.addEventListener('learnable-cloud-pulled', () => {
    if (currentMode === 'library') refreshLibraryCatalog(document.getElementById('content'));
  });
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
