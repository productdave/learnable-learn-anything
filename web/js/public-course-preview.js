import { getUser, onUserChange } from './auth.js?v=33';
import { createPublicPreviewClient } from './public-preview-client.js?v=4';
import { normalizePublicAuthor, publicAuthorInitials } from './public-author.js?v=1';
import { escapeHome as esc } from './home-model.js?v=7';
import { openCoursePublishing } from './course-publishing.js?v=6';
import * as appConfig from './config.js?v=1';
import { sharedImageHTML,mountSharedImages } from './shared-course-images.js?v=3';

const bullets = (items = []) => `<ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`;
const detail = (title, content) => `<details class="public-preview-disclosure"><summary>${esc(title)}</summary>${content}</details>`;
function sectionHTML(s) {
  switch (s.type) {
    case 'image': return sharedImageHTML(s,s.public_image.id,{review:true});
    // Only server-projected, allowlisted HTML reaches these two bodies.
    case 'concept': case 'callout': return `<section class="public-preview-section ${s.type === 'callout' ? 'public-preview-callout' : ''}">${s.title ? `<h4>${esc(s.title)}</h4>` : ''}${s.content}</section>`;
    case 'takeaway': return `<section class="public-preview-section"><h4>Key takeaways</h4>${bullets(s.points)}</section>`;
    case 'quiz': {
      const answer = s.variant === 'multiple-choice' ? s.options.find(o => o.id === s.correct)?.text : s.variant === 'true-false' ? s.correct ? 'True' : 'False' : s.sample_answer || s.acceptable_answers?.join(' / ');
      return `<section class="public-preview-section"><span class="public-preview-kicker">Knowledge check · read-only</span><h4>${esc(s.question || s.statement || s.sentence)}</h4>${s.options ? bullets(s.options.map(o=>o.text)) : ''}${s.pairs ? `<dl>${s.pairs.map(p=>`<dt>${esc(p.left)}</dt><dd>${esc(p.right)}</dd>`).join('')}</dl>` : ''}${detail('View answer and explanation',`${answer ? `<p><strong>${esc(answer)}</strong></p>` : ''}${s.key_points ? bullets(s.key_points) : ''}<p>${esc(s.explanation)}</p>`)}</section>`;
    }
    case 'exercise': return `<section class="public-preview-section"><h4>${esc(s.title)}</h4><p>${esc(s.prompt)}</p>${detail('Hints',bullets(s.hints))}</section>`;
    case 'practice': return `<section class="public-preview-section"><span class="public-preview-kicker">Practice · ${s.durationMinutes} minutes</span><h4>${esc(s.title)}</h4><p>${esc(s.goal)}</p>${s.guidance ? `<p>${esc(s.guidance)}</p>` : ''}<h5>Prepare</h5><p>${esc(s.setup)}</p>${bullets(s.equipment)}<ol>${s.steps.map(step=>`<li><strong>${esc(step.title)}</strong><p>${esc(step.instruction)}</p><p>Cue: ${esc(step.cue)}${step.repetitions ? ` · ${esc(step.repetitions)}` : ''}</p><p>${esc(step.success)}</p></li>`).join('')}</ol>${detail('Adjust the activity',`<h5>Easier alternatives</h5>${bullets(s.regressions)}<h5>Harder alternatives</h5>${bullets(s.progressions)}`)}<h5>When to pause or stop</h5>${bullets(s.safetyStops)}<h5>Readiness checks</h5>${bullets(s.readinessChecks.map(c=>c.label))}</section>`;
    case 'checklist': return `<section class="public-preview-section"><span class="public-preview-kicker">Checklist · read-only</span><h4>${esc(s.title)}</h4><p>${esc(s.description)}</p><ul>${s.items.map(item=>`<li>${esc(item.label)}${item.detail ? `<p>${esc(item.detail)}</p>` : ''}</li>`).join('')}</ul></section>`;
    default: return `<aside class="public-preview-withheld"><strong>${esc(s.title || 'Content not included')}</strong><p>${esc(s.message || 'This content needs public-preview support.')}</p></aside>`;
  }
}
export {sectionHTML as publicPreviewSectionHTML};

