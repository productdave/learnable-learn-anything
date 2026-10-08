import assert from 'node:assert/strict';
import { parseHTML } from 'linkedom';
import { mountCourseDescription } from '../web/js/course-description.js';
import { mountHomeDraft, homeDraftHTML } from '../web/js/home-draft.js';

const { document, window } = parseHTML(`<html><body><form><textarea id="home-outcome"></textarea><p id="count"></p><p id="error"></p>${homeDraftHTML()}</form></body></html>`);
globalThis.document = document;
globalThis.window = window;
const input = document.querySelector('textarea'), counter = document.querySelector('#count'), error = document.querySelector('#error');
let scrollHeight = 100;
Object.defineProperty(input, 'scrollHeight', { get: () => scrollHeight });
const abort = new AbortController();
const description = mountCourseDescription(input, { counter, error, signal: abort.signal });
const checks = [];
const check = (ok, label) => { assert.ok(ok, label); checks.push(label); };
check(counter.textContent === '0 / 5,000 characters', 'empty field shows its allowance');
input.value = 'x'.repeat(5000); description.update();
check(counter.textContent === '5,000 / 5,000 characters' && !error.textContent, 'exact boundary is allowed');
input.value += 'x'; description.update();
check(input.value.length === 5001 && /5,001/.test(counter.textContent), 'oversized paste is counted, never truncated');
check(error.textContent.includes('5,000') && input.getAttribute('aria-invalid') === 'true', 'oversized field exposes accessible validation');
check(counter.classList.contains('course-description-count--over'), 'over-limit counter has a distinct visual state');
input.value = '😀'.repeat(5000); description.update();
check(counter.textContent === '5,000 / 5,000 characters' && !error.textContent && !input.hasAttribute('aria-invalid'), 'Unicode counting and recovery match backend validation');
input.value = 'Back within the limit'; input.dispatchEvent(new window.Event('input'));
check(counter.textContent.startsWith('21 /'), 'typing refreshes the counter');
check(input.style.height === '102px', 'textarea expands to fit shorter text');
scrollHeight = 900; description.update();
check(input.style.height === '320px' && input.style.overflowY === 'auto', 'long description remains scrollable without consuming the whole page');
error.textContent = 'Describe what you want to learn or teach.'; input.setAttribute('aria-invalid', 'true'); input.value = ''; description.update();
check(!!error.textContent && input.hasAttribute('aria-invalid'), 'counter does not erase unrelated required-field feedback');
error.textContent = ''; input.removeAttribute('aria-invalid');
const savedText = 'Saved description\n' + 'r'.repeat(4200);
const record = { id: 'idea-description', step: 'home', revision: 1, brief: { topic: savedText } };
const home = mountHomeDraft(document.querySelector('form'), {
  getOwner: () => null,
  store: { list: async () => ({ drafts: [record] }) },
  onValueChange: () => description.update()
});
await home.ready;
check(input.value === savedText && counter.textContent === `${savedText.length.toLocaleString('en-US')} / 5,000 characters`, 'quiet Home restoration refreshes counter and expansion');
check(input.style.height === '320px', 'restored long text is expanded consistently');
home.dispose(); abort.abort();
console.log(`Course description UI: ${checks.length} actual component checks passed (DOM fixture, not a rendered browser).`);
