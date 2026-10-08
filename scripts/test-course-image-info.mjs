import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseHTML } from 'linkedom';

const js = resolve(process.env.INFO_JS_ROOT || 'web/js');
const cssPath = resolve(process.env.INFO_CSS_FILE || 'web/styles/home.css');
const { courseImageInfoHTML, componentSummaryHTML, mountCourseImageInfo } = await import(pathToFileURL(resolve(js, 'setup-components.js')));
const { experienceHTML } = await import(pathToFileURL(resolve(js, 'course-setup.js')));
const { setupDraft } = await import(pathToFileURL(resolve(js, 'setup-model.js')));
let checks = 0;
const check = (value, label) => { assert.ok(value, label); checks++; };

for (const [label, html] of [
  ['Experience', experienceHTML(setupDraft('Information disclosure test'))],
  ['Review/Create', componentSummaryHTML(['lessons', 'quizzes', 'flashcards'])]
]) {
  const { document } = parseHTML(`<main>${html}</main>`);
  const info = document.querySelector('[data-course-image-info]');
  check(info?.tagName === 'DETAILS' && !info.hasAttribute('open'), `${label}: collapsed by default`);
  check(document.querySelectorAll('[data-course-image-info]').length === 1, `${label}: one shared info control`);
  const summary = info.querySelector('summary');
  check(summary?.getAttribute('aria-label') === 'About course images and costs', `${label}: accessible trigger name`);
  check(summary?.querySelector('[aria-hidden="true"]')?.textContent === 'i', `${label}: small i icon, not a checkbox`);
  check(!document.querySelector('[data-component="images"]'), `${label}: images remain required`);
  check(!document.querySelector('.setup-image-choice'), `${label}: no large callout container`);
  check(info.contains(document.querySelector('[data-image-cost-guidance]')), `${label}: cost detail is behind the icon`);
  check(info.textContent.includes('US$0.013 per image') && info.textContent.includes('separately from Claude'), `${label}: estimate and separate billing retained`);
  check(info.textContent.includes('part of your course') && info.textContent.includes('no separate image-creation step or per-image approval'), `${label}: integrated creation explained without repeated approval`);
  check(info.textContent.includes('lessons that work better as text do not need one'), `${label}: usefulness, not a per-lesson quota`);
  check(info.querySelector('[data-image-info-close]')?.type === 'button', `${label}: close cannot submit the form`);
}

const { document } = parseHTML(`<main><div>${courseImageInfoHTML()}</div><button id="elsewhere">Elsewhere</button></main>`);
const root = document.querySelector('main'), info = root.querySelector('[data-course-image-info]');
const summary = info.querySelector('summary'), close = info.querySelector('[data-image-info-close]');
let returnedFocus = 0;
summary.focus = () => { returnedFocus++; };
mountCourseImageInfo(root);
info.setAttribute('open', '');
close.click();
check(!info.hasAttribute('open') && returnedFocus === 1, 'close dismisses and restores focus to the icon');
info.setAttribute('open', '');
root.querySelector('#elsewhere').click();
check(!info.hasAttribute('open') && returnedFocus === 1, 'outside click dismisses without stealing focus');
info.setAttribute('open', '');
const escape = new document.defaultView.Event('keydown', { bubbles: true, cancelable: true });
Object.defineProperty(escape, 'key', { value: 'Escape' });
document.dispatchEvent(escape);
check(!info.hasAttribute('open') && escape.defaultPrevented, 'Escape dismisses');
info.setAttribute('open', '');
info.querySelector('p').click();
check(info.hasAttribute('open'), 'interaction inside the explanation does not dismiss it');

const css = readFileSync(cssPath, 'utf8');
check(css.includes('width: 44px; height: 44px; list-style: none'), 'touch target stays44px despite the small visible icon');
check(css.includes('width: 18px; height: 18px; border:'), 'visible icon is18px');
check(css.includes('width: min(26rem, 100%)') && css.includes('max-height: 65vh'), 'open detail is bounded on narrow viewports');
check(css.includes(':focus-visible'), 'visible keyboard focus style retained');
for (const name of ['course-setup.js', 'setup-create.js']) {
  const source = readFileSync(resolve(js, name), 'utf8');
  check(source.includes('mountCourseImageInfo(host, { signal'), `${name}: dismissal is mounted with abortable listeners`);
}
console.log(`Course image info: ${checks} checks passed. No provider calls.`);
