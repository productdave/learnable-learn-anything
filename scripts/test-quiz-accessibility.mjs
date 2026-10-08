import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

// LEARNER-001/002 (30 Sep 2026): execute the real standard-quiz renderers and
// controllers. DOM focus is modelled; native Tab/focus is checked separately in CUA.
// Persistence/analytics are synthetic. No account, provider, network or storage.
const sourceRoot = resolve(process.env.QUIZ_SOURCE_ROOT || 'web/js');
const renderer = readFileSync(resolve(sourceRoot, 'components', process.env.QUIZ_RENDERER_NAME || 'quiz.js'), 'utf8');
const controller = readFileSync(resolve(sourceRoot, 'components', process.env.QUIZ_CONTROLLER_NAME || 'topic-view.js'), 'utf8');
const from = controller.indexOf('function initQuizRetry(');
const to = controller.indexOf('function initDragMatch(', from);
assert.ok(from >= 0 && to > from);

const sections = [
  { id: 'focus-mc', variant: 'multiple-choice', question: 'Which evidence is useful?', options: [{ id: 'a', text: 'One anecdote' }, { id: 'b', text: 'Held-out evaluation' }], correct: 'b', explanation: 'Use evidence from held-out cases.' },
  { id: 'focus-tf', variant: 'true-false', statement: 'One anecdote proves improvement.', correct: false, explanation: 'An anecdote is not enough.' },
  { id: 'focus-fib', variant: 'fill-in-blank', sentence: 'Evaluate on ___ cases.', acceptable_answers: ['held-out', 'held out'], explanation: 'Use fresh evidence.' },
  { id: 'focus-sa', variant: 'short-answer', question: 'What evidence would you ask for?', sample_answer: 'Ask about held-out evaluation.', key_points: ['A defined metric'], explanation: 'Compare your reasoning; this is not AI grading.' },
];
const names = { 'multiple-choice': 'initMultipleChoice', 'true-false': 'initTrueFalse', 'fill-in-blank': 'initFillInBlank', 'short-answer': 'initShortAnswer' };

function mount(section, saved) {
  const { document, window } = parseHTML('<html><body><button id="outside">Outside</button><main></main></body></html>');
  let current = true, focused = document.getElementById('outside');
  const writes = [], events = [];
  Object.defineProperty(document, 'activeElement', { get: () =>
    focused?.disabled || focused?.closest('[style*="display:none"],[style*="display: none"]') ? document.body : focused });
  window.HTMLElement.prototype.focus = function () { focused = this; };
  const progress = { isCurrent: () => current, saveQuizAnswer: (id, answer) => writes.push({ id, answer: JSON.parse(JSON.stringify(answer)) }) };
  const context = vm.createContext({
    document, window, store: { bind: () => progress, getQuizAnswer: () => saved },
    logEvent: (...args) => events.push(args), evtCtx: () => ({}),
    escapeAttr: value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])),
  });
  vm.runInContext(renderer.replace(/^import .*;\n/gm, '').replace('export function renderQuiz', 'function renderQuiz'), context);
  document.querySelector('main').innerHTML = context.renderQuiz(section);
  const root = document.querySelector('.quiz-block');
  vm.runInContext(controller.slice(from, to), context);
  context[names[section.variant]](root, section.id, saved);
  const input = root.querySelector('input,textarea');
  return {
    root, input, writes, events, document, window,
    check: root.querySelector('.quiz-check-btn'), retry: root.querySelector('.quiz-retry-btn'),
    feedback: root.querySelector('.quiz-explanation'),
    stale: () => { current = false; },
    answer(value) {
      if (input) { input.focus(); input.value = value; input.dispatchEvent(new window.Event('input', { bubbles: true })); }
      else { const option = root.querySelector(`[data-option="${value}"]`); option.focus(); option.click(); }
    },
    submit() { this.check.focus(); this.check.click(); },
  };
}

