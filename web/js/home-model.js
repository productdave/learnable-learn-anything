// Read-only presentation model. Cloud generation_jobs remains the state authority.
export const HOME_URL = '/';
export const HOME_FILTERS = ['community', 'mine'];
export const HOME_STATUSES = ['all', 'attention', 'building'];

export function normalizeHomeFilter(filter) {
  // Old status destinations now live inside the personal collection.
  if (filter === 'attention' || filter === 'building') return 'mine';
  return HOME_FILTERS.includes(filter) ? filter : 'community';
}

export function normalizeHomeStatus(status, legacyFilter) {
  if (!status && ['attention', 'building'].includes(legacyFilter)) return legacyFilter;
  return HOME_STATUSES.includes(status) ? status : 'all';
}

export function homeSelection(search = '') {
  const params = new URLSearchParams(search);
  const filter = normalizeHomeFilter(params.get('filter'));
  return { filter, status: filter === 'mine' ? normalizeHomeStatus(params.get('status'), params.get('filter')) : 'all' };
}

export function workspaceExperience() {
  // The workspace is now the app, not a preview behind a query parameter.
  // Existing experience=workspace (and older course) bookmarks still work.
  return true;
}

export function homeURL({ workspace, course, filter, status, q } = {}) {
  const params = new URLSearchParams();
  if (workspace) params.set('workspace', workspace);
  else if (course) params.set('course', course);
  const normalizedFilter = normalizeHomeFilter(filter);
  if (filter) params.set('filter', normalizedFilter);
  const normalizedStatus = normalizeHomeStatus(status, filter);
  if (normalizedFilter === 'mine' && normalizedStatus !== 'all') params.set('status', normalizedStatus);
  if (q) params.set('q', q);
  return params.toString() ? `?${params}` : HOME_URL;
}

export function visibleHomeJobs(jobs = [], ownerId = '') {
  return jobs.filter(job => job && (
    job.runner === 'cloud'
      ? !!ownerId && job.ownerId === ownerId
      : !job.ownerId || job.ownerId === ownerId
  )).sort((a, b) => Number(b.startedAt || 0) - Number(a.startedAt || 0));
}

export function jobPresentation(job = {}) {
  const status = job.status;
  let group = 'building';
  let tone = 'working';
  let label = 'Creating course';
  let action = 'View workspace';
  let detail = 'Open the workspace to see the latest saved progress.';
  if (status === 'completed') {
    group = job.courseInstalled && job.savedCourseId ? 'ready' : 'attention';
    tone = group === 'ready' ? 'success' : 'warning';
    label = group === 'ready' ? 'Ready' : 'Sync needed';
    action = group === 'ready' ? 'Open course' : 'Sync course';
    detail = group === 'ready' ? 'Your saved course is ready to open.' : 'Saved in your account. Sync it to this browser to open it.';
  } else if (status === 'cancelling') {
    label = 'Stopping';
    detail = 'Waiting for the current work to stop. No new work will be started.';
  } else if (status === 'cancelled') {
    group = 'attention'; tone = 'neutral'; label = 'Cancelled'; action = 'View saved request';
    detail = 'This run has stopped. Review the saved request before starting again.';
  } else if (job.needsApiKey) {
    group = 'attention'; tone = 'warning'; label = 'API key needed'; action = 'Resolve issue';
    detail = 'Your saved work is kept. Add a working API key to continue.';
  } else if (job.needsSourceReattach) {
    group = 'attention'; tone = 'warning'; label = 'Files needed'; action = 'Resolve issue';
    detail = 'Your request is kept. Reattach the source files before continuing.';
  } else if (status === 'review_curriculum' || status === 'review_research') {
    group = 'attention'; tone = 'warning';
    label = status === 'review_curriculum' ? 'Plan ready for review' : 'Evidence ready for review';
    action = status === 'review_curriculum' ? 'Review plan' : 'Review evidence';
    detail = 'Waiting for your approval before the next stage starts.';
  } else if (['failed', 'interrupted', 'timed_out', 'partial'].includes(status)) {
    group = 'attention'; tone = 'warning'; action = 'Resolve issue';
    label = ({ failed: 'Needs attention', interrupted: 'Interrupted', timed_out: 'Timed out', partial: 'Partially ready' })[status];
    detail = job.checkpoint?.brief
      ? 'Your checkpoint is saved. Review the issue and available recovery options.'
      : 'Your request is kept. Review the issue before retrying.';
  } else {
    const refining = job.brief?.visual_designer_policy === 'learner-experience-v1' || job.checkpoint?.brief?.visual_designer_policy === 'learner-experience-v1';
    label = ({ queued: 'Queued' })[status] || ({ intake: 'Designing plan', research: 'Researching evidence', topics: 'Building lessons', design: 'Refining lessons', images: refining ? 'Creating illustrations' : 'Creating instructional images', assemble: 'Finishing course', done: 'Finishing save' })[job.stage] || label;
    detail = job.runner === 'cloud' ? 'This work runs in your account. You can leave and return here.' : 'A saved run from this device. Open it to check its status.';
  }
  const rawTotal = Number(job.topicsTotal ?? job.totalTopics ?? 0);
  const total = Number.isFinite(rawTotal) ? Math.max(0, Math.floor(rawTotal)) : 0;
  const savedTopics = job.checkpoint?.topicsByKey;
  const failedTopics = Array.isArray(job.failures) ? job.failures.filter(failure => failure.topicId && !['design', 'images'].includes(failure.stage)).length : Number(job.failedCount) || 0;
  // topicsDone counts attempted lessons, including failures. The checkpoint is
  // the source of truth for saved content, including during a partial retry.
  const rawDone = savedTopics && typeof savedTopics === 'object' && !Array.isArray(savedTopics)
    ? Object.values(savedTopics).filter(Boolean).length
    : Number(job.topicsDone ?? 0) - failedTopics;
  const done = Number.isFinite(rawDone) ? Math.max(0, Math.min(total, Math.floor(rawDone))) : 0;
  return { group, tone, label, action, detail, total, done };
}

