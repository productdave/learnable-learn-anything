import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { parseHTML } from 'linkedom';

// Execute the real Tutor module, with synthetic DOM/storage/network only.
// No real key, provider, account or course is used by these regression tests.
const source = readFileSync(process.env.CHAT_SOURCE_FILE || 'web/js/chat.js', 'utf8');
const shell = readFileSync(process.env.CHAT_HTML_FILE || 'web/index.html', 'utf8');
function fixture({ workspace = true, key = '', fetcher } = {}) {
  const { document, window } = parseHTML(`<html><body ${workspace ? 'data-experience="workspace"' : ''}>
    <button id="chat-trigger">AI Tutor</button><button id="background">Background</button>
    <main><h1 class="topic-title">Test lesson</h1></main><div id="selection-popup"></div>
    <div id="chat-panel"><button class="chat-new-btn">New</button><button class="chat-settings-btn">Settings</button>
      <button class="chat-close-btn">Close</button><div class="chat-messages"></div>
      <textarea class="chat-input"></textarea><button class="chat-send-btn">Send</button></div>
  </body></html>`);
  let focused = document.body, synced = 0;
  const pending = [], requests = [], storage = new Map(key ? [['gametheory-api-key', key]] : []);
  Object.defineProperty(document, 'activeElement', { get: () => focused });
  window.HTMLElement.prototype.focus = function () { focused = this; };
  const context = vm.createContext({
    document, window, TextDecoder,
    localStorage: { getItem: k => storage.get(k), setItem: (k, v) => storage.set(k, v) },
    getCourseConfig: () => ({ chatSystemPrompt: 'Synthetic test tutor.' }),
    kickSync: () => { synced++; },
    setTimeout: fn => { pending.push(fn); return pending.length; },
    clearTimeout: () => {},
    fetch: (...args) => { requests.push(args); return fetcher ? fetcher(...args) : Promise.reject(new Error('Network prohibited in this test')); },
  });
  vm.runInContext(source.replace(/^import .*;\n/gm, '').replaceAll('export function ', 'function '), context);
  context.initChat();
  const panel = document.getElementById('chat-panel'), trigger = document.getElementById('chat-trigger');
  const press = (el, key) => {
    const event = new window.Event('keydown', { bubbles: true, cancelable: true });
    event.key = key; el.dispatchEvent(event);
  };
  const drainTimers = () => { pending.splice(0).forEach(callback => callback()); };
  const open = () => { trigger.focus(); trigger.click(); drainTimers(); };
  return { document, panel, trigger, context, press, open, drainTimers, requests,
    focus: () => focused, syncs: () => synced };
}

test('initial closed Tutor is excluded from keyboard and accessibility navigation', () => {
  const f = fixture();
  assert.equal(f.panel.hasAttribute('inert'), true);
  assert.equal(f.panel.getAttribute('aria-hidden'), 'true');
  assert.equal(f.trigger.getAttribute('aria-controls'), 'chat-panel');
  assert.equal(f.trigger.getAttribute('aria-expanded'), 'false');
  assert.equal(f.requests.length, 0);
});

test('open enables Tutor and associates a real API-key label/help', () => {
  const f = fixture(); f.open();
  assert.equal(f.panel.hasAttribute('inert'), false);
  assert.equal(f.panel.getAttribute('aria-hidden'), 'false');
  assert.equal(f.trigger.getAttribute('aria-expanded'), 'true');
  const input = f.panel.querySelector('.chat-key-input');
  assert.ok(input.id);
  assert.equal(f.panel.querySelector(`label[for="${input.id}"]`)?.textContent, 'Anthropic API Key');
  const help = f.document.getElementById(input.getAttribute('aria-describedby'));
  assert.match(help?.textContent || '', /Separate from your secure course-creation connection/);
  assert.match(help?.textContent || '', /Anthropic credits/);
  assert.equal(f.focus() === input, true, 'key prompt receives focus');
  assert.equal(f.requests.length, 0);
  assert.equal(f.syncs(), 0);
});

test('Escape closes, restores visible trigger focus and removes hidden tab stops', () => {
  const f = fixture(); f.open(); f.press(f.focus(), 'Escape');
  assert.equal(f.focus() === f.trigger, true, 'Escape restores trigger focus');
  assert.equal(f.panel.classList.contains('open'), false);
  assert.equal(f.panel.hasAttribute('inert'), true);
  assert.equal(f.panel.getAttribute('aria-hidden'), 'true');
  assert.equal(f.trigger.getAttribute('aria-expanded'), 'false');
});

test('close button and trigger toggle use the same keyboard boundary', () => {
  const f = fixture(); f.open();
  const close = f.panel.querySelector('.chat-close-btn'); close.focus(); close.click();
  assert.equal(f.focus() === f.trigger, true, 'close button restores trigger focus');
  assert.equal(f.panel.hasAttribute('inert'), true);
  f.open(); f.trigger.focus(); f.trigger.click();
  assert.equal(f.focus() === f.trigger, true, 'trigger retains focus');
  assert.equal(f.panel.hasAttribute('inert'), true);
});

test('closing a nonmodal Tutor does not steal background focus', () => {
  const f = fixture(); f.open();
  const background = f.document.getElementById('background'); background.focus();
  f.press(background, 'Escape');
  assert.equal(f.focus() === background, true, 'background focus is preserved');
  assert.equal(f.panel.hasAttribute('inert'), true);
});

