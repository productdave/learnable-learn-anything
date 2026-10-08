import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

// Regression: AUDIO-001/002/003, found by browser QA on 2026-09-30.
// Report: .gstack/qa-reports/qa-report-learnable-staging-vercel-app-2026-09-30-audio.md
// Execute the real player with a DOM and a synthetic browser speech service.
const source = readFileSync(resolve(process.env.TTS_SOURCE_FILE || 'web/js/tts.js'), 'utf8');
let checks = 0;
const equal = (value, expected, message) => { assert.deepEqual(value, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const { document, window } = parseHTML('<html><body><main id="app"></main><aside inert="prior">Retained boundary</aside></body></html>');
const app = document.querySelector('main'), existingInert = document.querySelector('aside');
let focused = document.body, scheduled = 0, cancelled = 0;
Object.defineProperty(document, 'activeElement', { get: () => focused });
window.HTMLElement.prototype.focus = function () { focused = this; this.dispatchEvent(new window.Event('focusin', { bubbles: true })); };
window.HTMLElement.prototype.scrollIntoView = () => {};
const spoken = [], prefs = new Map();
const speech = { getVoices: () => [], speak: utterance => spoken.push(utterance), cancel: () => { cancelled++; }, addEventListener: () => {} };
window.speechSynthesis = speech;
const context = vm.createContext({
  document, window, localStorage: { getItem: key => prefs.get(key), setItem: (key, value) => prefs.set(key, value) },
  SpeechSynthesisUtterance: class { constructor(text) { this.text = text; } },
  performance: { now: () => 0 }, requestAnimationFrame: () => ++scheduled, cancelAnimationFrame: () => {},
});
vm.runInContext(source.replaceAll('export function ', 'function '), context);
const render = () => {
  app.innerHTML = `<h1 class="topic-title">A keyboard test lesson</h1>${context.ttsBarHTML()}<div class="topic-sections"><section class="concept-section"><h2 class="concept-title">A clear next action</h2><p>A short first sentence.</p><p>A second sentence with a few more words.</p><p>One final useful sentence.</p></section></div>`;
  context.initTTS(app, { title: 'A keyboard test lesson', moduleName: 'Test module' });
};
const press = (element, key, shiftKey = false) => {
  const event = new window.Event('keydown', { bubbles: true, cancelable: true });
  event.key = key; event.shiftKey = shiftKey; element.dispatchEvent(event); return event;
};
render();
let entry = app.querySelector('#tts-listen');
entry.focus(); entry.click();
const root = document.querySelector('.tts-player'), sheet = root.querySelector('.tts-sheet');
const close = sheet.querySelector('[data-tts-close]'), minimize = sheet.querySelector('[data-tts-min]');
const slider = sheet.querySelector('[data-tts-scrub]'), voice = sheet.querySelector('select');
const toggle = sheet.querySelector('[data-tts-toggle]'), expand = root.querySelector('[data-tts-expand]');
equal(sheet.getAttribute('aria-modal'), 'true', 'player declares a modal dialog');
ok(sheet.contains(focused), 'opening moves focus into the player');
ok(app.hasAttribute('inert'), 'background becomes inert while modal');
equal(existingInert.getAttribute('inert'), 'prior', 'pre-existing inert value preserved');
equal(toggle.getAttribute('aria-label'), 'Pause narration', 'playing action is announced');
equal(root.querySelector('.tts-mini-toggle').getAttribute('aria-label'), 'Pause narration', 'mini player has matching action');
voice.focus(); ok(press(voice, 'Tab').defaultPrevented, 'Tab from last control is handled');
equal(focused, minimize, 'Tab wraps to the first control');
minimize.focus(); ok(press(minimize, 'Tab', true).defaultPrevented, 'Shift Tab is handled');
equal(focused, voice, 'Shift Tab wraps to last control');
entry.focus(); ok(sheet.contains(focused), 'escaped programmatic focus returns to player');
toggle.click(); equal(toggle.getAttribute('aria-label'), 'Play narration', 'paused action is announced');
equal(slider.getAttribute('role'), 'slider', 'timeline exposes a slider');
equal(slider.getAttribute('tabindex'), '0', 'timeline is keyboard reachable');
ok(slider.getAttribute('aria-label').includes('Playback'), 'timeline has a useful name');
slider.focus();
const start = Number(slider.getAttribute('aria-valuenow'));
ok(press(slider, 'ArrowRight').defaultPrevented, 'Right prevents page scrolling');
ok(Number(slider.getAttribute('aria-valuenow')) > start, 'Right advances even through short sentences');
press(slider, 'ArrowLeft'); equal(Number(slider.getAttribute('aria-valuenow')), start, 'Left returns to previous sentence');
press(slider, 'End'); const last = Number(slider.getAttribute('aria-valuenow'));
ok(last > start, 'End selects final sentence');
press(slider, 'ArrowRight'); equal(Number(slider.getAttribute('aria-valuenow')), last, 'Right clamps at final sentence');
press(slider, 'Home'); equal(Number(slider.getAttribute('aria-valuenow')), 0, 'Home selects beginning');
press(slider, 'ArrowLeft'); equal(Number(slider.getAttribute('aria-valuenow')), 0, 'Left clamps at beginning');
press(slider, 'ArrowUp'); ok(Number(slider.getAttribute('aria-valuenow')) > 0, 'Up advances');
press(slider, 'ArrowDown'); equal(Number(slider.getAttribute('aria-valuenow')), 0, 'Down reverses');
ok(!press(slider, 'x').defaultPrevented, 'unrelated key is untouched');
ok(/approximate|estimated/i.test(slider.getAttribute('aria-valuetext')), 'timeline discloses estimated timing');
sheet.querySelector('[data-tts-speed]').click();
ok(sheet.querySelector('[data-tts-speed]').getAttribute('aria-label').includes('1.15'), 'speed label updates with value');
minimize.click();
ok(!root.classList.contains('open') && root.classList.contains('minimized'), 'minimize keeps only mini player');
equal(app.hasAttribute('inert'), false, 'minimize restores background');
equal(focused, expand, 'minimize focuses expand control');
expand.click(); ok(sheet.contains(focused), 'expand restores dialog focus');
ok(app.hasAttribute('inert'), 'expand restores modal boundary');
press(focused, 'Escape');
ok(!root.classList.contains('open') && !root.classList.contains('minimized'), 'Escape closes player');
equal(app.hasAttribute('inert'), false, 'Escape restores background');
equal(existingInert.getAttribute('inert'), 'prior', 'Escape keeps pre-existing inert boundary');
equal(focused, entry, 'Escape returns to Listen rather than hidden mini control');
ok(cancelled > 0, 'close cancels narration');
entry.click(); close.click(); equal(focused, entry, 'close button returns focus');
entry.click(); const oldUtterance = spoken.at(-1);
window.dispatchEvent(new window.Event('hashchange'));
equal(app.hasAttribute('inert'), false, 'route change restores background');
ok(!root.classList.contains('playing'), 'route change stops playing state');
const count = spoken.length; oldUtterance.onend?.(); equal(spoken.length, count, 'old utterance cannot restart after navigation');
render(); entry = app.querySelector('#tts-listen'); entry.focus(); entry.click();
context.initTTS(app, { title: 'Replacement lesson' });
equal(app.hasAttribute('inert'), false, 'topic replacement restores background');
ok(!root.classList.contains('open'), 'topic replacement closes old player');
equal(prefs.size, 1, 'only requested speed preference was written; no course/account state');
console.log(`Listen accessibility: ${checks} behavioral checks passed (actual player, simulated speech/DOM; no network).`);