export function publicAuthorForPreview(name) {
  if (typeof name !== 'string' || [...name.trim()].length > 80) return null;
  return normalizePublicAuthor({ displayName:name });
}

export function openPublicCoursePreview(courseId, { client = createPublicPreviewClient(), getIdentity = getUser, watchIdentity = onUserChange } = {}) {
  const owner = getIdentity()?.id, opener = document.activeElement, dialog = document.createElement('dialog');
  dialog.className = 'course-editor public-course-preview'; dialog.setAttribute('aria-labelledby','public-preview-title'); document.body.append(dialog);
  let preview = null, updatedAt = '', reviewToken = '', loading = true, error = '', pane = 'listing', selected = 0, authorName = '', originalName = '', initialized = false, leaving = false, disposed = false, ticket = 0, unwatch,disposeImages=()=>{};
  const valid = () => !disposed && getIdentity()?.id === owner;
  const dirty = () => authorName !== originalName;
  const lessons = () => (preview?.modules || []).flatMap(mod=>mod.topics.map(topic=>({ ...topic,moduleTitle:mod.title })));
  const beforeUnload = event => { if (dirty()) { event.preventDefault(); event.returnValue = ''; } };
  const navigateAway = () => close(true);
  function close(force = false) {
    if (disposed) return;
    if (!force && dirty()) { leaving = true; paint(); dialog.querySelector('[data-preview-action="stay"]')?.focus(); return; }
    disposed = true; ticket++; disposeImages(); preview = null; authorName = originalName = '';
    unwatch?.(); window.removeEventListener('beforeunload',beforeUnload); window.removeEventListener('popstate',navigateAway);
    dialog.close(); dialog.remove(); const fallback=[...document.querySelectorAll('[data-public-preview],[data-manage-publication]')].find(el=>(el.dataset.publicPreview||el.dataset.managePublication)===courseId&&!el.closest('details:not([open])')&&el.getClientRects().length)||[...document.querySelectorAll('[data-home-course]')].find(el=>el.dataset.homeCourse===courseId)?.querySelector('h3 a');(opener?.isConnected?opener:fallback)?.focus();
  }
  function byline() {
    const author = publicAuthorForPreview(authorName);
    return `<span class="home-author-avatar" aria-hidden="true">${author ? esc(publicAuthorInitials(author.displayName)) : '?'}</span><span>${author ? `By ${esc(author.displayName)}` : 'Public author name not set'}</span>`;
  }
  function authorFeedback() {
    dialog.querySelectorAll('[data-preview-byline]').forEach(el=>el.innerHTML=byline());
    const error = dialog.querySelector('#public-author-error');
    if (error) error.textContent = authorName.trim() && !publicAuthorForPreview(authorName) ? 'Use a public name of 1–80 characters, not an email address.' : '';
    const count = dialog.querySelector('#public-author-count');
    if (count) count.textContent = `${[...authorName.trim()].length} / 80 characters`;
    const checks = dialog.querySelector('[data-preview-checks]');
    if (checks) { const open=checks.querySelector('details')?.open; checks.innerHTML=checksHTML(); checks.querySelector('details').open=!!open; }
  }
  function checksHTML() {
    const issues=preview.issues.filter(i=>i.code!=='author');
    if (!publicAuthorForPreview(authorName)) issues.push({location:'Course',message:'Choose the public author name you want learners to see.'});
    return detail(`Review before sharing · ${issues.length} ${issues.length===1?'check':'checks'} flagged`,`<ul>${issues.map(issue=>`<li><strong>${esc(issue.location)}</strong>: ${esc(issue.message)}</li>`).join('')}</ul><p>Check facts, answers, accessibility and rights to share. Child safety, health and other high-stakes instruction need qualified review. This preview does not certify safety or accuracy.</p>`);
  }
  function paint() {
    if (!valid()) return;
    disposeImages();
    dialog.innerHTML = `<header><div><p class="public-preview-kicker">Private preview · not a live public page</p><h2 id="public-preview-title">Preview for publishing</h2><p>Check what you intend to share. Nothing here publishes your course or changes an existing public version.</p></div><button type="button" data-preview-action="close" aria-label="Close publishing preview">×</button></header>
      ${leaving ? `<section><h3>Leave this preview?</h3><p>The public name you tried is only in this preview and won’t be saved. Your course and account profile are unchanged.</p><button type="button" class="home-button" data-preview-action="stay">Keep reviewing</button><button type="button" data-preview-action="leave">Leave preview</button></section>` : loading ? '<p role="status">Loading the latest saved course…</p>' : error ? `<section><p class="editor-error" role="alert">${esc(error)}</p><button type="button" data-preview-action="refresh">Try again</button></section>` : preview ? `
      <nav class="public-preview-nav" aria-label="Preview views"><button type="button" data-preview-pane="listing" aria-pressed="${pane==='listing'}">Course listing</button><button type="button" data-preview-pane="lesson" aria-pressed="${pane==='lesson'}">Lesson content</button></nav>
      <div class="public-preview-body">${pane==='listing' ? `<section aria-labelledby="public-listing-heading"><h3 id="public-listing-heading" tabindex="-1">Community listing preview</h3><article class="home-course public-preview-listing"><span class="home-status home-status--neutral">Course listing · preview only</span><h4>${esc(preview.title)}</h4><div class="home-course-author" data-preview-byline>${byline()}</div><p>${esc(preview.subtitle || 'No course description yet.')}</p><span class="home-course-meta">${preview.modules.length} ${preview.modules.length===1?'module':'modules'} · ${lessons().length} ${lessons().length===1?'lesson':'lessons'}</span></article>
      <label class="editor-field" for="public-author-name"><span id="public-author-label">Try a public author name</span><input id="public-author-name" value="${esc(authorName)}" autocomplete="off" aria-labelledby="public-author-label" aria-describedby="public-author-help public-author-count public-author-error"><small id="public-author-help">Changes here are preview-only until you publish. Your account profile won’t change. Initials stand in for a public avatar.</small><small id="public-author-count"></small><small id="public-author-error" class="editor-error" aria-live="polite"></small></label>
      <h4>Learning path</h4><ol class="public-preview-path">${preview.modules.map(mod=>`<li><strong>${esc(mod.title)}</strong><p>${esc(mod.description)}</p><ul>${mod.topics.map(topic=>`<li>${esc(topic.title)}${topic.available?'':' · Not saved yet'}</li>`).join('')}</ul></li>`).join('')}</ol><button type="button" class="home-button" data-preview-pane="lesson">Preview lesson content →</button></section>` : `<section aria-labelledby="public-lesson-heading"><h3 id="public-lesson-heading" tabindex="-1">Lesson content preview</h3><p>Read-only content review. This does not record answers, practice checks or learning progress. Review accepted images and their alternative text below. Images stay private until you confirm publishing.</p><label class="editor-field" for="public-lesson"><span id="public-lesson-label">Choose a lesson</span><select id="public-lesson" aria-labelledby="public-lesson-label">${lessons().map((lesson,index)=>`<option value="${index}" ${index===selected?'selected':''}>${esc(lesson.moduleTitle)} · ${esc(lesson.title)}</option>`).join('')}</select></label><div data-preview-lesson>${lessonHTML()}</div></section>`}</div>
      <div data-preview-checks>${checksHTML()}</div>
      ${detail('What stays private', '<p>Original notes, transcripts, files, account details, API keys, generation instructions, billing records and learning progress are not included as separate data. Private image originals, storage paths and prompts stay private. Only explicitly confirmed image copies are shared. Avatars are still held back.</p><p>Lesson text may still quote or describe material from your sources. Review every lesson for personal or confidential information before sharing.</p>')}
      <footer class="public-preview-footer"><p>${appConfig.SELF_PUBLISH_ENABLED?'Publishing needs a separate final confirmation.':'Publishing is not enabled in this preview.'} ${updatedAt ? `Saved copy checked: ${esc(new Date(updatedAt).toLocaleString())}.` : ''}</p>${appConfig.SELF_PUBLISH_ENABLED?'<button type="button" class="home-button" data-preview-action="publish">Review publishing →</button>':''}<button type="button" data-preview-action="refresh">Refresh saved content</button><button type="button" data-preview-action="close">Back to saved course</button></footer>` : ''}`;
    authorFeedback();mountImages();
  }
  function mountImages(){disposeImages();disposeImages=mountSharedImages(dialog,{loadImage:id=>client.asset(owner,courseId,id,reviewToken),isCurrent:valid});}
  function lessonHTML() {
    const lesson = lessons()[selected];
    if (!lesson) return '<p>No lessons are available to preview.</p>';
    if (!lesson.available) return `<h4>${esc(lesson.title)}</h4><p>This lesson has not been saved yet. Return to the course to finish recovery.</p>`;
    return `<article class="public-preview-lesson"><h3>${esc(lesson.title)}</h3><div class="home-course-author" data-preview-byline>${byline()}</div>${lesson.estimatedMinutes ? `<p>${lesson.estimatedMinutes} minutes</p>` : ''}${lesson.sections.map(sectionHTML).join('')}${lesson.flashcards.length ? `<section class="public-preview-section"><h4>Flashcards</h4>${lesson.flashcards.map(card=>detail(card.front,`<p>${esc(card.back)}</p>`)).join('')}</section>` : ''}</article>`;
  }
  async function load() {
    const current = ++ticket; preview = null; loading = true; error = ''; paint();
    try {
      const result = await client.load(owner,courseId);
      if (!valid() || current!==ticket) return;
      preview = result.preview; updatedAt = result.updatedAt;reviewToken = result.reviewToken;
      if (!initialized) { originalName = authorName = preview.publicAuthor?.displayName || ''; initialized = true; }
      if (selected>=lessons().length) selected = 0;
    } catch (err) { if (valid() && current===ticket) error = err.message; }
    finally { if (valid() && current===ticket) { loading = false; paint(); if (error) dialog.querySelector('[data-preview-action="refresh"]')?.focus(); } }
  }
  dialog.addEventListener('click',event=>{
    const target = event.target.closest('button'); if (!target) return;
    if (target.dataset.previewPane) { pane = target.dataset.previewPane; paint(); dialog.querySelector('.public-preview-body h3')?.focus(); }
    const action = target.dataset.previewAction;
    if (action==='close') close(); if (action==='leave') close(true); if (action==='stay') { leaving=false; paint(); dialog.querySelector('#public-author-name, .public-preview-nav button')?.focus(); }
    if (action==='refresh' && !loading) load();
    if(action==='publish'&&preview)openCoursePublishing(courseId,{title:preview.title,authorName,reviewToken,onPublished:name=>{if(valid()){authorName=originalName=name;authorFeedback();}}});
  });
  dialog.addEventListener('input',event=>{ if (event.target.id==='public-author-name') { authorName=event.target.value; authorFeedback(); } });
  dialog.addEventListener('change',event=>{ if (event.target.id==='public-lesson') { selected=Number(event.target.value);disposeImages();dialog.querySelector('[data-preview-lesson]').innerHTML=lessonHTML();mountImages(); } });
  dialog.addEventListener('cancel',event=>{ event.preventDefault(); close(); });
  unwatch = watchIdentity?.(()=>{ if (!valid()) close(true); });
  window.addEventListener('beforeunload',beforeUnload); window.addEventListener('popstate',navigateAway);
  paint(); dialog.showModal(); load();
  return { dialog,close };
}
