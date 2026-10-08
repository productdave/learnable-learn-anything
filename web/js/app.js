import { store } from './store.js?v=5';
import { loadCourse, loadModule, loadLibrary, getCourseConfig, getCurriculum, getCurrentCourseId, invalidateCourseCache } from './course-loader.js?v=8';
import { renderSidebar } from './components/sidebar.js?v=6';
import { renderTopicView, refreshLearningControls } from './components/topic-view.js?v=45';
import { renderLearningStatus } from './components/learning-status.js?v=7';
import { initSearch } from './search.js?v=7';
import { initFlashcards } from './flashcards.js?v=29';
import { courseHasFlashcards } from './course-features.js?v=1';
import { initChat, closeChat } from './chat.js?v=25';
import { initAuth, getUser, onUserChange, openAccount } from './auth.js?v=33';
import { initSync } from './sync.js?v=27';
import { openIntake, openIntakeForJob, openIntakeWithDraft, mountIntakeForJob } from './intake.js?v=97';
import { listActiveJobs, onJobsChange, markInterruptedIfStale, removeJob, removeCloudJobs, updateJob, getJob as getJobLazy } from './jobs.js?v=5';
import { cloudGenAvailable, cancelCloudGeneration, resumeCloudGeneration, restartOrStartCloudGeneration, rehydrateCloudSubscriptions, markStaleCloudJobs, markCloudCredentialsReady, deleteCloudGeneration, clearCloudGenerationSubscriptions, pullSavedCloudCourseForJob, hasSavedRequestRestartIntent, generationActionSnapshot } from './cloud-gen-client.js?v=92';
import { getUserCourse, removeUserCourse, canDeleteCourse, _setCurrentUserEmailFromAuth, _onCoursesChanged, _installCourseFromRemote } from './user-courses.js?v=4';
import { courseCanSyncToAccount, initCourseSync, syncCoursesNow } from './course-sync.js?v=31';
import { agentNameForStage } from './generator/agents.mjs?v=2';
import { createHomeController,homeAuthorHTML } from './home.js?v=29';
import { createCommunityCatalog } from './community-catalog.js?v=1';
import { mountModeration,REPORTS_URL } from './moderation.js?v=3';
import { createModerationClient } from './moderation-client.js?v=3';
import { createSetupController } from './course-setup.js?v=25';
import { HOME_URL, homeURL, workspaceExperience } from './home-model.js?v=7';
import { openCourseEditor } from './course-editor.js?v=7';
import { openCourseImages } from './course-images.js?v=5';
import { openPublicCoursePreview } from './public-course-preview.js?v=7';
import { openCourseReport,openCoursePublishing } from './course-publishing.js?v=6';
import { createPublicationStatusClient } from './publication-status-client.js?v=4';
import * as appConfig from './config.js?v=1';
import { disposePrivateCourseImages } from './private-course-images.js?v=5';
import { disposeSharedCourseImages } from './shared-course-images.js?v=3';

let cloudGenerationRefresh = null;
let cloudGenerationRefreshOwnerId = null;
let homeController = null;
let setupController = null;
let legacyHomeUnsubscribe = null;
let navigationVersion = 0;
let courseEditor = null;
let moderationController=null,moderationAccessTicket=0;

function getSetupController() {
  if (!setupController) setupController = createSetupController({
    getOwner: () => getUser()?.id || null, navigate: navigateTo,
    openJob: async (jobId, owner) => {
      const { reattachCloudGeneration } = await import('./cloud-gen-client.js?v=92');
      if (getUser()?.id !== owner) return;
      const attached = await reattachCloudGeneration(jobId);
      if (getUser()?.id !== owner) return;
      if (!attached) throw new Error('Your course plan was started, but progress couldn’t be loaded. Retry to reconnect to the same job.');
      navigateTo(homeURL({ workspace: jobId }));
    }
  });
  return setupController;
}

function getHomeController() {
  if (!homeController) homeController = createHomeController({
    loadLibrary, listJobs: listActiveJobs, getJob: getJobLazy, getUser,
    loadCommunityPage:createCommunityCatalog({enabled:!!appConfig.SELF_PUBLISH_ENABLED}),
    getSavedCourse: getUserCourse, canDelete: canDeleteCourse,
    loadPublicationStatuses:appConfig.SELF_PUBLISH_ENABLED?createPublicationStatusClient().load:undefined,
    onJobsChange, refreshCloud: refreshCloudGenerationState,
    jobControls: jobCardHTML, wireJobs: wireJobsSection, wireCourses: wireLibraryCards,
    mountJobProgress: mountIntakeForJob,
    openCreate: () => getSetupController().start(), openDraft: brief => getSetupController().start(brief),
    listDrafts: () => getSetupController().list(), deleteDraft: id => getSetupController().deleteDraft(id), openAccount
  });
  return homeController;
}

