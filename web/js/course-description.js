import { COURSE_DESCRIPTION_LIMIT, courseDescriptionIssue } from './setup-model.js?v=7';

// Share counting, feedback and expansion between Home and course setup. Do not
// use maxlength: pasting too much must preserve the text, not silently cut it.
export function mountCourseDescription(input, { counter, error, signal } = {}) {
  function update() {
    const count = Array.from(input.value).length;
    const issue = courseDescriptionIssue(input.value);
    counter.textContent = `${count.toLocaleString('en-US')} / ${COURSE_DESCRIPTION_LIMIT.toLocaleString('en-US')} characters`;
    counter.classList.toggle('course-description-count--over', !!issue);
    if (issue || error.dataset.descriptionIssue) {
      error.textContent = issue;
      if (issue) { error.dataset.descriptionIssue = 'true'; input.setAttribute('aria-invalid', 'true'); }
      else { delete error.dataset.descriptionIssue; input.removeAttribute('aria-invalid'); }
    }
    // Cap growth so a long brief cannot push every other control off-screen.
    input.style.height = 'auto';
    if (input.scrollHeight) input.style.height = `${Math.min(input.scrollHeight + 2, 320)}px`;
    input.style.overflowY = input.scrollHeight > 318 ? 'auto' : 'hidden';
    return issue;
  }
  input.addEventListener('input', update, { signal });
  update();
  return { update };
}
