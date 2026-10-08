import { HOME_URL, HOME_FILTERS, HOME_STATUSES, homeSelection, homeURL, visibleHomeJobs, jobPresentation, homeGroups, lifecycleSteps, escapeHome as esc } from './home-model.js?v=7';
import { normalizePublicAuthor, publicAuthorInitials } from './public-author.js?v=1';
import { homeDraftHTML, mountHomeDraft } from './home-draft.js?v=7';
import { setupURL, COMPONENT_LABELS } from './setup-model.js?v=7';
import { mountCourseDescription } from './course-description.js?v=1';
import { briefTitle } from './brief-presentation.js?v=1';
import { inspectSavedCourse } from './course-readiness.js?v=8';
import { savedCourseReadinessHTML } from './course-readiness-view.js?v=10';
import { publicationCardHTML } from './publication-card.js?v=4';
import { mountCommunityBrowser } from './community-browser.js?v=3';

const arrow = '<span aria-hidden="true">→</span>';
const labels = { community: 'Community Courses', mine: 'Your Courses' };
const statusLabels = { all: 'All courses', attention: 'Needs Your Attention', building: 'In Progress' };

export function homeMaterialsHTML(components, incomplete = false) {
  if (!Array.isArray(components)) return '';
  const selected = Object.keys(COMPONENT_LABELS).filter(value => components.includes(value));
  if (!selected.length) return '';
  return `<section class="home-section home-materials" aria-label="Selected course materials"><h2>Your selected materials</h2><p>${selected.map(value => esc(COMPONENT_LABELS[value])).join(', ')}.</p>${incomplete ? '<p class="source-help">This is your selection, not a completion check. Only saved lessons are available while work is incomplete.</p>' : ''}</section>`;
}

export function homeJobHTML(job) {
  const state = jobPresentation(job);
  const href = state.group === 'ready' ? homeURL({ course: job.savedCourseId }) : homeURL({ workspace: job.id });
  return `<article class="home-job" data-home-job="${esc(job.id)}">
    <div class="home-job-copy"><span class="home-status home-status--${state.tone}">${esc(state.label)}</span>
      <h3>${esc(briefTitle(job.title))}</h3><p>${esc(state.detail)}</p>
      ${state.total ? `<span class="home-work-count">${state.done} of ${state.total} lessons saved</span>` : ''}
    </div><a class="home-button home-button--secondary" href="${esc(href)}">${esc(state.action)} ${arrow}<span class="sr-only">: ${esc(briefTitle(job.title))}</span></a>
  </article>`;
}

export function homeAuthorHTML(value) {
  const author = normalizePublicAuthor(value);
  const initials = author ? publicAuthorInitials(author.displayName) : '';
  const fallback = initials ? esc(initials) : '<svg width="18" height="18" focusable="false"><use href="#icon-user"/></svg>';
  return `<div class="home-course-author"><span class="home-author-avatar" aria-hidden="true">${fallback}${author?.avatarUrl ? `<img data-home-avatar src="${esc(author.avatarUrl)}" alt="" width="32" height="32" loading="lazy" decoding="async" referrerpolicy="no-referrer">` : ''}</span><span class="home-author-name">${author ? `By ${esc(author.displayName)}` : 'Author not listed'}</span></div>`;
}

export function homeSetupDraftHTML(draft) {
  const title = esc(briefTitle(draft.brief.topic));
  return `<article class="home-job"><div class="home-job-copy"><span class="home-status ${draft.unsaved ? 'home-status--warning' : ''}">${draft.unsaved ? 'Keep this tab open' : 'Setup incomplete'}</span><h3>${title}</h3>${draft.unsaved ? '<p>Your latest details could not be saved. Continue setup before leaving this tab.</p>' : ''}</div><div class="home-draft-actions"><a class="home-button home-button--secondary" href="${esc(setupURL(draft.id, draft.step))}">Continue setup →<span class="sr-only">: ${title}</span></a><button type="button" class="home-button home-button--secondary" data-delete-draft="${esc(draft.id)}" aria-label="Delete draft: ${title}">Delete draft</button></div></article>`;
}