function syncExperienceShell(preview, courseId) {
  document.body.dataset.experience = preview ? 'workspace' : 'legacy';
  document.body.classList.toggle('home-mode', preview && !courseId);
  const logo = document.querySelector('.header-logo');
  if (logo) {
    logo.setAttribute('href', preview ? HOME_URL : '/');
    logo.setAttribute('aria-label', 'Learnable Home');
  }
  const sub = document.querySelector('.header-logo-sub');
  if (!courseId && sub) sub.textContent = preview ? 'Home' : '';
  let nav = document.getElementById('experience-nav');
  if (!nav) {
    nav = document.createElement('nav');
    nav.id = 'experience-nav';
    nav.className = 'experience-nav';
    nav.setAttribute('aria-label', 'Main navigation');
    document.querySelector('.header-left')?.appendChild(nav);
  }
  nav.hidden = !preview;
  const workspaceId = new URLSearchParams(location.search).get('workspace');
  const setupId = new URLSearchParams(location.search).get('draft');
  nav.innerHTML = preview ? `<a href="${HOME_URL}" ${!courseId && !workspaceId && !setupId ? 'aria-current="page"' : ''}>Home</a>${courseId ? '<span aria-current="page">Learning</span>' : setupId ? '<span aria-current="page">Setup</span>' : workspaceId ? '<span aria-current="page">Workspace</span>' : ''}` : '';
  const accessTicket=++moderationAccessTicket,owner=getUser()?.id;
  if(preview&&appConfig.MODERATION_ENABLED&&owner)createModerationClient().access().then(()=>{if(accessTicket===moderationAccessTicket&&getUser()?.id===owner){const link=document.createElement('a');link.href=REPORTS_URL;link.textContent='Reports';if(new URLSearchParams(location.search).has('moderation')){nav.querySelector('[aria-current]')?.removeAttribute('aria-current');link.setAttribute('aria-current','page');}nav.append(link);}}).catch(()=>{});
}

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
  if (logoLink) logoLink.setAttribute('href', workspaceExperience(location.search) ? HOME_URL : '/');

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
  const modules = Array.isArray(curriculum.modules) ? curriculum.modules : [];
  const overallProgress = store.getOverallProgress(modules);
  const totalTopics = modules.reduce((sum, m) => sum + (Array.isArray(m.topics) ? m.topics.length : 0), 0);
  const completedTopics = modules.reduce((sum, m) => {
    return sum + (m.topics || []).filter(topic => store.isTopicCompleted(m.id, topic.id)).length;
  }, 0);

  let html = `
    <div class="dashboard">
      <div class="dashboard-hero">
        <div class="dashboard-eyebrow">${config.eyebrow || ''}</div>
        <h1 class="dashboard-title">${escapeHTML(curriculum.title)}</h1>
        <p class="dashboard-subtitle">${escapeHTML(curriculum.subtitle)}</p>
        ${config.communityPublication?`${homeAuthorHTML(config.publicAuthor)}<button type="button" class="home-button home-button--secondary" data-report-course="${escapeHTML(config.id)}">Report this course</button>`:''}
        <div class="dashboard-stats">
          <div class="dashboard-stat">
            <span class="dashboard-stat-value">${modules.length}</span>
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

  for (const mod of modules) {
    const topics = Array.isArray(mod.topics) ? mod.topics : [];
    const progress = store.getModuleProgress(mod.id, topics.length);
    const completedCount = Math.round(progress * topics.length);
    const firstTopic = topics[0]?.id || '';

    html += `
          <a href="${firstTopic ? `#/${mod.id}/${firstTopic}` : '#'}" class="module-card" style="--module-color: ${mod.color || '#4338CA'}">
            <div class="module-card-header">
              <div class="module-card-icon">
                <svg width="24" height="24"><use href="#icon-${mod.icon || 'target'}"/></svg>
              </div>
              <span class="module-card-number">Module ${mod.number}</span>
            </div>
            <h3 class="module-card-title">${escapeHTML(mod.title)}</h3>
            <p class="module-card-desc">${escapeHTML(mod.description)}</p>
            <div class="module-card-footer">
              <div class="module-card-progress-bar">
                <div class="module-card-progress-fill" style="width: ${progress * 100}%"></div>
              </div>
              <span class="module-card-progress-text">${completedCount}/${topics.length} topics</span>
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
  disposePrivateCourseImages();
  disposeSharedCourseImages();
  const routeURL = window.location.href;
  const routeEpoch = store.scope().epoch;
  const hash = window.location.hash.slice(2) || '';
  const content = document.getElementById('content');
  const sidebar = document.getElementById('sidebar');
  const courseId = getCurrentCourseId();
  if (courseId) await loadCourse(courseId);
  if (store.scope().epoch !== routeEpoch || getCurrentCourseId() !== courseId || window.location.href !== routeURL) return;
  const curriculum = getCurriculum();
  const modules = Array.isArray(curriculum.modules) ? curriculum.modules : [];

  store.setLearningPath(modules);
  renderSidebar(sidebar);

  if (!hash || hash === '') {
    renderDashboard(content);
    return;
  }

  const [moduleId, topicId] = hash.split('/');

  if (!topicId) {
    const mod = modules.find(m => m.id === moduleId);
    const firstTopic = Array.isArray(mod?.topics) ? mod.topics[0]?.id : '';
    if (mod && firstTopic) {
      window.location.hash = `#/${moduleId}/${firstTopic}`;
    }
    return;
  }

  const mod = modules.find(m => m.id === moduleId);
  if (!mod) {
    renderDashboard(content);
    return;
  }

  const topics = Array.isArray(mod.topics) ? mod.topics : [];
  const topicMeta = topics.find(t => t.id === topicId);
  if (!topicMeta) {
    if (topics[0]?.id) window.location.hash = `#/${moduleId}/${topics[0].id}`;
    else renderDashboard(content);
    return;
  }

  try {
    const moduleData = await loadModule(moduleId);
    if (store.scope().epoch !== routeEpoch || window.location.href !== routeURL) return;
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
    if (store.scope().epoch !== routeEpoch || window.location.href !== routeURL) return;
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
  const activeRetryJob = listActiveJobs().find(j => j.runner === 'cloud' && j.savedCourseId === courseId && ['partial', 'failed', 'interrupted', 'timed_out'].includes(j.status));
  const canResume = !!activeRetryJob;
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
          <button class="library-card-action" data-missing-action="open-job" data-job-id="${escapeHTML(activeRetryJob.id)}">Retry missing topic${failedCount > 1 ? 's' : ''}</button>
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
  const btn = container.querySelector('[data-missing-action="open-job"]');
  if (!btn) return;
  btn.addEventListener('click', () => {
    const id = btn.dataset.jobId;
    if (id) openIntakeForJob(id);
  });
}

function courseRenderErrorHTML(courseId, err) {
  const saved = getUserCourse(courseId);
  const canSync = !!(saved?._generationJobId && saved?._generationRunId);
  const detail = err?.message || 'The saved course data could not be rendered.';
  return `
    <div class="empty-state missing-topic">
      <div class="missing-topic-icon">
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>
          <path d="M12 9v4M12 17h.01"/>
        </svg>
      </div>
      <h2>This course needs a quick refresh</h2>
      <p>Learnable found the course, but the saved copy in this browser is missing part of the curriculum shape it needs to render.</p>
      <div class="missing-topic-actions">
        ${canSync ? `<button class="library-card-action" data-course-repair="${escapeHTML(courseId)}" data-job-id="${escapeHTML(saved._generationJobId)}">Sync fresh copy</button>` : ''}
        <a class="library-card-action library-card-action--ghost" href="/">Back to library</a>
      </div>
      <p class="missing-topic-note">${escapeHTML(detail)}</p>
    </div>`;
}

function wireCourseRenderError(container, courseId) {
  const btn = container.querySelector('[data-course-repair]');
  if (!btn) return;
  btn.addEventListener('click', async () => {
    const jobId = btn.dataset.jobId || '';
    btn.disabled = true;
    btn.textContent = 'Syncing...';
    try {
      const ok = await pullSavedCloudCourseForJob(jobId, courseId);
      invalidateCourseCache(courseId);
      if (!ok) throw new Error('The cloud copy could not be pulled yet. Try refreshing in a moment.');
      await renderForCurrentURL();
    } catch (err) {
      btn.disabled = false;
      btn.textContent = 'Sync fresh copy';
      const note = container.querySelector('.missing-topic-note');
      if (note) note.textContent = err.message || String(err);
    }
  });
}