test('pending key focus cannot re-enter a closed panel', () => {
  const f = fixture(); f.trigger.focus(); f.trigger.click();
  f.press(f.trigger, 'Escape'); f.drainTimers();
  assert.equal(f.focus() === f.trigger, true, 'delayed prompt cannot reclaim focus');
  assert.equal(f.panel.contains(f.focus()), false);
});

test('removed key prompt cannot receive delayed focus after a new conversation', () => {
  const f = fixture(); f.trigger.focus(); f.trigger.click();
  f.panel.querySelector('.chat-new-btn').click(); f.drainTimers();
  assert.equal(f.focus() === f.panel.querySelector('.chat-input'), true, 'removed prompt cannot reclaim focus');
  assert.equal(f.focus().isConnected, true);
});

for (const fail of [false, true]) {
  test(`late ${fail ? 'failed' : 'successful'} response cannot focus closed Tutor`, async () => {
    let resolveRequest, rejectRequest;
    const f = fixture({ key: 'synthetic-test-only', fetcher: () => new Promise((resolve, reject) => {
      resolveRequest = resolve; rejectRequest = reject;
    }) });
    f.open();
    const pending = f.context.streamMessage('Synthetic question');
    f.press(f.focus(), 'Escape');
    if (fail) rejectRequest(new Error('Synthetic provider failure'));
    else resolveRequest({ ok: true, body: { getReader: () => ({ read: async () => ({ done: true }) }) } });
    await pending;
    assert.equal(f.requests.length, 1);
    assert.equal(f.focus() === f.trigger, true, 'late response cannot reclaim focus');
    assert.equal(f.panel.hasAttribute('inert'), true);
    assert.equal(f.panel.querySelector('.chat-input').disabled, false);
    assert.equal(f.syncs(), 0);
  });
}

test('legacy account-copy contract remains separate from workspace wording', () => {
  const f = fixture({ workspace: false }); f.open();
  assert.match(f.panel.textContent, /Saved to your account so the tutor and cloud course-generation agents can use it across devices/);
  assert.doesNotMatch(f.panel.textContent, /Separate from your secure course-creation connection/);
});

test('HTML is inert before boot and library routing closes through the Tutor controller', () => {
  const html = shell, app = readFileSync('web/js/app.js', 'utf8');
  const { document } = parseHTML(html);
  assert.equal(document.getElementById('chat-panel').hasAttribute('inert'), true);
  assert.equal(document.getElementById('chat-panel').getAttribute('aria-hidden'), 'true');
  const version = app.match(/import \{ initChat, closeChat \} from '\.\/chat\.js\?v=(\d+)'/)?.[1];
  assert.ok(Number(version) >= 24, 'controller import is at least the accessibility fix version');
  const library = app.slice(app.indexOf('function setShellForLibrary()'), app.indexOf('function setShellForCourse'));
  assert.match(library, /closeChat\(\{ restoreFocus: false \}\)/);
  assert.doesNotMatch(library, /courseTutor\.classList\.remove\('open'\)/);
});

test('pilot retains Tutor only in inactive templates, not live header or selection controls', () => {
  const { document } = parseHTML(shell);
  for (const [id, templateId] of [['chat-trigger', 'deferred-tutor-trigger'],
    ['chat-panel', 'deferred-tutor-panel'], ['selection-popup', 'deferred-tutor-panel']]) {
    const template = document.getElementById(templateId);
    assert.equal(template?.tagName, 'TEMPLATE', id + ' must be deferred');
    assert.equal(template.content.querySelectorAll('#' + id).length, 1, 'Keep exactly one restorable copy of ' + id);
    assert.equal(document.querySelectorAll('#' + id).length, 0, id + ' must not be live');
  }
  for (const id of ['search-trigger', 'flashcard-trigger', 'theme-toggle']) {
    assert.ok(document.getElementById(id));
    assert.equal(document.getElementById(id).closest('template'), null, id + ' remains live');
  }
  assert.equal(document.querySelector('script[type="module"]').closest('template'), null);
});

test('pilot Tutor initialisation has no listeners, key reads, timers or provider work', () => {
  const { document, window } = parseHTML(shell);
  // Linkedom's getElementById traverses template content, unlike a browser.
  // Remove the inactive templates to model the native document's live tree.
  document.querySelectorAll('template').forEach(el => el.remove());
  const fail = action => { throw new Error('Deferred Tutor attempted ' + action); };
  document.addEventListener = () => fail('document listener registration');
  const context = vm.createContext({
    document, window, TextDecoder,
    localStorage: { getItem: () => fail('key read'), setItem: () => fail('key write') },
    getCourseConfig: () => fail('course configuration read'),
    kickSync: () => fail('account sync'),
    setTimeout: () => fail('timer'), clearTimeout: () => fail('timer cancellation'),
    fetch: () => fail('provider request'),
  });
  vm.runInContext(source.replace(/^import .*;\n/gm, '').replaceAll('export function ', 'function '), context);
  context.initChat();
  context.closeChat({ restoreFocus: false });
  assert.equal(document.getElementById('chat-trigger'), null);
  assert.equal(document.getElementById('chat-panel'), null);
  assert.equal(document.getElementById('selection-popup'), null);
});
