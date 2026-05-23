// Text-to-speech "Listen" feature — reads the current topic aloud using the
// browser's built-in Web Speech API (speechSynthesis). No API key, no network.
//
// Design notes:
// - Reads the article-like content (title, concept headings + paragraphs,
//   callouts, takeaways). Skips interactive quizzes.
// - Chunks text into short segments (≈ sentence level) so we (a) avoid the
//   well-known Chrome bug that cuts off utterances after ~15s, and (b) can
//   highlight + auto-scroll the segment currently being read.
// - Keeps playing when the tab is backgrounded (browser default for TTS).

const SPEED_KEY = 'learnable-tts-rate';
const SPEEDS = [0.9, 1, 1.15, 1.3, 1.5];

let chunks = [];        // [{ text, node }]
let idx = 0;
let playing = false;
let rate = parseFloat(localStorage.getItem(SPEED_KEY)) || 1;
let els = {};           // cached control elements

function supported() {
  return typeof window !== 'undefined' && 'speechSynthesis' in window;
}

// Split a long string into sentence-ish chunks under ~200 chars.
function splitSentences(text) {
  const parts = text.match(/[^.!?]+[.!?]+(\s|$)|[^.!?]+$/g) || [text];
  const out = [];
  let buf = '';
  for (const p of parts) {
    if ((buf + p).length > 200 && buf) { out.push(buf.trim()); buf = p; }
    else buf += p;
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

// Walk the rendered topic and collect readable segments in document order.
function collectChunks(container) {
  const result = [];
  const push = (text, node) => {
    const clean = (text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    for (const s of splitSentences(clean)) result.push({ text: s, node });
  };

  const title = container.querySelector('.topic-title');
  if (title) push(title.textContent, title);

  // Walk sections in order; read concepts, callouts, takeaways. Skip quizzes.
  const sections = container.querySelectorAll('.topic-sections > *');
  sections.forEach(sec => {
    if (sec.classList.contains('quiz-block')) return; // interactive — skip
    if (sec.classList.contains('concept-section')) {
      const h = sec.querySelector('.concept-title');
      if (h) push(h.textContent, h);
      sec.querySelectorAll('.concept-body p, .concept-section > p, p').forEach(p => push(p.textContent, p));
    } else if (sec.classList.contains('callout')) {
      const t = sec.querySelector('.callout-title');
      if (t) push(t.textContent, t);
      sec.querySelectorAll('p, .callout-content').forEach(p => push(p.textContent, p));
      if (!sec.querySelector('p, .callout-content')) push(sec.textContent, sec);
    } else if (sec.classList.contains('takeaway')) {
      push('Key takeaways.', sec.querySelector('.takeaway-title') || sec);
      sec.querySelectorAll('li').forEach(li => push(li.textContent, li));
    }
  });
  return result;
}

function setPlayingUI(on) {
  if (els.playIcon) els.playIcon.style.display = on ? 'none' : '';
  if (els.pauseIcon) els.pauseIcon.style.display = on ? '' : 'none';
  if (els.label) els.label.textContent = on ? 'Pause' : (idx > 0 ? 'Resume' : 'Listen');
  if (els.stop) els.stop.style.display = (on || idx > 0) ? '' : 'none';
  if (els.speed) els.speed.style.display = (on || idx > 0) ? '' : 'none';
}

function clearHighlight() {
  document.querySelectorAll('.tts-speaking').forEach(n => n.classList.remove('tts-speaking'));
}

function speakFrom(i) {
  if (i >= chunks.length) { stop(); return; }
  idx = i;
  const { text, node } = chunks[i];

  const u = new SpeechSynthesisUtterance(text);
  u.rate = rate;
  u.onstart = () => {
    clearHighlight();
    if (node) {
      node.classList.add('tts-speaking');
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (els.progress) els.progress.textContent = `${i + 1}/${chunks.length}`;
  };
  u.onend = () => {
    if (playing) speakFrom(i + 1);
  };
  u.onerror = () => { if (playing) speakFrom(i + 1); };
  window.speechSynthesis.speak(u);
}

function start() {
  if (!chunks.length) return;
  window.speechSynthesis.cancel();
  playing = true;
  setPlayingUI(true);
  speakFrom(idx >= chunks.length ? 0 : idx);
}

function pause() {
  playing = false;
  window.speechSynthesis.pause();
  setPlayingUI(false);
}

function resume() {
  // Some browsers lose the paused queue; if so, restart from current chunk.
  playing = true;
  setPlayingUI(true);
  if (window.speechSynthesis.paused) window.speechSynthesis.resume();
  else speakFrom(idx);
}

function stop() {
  playing = false;
  idx = 0;
  window.speechSynthesis.cancel();
  clearHighlight();
  setPlayingUI(false);
  if (els.progress) els.progress.textContent = '';
}

function cycleSpeed() {
  const cur = SPEEDS.indexOf(rate);
  rate = SPEEDS[(cur + 1) % SPEEDS.length];
  localStorage.setItem(SPEED_KEY, String(rate));
  if (els.speed) els.speed.textContent = `${rate}×`;
  // Apply immediately if mid-playback.
  if (playing) {
    window.speechSynthesis.cancel();
    speakFrom(idx);
  }
}

/** Markup for the Listen control — injected into the topic header. */
export function ttsBarHTML() {
  if (!supported()) return '';
  const playSvg = '<svg class="tts-ic tts-ic-play" viewBox="0 0 24 24" width="16" height="16"><path d="M8 5v14l11-7z"/></svg>';
  const pauseSvg = '<svg class="tts-ic tts-ic-pause" viewBox="0 0 24 24" width="16" height="16" style="display:none"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>';
  const stopSvg = '<svg viewBox="0 0 24 24" width="14" height="14"><rect x="6" y="6" width="12" height="12" rx="2"/></svg>';
  return `
    <div class="tts-bar" id="tts-bar">
      <button class="tts-btn tts-toggle" id="tts-toggle" aria-label="Listen to this topic">
        ${playSvg}${pauseSvg}<span class="tts-label">Listen</span>
      </button>
      <button class="tts-btn tts-stop" id="tts-stop" aria-label="Stop" style="display:none">${stopSvg}</button>
      <button class="tts-btn tts-speed" id="tts-speed" aria-label="Playback speed" style="display:none">${rate}×</button>
      <span class="tts-progress" id="tts-progress"></span>
    </div>`;
}

/** Wire up the Listen control after a topic renders. */
export function initTTS(container) {
  if (!supported()) return;
  // Reset any speech from a previous topic.
  window.speechSynthesis.cancel();
  chunks = collectChunks(container);
  idx = 0;
  playing = false;

  els = {
    toggle: container.querySelector('#tts-toggle'),
    stop: container.querySelector('#tts-stop'),
    speed: container.querySelector('#tts-speed'),
    progress: container.querySelector('#tts-progress'),
    playIcon: container.querySelector('.tts-ic-play'),
    pauseIcon: container.querySelector('.tts-ic-pause'),
    label: container.querySelector('.tts-label')
  };
  if (!els.toggle) return;
  if (els.speed) els.speed.textContent = `${rate}×`;

  els.toggle.addEventListener('click', () => {
    if (playing) pause();
    else if (idx > 0 && window.speechSynthesis.paused) resume();
    else start();
  });
  els.stop?.addEventListener('click', stop);
  els.speed?.addEventListener('click', cycleSpeed);
}

// Stop narration when leaving the page entirely.
if (supported()) {
  window.addEventListener('beforeunload', () => window.speechSynthesis.cancel());
  window.addEventListener('hashchange', () => window.speechSynthesis.cancel());
}