function renderCourseRouteError(content, courseId, err) {
  // eslint-disable-next-line no-console
  console.error('[course-render] failed:', err);
  content.innerHTML = courseRenderErrorHTML(courseId, err);
  wireCourseRenderError(content, courseId);
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

const WORKFLOW_STEPS = [
  {
    id: 'context',
    title: 'Context',
    actor: 'You + Learnable',
    body: 'Add the topic, goal, starting point, links, notes, files, and constraints before the agent spends tokens.',
    human: true
  },
  {
    id: 'curriculum',
    title: 'Curriculum',
    actor: 'Curriculum Designer',
    body: 'The agent proposes the modules, topic order, scope, and learning objectives.',
    human: true
  },
  {
    id: 'research',
    title: 'Research',
    actor: 'Researcher',
    body: 'The agent gathers concepts, examples, misconceptions, and source direction for each module.',
    human: true
  },
  {
    id: 'lessons',
    title: 'Lessons',
    actor: 'Lesson Writer + Practice Designer',
    body: 'The agent writes explanations, quizzes, exercises, flashcards, and practice loops.',
    human: false
  },
  {
    id: 'review',
    title: 'Final Review',
    actor: 'Reviewer',
    body: 'The agent assembles the course, checks missing pieces, and saves it to your library.',
    human: false
  }
];

async function renderLibrary(container) {
  legacyHomeUnsubscribe?.();
  legacyHomeUnsubscribe = null;
  let library;
  try {
    library = await loadLibrary();
  } catch {
    container.innerHTML = `<div class="empty-state"><p>Course library not available.</p></div>`;
    return;
  }
  const visible = library.courses.filter(c => !c.internal);
  const activeJobs = listActiveJobs();
  const recent = visible.slice(0, 6);

  container.innerHTML = `
    <div class="agent-home">
      <div class="agent-workflow-host">${courseWorkflowHTML(activeJobs)}</div>

      <div class="library-jobs-host">${jobsSectionHTML(activeJobs)}</div>

      <div class="library-section agent-library-section">
        <div class="agent-section-heading">
          <h2 class="library-section-title">Recent courses</h2>
          <button class="agent-secondary-btn" id="generate-btn">New course</button>
        </div>
        <div class="library-grid">
          ${recent.map(c => libraryCardHTML(c)).join('')}
        </div>
      </div>
    </div>`;

  wireAgentWorkflow(container);
  container.querySelector('#generate-btn')?.addEventListener('click', openIntake);
  wireLibraryCards(container);
  wireJobsSection(container);

  // Live updates: when a job's progress changes, re-render just the jobs section.
  // (If a new course just finished saving, also refresh the library list.)
  legacyHomeUnsubscribe = onJobsChange(() => {
    const host = container.querySelector('.library-jobs-host');
    const newJobs = listActiveJobs();
    const workflowHost = container.querySelector('.agent-workflow-host');
    if (workflowHost) workflowHost.innerHTML = courseWorkflowHTML(newJobs);
    wireAgentWorkflow(container);
    if (host) host.innerHTML = jobsSectionHTML(newJobs);
    wireJobsSection(container);
    // If a job finished and added a course to localStorage, refresh the catalog too.
    // (Re-rendering only the catalog grid keeps things cheap.)
    refreshLibraryCatalog(container);
  });
}

function wireAgentWorkflow(container) {
  container.querySelectorAll('[data-agent-action="open-intake"]').forEach(btn => {
    btn.addEventListener('click', openIntake);
  });
  container.querySelectorAll('[data-agent-action="open-review"], [data-agent-action="open-job"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.jobId;
      if (id) openIntakeForJob(id);
    });
  });
}

function courseWorkflowHTML(jobs = []) {
  const state = workflowStateFromJobs(jobs);
  return `
    <section class="agent-workflow" aria-label="Course creation workflow">
      <div class="agent-workflow-head">
        <div>
          <p class="agent-workflow-kicker">Course builder workflow</p>
          <h1>Talk to the agent, then approve the important steps.</h1>
        </div>
        <button class="agent-primary-btn" data-agent-action="open-intake">New course</button>
      </div>
      <div class="agent-workflow-steps">
        ${WORKFLOW_STEPS.map((step, index) => workflowStepHTML(step, index, state)).join('')}
      </div>
    </section>`;
}

function workflowStateFromJobs(jobs = []) {
  const active = jobs.find(j => j.status === 'review_curriculum' || j.status === 'review_research')
    || jobs.find(j => j.status === 'running' || j.status === 'cancelling')
    || jobs.find(j => ['failed', 'interrupted', 'timed_out', 'partial'].includes(j.status));

  const state = {
    activeId: 'context',
    done: new Set(),
    job: active || null,
    actionStepId: 'context',
    actionLabel: 'Add context',
    action: 'open-intake'
  };

  if (!active) return state;

  if (active.status === 'review_curriculum') {
    state.activeId = 'curriculum';
    state.done.add('context');
    state.actionStepId = 'curriculum';
    state.actionLabel = 'Open curriculum review';
    state.action = 'open-review';
  } else if (active.status === 'review_research') {
    state.activeId = 'research';
    state.done.add('context');
    state.done.add('curriculum');
    state.actionStepId = 'research';
    state.actionLabel = 'Open research review';
    state.action = 'open-review';
  } else if (active.stage === 'research') {
    state.activeId = 'research';
    state.done.add('context');
    state.done.add('curriculum');
    state.actionStepId = 'research';
    state.actionLabel = 'View progress';
    state.action = 'open-job';
  } else if (active.stage === 'topics') {
    state.activeId = 'lessons';
    state.done.add('context');
    state.done.add('curriculum');
    state.done.add('research');
    state.actionStepId = 'lessons';
    state.actionLabel = 'View progress';
    state.action = 'open-job';
  } else if (active.stage === 'assemble' || active.stage === 'done') {
    state.activeId = 'review';
    state.done.add('context');
    state.done.add('curriculum');
    state.done.add('research');
    state.done.add('lessons');
    state.actionStepId = 'review';
    state.actionLabel = 'View progress';
    state.action = 'open-job';
  } else {
    state.activeId = 'context';
    state.actionStepId = 'context';
    state.actionLabel = 'View progress';
    state.action = 'open-job';
  }

  if (['failed', 'interrupted', 'timed_out', 'partial'].includes(active.status)) {
    state.actionLabel = active.status === 'partial' ? 'Open partial course' : 'Open issue';
    state.action = 'open-job';
  }

  return state;
}

