const MODEL = 'claude-haiku-4-5-20251001';
const API_URL = 'https://api.anthropic.com/v1/messages';
const KEY_STORE = 'aipm-api-key';

let panel, popup, messagesEl, inputEl, sendBtn;
let state = {
  open: false,
  messages: [],
  context: '',
  topicTitle: '',
  moduleName: '',
  streaming: false
};

function getKey() { return localStorage.getItem(KEY_STORE) || ''; }
function setKey(k) { localStorage.setItem(KEY_STORE, k.trim()); }

function escHtml(t) {
  return t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function applyInline(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([^*\n]+)\*/g, '<em>$1</em>')
    .replace(/`([^`\n]+)`/g, '<code class="chat-inline-code">$1</code>');
}

function formatMsg(raw) {
  const esc = escHtml(raw);
  return esc.split(/\n\n+/).map(p => {
    const lines = p.split('\n');
    if (lines.every(l => !l.trim() || /^[-*•]\s/.test(l.trim()))) {
      return '<ul>' + lines.filter(l => l.trim())
        .map(l => `<li>${applyInline(l.replace(/^[-*•]\s+/, ''))}</li>`).join('') + '</ul>';
    }
    if (lines.every(l => !l.trim() || /^\d+\.\s/.test(l.trim()))) {
      return '<ol>' + lines.filter(l => l.trim())
        .map(l => `<li>${applyInline(l.replace(/^\d+\.\s+/, ''))}</li>`).join('') + '</ol>';
    }
    return `<p>${applyInline(p.replace(/\n/g, '<br>'))}</p>`;
  }).join('');
}

function scrollBottom() {
  if (messagesEl) messagesEl.scrollTop = messagesEl.scrollHeight;
}

function buildSystem() {
  let s = 'You are an AI learning assistant embedded in an interactive course on AI Product Management for product managers.';
  if (state.topicTitle || state.moduleName) {
    s += `\n\nThe learner is studying "${state.topicTitle}" in the "${state.moduleName}" module.`;
  }
  if (state.context) {
    s += `\n\nThey selected this text from the lesson:\n\n"${state.context}"\n\nStart by directly addressing this concept and grounding it in practical PM decision-making.`;
  }
  s += '\n\nBe concise (150-250 words per response unless asked for more). Focus on product decisions, not engineering. Use concrete examples — real tools, companies, situations. Write in plain paragraphs or short bullet lists. No filler phrases, no em dashes.';
  return s;
}

async function streamMessage(userContent) {
  if (state.streaming || !userContent.trim()) return;
  const key = getKey();
  if (!key) { showKeyPrompt(); return; }

  state.messages.push({ role: 'user', content: userContent });
  state.streaming = true;
  renderMessages();

  if (inputEl) { inputEl.value = ''; inputEl.disabled = true; }
  if (sendBtn) sendBtn.disabled = true;

  const bubble = document.createElement('div');
  bubble.className = 'chat-msg chat-msg--ai';
  bubble.innerHTML = '<span class="chat-cursor"></span>';
  messagesEl.appendChild(bubble);
  scrollBottom();

  let full = '';

  try {
    const res = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-api-key': key,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        stream: true,
        system: buildSystem(),
        messages: state.messages
      })
    });

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error(err.error?.message || `HTTP ${res.status}`);
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const raw = line.slice(6).trim();
        if (!raw || raw === '[DONE]') continue;
        try {
          const ev = JSON.parse(raw);
          if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') {
            full += ev.delta.text;
            bubble.innerHTML = formatMsg(full) + '<span class="chat-cursor"></span>';
            scrollBottom();
          }
        } catch { /* skip malformed SSE lines */ }
      }
    }

    bubble.innerHTML = formatMsg(full);
    state.messages.push({ role: 'assistant', content: full });

  } catch (err) {
    bubble.innerHTML = `<p class="chat-error">⚠ ${escHtml(err.message)}${err.message.includes('401') ? ' — check your API key.' : ''}</p>`;
    state.messages.pop();
  }

  state.streaming = false;
  if (inputEl) { inputEl.disabled = false; inputEl.focus(); }
  if (sendBtn) sendBtn.disabled = false;
}

function renderMessages() {
  if (!messagesEl) return;
  messagesEl.innerHTML = '';

  if (state.context) {
    const trunc = state.context.length > 230 ? state.context.slice(0, 230) + '…' : state.context;
    messagesEl.innerHTML += `
      <div class="chat-context-card">
        <div class="chat-context-label">
          <svg width="11" height="11"><use href="#icon-sparkle"/></svg>
          Selected context
        </div>
        <div class="chat-context-text">${escHtml(trunc)}</div>
      </div>`;
  }

  if (!state.messages.length && !state.context) {
    messagesEl.innerHTML += `
      <div class="chat-welcome">
        <svg width="36" height="36"><use href="#icon-sparkle"/></svg>
        <p>Highlight any text in the lesson to ask the AI about it — or type a question about the current topic below.</p>
      </div>`;
  }

  for (const msg of state.messages) {
    messagesEl.innerHTML += `
      <div class="chat-msg chat-msg--${msg.role === 'user' ? 'user' : 'ai'}">
        ${msg.role === 'user' ? escHtml(msg.content) : formatMsg(msg.content)}
      </div>`;
  }

  scrollBottom();
}

function showKeyPrompt() {
  if (!panel) return;
  const existing = panel.querySelector('.chat-key-prompt');
  if (existing) { existing.remove(); return; }

  const el = document.createElement('div');
  el.className = 'chat-key-prompt';
  el.innerHTML = `
    <div class="chat-key-prompt-title">Anthropic API Key</div>
    <p>Stored locally in your browser. Sent directly to Anthropic — never anywhere else.</p>
    <div class="chat-key-row">
      <input type="password" class="chat-key-input" placeholder="sk-ant-api03-..." spellcheck="false" autocomplete="off"/>
      <button class="chat-key-save">Save</button>
    </div>
    <a href="https://console.anthropic.com/" target="_blank" rel="noopener" class="chat-key-link">Get a key at console.anthropic.com →</a>
  `;
  messagesEl.prepend(el);

  const input = el.querySelector('.chat-key-input');
  el.querySelector('.chat-key-save').addEventListener('click', () => {
    const val = input.value.trim();
    if (!val) { input.classList.add('error'); return; }
    setKey(val);
    el.remove();
    updateKeyBtn();
    if (state.context && !state.messages.length) {
      streamMessage('Can you explain this concept more deeply and give me a concrete PM example of when this matters?');
    }
  });
  input.addEventListener('keydown', e => {
    if (e.key === 'Enter') el.querySelector('.chat-key-save').click();
    input.classList.remove('error');
  });
  setTimeout(() => input.focus(), 50);
}

function updateKeyBtn() {
  const btn = panel?.querySelector('.chat-settings-btn');
  if (!btn) return;
  const has = !!getKey();
  btn.classList.toggle('has-key', has);
  btn.title = has ? 'API key saved — click to change' : 'Set API key';
}

function openPanel(context, topicTitle, moduleName) {
  state.context = context || '';
  state.topicTitle = topicTitle || '';
  state.moduleName = moduleName || '';
  state.messages = [];
  state.open = true;

  panel.classList.add('open');
  renderMessages();

  if (!getKey()) {
    showKeyPrompt();
    return;
  }
  if (context) {
    streamMessage('Can you explain this concept more deeply and give me a concrete PM example of when this matters?');
  } else {
    inputEl?.focus();
  }
}

function closePanel() {
  state.open = false;
  panel.classList.remove('open');
}

function getTopicInfo() {
  return {
    topicTitle: document.querySelector('.topic-title')?.textContent?.trim() || '',
    moduleName: document.querySelector('.topic-breadcrumb span[style]')?.textContent?.trim() || ''
  };
}

export function initChat() {
  panel = document.getElementById('chat-panel');
  popup = document.getElementById('selection-popup');
  if (!panel || !popup) return;

  messagesEl = panel.querySelector('.chat-messages');
  inputEl = panel.querySelector('.chat-input');
  sendBtn = panel.querySelector('.chat-send-btn');

  panel.querySelector('.chat-close-btn')?.addEventListener('click', closePanel);

  panel.querySelector('.chat-new-btn')?.addEventListener('click', () => {
    state.messages = [];
    state.context = '';
    renderMessages();
    inputEl?.focus();
  });

  panel.querySelector('.chat-settings-btn')?.addEventListener('click', showKeyPrompt);

  document.getElementById('chat-trigger')?.addEventListener('click', () => {
    if (state.open) { closePanel(); return; }
    const info = getTopicInfo();
    openPanel('', info.topicTitle, info.moduleName);
  });

  updateKeyBtn();

  sendBtn?.addEventListener('click', () => streamMessage(inputEl?.value?.trim() || ''));

  inputEl?.addEventListener('keydown', e => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      streamMessage(inputEl.value.trim());
    }
  });

  // Auto-resize textarea
  inputEl?.addEventListener('input', () => {
    inputEl.style.height = 'auto';
    inputEl.style.height = Math.min(inputEl.scrollHeight, 120) + 'px';
  });

  // Selection detection — only inside topic content
  let selTimer;
  document.addEventListener('mouseup', () => {
    clearTimeout(selTimer);
    selTimer = setTimeout(() => {
      const sel = window.getSelection();
      const text = sel?.toString().trim();
      if (!text || text.length < 15) { popup.style.display = 'none'; return; }

      const range = sel.getRangeAt(0);
      const anchor = range.commonAncestorContainer;
      const node = anchor.nodeType === 3 ? anchor.parentElement : anchor;
      const inContent = node?.closest('.topic-sections, .concept-content, .callout-content, .callout-text, .takeaway-list');
      if (!inContent) { popup.style.display = 'none'; return; }

      const rect = range.getBoundingClientRect();
      const left = Math.max(8, Math.min(rect.left + rect.width / 2 - 54, window.innerWidth - 120));
      popup.style.left = `${left}px`;
      popup.style.top = `${rect.top - 46}px`;
      popup.style.display = 'flex';
      popup.dataset.selected = text;
    }, 100);
  });

  document.addEventListener('mousedown', e => {
    if (!e.target.closest('#selection-popup')) popup.style.display = 'none';
  });

  popup.addEventListener('click', () => {
    const text = popup.dataset.selected || '';
    popup.style.display = 'none';
    window.getSelection()?.removeAllRanges();
    const info = getTopicInfo();
    openPanel(text, info.topicTitle, info.moduleName);
  });

  document.addEventListener('keydown', e => {
    if (e.key === 'Escape' && state.open) closePanel();
  });
}