for (const section of sections) {
  const short = section.variant === 'short-answer';
  const right = section.variant === 'multiple-choice' ? 'b' : section.variant === 'true-false' ? 'false' : short ? 'Ask for held-out results.' : '  HELD OUT  ';
  const wrong = section.variant === 'multiple-choice' ? 'a' : section.variant === 'true-false' ? 'true' : 'banana';
  for (const value of short ? [right] : [wrong, right]) {
    test(`${section.variant}: fresh ${value === right ? 'correct/reveal' : 'incorrect'} submission focuses meaningful feedback`, () => {
      const f = mount(section); f.answer(value); f.submit();
      assert.equal(f.writes.length, 1);
      assert.equal(f.document.activeElement === f.feedback, true, 'focus must not remain on a hidden/disabled control or BODY');
      assert.equal(f.feedback.getAttribute('tabindex'), '-1', 'result is focusable without adding an extra Tab stop');
      assert.ok(f.feedback.getAttribute('aria-label'), 'feedback has a meaningful name');
      assert.ok(f.feedback.textContent.trim());
      if (!short) assert.match(f.feedback.textContent, value === right ? /Correct/ : /Not quite/);
      const previous = f.writes.length; f.check.click();
      assert.equal(f.writes.length, previous, 'hidden submit cannot save twice');
    });
  }
  test(`${section.variant}: saved feedback does not steal focus on hydration`, () => {
    const f = mount(section); f.answer(right); f.submit();
    const reopened = mount(section, f.writes[0].answer);
    assert.equal(reopened.document.activeElement.id, 'outside');
    assert.equal(reopened.feedback.style.display, '');
    assert.equal(reopened.writes.length, 0);
  });
  test(`${section.variant}: stale submission cannot change focus or progress`, () => {
    const f = mount(section); f.answer(right); f.stale(); f.submit();
    assert.equal(f.writes.length, 0);
    assert.equal(f.document.activeElement === f.check, true);
    assert.equal(f.feedback.style.display, 'none');
  });
}

for (const section of sections.filter(s => s.variant !== 'short-answer')) {
  test(`${section.variant}: retry follows feedback and returns to an empty answer`, () => {
    const f = mount(section); f.answer(section.variant === 'multiple-choice' ? 'a' : section.variant === 'true-false' ? 'true' : 'banana'); f.submit();
    assert.equal(f.retry.getAttribute('onclick'), null, 'retry uses the guarded controller, not a separate inline handler');
    assert.equal(f.feedback.contains(f.retry), true, 'Tab from feedback can reach its retry action');
    f.retry.focus(); f.retry.click();
    const firstAnswer = f.input || f.root.querySelector('.quiz-option,.quiz-tf-btn');
    assert.equal(f.document.activeElement === firstAnswer, true);
    assert.equal(f.check.disabled, true);
    assert.equal(f.root.querySelectorAll('.selected,.incorrect,.correct').length, 0);
    assert.equal(f.writes.length, 1, 'retry alone preserves the previous stored result');
    f.check.click(); assert.equal(f.writes.length, 1, 'empty retry cannot resubmit a stale selection');
    const reopened = mount(section, f.writes[0].answer); reopened.stale(); reopened.retry.focus(); reopened.retry.click();
    assert.equal(reopened.feedback.style.display, '', 'stale retry does not mutate UI');
    assert.equal(reopened.writes.length, 0);
  });
}

test('fill-in and written answers have question-specific, safely escaped names', () => {
  const f = mount({ ...sections[2], sentence: 'Keep "fresh" <evidence> in ___ sets.' });
  assert.equal(f.input.getAttribute('aria-label'), 'Fill in the blank: Keep "fresh" <evidence> in [blank] sets.');
  assert.equal(f.root.querySelector('evidence'), null, 'label content cannot become markup');
  const written = mount(sections[3]);
  assert.equal(written.input.getAttribute('aria-label'), sections[3].question);
});

test('fill-in Enter focuses feedback; retry retains its label and input focus', () => {
  const f = mount(sections[2]); f.answer('banana');
  const key = new f.window.Event('keydown', { bubbles: true, cancelable: true }); key.key = 'Enter';
  f.input.dispatchEvent(key);
  assert.equal(key.defaultPrevented, true);
  assert.equal(f.document.activeElement === f.feedback, true);
  f.retry.click();
  assert.equal(f.document.activeElement === f.input, true);
  assert.equal(f.input.getAttribute('aria-label'), 'Fill in the blank: Evaluate on [blank] cases.');
});

test('written-answer reveal rejects empty and repeated synthetic submissions', () => {
  const f = mount(sections[3]); f.answer('   '); f.submit();
  assert.equal(f.writes.length, 0);
  f.answer('Ask for held-out results.'); f.submit(); f.check.click();
  assert.equal(f.writes.length, 1);
  assert.equal(f.events.length, 1);
});