function workflowStepHTML(step, index, state) {
  const isDone = state.done.has(step.id);
  const isActive = state.activeId === step.id && !isDone;
  const isActionStep = state.actionStepId === step.id;
  const status = isDone ? 'Done' : isActive ? (step.human ? 'Needs input' : 'Working') : 'Next';
  const cls = [
    'agent-workflow-step',
    isDone ? 'is-done' : '',
    isActive ? 'is-active' : ''
  ].filter(Boolean).join(' ');
  const actionButton = isActionStep
    ? `<button class="${isActive || step.id === 'context' ? 'agent-primary-btn' : 'agent-secondary-btn'}"
        data-agent-action="${escapeHTML(state.action)}"
        ${state.job?.id ? `data-job-id="${escapeHTML(state.job.id)}"` : ''}>${escapeHTML(state.actionLabel)}</button>`
    : '';

  return `
    <article class="${cls}">
      <div class="agent-workflow-step-top">
        <span class="agent-workflow-index">${isDone ? '<svg width="14" height="14"><use href="#icon-check"/></svg>' : index + 1}</span>
        <span class="agent-workflow-status">${escapeHTML(status)}</span>
      </div>
      <h2>${escapeHTML(step.title)}</h2>
      <p>${escapeHTML(step.body)}</p>
      <div class="agent-workflow-foot">
        <span>${escapeHTML(step.actor)}</span>
        ${step.human ? '<strong>Human checkpoint</strong>' : ''}
      </div>
      ${actionButton ? `<div class="agent-workflow-action">${actionButton}</div>` : ''}
    </article>`;
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
  const isTimedOut = j.status === 'timed_out';
  const isPartial = j.status === 'partial';
  const isDone = j.status === 'completed';
  const isReview = j.status === 'review_curriculum' || j.status === 'review_research';
  const canResume = !!(j.runner === 'cloud' && j.checkpoint?.brief);
  const pendingRestart = isPendingRestartJob(j);

  // Subtitle / progress label by state.
  let stageLabel;
  if (isCancelling) stageLabel = j.message || 'Cancelling…';
  else if (isFailed) stageLabel = 'Failed';
  else if (isTimedOut) stageLabel = canResume ? 'Timed out — resume from saved checkpoint' : 'Timed out before checkpoint — restart from request';
  else if (isInterrupted) stageLabel = canResume ? 'Interrupted — resume to keep your progress' : 'Interrupted before checkpoint — retry from original request';
  else if (isPartial) stageLabel = `${(j.totalTopics || 0) - (j.failedCount || 0)} of ${j.totalTopics || 0} topics done · ${j.failedCount || 0} failed`;
  else if (isReview && j.needsApiKey) stageLabel = 'Waiting for API key';
  else if (isReview) stageLabel = j.status === 'review_curriculum' ? 'Waiting for curriculum review' : 'Waiting for research review';
  else if (isDone) stageLabel = j.courseInstalled ? 'Done' : 'Saving course to your account…';
  else stageLabel = ({
    intake: `${agentNameForStage('intake')} · Designing outline`,
    research: `${agentNameForStage('research')} · Researching`,
    topics: `${agentNameForStage('topics')} · Writing topics ${j.topicsDone}/${j.topicsTotal || '…'}`,
    assemble: `${agentNameForStage('assemble')} · Finalising`,
    done: 'Ready'
  }[j.stage] || 'Working');

  const pct = isDone
    ? 100
    : isPartial
    ? Math.round(((j.totalTopics - j.failedCount) / Math.max(1, j.totalTopics)) * 100)
    : (j.topicsTotal ? Math.min(100, Math.round(((j.topicsDone || 0) / j.topicsTotal) * 100)) : (j.stage === 'intake' ? 5 : j.stage === 'research' ? 20 : 60));

  const accent = isFailed ? '#E11D48' : (isPartial || isCancelling || isInterrupted || isTimedOut) ? '#D97706' : '#4338CA';
  const iconPath =
    isFailed ? '<path d="M12 9v4M12 17h.01M10.29 3.86 1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/>'
    : (isInterrupted || isTimedOut) ? '<path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/>'
    : isPartial ? '<circle cx="12" cy="12" r="9"/><path d="M12 8v4M12 16h.01"/>'
    : '<path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83"/>';

  let actionsHTML;
  if (isCancelling) {
    actionsHTML = `<span class="library-card-action library-card-action--ghost" aria-disabled="true">Draining…</span>`;
  } else if (isPartial && j.savedCourseId) {
    const needsApiKey = !!j.needsApiKey;
    actionsHTML = j.runner === 'cloud' ? `
      ${needsApiKey
        ? `<button class="library-card-action" data-job-action="api-key" data-job-id="${j.id}">Add API key</button>`
        : pendingRestart
          ? `<button class="library-card-action" data-job-action="restart" data-job-id="${j.id}">Restart from request</button>`
          : `<button class="library-card-action" data-job-action="resume" data-job-id="${j.id}">Retry missing topics</button>`}
      <a class="library-card-action library-card-action--ghost" href="?course=${encodeURIComponent(j.savedCourseId)}">Open as-is</a>
      ${needsApiKey || pendingRestart ? '' : `<button class="library-card-action library-card-action--ghost" data-job-action="restart" data-job-id="${j.id}">Restart</button>`}
      ${(j.failures || []).length ? `<button class="library-card-action library-card-action--ghost" data-job-action="open" data-job-id="${j.id}">View errors</button>` : ''}
      <button class="library-card-action library-card-action--danger" data-job-action="delete-partial" data-job-id="${j.id}" data-course-id="${j.savedCourseId}">Delete</button>`
      : `
      <a class="library-card-action library-card-action--ghost" href="?course=${encodeURIComponent(j.savedCourseId)}">Open as-is</a>
      ${(j.failures || []).length ? `<button class="library-card-action library-card-action--ghost" data-job-action="open" data-job-id="${j.id}">View errors</button>` : ''}
      <button class="library-card-action library-card-action--danger" data-job-action="delete-partial" data-job-id="${j.id}" data-course-id="${j.savedCourseId}">Delete</button>`;
  } else if (isFailed || isInterrupted || isTimedOut) {
    const needsSourceReattach = !!j.needsSourceReattach;
    const needsApiKey = !!j.needsApiKey;
    const retryLabel = needsApiKey ? 'Add API key' : (needsSourceReattach ? 'Reattach files' : (pendingRestart ? 'Restart from request' : (canResume ? 'Resume' : 'Retry')));
    const retryAction = needsApiKey ? 'api-key' : (needsSourceReattach ? 'reattach' : (pendingRestart ? 'restart' : (canResume ? 'resume' : 'retry')));
    actionsHTML = `
      <button class="library-card-action" data-job-action="${retryAction}" data-job-id="${j.id}">${retryLabel}</button>
      ${j.runner === 'cloud' && canResume && !pendingRestart && !needsApiKey && !needsSourceReattach ? `<button class="library-card-action library-card-action--ghost" data-job-action="restart" data-job-id="${j.id}">Restart</button>` : ''}
      ${(j.failures || []).length ? `<button class="library-card-action library-card-action--ghost" data-job-action="open" data-job-id="${j.id}">View errors</button>` : ''}
      <button class="library-card-action library-card-action--danger" data-job-action="delete-job" data-job-id="${j.id}">Delete</button>`;
  } else if (isReview) {
    actionsHTML = `
      ${j.needsApiKey ? `<button class="library-card-action" data-job-action="api-key" data-job-id="${j.id}">Add API key</button>` : ''}
      <button class="library-card-action" data-job-action="open" data-job-id="${j.id}">Open review</button>
      <button class="library-card-action library-card-action--danger" data-job-action="delete-job" data-job-id="${j.id}">Delete</button>`;
  } else if (isDone) {
    actionsHTML = j.courseInstalled && j.savedCourseId
      ? `<a class="library-card-action" href="?course=${encodeURIComponent(j.savedCourseId)}">Open course</a>`
      : `<button class="library-card-action library-card-action--ghost" data-job-action="sync-completed" data-job-id="${j.id}" data-course-id="${escapeHTML(j.savedCourseId || '')}">Sync course</button>
         <button class="library-card-action library-card-action--danger" data-job-action="delete-job" data-job-id="${j.id}">Delete</button>`;
  } else {
    // Running.
    actionsHTML = `
      <button class="library-card-action" data-job-action="open" data-job-id="${j.id}">View progress</button>
      <button class="library-card-action library-card-action--danger" data-job-action="cancel" data-job-id="${j.id}">Cancel</button>`;
  }

  return `
    <div class="library-card library-card--job ${isFailed ? 'is-failed' : ''} ${isInterrupted || isTimedOut ? 'is-interrupted' : ''} ${isPartial ? 'is-partial' : ''}" data-job-id="${j.id}" style="--accent: ${accent}">
      <div class="library-card-icon">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${iconPath}</svg>
      </div>
      <h3 class="library-card-title">${escapeHTML(j.title || 'New course')}</h3>
      <p class="library-card-subtitle">${escapeHTML(stageLabel)}${j.error && !isPartial ? ` — ${escapeHTML(j.error)}` : ''}</p>
      <div class="library-card-progress">
        <div class="library-card-progress-bar"><div class="library-card-progress-fill" style="width: ${pct}%"></div></div>
      </div>
      <div class="library-card-meta">${actionsHTML.replaceAll('data-job-action=', `data-generation-status="${escapeHTML(j.status)}" data-generation-run="${escapeHTML(j.runId || '')}" data-job-action=`)}</div>
    </div>`;
}

