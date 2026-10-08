import { inspectSavedCourse } from './course-readiness.js?v=8';
import { homeURL, escapeHome as esc } from './home-model.js?v=7';
import { COMPONENT_LABELS } from './setup-model.js?v=7';

const labels = { ...COMPONENT_LABELS, lessons: 'Lessons', practice: 'Practice activities' };
const lessonLink = (courseId, lesson) => `${homeURL({ course: courseId })}#/${encodeURIComponent(lesson.moduleId)}/${encodeURIComponent(lesson.topicId)}`;
const gapLabel = value => labels[value] ? `${labels[value]} missing or incomplete` : value;
export function savedCourseReadinessHTML(course, { loading = false, report = inspectSavedCourse(course), jobAvailable = false, recoveryAvailable = false, editable = false } = {}) {
  if (!report.available) return `<section class="home-section course-readiness"><h2>Saved course details</h2><p>${loading ? 'Checking the saved course…' : 'The saved course details aren’t available in this browser yet. We can’t confirm its lessons or materials.'}</p><p>Use Sync course above if available, or check again. Your account copy has not been changed.</p><button type="button" class="home-button home-button--secondary" data-home-refresh ${loading ? 'disabled' : ''}>${loading ? 'Checking…' : 'Check saved course'}</button></section>`;
  const affected = report.lessons.filter(lesson => lesson.gaps.length || lesson.warnings.length);
  const id = course.config.id;
  return `<section class="home-section course-readiness" aria-labelledby="saved-course-heading">
    <div class="home-section-heading"><h2 id="saved-course-heading">What’s in your saved course</h2><span>${report.saved} / ${report.total} lessons</span></div>
    <p>These counts reflect your saved course. Work still being created may not appear yet. They do not certify accuracy, teaching quality or safety.</p>
    <div class="editor-actions">${editable ? `<button type="button" class="home-button home-button--secondary" data-refine-course="${esc(id)}">Make changes</button>` : ''}<button type="button" class="home-button home-button--secondary" data-public-preview="${esc(id)}">Preview for publishing</button></div><p class="source-help">Preview sharing without publishing. Your saved course and learning progress stay unchanged.</p>
    ${report.designProgress?.selected ? refinementReadinessHTML(report.designProgress, { jobAvailable, recoveryAvailable }) : ''}
    ${report.imageProgress?.selected ? visualReadinessHTML(report.imageProgress, { jobAvailable, recoveryAvailable }) : ''}
    <ul class="ready-materials">${report.materials.filter(material => material.id !== 'practice' || material.selected === true || material.count > 0).map(material => `<li><strong>${esc(labels[material.id])}</strong><span>${material.selected === false ? material.count ? `${material.count} found · not selected` : 'Not selected' : `${material.lessons} of ${report.total} lessons${material.id !== 'lessons' ? ` · ${material.count} ${material.id === 'flashcards' ? 'cards' : material.id === 'quizzes' ? 'questions' : material.id === 'checklists' ? 'checklists' : 'activities'}` : ''}`}</span></li>`).join('')}</ul>
    ${report.gaps.length ? `<div class="home-notice home-notice--warning"><div><strong>${report.gaps.length} ${report.gaps.length === 1 ? 'lesson has' : 'lessons have'} missing content or materials</strong><p>${recoveryAvailable ? 'Use the available recovery controls above for failed lessons. Accepted lessons stay available.' : jobAvailable ? 'Open the available lessons below to review what needs attention. No automatic rebuild has started.' : 'The build history is not available here. Open the saved lessons below to review what remains; no automatic rebuild has started.'}</p></div></div>` : '<p>Saved lesson content is available throughout the learning path. Review the material before relying on it.</p>'}
    ${report.warnings.length ? `<ul class="ready-warnings">${report.warnings.map(warning => `<li>${esc(warning)}</li>`).join('')}</ul>` : ''}
    <details class="ready-lesson-list" ${affected.length ? 'open' : ''}><summary aria-label="Review saved lessons">${affected.length ? `Review ${affected.length} affected ${affected.length === 1 ? 'lesson' : 'lessons'}` : 'Review lessons individually'}</summary>
      <ul>${(affected.length ? affected : report.lessons).map(lesson => `<li><div><span class="home-updated">${esc(lesson.moduleTitle)}</span>${lesson.openable ? `<a href="${esc(lessonLink(id, lesson))}">${esc(lesson.title)} →</a>` : `<strong>${esc(lesson.title)}</strong>`}</div>${[...lesson.gaps.map(gapLabel), ...lesson.warnings].map(warning => `<p>${esc(warning)}</p>`).join('')}${!lesson.saved ? '<p>Not available to open yet.</p>' : ''}</li>`).join('')}</ul>
    </details>
    <details class="ready-references"><summary aria-label="Review source references">Review source references · ${report.evidence.referenced} of ${report.evidence.modules.length} ${report.evidence.modules.length === 1 ? 'module lists' : 'modules list'} sources</summary><p>These references were reported by AI. Open them to check the claims, credibility and conflicting advice. This is not proof that a source was read or used.</p>
      ${report.evidence.modules.map(module => `<section><h3>${esc(module.title)}</h3>${module.references.length ? `<ul>${module.references.map(reference => `<li>${reference.url ? `<a href="${esc(reference.url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer">${esc(reference.title)}<span class="sr-only"> (opens in a new tab)</span></a>` : `<span>${esc(reference.title)} — no usable link; check manually.</span>`}</li>`).join('')}</ul>` : '<p>No references are available for this module. Review the evidence before relying on its advice.</p>'}</section>`).join('')}
    </details>
    <aside class="ready-human-review"><h3>Before you use or share this course</h3><p>Check the facts, quiz answers, practical instructions and illustrations. For child safety, health or other high-stakes topics, get qualified review. Completing a checklist is not a safety certification.</p><p>${report.images ? `${report.images} image ${report.images === 1 ? 'section was' : 'sections were'} found. ` : ''}Image counts include source images; they don’t confirm GPT-generated illustrations. Check that each image loads and accurately explains the lesson.</p><p>Creating a course does not publish it. This workspace shows your saved account copy.</p></aside>
  </section>`;
}

