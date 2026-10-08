import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

// Regression: LEARNER-001 — incorrect true/false and fill-in answers could not be retried.
// Found by browser QA on 2026-09-30.
// Report: docs/upgrade/M3-LEARNER-QA-2026-09-30.md
// Run the real renderers/controllers with only persistence and analytics stubbed.
const sourceRoot = resolve(process.env.QUIZ_SOURCE_ROOT || 'web/js');
const { renderQuiz } = await import(pathToFileURL(resolve(sourceRoot, 'components', process.env.QUIZ_RENDERER_NAME || 'quiz.js')));
const source = readFileSync(resolve(sourceRoot, 'components', process.env.QUIZ_CONTROLLER_NAME || 'topic-view.js'), 'utf8');
const from = source.indexOf('function initQuizRetry(') >= 0
  ? source.indexOf('function initQuizRetry(') : source.indexOf('function initTrueFalse(');
const to = source.indexOf('function initDragMatch(', from);
assert.ok(from >= 0 && to > from, 'quiz controller boundaries exist');
let checks = 0;
const equal = (actual, expected, message) => { assert.deepEqual(actual, expected, message); checks++; };
const ok = (value, message) => { assert.ok(value, message); checks++; };
const sections = [
  { id: 'retry-tf', variant: 'true-false', statement: 'One threshold fits every pilot.', correct: false, explanation: 'Choose for the task.' },
  { id: 'retry-fib', variant: 'fill-in-blank', sentence: 'Evaluate on ___ cases.', acceptable_answers: ['held-out', 'held out'], explanation: 'Use fresh evidence.' },
];

function mount(section, saved) {
  const { document, window } = parseHTML(`<html><body>${renderQuiz(section)}</body></html>`);
  const root = document.querySelector('.quiz-block');
  let current = true, focused = null;
  const writes = [];
  for (const element of root.querySelectorAll('button,input')) element.focus = () => { focused = element; };
  const progress = { isCurrent: () => current, saveQuizAnswer: (id, answer) => writes.push({ id, answer: JSON.parse(JSON.stringify(answer)) }) };
  const context = vm.createContext({
    store: { bind: () => progress }, logEvent: () => {}, evtCtx: () => ({}),
    escapeAttr: value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  });
  vm.runInContext(source.slice(from, to), context);
  context[section.variant === 'true-false' ? 'initTrueFalse' : 'initFillInBlank'](root, section.id, saved);
  const input = root.querySelector('input');
  const setAnswer = answer => {
    if (input) { input.value = answer; input.dispatchEvent(new window.Event('input', { bubbles: true })); }
    else root.querySelector(`[data-option="${answer}"]`).click();
  };
  return {
    root, input, writes, setAnswer, window,
    check: root.querySelector('.quiz-check-btn'), retry: root.querySelector('.quiz-retry-btn'),
    stale: () => { current = false; }, get focused() { return focused; },
  };
}

for (const section of sections) {
  const isTF = section.variant === 'true-false';
  const wrong = isTF ? 'true' : 'banana', right = isTF ? 'false' : '  HELD   OUT!  ';
  let fixture = mount(section);
  equal(fixture.check.disabled, true, 'empty answer cannot be checked');
  fixture.setAnswer(wrong); equal(fixture.check.disabled, false, 'answer enables checking');
  fixture.check.click();
  equal(fixture.writes.at(-1).answer.correct, false, 'incorrect answer recorded');
  ok(fixture.root.classList.contains('answered'), 'feedback is shown');
  ok(fixture.retry, `${section.variant}: incorrect answer must offer Try Again`);
  equal(fixture.retry.style.display, '', 'retry visible after incorrect answer');
  equal(fixture.check.style.display, 'none', 'checking hidden while feedback shown');
  const savedWrong = fixture.writes.at(-1).answer;
  fixture = mount(section, savedWrong);
  equal(fixture.retry.style.display, '', 'saved incorrect answer remains retryable after reopening');
  fixture.retry.click();
  equal(fixture.root.classList.contains('answered'), false, 'retry reopens the question');
  equal(fixture.root.classList.contains('incorrect'), false, 'retry removes incorrect styling');
  equal(fixture.root.querySelector('.quiz-explanation').style.display, 'none', 'old explanation hidden');
  equal(fixture.retry.style.display, 'none', 'retry hidden during new attempt');
  equal(fixture.check.style.display, '', 'check action restored');
  equal(fixture.check.disabled, true, 'new attempt requires a fresh answer');
  equal(fixture.writes.length, 0, 'retry preserves saved result until a replacement is submitted');
  if (isTF) {
    equal(fixture.root.querySelectorAll('.selected,.correct,.incorrect').length, 0, 'TF selection and result styles reset');
    equal(fixture.focused, fixture.root.querySelector('.quiz-tf-btn'), 'focus returns to first answer');
  } else {
    equal(fixture.input.disabled, false, 'fill-in input becomes editable');
    equal(fixture.input.value, '', 'fill-in starts a fresh attempt');
    equal(fixture.focused, fixture.input, 'focus returns to fill-in input');
    fixture.setAnswer('   '); equal(fixture.check.disabled, true, 'whitespace is not an answer');
  }
  // A synthetic click on a disabled button must not record a blank/stale choice.
  fixture.check.click(); equal(fixture.writes.length, 0, 'empty retry never overwrites progress');
  fixture.setAnswer(right);
  if (isTF) fixture.check.click();
  else {
    const enter = new fixture.window.Event('keydown', { bubbles: true, cancelable: true });
    enter.key = 'Enter'; fixture.input.dispatchEvent(enter);
    equal(enter.defaultPrevented, true, 'Enter submits a non-empty retry');
  }
  equal(fixture.writes.length, 1, 'exactly one replacement is saved');
  equal(fixture.writes[0].id, section.id, 'replacement keeps the same quiz identity');
  equal(fixture.writes[0].answer.correct, true, 'correct retry replaces incorrect result');
  equal(fixture.retry.style.display, 'none', 'correct answer hides retry');
  const savedCorrect = fixture.writes[0].answer;
  fixture.check.click(); equal(fixture.writes.length, 1, 'checked answer cannot submit twice');
  fixture = mount(section, savedCorrect);
  ok(fixture.root.classList.contains('answered'), 'correct result survives reopening');
  equal(fixture.retry.style.display, 'none', 'reopened correct result has no retry');
  if (!isTF) equal(fixture.input.disabled, true, 'correct fill-in stays read-only');
  fixture = mount(section, savedWrong); fixture.stale(); fixture.retry.click();
  ok(fixture.root.classList.contains('answered'), 'stale account/course cannot reopen this attempt');
  equal(fixture.writes.length, 0, 'stale retry never saves');
  fixture = mount(section); fixture.setAnswer(right); fixture.stale(); fixture.check.click();
  equal(fixture.writes.length, 0, 'stale submit never saves');
}
console.log(`Quiz retry: ${checks} behavioral checks passed (TF/FIB, persisted feedback, focus, keyboard, empty input, duplicate/stale guards).`);