function wireJobsSection(container) {
  container.querySelectorAll('[data-job-action]').forEach(btn => {
    if (btn.dataset.jobWired) return;
    btn.dataset.jobWired = 'true';
    btn.addEventListener('click', async (e) => {
      e.preventDefault();
      const id = btn.dataset.jobId;
      const action = btn.dataset.jobAction;
      const expected = generationActionSnapshot({ status: btn.dataset.generationStatus, runId: btn.dataset.generationRun });
      if (action === 'open' || action === 'retry' || action === 'reattach') {
        if (action === 'reattach') {
          const job = getJobLazy(id);
          openIntakeWithDraft(job?.brief || {}, { reuseJobId: id, expected });
          return;
        }
        if (action === 'retry') {
          const job = getJobLazy(id);
          if (job?.brief && cloudGenAvailable()) {
            try { await restartOrStartCloudGeneration(id, job.brief, '', expected); openIntakeForJob(id); return; }
            catch (err) { alert(`Couldn't restart: ${err.message || err}`); return; }
          }
        }
        openIntakeForJob(id);
      } else if (action === 'resume') {
        const job = getJobLazy(id);
        if (job?.runner === 'cloud' && cloudGenAvailable()) {
          try { await resumeCloudGeneration(id, expected); openIntakeForJob(id); return; }
          catch (err) { alert(`Couldn't resume: ${err.message || err}`); return; }
        }
        openIntakeForJob(id);
      } else if (action === 'restart') {
        if (!confirm('Restart from the saved request? Learnable keeps your source context and human feedback, then rebuilds the course from the curriculum step.')) return;
        const job = getJobLazy(id);
        if (job?.brief && cloudGenAvailable()) {
          try { await restartOrStartCloudGeneration(id, job.brief, '', expected); openIntakeForJob(id); return; }
          catch (err) { alert(`Couldn't restart: ${err.message || err}`); return; }
        }
        openIntakeForJob(id);
      } else if (action === 'api-key') {
        openAccount({ intent: 'course-generation', jobId: id });
      } else if (action === 'sync-completed') {
        const courseId = btn.dataset.courseId;
        try {
          const ok = await pullSavedCloudCourseForJob(id, courseId);
          if (ok && courseId) {
            if (workspaceExperience(location.search)) navigateTo(homeURL({ course: courseId }));
            else window.location.href = `?course=${encodeURIComponent(courseId)}`;
          } else {
            alert('The course is saved in the cloud, but it could not be synced to this browser yet. Try again in a moment.');
          }
        } catch (err) {
          alert(`Couldn't sync course: ${err.message || err}`);
        }
      } else if (action === 'cancel') {
        if (!confirm('Cancel this generation? Anything created so far will be discarded.')) return;
        const job = getJobLazy(id);
        if (job?.runner === 'cloud') {
          try { await cancelCloudGeneration(id, expected); }
          catch (err) { alert(`Couldn't cancel: ${err.message || err}`); }
        }
        else removeJob(id);
      } else if (action === 'delete-job') {
        if (!confirm('Delete this generation? Any partial work is discarded — this cannot be undone.')) return;
        const j = getJobLazy(id);
        let deletedCourseId = j?.runner === 'cloud' ? null : (j?.savedCourseId || null);
        if (j?.runner === 'cloud') {
          try {
            const result = await deleteCloudGeneration(id, expected);
            deletedCourseId = result?.deletedCourseId || null;
          }
          catch (err) { alert(`Couldn't delete: ${err.message || err}`); return; }
        } else {
          removeJob(id);
        }
        if (deletedCourseId) {
          try { removeUserCourseForCurrentAccount(deletedCourseId); } catch {}
        }
      } else if (action === 'delete-partial') {
        if (!confirm('Delete this partial course and its job? Any topics that did get generated will be lost.')) return;
        const courseId = btn.dataset.courseId;
        const j = getJobLazy(id);
        let deletedCourseId = j?.runner === 'cloud' ? null : courseId;
        if (j?.runner === 'cloud') {
          try {
            const result = await deleteCloudGeneration(id, expected);
            deletedCourseId = result?.deletedCourseId || null;
          }
          catch (err) { alert(`Couldn't delete: ${err.message || err}`); return; }
        } else {
          removeJob(id);
        }
        try { removeUserCourseForCurrentAccount(deletedCourseId); } catch {}
      } else if (action === 'dismiss') {
        removeJob(id);
      }
    });
  });
}