function refinementReadinessHTML(progress, { jobAvailable, recoveryAvailable }) {
  const detail = progress.complete
    ? 'The course-wide copy and presentation pass is saved. This is an AI-refined draft for your review, not a rendered visual inspection or human approval.'
    : `Your saved draft is retained. ${recoveryAvailable ? 'Use Resume above to continue refinement in the same course creation.' : jobAvailable ? 'Refinement is not complete in this saved copy. Check the current status above.' : 'Open the original course workspace to check its refinement status. No new work has been started here.'}`;
  return `<section class="ready-image-plan" aria-labelledby="ready-design-heading"><h3 id="ready-design-heading">Lesson refinement</h3><p><strong>${progress.saved} of ${progress.total} lesson refinements saved</strong></p><p>${detail}</p>${progress.flags?.length ? `<details><summary>Review notes · ${progress.flags.length}</summary><p>The Visual Designer flagged these points for human review. They are not resolved by completing this draft.</p><ul>${progress.flags.map(flag => `<li><strong>${esc(flag.title)}</strong>${flag.kind ? ` · ${esc(flag.kind)}` : ''} — ${esc(flag.message)}</li>`).join('')}</ul></details>` : ''}</section>`;
}

function visualReadinessHTML(progress, { jobAvailable, recoveryAvailable }) {
  const summary = progress.integrated
    ? `${progress.saved} of ${progress.total} planned ${progress.total === 1 ? 'image' : 'images'} saved${progress.omitted ? ` · ${progress.omitted} ${progress.omitted === 1 ? 'lesson works' : 'lessons work'} without an image` : ''}`
    : `${progress.saved} of ${progress.total} originally requested images saved`;
  const incomplete = progress.missing || progress.unplanned;
  const detail = !progress.integrated
    ? 'This course was created with the earlier, separate image workflow. Its saved content is retained. It has not been migrated or charged for new images automatically.'
    : incomplete ? `Your saved lessons remain available. ${progress.unplanned ? `${progress.unplanned} visual ${progress.unplanned === 1 ? 'decision is' : 'decisions are'} not saved yet. ` : ''}${recoveryAvailable ? 'Use Resume above to continue the same course creation from its saved results.' : jobAvailable ? 'Course creation is still incomplete. Check its status and recovery controls above.' : 'Open the original course workspace to check its generation status. No new image has been requested here.'}`
    : 'Useful illustrations are already in the lessons. Where text explains the subject clearly, Learnable has deliberately left the lesson without a generated image.';
  return `<section class="ready-image-plan" aria-labelledby="ready-image-heading"><h3 id="ready-image-heading">Instructional images</h3><p><strong>${summary}</strong></p><p>${detail}</p>${progress.integrated && progress.omitted ? `<details><summary>Where text works better</summary><ul>${progress.rows.filter(row => row.decision === 'omit').map(row => `<li><strong>${esc(row.title)}</strong> — ${esc(row.reason)}</li>`).join('')}</ul></details>` : ''}</section>`;
}