export function matchesHomeSearch(item, query = '') {
  const text = `${item.title || ''} ${item.subtitle || ''}`.toLocaleLowerCase();
  return query.trim().toLocaleLowerCase().split(/\s+/).every(term => text.includes(term));
}

export function homeGroups(courses = [], jobs = [], query = '', filter = 'community', status) {
  status = normalizeHomeStatus(status, filter);
  filter = normalizeHomeFilter(filter);
  const matchingJobs = jobs.filter(j => matchesHomeSearch(j, query));
  const linked = new Set(jobs.filter(j => j.savedCourseId && jobPresentation(j).group !== 'ready').map(j => j.savedCourseId));
  const matchingCourses = courses.filter(c => !c.internal && !linked.has(c.id) && matchesHomeSearch(c, query));
  return {
    attention: filter === 'mine' && ['all', 'attention'].includes(status) ? matchingJobs.filter(j => jobPresentation(j).group === 'attention') : [],
    building: filter === 'mine' && ['all', 'building'].includes(status) ? matchingJobs.filter(j => jobPresentation(j).group === 'building') : [],
    mine: filter === 'mine' && status !== 'building' ? matchingCourses.filter(c => c.user && (status === 'all' || c.partial)) : [],
    // Entries come from the published catalog. Explicit private/unlisted entries
    // must never become community results, even if a later catalog includes them.
    community: filter === 'community' ? matchingCourses.filter(c => !c.user && (!c.visibility || c.visibility === 'public')) : []
  };
}

export function lifecycleSteps(job) {
  const refining = job.brief?.visual_designer_policy === 'learner-experience-v1' || job.checkpoint?.brief?.visual_designer_policy === 'learner-experience-v1' || job.stage === 'design';
  if (refining) {
    let position = job.status === 'review_curriculum' ? 0 : job.status === 'review_research' ? 1
      : ({ intake: 0, research: 1, topics: 2, design: 3, images: 4, assemble: 5, done: 5 })[job.stage] ?? 0;
    const progress = jobPresentation(job);
    if ((job.status === 'partial' && !['design', 'images'].includes(job.stage)) || (position >= 3 && progress.total > 0 && progress.done < progress.total)) position = 2;
    const ready = job.status === 'completed' && job.courseInstalled && job.savedCourseId;
    return ['Plan', 'Research', 'Lessons', 'Refine', 'Images', 'Ready'].map((label, index) => ({ label,
      state: ready ? 'done' : index < position ? 'done' : index === position ? 'current' : 'next' }));
  }
  const integrated = job.brief?.materials_policy === 'integrated-visuals-v2' || job.checkpoint?.brief?.materials_policy === 'integrated-visuals-v2' || job.stage === 'images';
  let position = job.status === 'review_curriculum' ? 1 : job.status === 'review_research' ? 2
    : ({ intake: 1, research: 2, topics: 3, images: 4, assemble: integrated ? 5 : 4, done: integrated ? 5 : 4 })[job.stage] ?? 0;
  const progress = jobPresentation(job);
  if ((job.status === 'partial' && job.stage !== 'images') || (position >= 4 && progress.total > 0 && progress.done < progress.total)) position = 3;
  const ready = job.status === 'completed' && job.courseInstalled && job.savedCourseId;
  return ['Request', 'Plan', 'Evidence', 'Lessons', ...(integrated ? ['Images'] : []), 'Save', 'Ready'].map((label, index) => ({
    label,
    state: ready ? 'done' : index < position ? 'done' : index === position ? 'current' : 'next'
  }));
}

export function escapeHome(value) {
  return String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