async function refreshLibraryCatalog(container) {
  if (workspaceExperience(location.search) && !getCurrentCourseId()) {
    return homeController?.refresh();
  }
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
  const usageText = tokenUsageLabel(c.tokenUsage);
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
        ${usageText ? ` · <span class="library-card-tag" title="Approximate tokens consumed while generating this course">${usageText}</span>` : ''}
      </div>
    </a>`;
}

function tokenUsageLabel(usage) {
  const total = Number(usage?.total?.totalTokens || usage?.totalTokens || 0);
  if (!Number.isFinite(total) || total <= 0) return '';
  return `${compactNumber(total)} tokens`;
}

function compactNumber(value) {
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(value >= 10_000_000 ? 0 : 1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(value >= 10_000 ? 0 : 1)}k`;
  return String(Math.round(value));
}

function wireLibraryCards(container) {
  container.querySelectorAll('[data-delete-course]').forEach(btn => {
    if (btn.dataset.deleteWired) return;
    btn.dataset.deleteWired = 'true';
    const displayedCourse = getUserCourse(btn.dataset.deleteCourse);
    const deletionJobId = displayedCourse?._generationJobId;
    const expected = generationActionSnapshot(getJobLazy(deletionJobId) || { status: displayedCourse?.partial ? 'partial' : 'completed', runId: displayedCourse?._generationRunId });
    btn.addEventListener('click', async (e) => {
      // The delete button lives inside an <a> wrapping the whole card; stop
      // the click from navigating to the course.
      e.preventDefault();
      e.stopPropagation();
      const id = btn.dataset.deleteCourse;
      const title = btn.dataset.courseTitle || 'this course';
      if (!confirm(`Delete "${title}"? This removes the course from your library and ends public access if you published it. This can't be undone.`)) return;
      const course = getUserCourse(id);
      const generationJobId = course?._generationJobId || null;
      btn.disabled = true;
      try {
        if (generationJobId && cloudGenAvailable()) {
          await deleteCloudGeneration(generationJobId, expected);
        }
        removeUserCourse(id);
        invalidateCourseCache(id);
      } catch (err) {
        btn.disabled = false;
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
  store.setOwner(getUser()?.id || null);
  _setCurrentUserEmailFromAuth(getUser()?.email || '', getUser()?.id || '');
  let currentAuthId = getUser()?.id || null;
  onUserChange((u) => {
    store.setOwner(u?.id || null);
    const nextAuthId = u?.id || null;
    _setCurrentUserEmailFromAuth(u?.email || '', u?.id || '');
    if (nextAuthId !== currentAuthId) {
      clearCloudGenerationSubscriptions();
      removeCloudJobs();
      const activeCourseId = getCurrentCourseId();
      if (activeCourseId) {
        invalidateCourseCache(activeCourseId);
        currentMode = null;
        currentCourseSlug = null;
      }
      currentAuthId = nextAuthId;
      if (u) {
        refreshCloudGenerationState().catch(() => {});
      }
    }
    // Re-render the current route so account-only courses are revalidated
    // after sign-out or account switch, not just when the library is visible.
    renderForCurrentURL();
  });
}

function removeUserCourseForCurrentAccount(courseId) {
  if (!courseId) return false;
  const course = getUserCourse(courseId);
  const user = getUser();
  if (!courseCanSyncToAccount(course, user?.email || '', user?.id || '')) return false;
  removeUserCourse(courseId);
  invalidateCourseCache(courseId);
  return true;
}

async function refreshCloudGenerationState() {
  const ownerId = getUser()?.id || null;
  if (!ownerId) return;
  if (cloudGenerationRefresh && cloudGenerationRefreshOwnerId === ownerId) return cloudGenerationRefresh;
  cloudGenerationRefreshOwnerId = ownerId;
  const refreshOwnerId = ownerId;
  cloudGenerationRefresh = (async () => {
    try { await markStaleCloudJobs(); } catch {}
    await rehydrateCloudSubscriptions();
  })().finally(() => {
    if (cloudGenerationRefreshOwnerId === refreshOwnerId) {
      cloudGenerationRefresh = null;
      cloudGenerationRefreshOwnerId = null;
    }
  });
  return cloudGenerationRefresh;
}

function installCloudGenerationRefreshTriggers() {
  setInterval(() => {
    refreshCloudGenerationState().catch(() => {});
  }, 60 * 1000);

  window.addEventListener('online', () => {
    refreshCloudGenerationState().catch(() => {});
  });
  window.addEventListener('focus', () => {
    refreshCloudGenerationState().catch(() => {});
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      refreshCloudGenerationState().catch(() => {});
    }
  });
}

function clearApiKeyWaitForCloudJobs(preferredJobId = '', clearedJobIds = null) {
  const hasClearedFilter = Array.isArray(clearedJobIds);
  const cleared = new Set((clearedJobIds || []).filter(Boolean));
  for (const job of listActiveJobs()) {
    if (job.runner !== 'cloud' || !job.needsApiKey) continue;
    if (hasClearedFilter && !cleared.has(job.id)) continue;
    const isReview = job.status === 'review_curriculum' || job.status === 'review_research';
    const message = isReview
      ? 'API key saved. Continue from this checkpoint.'
      : job.status === 'partial'
        ? (isPendingRestartJob(job) ? 'API key saved. Restart from the saved request.' : 'API key saved. Retry missing topics from the saved checkpoint.')
        : isPendingRestartJob(job)
          ? 'API key saved. Restart from the saved request.'
          : 'API key saved. Resume from the saved checkpoint.';
    updateJob(job.id, {
      needsApiKey: false,
      pendingRestart: isPendingRestartJob(job),
      error: null,
      message,
      apiKeySavedAt: Date.now(),
      apiKeySavedFor: preferredJobId || null
    });
  }
}

function refreshWorkspaceCredentialWaits(event) {
  const detail = event.detail;
  if (detail?.owner !== getUser()?.id || detail.connected !== true || !Array.isArray(detail.cleared)) return;
  clearApiKeyWaitForCloudJobs('', detail.cleared);
  // The user chooses Resume/Retry after connection. Never auto-start a job.
  refreshCloudGenerationState().catch(() => {});
}

async function continueCloudJobAfterApiKeySaved(jobId = '') {
  if (!jobId || !cloudGenAvailable()) return false;
  const job = getJobLazy(jobId);
  if (!job || job.runner !== 'cloud') return false;
  if (job.status === 'review_curriculum' || job.status === 'review_research') {
    openIntakeForJob(jobId);
    return false;
  }
  if (job.needsSourceReattach) return false;
  if (isPendingRestartJob(job)) {
    if (!job.brief) return false;
    await restartOrStartCloudGeneration(jobId, job.brief);
    openIntakeForJob(jobId);
    return true;
  }
  if (['failed', 'interrupted', 'timed_out', 'partial'].includes(job.status)) {
    if (job.checkpoint?.brief || job.status === 'partial') {
      await resumeCloudGeneration(jobId);
    } else if (job.brief) {
      await restartOrStartCloudGeneration(jobId, job.brief);
    } else {
      return false;
    }
    openIntakeForJob(jobId);
    return true;
  }
  return false;
}

function isPendingRestartJob(job) {
  if (!job || !['failed', 'interrupted', 'timed_out', 'partial'].includes(job.status)) return false;
  if (job.pendingRestart) return true;
  return hasSavedRequestRestartIntent(job);
}

function escapeHTML(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function setShellForLibrary() {
  closeChat({ restoreFocus: false });
  const sidebar = document.getElementById('sidebar');
  if (sidebar) { sidebar.style.display = 'none'; sidebar.classList.remove('open'); }
  document.getElementById('sidebar-overlay')?.classList.remove('visible');
  document.body.style.overflow = '';
  const menuBtn = document.getElementById('mobile-menu-toggle');
  if (menuBtn) menuBtn.style.display = 'none';
  for (const id of ['search-trigger', 'flashcard-trigger', 'chat-trigger']) {
    const el = document.getElementById(id);
    if (el) el.style.display = 'none';
  }
  const courseTutor = document.getElementById('chat-panel');
  if (courseTutor) {
    courseTutor.style.display = 'none';
  }
  const selectionPopup = document.getElementById('selection-popup');
  if (selectionPopup) selectionPopup.style.display = 'none';
  document.title = 'Learnable';
}

function setShellForCourse(config = {}) {
  const sidebar = document.getElementById('sidebar');
  if (sidebar) sidebar.style.display = '';
  const menuBtn = document.getElementById('mobile-menu-toggle');
  if (menuBtn) menuBtn.style.display = '';
  for (const id of ['search-trigger', 'flashcard-trigger', 'chat-trigger']) {
    const el = document.getElementById(id);
    if (el) el.style.display = '';
  }
  const flashcardTrigger = document.getElementById('flashcard-trigger');
  if (flashcardTrigger && !courseHasFlashcards(config)) flashcardTrigger.style.display = 'none';
  const flashcardOverlay = document.getElementById('flashcard-overlay');
  if (flashcardOverlay) flashcardOverlay.style.display = 'none';
  const courseTutor = document.getElementById('chat-panel');
  if (courseTutor) courseTutor.style.display = '';
  const selectionPopup = document.getElementById('selection-popup');
  if (selectionPopup) selectionPopup.style.display = '';
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
  disposePrivateCourseImages();
  disposeSharedCourseImages();
  const version = ++navigationVersion;
  const courseId = getCurrentCourseId();
  store.setCourse(courseId);
  const cards = document.getElementById('flashcard-overlay');
  if (cards) cards.style.display = 'none';
  const content = document.getElementById('content');
  const preview = workspaceExperience(location.search);
  syncExperienceShell(preview, courseId);
  homeController?.dispose();
  moderationController?.dispose();moderationController=null;
  setupController?.dispose();
  legacyHomeUnsubscribe?.();
  legacyHomeUnsubscribe = null;

  if (!courseId) {
    setShellForLibrary();
    currentMode = 'library';
    currentCourseSlug = null;
    const params = new URLSearchParams(location.search);
    if(preview&&params.get('moderation')==='reports')moderationController=mountModeration(content,{reportId:params.get('report')||''});
    else if (preview && params.get('draft')) await getSetupController().render(content, params.get('draft'), params.get('step'));
    else if (preview) await getHomeController().render(content, params.get('workspace') || '');
    else await renderLibrary(content);
    return;
  }

  // Course mode. If we're entering a new course (from library or a switch),
  // load its data + flip the shell. Otherwise (same course, hash-only nav)
  // just rerender the route.
  if (currentMode !== 'course' || currentCourseSlug !== courseId) {
    try {
      const { config } = await loadCourse(courseId);
      if (version !== navigationVersion) return;
      applyCourseConfigToShell(config);
    } catch (err) {
      if (version !== navigationVersion) return;
      const saved = getUserCourse(courseId);
      if (saved) {
        applyCourseConfigToShell(saved.config || { name: saved.curriculum?.title || courseId });
        setShellForCourse(saved.config || {});
        renderCourseRouteError(content, courseId, err);
        currentMode = 'course';
        currentCourseSlug = courseId;
      } else {
        setShellForLibrary();
        content.innerHTML =
          `<div class="empty-state"><h1>Course unavailable</h1><p>It may have been removed or require a different account.</p><a href="${preview ? HOME_URL : '/'}">Back to Home</a></div>`;
        currentMode = 'library';
        currentCourseSlug = null;
      }
      return;
    }
    setShellForCourse(getCourseConfig());
    initCourseChromeOnce();
    currentMode = 'course';
    currentCourseSlug = courseId;
  }
  try {
    await renderRoute();
  } catch (err) {
    if (version !== navigationVersion) return;
    renderCourseRouteError(content, courseId, err);
  }
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
    let href = link.getAttribute('href');
    if (!href) return;
    if (href === '#content') {
      e.preventDefault();
      document.getElementById('content')?.focus();
      return;
    }
    // Skip external and protocol URLs.
    if (/^(https?:|mailto:|tel:)/i.test(href)) return;
    // Hash-only changes within the same path: let hashchange handle topic nav.
    if (href.startsWith('#')) return;

    e.preventDefault();
    navigateTo(href);
  });
}

async function retireLegacyServiceWorker() {
  if (!('serviceWorker' in navigator)) return false;
  try {
    const hadController = !!navigator.serviceWorker.controller;
    const regs = await navigator.serviceWorker.getRegistrations();
    const removed = (await Promise.all(regs.map(reg => reg.unregister()))).some(Boolean);
    const reloadKey = 'learnable-sw-retired-reload';
    if (hadController && removed && !sessionStorage.getItem(reloadKey)) {
      sessionStorage.setItem(reloadKey, '1');
      window.location.reload();
      return true;
    } else if (!hadController) {
      sessionStorage.removeItem(reloadKey);
    }
  } catch {
    // Non-critical cleanup. The active app no longer depends on a service worker.
  }
  return false;
}

async function init() {
  await loadIcons();
  initTheme();
  if (await retireLegacyServiceWorker()) return;
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
  // load. If Realtime drops an update, the same refresh loop repairs the
  // local mirror so review checkpoints and completed courses still appear.
  refreshCloudGenerationState().catch(() => {});
  installCloudGenerationRefreshTriggers();
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
  // A cold reader may show unavailable before the account pull finishes.
  // Recover the requested URL even if that error changed the rendered mode.
  // Otherwise refresh the library catalog after installed/removed courses.
  // Distinct from `-imported` so this listener doesn't kick another pull.
  window.addEventListener('learnable-cloud-pulled', () => {
    if (getCurrentCourseId()) renderForCurrentURL();
    else if (currentMode === 'library') refreshLibraryCatalog(document.getElementById('content'));
  });
  window.addEventListener('learnable-provider-connection-changed', refreshWorkspaceCredentialWaits);
  window.addEventListener('learnable-api-key-saved', async (event) => {
    let refreshedAfterCredentialRecovery = false;
    try {
      const jobId = event.detail?.jobId || '';
      const result = await markCloudCredentialsReady(jobId);
      const cleared = Array.isArray(result?.cleared) ? result.cleared : [];
      const started = Array.isArray(result?.started) ? result.started : [];
      clearApiKeyWaitForCloudJobs(jobId, cleared);
      if (jobId && started.includes(jobId)) {
        await refreshCloudGenerationState();
        refreshedAfterCredentialRecovery = true;
        if (getJobLazy(jobId)?.runner === 'cloud') openIntakeForJob(jobId);
      } else if (jobId && cleared.includes(jobId)) {
        await continueCloudJobAfterApiKeySaved(jobId);
      }
    } catch {}
    if (!refreshedAfterCredentialRecovery) {
      refreshCloudGenerationState().catch(() => {});
    }
  });
  await renderForCurrentURL();

  installLinkInterceptor();
  document.addEventListener('click',event=>{const button=event.target.closest('[data-report-course]');if(button)openCourseReport(button.dataset.reportCourse,getCourseConfig().communityVersion);});
  document.addEventListener('click', event => {
    const button = event.target.closest('[data-refine-course], [data-course-images], [data-public-preview], [data-manage-publication]');
    if (!button) return;
    if (courseEditor?.dialog?.isConnected) { courseEditor.dialog.focus(); return; }
    const id = button.dataset.refineCourse || button.dataset.courseImages || button.dataset.publicPreview || button.dataset.managePublication;
    if(button.hasAttribute('data-manage-publication')){courseEditor=openCoursePublishing(id,{title:button.dataset.courseTitle,mode:'manage',onPreview:()=>{courseEditor=openPublicCoursePreview(id);}});return;}
    if (button.hasAttribute('data-public-preview')) { courseEditor = openPublicCoursePreview(id); return; }
    courseEditor = (button.dataset.courseImages ? openCourseImages : openCourseEditor)(id, { preferUnfinished: button.hasAttribute('data-image-plan'), onSaved: async (result, owner) => {
      if (getUser()?.id !== owner) throw new Error('Account changed.');
      const installed = _installCourseFromRemote(id, { ...result.payload, createdByUserId: owner, _syncedAt: Date.parse(result.updatedAt) || result.payload.updatedAt });
      if (!installed) throw new Error('Could not refresh device copy.');
      invalidateCourseCache(id);
      await renderForCurrentURL();
    } });
  });
  window.addEventListener('popstate', renderForCurrentURL);
  window.addEventListener('hashchange', () => {
    // Hash drives the topic route inside a course view; library mode ignores it.
    if (currentMode === 'course') {
      renderRoute().catch(err => renderCourseRouteError(document.getElementById('content'), currentCourseSlug, err));
    }
  });

  store.subscribe(async (_, event) => {
    if (currentMode === 'course') {
      const courseId = currentCourseSlug, version = navigationVersion, epoch = store.scope().epoch;
      const current = () => currentMode === 'course' && currentCourseSlug === courseId
        && getCurrentCourseId() === courseId && version === navigationVersion && epoch === store.scope().epoch;
      try {
        // A background completed-job refresh may have invalidated the cache.
        // Reload it before synchronous sidebar access, without replacing the
        // lesson with an error while data is simply being refreshed.
        await loadCourse(courseId);
        if (!current()) return;
        renderSidebar(document.getElementById('sidebar'));
      } catch (err) {
        if (current()) renderCourseRouteError(document.getElementById('content'), courseId, err);
        return;
      }
      if (event.reason === 'remote') refreshLearningControls(document.getElementById('content'));
      if (event.reason === 'local' || event.reason === 'status') renderLearningStatus(document.getElementById('content'));
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && !e.ctrlKey && !e.metaKey) {
      const active = document.activeElement;
      if (active && active.tagName !== 'INPUT' && active.tagName !== 'TEXTAREA' && !active.isContentEditable) {
        e.preventDefault();
        if (workspaceExperience(location.search) && !getCurrentCourseId()) document.getElementById('home-search')?.focus();
        else document.getElementById('search-trigger')?.click();
      }
    }
  });
}

init();