export function originalRequestHTML(job) {
  return `<details class="home-request"><summary>Original request</summary><div class="brief-original-text setup-prewrap" role="region" aria-label="Original course request" tabindex="0"><p>${esc(job.brief?.topic || job.title || 'No request title saved.')}</p>${job.brief?.goal ? `<p>${esc(job.brief.goal)}</p>` : ''}</div><p class="home-updated">Source notes and files remain with the existing creation and review flow.</p></details>`;
}

export function homeCourseHTML(course, canDelete = false, reviewHref = '',publication = null) {
  return `<article class="home-course" data-home-course="${esc(course.id)}">
    <div class="home-course-top"><span class="home-status home-status--${course.partial ? 'warning' : 'neutral'}">${course.partial ? 'Partially ready' : course.user ? 'Your course' : 'Public course'}</span>
      ${canDelete ? `<details class="home-menu"><summary aria-label="Options for ${esc(course.title)}">Options</summary><div class="home-menu-actions"><button type="button" data-public-preview="${esc(course.id)}">Preview for publishing</button><button type="button" data-delete-course="${esc(course.id)}" data-course-title="${esc(course.title)}">Delete course</button></div></details>` : ''}
    </div>
    <h3><a href="${esc(homeURL({ course: course.id }))}">${esc(course.title || 'Untitled course')} ${arrow}</a></h3>
    ${homeAuthorHTML(publication?.publication?.author?{displayName:publication.publication.author}:course.publicAuthor)}
    <p>${esc(course.subtitle || 'Open the course to explore its learning path.')}</p>
    <span class="home-course-meta">${Number(course.modules) || 0} ${Number(course.modules) === 1 ? 'module' : 'modules'} · ${Number(course.topics) || 0} ${Number(course.topics) === 1 ? 'lesson' : 'lessons'}</span>
    ${course.user && reviewHref ? `<a class="home-course-review" href="${esc(reviewHref)}">Review course<span class="sr-only">: ${esc(course.title || 'Untitled course')}</span></a>` : ''}
    ${course.user&&canDelete?publicationCardHTML(course,publication):''}
  </article>`;
}

function section(title, items, render, id, { description = '', emptyHTML = '' } = {}) {
  if (!items.length && !emptyHTML) return '';
  return `<section class="home-section" aria-labelledby="home-${id}"><div class="home-section-heading"><h2 id="home-${id}">${title}</h2>${items.length ? `<span>${items.length}</span>` : ''}</div>${description ? `<p class="home-section-description">${esc(description)}</p>` : ''}${items.length ? `<div class="${id === 'mine' || id === 'community' ? 'home-course-grid' : 'home-job-list'}">${items.map(render).join('')}</div>` : emptyHTML}</section>`;
}

function notice(text, warning = false) {
  return `<div class="home-notice ${warning ? 'home-notice--warning' : ''}" role="status">${esc(text)}</div>`;
}

