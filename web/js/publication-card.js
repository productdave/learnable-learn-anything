import {escapeHome as esc} from './home-model.js?v=7';

export function publicationCardHTML(course,status) {
  if(!status)return '';
  const state=status.state,known=['private','published','unpublished','restricted'].includes(state),restricted=state==='restricted';
  const loading=state==='loading',published=state==='published';
  const label=loading?'Checking visibility…':restricted?'Public sharing restricted':!known?'Status unavailable':published?'Published':state==='unpublished'?'Unpublished':'Private';
  const safePublicId=/^public-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(status.publication?.id||'');
  const detail=loading?'Checking your account.':restricted?'Public access was removed after a moderation review. Your private course is still saved; publishing is restricted.':!known?'We couldn’t confirm sharing status. Your saved course is still available.':published?(status.sourceChanged?'Saved copy changed since publication. Review before updating.':'Your last confirmed version is public. Private edits are not shared automatically.'):state==='unpublished'?'Public access has ended. Your private course is still saved.':'Not published from this account copy.';
  const action=published||restricted?`<button type="button" data-manage-publication="${esc(course.id)}" data-course-title="${esc(course.title)}">${restricted?'View sharing status':'Manage publication'}</button>`:`<button type="button" data-public-preview="${esc(course.id)}">${state==='unpublished'?'Review and publish again':'Preview for publishing'}</button>`;
  return `<section class="home-publication" aria-label="Publication for ${esc(course.title)}"><div class="home-publication-heading"><span>Visibility</span><span class="home-status home-status--${published?'success':'neutral'}" data-publication-state="${esc(state)}">${label}</span></div><p>${esc(detail)}</p><div class="home-publication-actions">${known?action:loading?'':'<button type="button" data-publication-retry>Retry status</button>'}${published&&safePublicId?`<a href="/?course=${status.publication.id}" target="_blank" rel="noopener">View public course <span aria-hidden="true">↗</span></a>`:''}</div></section>`;
}