// Dependencies are passed in from the existing app: no duplicate job store, action
// implementation, authentication client or lifecycle state machine.
export function createHomeController(api) {
  let host = null;
  let workspaceId = '';
  let courses = [];
  let catalogError = null;
  let loading = false;
  let request = 0;
  let events = null;
  let unsubscribe = null;
  let outcomeDraft = '';
  let draftOwner = '';
  let localDraft = null;
  let setupDrafts = [], setupError = false, setupAccountError = false;
  let publications=new Map(),publicationRequest=0,lastPublicationRefresh=0;
  let communityBrowser=null;
  let inlineProgress = null, inlineJobId = '';
  const renderedHTML = new WeakMap();

  const jobs = () => visibleHomeJobs(api.listJobs(), api.getUser()?.id || '');
  const active = () => !!host?.querySelector('[data-home-root]');

  function dispose() {
    disposeProgress();
    const outcome = host?.querySelector('#home-outcome');
    if (outcome && draftOwner === (api.getUser()?.id || '')) outcomeDraft = outcome.value;
    localDraft?.dispose();
    localDraft = null;
    communityBrowser?.dispose();communityBrowser=null;
    request++;
    publicationRequest++;publications=new Map();
    events?.abort();
    unsubscribe?.();
    unsubscribe = null;
    host = null;
  }

  function disposeProgress() {
    inlineProgress?.dispose();
    inlineProgress = null; inlineJobId = '';
  }

  function preserveFocusReplace(target, html) {
    if (!target || renderedHTML.get(target) === html) return;
    const focused = document.activeElement;
    const href = target.contains(focused) ? focused.getAttribute('href') : null;
    const action = target.contains(focused) ? focused.dataset.jobAction : null;
    const summary = target.contains(focused) && focused.matches('summary') ? focused.getAttribute('aria-label') || focused.textContent : null;
    const cardAction=target.contains(focused)&&focused.matches('button')?{id:focused.closest('[data-home-course]')?.dataset.homeCourse,text:focused.textContent}:null;
    const openDetails = [...target.querySelectorAll('details[open]')].map(detail => detail.querySelector('summary')?.getAttribute('aria-label') || detail.querySelector('summary')?.textContent);
    target.innerHTML = html;
    renderedHTML.set(target, html);
    target.querySelectorAll('details').forEach(detail => {
      const summary = detail.querySelector('summary');
      if (openDetails.includes(summary?.getAttribute('aria-label') || summary?.textContent)) detail.open = true;
    });
    const replacement = href ? [...target.querySelectorAll('a')].find(a => a.getAttribute('href') === href)
      : action ? [...target.querySelectorAll('[data-job-action]')].find(el => el.dataset.jobAction === action)
      : summary ? [...target.querySelectorAll('summary')].find(el => (el.getAttribute('aria-label') || el.textContent) === summary)
      : cardAction ? [...target.querySelectorAll('[data-home-course] button')].find(el=>el.closest('[data-home-course]').dataset.homeCourse===cardAction.id&&el.textContent===cardAction.text)||[...target.querySelectorAll('[data-home-course]')].find(el=>el.dataset.homeCourse===cardAction.id)?.querySelector('h3 a') : null;
    replacement?.focus({ preventScroll: true });
  }

  function paint() {
    if (!active()) return;
    const connection = host.querySelector('[data-home-connection]');
    connection.innerHTML = navigator.onLine === false ? notice(workspaceId
      ? 'You’re offline. Showing the last saved workspace state; reconnect before continuing.'
      : 'You’re offline. Available courses are shown below; reconnect for the latest account updates.', true) : '';
    if (workspaceId) { paintWorkspace(); return; }
    document.title = 'Home | Learnable';
    const { filter, status } = homeSelection(location.search);
    const query = host.querySelector('[data-home-search]')?.value || '';
    host.querySelectorAll('[data-home-filter]').forEach(link => {
      link.setAttribute('aria-current', link.dataset.homeFilter === filter ? 'page' : 'false');
      link.href = homeURL({ filter: link.dataset.homeFilter, q: query });
    });
    if(filter==='community'&&communityBrowser)return;
    const groups = homeGroups(courses, jobs(), query, filter, status);
    const localSetups = filter === 'mine' && status === 'all' ? setupDrafts.filter(draft => (draft.brief.topic || 'Untitled course').toLocaleLowerCase().includes(query.trim().toLocaleLowerCase())) : [];
    const hasResults = localSetups.length || Object.values(groups).some(items => items.length);
    const resultCount = localSetups.length + Object.values(groups).reduce((n, items) => n + items.length, 0);
    const accountNote = !api.getUser() && !query && filter === 'mine'
      ? `<div class="home-empty"><h3>Keep your courses together</h3><p>Sign in to see the courses saved to your account.</p><button class="home-button" data-home-account>Sign in</button></div>` : '';
    const emptyAction = query ? `<a class="home-button home-button--secondary" href="${homeURL({ filter, status })}">Clear search</a>`
      : status !== 'all' ? `<a class="home-button home-button--secondary" href="${homeURL({ filter: 'mine' })}">Show all your courses</a>`
      : '<button class="home-button" data-home-create>Create a course</button>';
    const empty = accountNote || `<div class="home-empty"><h3>${query ? 'No matching courses' : status === 'attention' ? 'Nothing needs your attention' : status === 'building' ? 'No courses being created' : 'Your next course starts here'}</h3><p>${query ? 'Try a different title or clear your search.' : status === 'attention' ? 'Reviews and issues will appear here when there’s something for you to do.' : 'Describe what you want to learn or teach, then create a course.'}</p>${emptyAction}</div>`;
    const error = catalogError ? `<div class="home-notice home-notice--warning" role="status"><div><strong>Couldn’t load Community Courses</strong><p>Your saved courses and jobs are still available in their tabs.</p></div><button class="home-button home-button--secondary" data-home-refresh ${loading ? 'disabled' : ''}>${loading ? 'Retrying…' : 'Try again'}</button></div>` : '';
    const loadingHTML = loading && !courses.length && !hasResults ? '<div class="home-loading" role="status">Loading your courses…<div class="home-skeleton"></div><div class="home-skeleton"></div></div>' : '';
    const communityEmpty = catalogError
      ? '<div class="home-empty"><h3>Community Courses are unavailable</h3><p>Try again above to load published courses.</p></div>'
      : loading ? '<div class="home-loading" role="status">Loading Community Courses…<div class="home-skeleton"></div></div>'
      : query ? `<div class="home-empty"><h3>No matching community courses</h3><p>Try a different title or clear your search.</p><a class="home-button home-button--secondary" href="${homeURL({ filter: 'community' })}">Clear search</a></div>`
      : '<div class="home-empty"><h3>No community courses yet</h3><p>Courses will appear here when they’re published publicly. Your private courses stay in Your Courses.</p></div>';
    const communityHTML = filter === 'community' ? section(labels.community, groups.community, c => homeCourseHTML(c), 'community', {
      description: 'Courses published by the community, open for everyone to explore.',
      emptyHTML: communityEmpty
    }) : '';
    const personalJobs = [...groups.attention, ...groups.building];
    const personalHTML = filter === 'mine'
      ? (personalJobs.length ? `<div class="home-job-list">${personalJobs.map(homeJobHTML).join('')}</div>` : '')
        + (groups.mine.length ? `<div class="home-course-grid">${groups.mine.map(c => homeCourseHTML(c, api.canDelete(c), api.getSavedCourse(c.id)?._generationJobId ? homeURL({ workspace: api.getSavedCourse(c.id)._generationJobId }) : '',api.loadPublicationStatuses?publications.get(c.id)||{state:'loading'}:null)).join('')}</div>` : '')
      : '';
    const setupHTML = localSetups.length ? `<div class="home-local-setups"><h3>Continue setting up</h3><p>Finish your setup to create a course.</p><div class="home-job-list">${localSetups.map(homeSetupDraftHTML).join('')}</div></div>` : '';
    const setupWarning = filter === 'mine' && setupError ? '<div class="home-notice home-notice--warning" role="status">We couldn’t restore all unfinished setups in this browser. Keep any open setup tabs until you can continue.<button class="home-button home-button--secondary" data-home-refresh>Retry</button></div>' : '';
    const accountWarning = filter === 'mine' && setupAccountError ? '<div class="home-notice home-notice--warning" role="status">We couldn’t load all of your unfinished setups. You can continue any setup shown below or retry.<button class="home-button home-button--secondary" data-home-refresh>Retry</button></div>' : '';
    const html = error + setupWarning + accountWarning + communityHTML + setupHTML + personalHTML
      + (!hasResults && !communityHTML ? loadingHTML || empty : '');
    const target = host.querySelector('[data-home-results]');
    preserveFocusReplace(target, html);
    api.wireCourses(target);
    host.querySelector('[data-home-result-count]').textContent = loading ? 'Updating courses…' : `${resultCount} ${resultCount === 1 ? 'result' : 'results'}`;
  }

  function paintWorkspace() {
    let job = api.getJob(workspaceId);
    if (job && !visibleHomeJobs([job], api.getUser()?.id || '').length) job = null;
    const saved = courses.find(c => c.user && api.getSavedCourse(c.id)?._generationJobId === workspaceId);
    const courseId = job?.savedCourseId || saved?.id;
    const candidate = courseId ? api.getSavedCourse(courseId) : null;
    const savedCourse = candidate?._generationJobId === workspaceId ? candidate : null;
    const report = inspectSavedCourse(savedCourse);
    if (job?.status === 'completed' && !savedCourse) job = { ...job, courseInstalled: false };
    const target = host.querySelector('[data-home-workspace]');
    if (!job) {
      disposeProgress();
      const html = saved
        ? `<a class="home-back" href="${HOME_URL}">← Home</a><div class="home-workspace-head"><span class="home-status home-status--${report.needsAttention || !report.available ? 'warning' : 'success'}">${report.partial ? 'Partially ready' : report.needsAttention ? 'Draft needs attention' : report.available ? 'Ready for review' : 'Saved · check details'}</span><h1>${esc(saved.title)}</h1><p>${report.available && !report.needsAttention ? 'Your course draft is saved and ready to review.' : 'Your saved account copy is retained. Check the available content below.'}</p><a class="home-button" href="${esc(homeURL({ course: saved.id }))}">Open course ${arrow}</a></div>${savedCourseReadinessHTML(savedCourse, { report, loading, editable: !report.partial })}`
        : `<a class="home-back" href="${HOME_URL}">← Home</a><div class="home-empty"><h1>${loading ? 'Loading workspace…' : 'Workspace unavailable'}</h1><p>${loading ? 'Checking the work available to your account.' : 'It may have been removed or belong to a different account. Sign in to the right account, or check again.'}</p>${!loading ? '<button class="home-button home-button--secondary" data-home-refresh>Check again</button><button class="home-button" data-home-account>Account</button>' : ''}</div>`;
      preserveFocusReplace(target, html);
      return;
    }
    const state = jobPresentation(job);
    const timeline = lifecycleSteps(job);
    if (job.status === 'completed' && report.available) { state.total = report.total; state.done = report.saved; }
    if (job.status === 'completed' && report.available && report.needsAttention) {
      state.label = 'Draft needs attention'; state.tone = 'warning'; state.group = 'attention'; state.detail = 'Your account copy is saved. Review the missing content below before relying on the course.';
      const attentionStage = !report.gaps.length && report.designProgress?.selected && !report.designProgress.complete ? 'Refine'
        : !report.gaps.length && report.imageProgress?.selected && (report.imageProgress.missing || report.imageProgress.unplanned) ? 'Images' : 'Lessons';
      const attentionIndex = Math.max(0, timeline.findIndex(step => step.label === attentionStage));
      timeline.forEach((step, index) => { if (index >= attentionIndex) step.state = index === attentionIndex ? 'current' : 'next'; });
    }
    document.title = `${briefTitle(job.title, 'Course workspace')} | Learnable`;
    if (api.mountJobProgress && !['completed', 'cancelled'].includes(job.status)) {
      // Keep the live renderer in place. Replacing the whole workspace on each
      // library/job refresh would destroy feedback, source inputs and focus.
      if (inlineJobId !== job.id || !target.querySelector('[data-workspace-inline]')) {
        disposeProgress();
        target.innerHTML = `<a class="home-back" href="${HOME_URL}">← Home</a>
          <span class="home-eyebrow">Course workspace</span>
          <section class="home-inline-progress" data-workspace-inline aria-label="Course creation progress and review"></section>
          <div data-workspace-after></div>`;
        renderedHTML.delete(target);
        inlineJobId = job.id;
        inlineProgress = api.mountJobProgress(target.querySelector('[data-workspace-inline]'), job.id);
      }
      preserveFocusReplace(target.querySelector('[data-workspace-after]'), `
        ${job.savedCourseId ? savedCourseReadinessHTML(savedCourse, { report, loading, jobAvailable: true, editable: false, recoveryAvailable: ['partial', 'failed', 'interrupted', 'timed_out'].includes(job.status) }) : ''}
        ${homeMaterialsHTML(job.brief?.components || job.checkpoint?.brief?.components, true)}
        ${originalRequestHTML(job)}`);
      return;
    }
    const focusAfterCompletion = inlineProgress && target.contains(document.activeElement);
    disposeProgress();
    const date = new Date(job.lastUpdatedAt || job.startedAt || 0);
    const updated = date.getTime() ? date.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '';
    let controls;
    if (job.status === 'cancelled') {
      controls = `<p>This run has stopped. Starting again creates a new request.</p><button class="home-button home-button--secondary" data-home-reuse>Use saved request</button>`;
    } else {
      controls = api.jobControls(job);
      // Keep tested recovery actions, but move destructive/full-rebuild choices
      // away from the primary next step. This changes placement, not semantics.
      const wrapper = document.createElement('div');
      wrapper.innerHTML = controls;
      const secondary = [...wrapper.querySelectorAll('[data-job-action]')].filter(button => ['delete-job', 'delete-partial', 'cancel', 'restart'].includes(button.dataset.jobAction));
      if (secondary.length) {
        const menu = document.createElement('details');
        menu.className = 'home-run-menu';
        menu.innerHTML = '<summary>More actions</summary><div></div>';
        secondary.forEach(button => menu.querySelector('div').appendChild(button));
        wrapper.querySelector('.library-card-meta')?.appendChild(menu);
      }
      controls = wrapper.innerHTML;
    }
    const html = `<a class="home-back" href="${HOME_URL}">← Home</a>
      <header class="home-workspace-head"><span class="home-eyebrow">Course workspace</span><h1>${esc(briefTitle(job.title))}</h1>
        <span class="home-status home-status--${state.tone}">${esc(state.label)}</span><p>${esc(state.detail)}</p>${updated ? `<span class="home-updated">Updated ${esc(updated)}</span>` : ''}</header>
      <section class="home-section" aria-labelledby="workspace-progress"><h2 id="workspace-progress">Course progress</h2>
        <ol class="home-timeline">${timeline.map(step => `<li class="is-${step.state}" ${step.state === 'current' ? 'aria-current="step"' : ''}><span class="home-step-mark" aria-hidden="true">${step.state === 'done' ? '✓' : '○'}</span>${step.label}<span class="sr-only">: ${step.state === 'done' ? 'complete' : step.state === 'current' ? 'current stage' : 'not yet complete'}</span></li>`).join('')}</ol>
        ${state.total ? `<p class="home-work-count">${state.done} of ${state.total} lessons saved${job.stage === 'design' ? ` · ${job.designProgress?.completed || 0} of ${job.designProgress?.total || state.total} lesson refinements saved` : state.done === state.total && state.group === 'building' ? ' · course creation is still in progress' : ''}</p>` : ''}</section>
      <section class="home-section home-next-action" aria-labelledby="workspace-next"><h2 id="workspace-next">${state.group === 'attention' ? 'Your next step' : state.group === 'ready' ? 'Start learning' : 'Activity and controls'}</h2>
        <div class="home-existing-controls">${controls}</div>${job.status === 'partial' ? `<p class="source-help">${['design', 'images'].includes(job.stage) ? 'Resume continues this same course creation. Your saved lessons, refinements and images are kept.' : 'Retry rebuilds only failed lessons, including their selected materials. Your saved lessons and their progress stay available.'}</p>` : ''}</section>
      ${job.savedCourseId ? savedCourseReadinessHTML(savedCourse, { report, loading, jobAvailable: true, editable: job.status === 'completed', recoveryAvailable: ['partial', 'failed', 'interrupted', 'timed_out'].includes(job.status) }) : ''}
      ${homeMaterialsHTML(job.brief?.components || job.checkpoint?.brief?.components, state.group !== 'ready')}
      ${originalRequestHTML(job)}`;
    preserveFocusReplace(target, html);
    if (focusAfterCompletion) { const heading = target.querySelector('h1'); heading?.setAttribute('tabindex', '-1'); heading?.focus({ preventScroll: true }); }
    api.wireJobs(target);
    // Existing controls retain their action semantics, but links stay in preview.
    target.querySelectorAll('a[href^="?course="]').forEach(link => {
      link.href = homeURL({ course: new URLSearchParams(link.getAttribute('href').slice(1)).get('course') });
    });
    target.querySelectorAll('[data-job-action]').forEach(button => {
      const inspectOnly = ['open', 'api-key'].includes(button.dataset.jobAction);
      if (!inspectOnly) {
        button.disabled = navigator.onLine === false;
        if (button.disabled) button.title = 'Reconnect to use this action';
        else button.removeAttribute('title');
      }
    });
  }

  async function refreshPublications() {
    const owner=api.getUser()?.id;
    if(!active()||workspaceId||homeSelection(location.search).filter!=='mine'||!owner||!api.loadPublicationStatuses)return;
    const version=++publicationRequest,ids=courses.filter(c=>c.user&&api.canDelete(c)).map(c=>c.id);
    publications=new Map(ids.map(id=>[id,{state:'loading'}]));lastPublicationRefresh=Date.now();paint();
    let result;
    try{if(navigator.onLine===false)throw new Error('offline');result=await api.loadPublicationStatuses(owner,ids);}
    catch{result=new Map(ids.map(id=>[id,{state:'error'}]));}
    if(version!==publicationRequest||!active()||owner!==api.getUser()?.id)return;
    publications=result;paint();
  }

  async function refresh({ cloud = false } = {}) {
    if (!active()) return;
    if(communityBrowser)return communityBrowser.refresh();
    const version = ++request;
    const owner = api.getUser()?.id || '';
    loading = true;
    paint();
    if (cloud && navigator.onLine !== false) await api.refreshCloud().catch(() => {});
    try {
      const [result, drafts] = await Promise.all([api.loadLibrary({ allowPartial: true,includePublic:!api.loadCommunityPage }).catch(() => ({ courses, catalogError: true })), api.listDrafts?.().catch(() => ({ drafts: [], error: true })) || { drafts: [] }]);
      if (version !== request || !active() || owner !== (api.getUser()?.id || '')) return;
      courses = result.courses;
      catalogError = result.catalogError || null;
      setupDrafts = drafts.drafts; setupError = !!drafts.error; setupAccountError = !!drafts.accountError;
    } catch {
      if (version !== request || !active()) return;
      catalogError = true;
    }
    if (version !== request || !active()) return;
    loading = false;
    paint();
    await refreshPublications();
  }

  async function render(container, id = '') {
    dispose();
    host = container;
    workspaceId = id;
    const owner = api.getUser()?.id || '';
    if (draftOwner !== owner) outcomeDraft = '';
    draftOwner = owner;
    courses = []; setupDrafts = []; setupError = false; setupAccountError = false; catalogError = null; loading = true;
    events = new AbortController();
    const signal = events.signal;
    const params = new URLSearchParams(location.search);
    const selected = homeSelection(location.search);
    host.innerHTML = `<div class="home-experience" data-home-root><div data-home-connection></div>${id ? '<div data-home-workspace></div>' : `
      <header class="home-heading"><div><span class="home-eyebrow">Your learning space</span><h1>What will you learn next?</h1><p>Turn an outcome into a course. Pick up your work here.</p></div></header>
      <form class="home-create-form" novalidate><label for="home-outcome">What do you want to learn or teach?</label><div class="home-create-row"><div class="home-description-field"><textarea class="course-description" id="home-outcome" name="outcome" rows="2" aria-describedby="home-outcome-count home-outcome-error" placeholder="e.g. Teach my four-year-old to swim. Describe what you want the course to cover." autocomplete="off">${esc(outcomeDraft)}</textarea><p class="course-description-count" id="home-outcome-count"></p><p class="course-description-error" id="home-outcome-error" aria-live="polite"></p></div><button class="home-button" type="submit">Create course ${arrow}</button></div>${homeDraftHTML()}</form>
      <div class="home-toolbar"><nav class="home-filters" aria-label="Course collections">${HOME_FILTERS.map(filter => `<a href="${esc(homeURL({ filter, q: params.get('q') || '' }))}" data-home-filter="${filter}">${labels[filter]}</a>`).join('')}</nav>
      <div class="home-search"><label for="home-search">Find a course</label><input id="home-search" type="search" data-home-search value="${esc(params.get('q') || '')}" maxlength="120" placeholder="${selected.filter==='community'&&api.loadCommunityPage?'Title, description or author':'Search by title'}" autocomplete="off"></div></div>
      <span class="sr-only" role="status" data-home-result-count></span>${selected.filter === 'mine' ? `<section class="home-section home-personal" aria-labelledby="home-mine"><div class="home-personal-heading"><div><h2 id="home-mine">Your Courses</h2><p>Saved courses and courses you’re creating.</p></div><div class="home-status-filter"><label for="home-course-status">Status</label><select id="home-course-status" data-home-status>${HOME_STATUSES.map(status => `<option value="${status}" ${selected.status === status ? 'selected' : ''}>${statusLabels[status]}</option>`).join('')}</select></div></div><div data-home-results class="home-personal-results"></div></section>` : '<div data-home-results></div>'}`}</div>`;
    if(!id&&selected.filter==='community'&&api.loadCommunityPage)communityBrowser=mountCommunityBrowser(host.querySelector('[data-home-results]'),{
      loadPage:api.loadCommunityPage,renderCourse:c=>homeCourseHTML(c),wireCourses:api.wireCourses,query:params.get('q')||'',
      onClear:()=>{const input=host.querySelector('[data-home-search]');input.value='';input.dispatchEvent(new Event('input',{bubbles:true}));input.focus();}
    });
    const description = !id ? mountCourseDescription(host.querySelector('#home-outcome'), {
      counter: host.querySelector('#home-outcome-count'), error: host.querySelector('#home-outcome-error'), signal
    }) : null;
    if (!id) localDraft = mountHomeDraft(host.querySelector('.home-create-form'), {
      getOwner: () => api.getUser()?.id || null,
      onValueChange: () => description.update(),
      continueUnsaved: value => { if (description.update()) { host.querySelector('#home-outcome').focus(); return; } value.trim() ? api.openDraft({ topic: value }) : api.openCreate(); }
    });
    host.addEventListener('submit', async event => {
      if (!event.target.matches('.home-create-form')) return;
      event.preventDefault();
      if (description.update()) { host.querySelector('#home-outcome').focus(); return; }
      const ownerAtSubmit = api.getUser()?.id || '';
      const form = event.target;
      const currentDraft = localDraft;
      if (currentDraft && !(await currentDraft.flush())) return;
      if (currentDraft !== localDraft || ownerAtSubmit !== (api.getUser()?.id || '') || !form.isConnected) return;
      const outcome = event.target.elements.outcome.value;
      const button = form.querySelector('[type="submit"]'), input = form.elements.outcome;
      const original = button.innerHTML;
      button.disabled = true; button.textContent = 'Opening setup…'; input.readOnly = true;
      try { await (outcome.trim() ? api.openDraft({ topic: outcome }) : api.openCreate()); }
      finally { if (form.isConnected) { button.disabled = false; button.innerHTML = original; input.readOnly = false; } }
    }, { signal });
    // Keep the visible fallback instead of a broken-image icon. Image errors do
    // not bubble, so this listener intentionally uses the capture phase.
    host.addEventListener('error', event => {
      if (event.target.matches?.('[data-home-avatar]')) event.target.remove();
    }, { signal, capture: true });
    host.addEventListener('input', event => {
      if (!event.target.matches('[data-home-search]')) return;
      const { filter, status } = homeSelection(location.search);
      history.replaceState(null, '', homeURL({ filter, status, q: event.target.value }));
      communityBrowser?.search(event.target.value);
      paint();
    }, { signal });
    host.addEventListener('change', event => {
      if (!event.target.matches('[data-home-status]')) return;
      const q = host.querySelector('[data-home-search]')?.value || '';
      history.pushState(null, '', homeURL({ filter: 'mine', status: event.target.value, q }));
      paint();
    }, { signal });
    host.addEventListener('click', async event => {
      const button = event.target.closest('button');
      if(button?.matches('[data-delete-draft]')) {
        const owner=api.getUser()?.id||'';
        if(await api.deleteDraft?.(button.dataset.deleteDraft) && active() && owner===(api.getUser()?.id||'')) {
          await refresh();const heading=host?.querySelector('#home-mine');heading?.setAttribute('tabindex','-1');heading?.focus();
        }
      }
      if (button?.matches('[data-home-create]')) api.openCreate();
      if (button?.matches('[data-home-account]')) api.openAccount();
      if (button?.matches('[data-home-refresh]')) refresh({ cloud: true });
      if (button?.matches('[data-publication-retry]')) refreshPublications();
      if (button?.matches('[data-home-reuse]')) {
        const job = jobs().find(item => item.id === workspaceId);
        if (job) api.openDraft(job.brief || {});
      }
    }, { signal });
    window.addEventListener('offline', () => {paint();refreshPublications();}, { signal });
    window.addEventListener('online', () => refresh({ cloud: true }), { signal });
    window.addEventListener('publication-changed', refreshPublications, {signal});
    window.addEventListener('focus',()=>{if(Date.now()-lastPublicationRefresh>5000)refreshPublications();},{signal});
    document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible')refreshPublications();},{signal});
    window.addEventListener('storage', event => {
      if (['learnable-gen-jobs', 'learnable-user-courses'].includes(event.key)) refresh();
    }, { signal });
    unsubscribe = api.onJobsChange(() => { if(!communityBrowser){paint(); refresh();} });
    paint();
    await refresh();
  }

  return { render, refresh, dispose };
}
