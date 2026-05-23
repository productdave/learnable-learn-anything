// Text-to-speech "Listen" player — Substack-style audio player UI on top of
// the browser's built-in Web Speech API (speechSynthesis). No API key, no
// network, keeps playing when the tab is backgrounded.
//
// A play icon in the topic header opens a full bottom-sheet player with a
// cover, scrubber, elapsed/total time, skip ±15/30s, play/pause and speed.
// A chevron minimizes to a persistent mini-player; close stops + dismisses.
//
// Timeline model: speechSynthesis has no native timeline, so we estimate each
// chunk's duration from its word count and the playback rate (~180 wpm × rate),
// build a cumulative timeline, and drive the scrubber from a rAF tick. Seeking
// and skip land on chunk boundaries (we can't start mid-utterance reliably).

const SPEED_KEY = 'learnable-tts-rate';
const VOICE_KEY = 'learnable-tts-voice';
const SPEEDS = [0.9, 1, 1.15, 1.3, 1.5];
const WPM = 180; // baseline words-per-minute at rate 1

let voices = [];          // ranked English voices (best first)
let selectedURI = localStorage.getItem(VOICE_KEY) || '';

// macOS ships dozens of novelty voices (Bad News, Bubbles, Zarvox…). Hide them.
const JUNK = ['bad news','good news','bells','boing','bubbles','cellos','jester','organ',
  'superstar','trinoids','whisper','wobble','zarvox','albert','bahh','deranged','hysterical',
  'pipe','ralph','junior','kathy','fred','grandma','grandpa','rocko','shelley','sandy','flo',
  'eddy','reed','rishi'];

function scoreVoice(v) {
  const lang = (v.lang || '').toLowerCase();
  if (!lang.startsWith('en')) return -1;
  const n = v.name.toLowerCase();
  if (JUNK.some(j => n.includes(j))) return -1;
  let s = 0;
  if (n.includes('siri')) s += 95;            // best on Apple
  if (n.includes('premium')) s += 90;
  if (n.includes('natural') || n.includes('neural')) s += 88;
  if (n.includes('enhanced')) s += 80;
  if (n.includes('google')) s += 70;          // Chrome cloud voices — much better than local
  if (!v.localService) s += 20;               // cloud generally smoother
  const good = ['samantha','ava','zoe','allison','serena','tessa','karen','daniel','moira','nicky','aaron','jamie'];
  if (good.some(g => n === g || n.startsWith(g + ' ') || n.startsWith(g + ' ('))) s += 30;
  if (lang === 'en-us') s += 6;
  if (lang === 'en-gb' || lang === 'en-au') s += 3;
  return s;
}

function loadVoices() {
  const all = window.speechSynthesis.getVoices() || [];
  voices = all
    .map(v => ({ v, s: scoreVoice(v) }))
    .filter(x => x.s >= 0)
    .sort((a, b) => b.s - a.s)
    .map(x => x.v);
}

function currentVoice() {
  if (!voices.length) loadVoices();
  if (selectedURI) {
    const found = voices.find(v => v.voiceURI === selectedURI);
    if (found) return found;
  }
  return voices[0] || null; // best-ranked
}

let chunks = [];          // [{ text, node, words, dur, start }]
let totalDur = 0;
let idx = 0;
let playing = false;
let rate = parseFloat(localStorage.getItem(SPEED_KEY)) || 1;
let chunkStartTs = 0;     // performance.now() when current chunk began
let speakToken = 0;       // guards against stale onend/onerror after cancel()
let rafId = null;
let meta = { title: '', moduleName: '', moduleColor: '#4338CA', icon: 'book' };
let ui = null;            // player DOM refs

const supported = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

// ---- text collection + timeline -----------------------------------

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

function collectChunks(container) {
  const result = [];
  const push = (text, node) => {
    const clean = (text || '').replace(/\s+/g, ' ').trim();
    if (!clean) return;
    for (const s of splitSentences(clean)) result.push({ text: s, node });
  };
  const title = container.querySelector('.topic-title');
  if (title) push(title.textContent, title);
  container.querySelectorAll('.topic-sections > *').forEach(sec => {
    if (sec.classList.contains('quiz-block')) return;
    if (sec.classList.contains('concept-section')) {
      const h = sec.querySelector('.concept-title');
      if (h) push(h.textContent, h);
      sec.querySelectorAll('.concept-body p, .concept-section > p, p').forEach(p => push(p.textContent, p));
    } else if (sec.classList.contains('callout')) {
      const t = sec.querySelector('.callout-title');
      if (t) push(t.textContent, t);
      const bodies = sec.querySelectorAll('p, .callout-content');
      if (bodies.length) bodies.forEach(p => push(p.textContent, p));
      else push(sec.textContent, sec);
    } else if (sec.classList.contains('takeaway')) {
      push('Key takeaways.', sec.querySelector('.takeaway-title') || sec);
      sec.querySelectorAll('li').forEach(li => push(li.textContent, li));
    }
  });
  return result;
}

function buildTimeline() {
  let t = 0;
  for (const c of chunks) {
    c.words = c.text.split(/\s+/).length;
    c.dur = (c.words / WPM) * 60 / rate + 0.25; // seconds
    c.start = t;
    t += c.dur;
  }
  totalDur = t;
}

function currentTime() {
  if (!chunks.length) return 0;
  const within = playing ? Math.min((performance.now() - chunkStartTs) / 1000, chunks[idx].dur) : 0;
  return Math.min((chunks[idx]?.start || 0) + within, totalDur);
}

function fmt(sec) {
  sec = Math.max(0, Math.round(sec));
  const m = Math.floor(sec / 60), s = sec % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// ---- playback ------------------------------------------------------

function clearHighlight() {
  document.querySelectorAll('.tts-speaking').forEach(n => n.classList.remove('tts-speaking'));
}

function speakFrom(i) {
  if (i >= chunks.length) { stop(); return; }
  idx = i;
  chunkStartTs = performance.now(); // sync, so currentTime() is correct before onstart fires
  const myToken = ++speakToken;     // any later cancel/seek bumps the token, neutering this utterance's handlers
  const { text, node } = chunks[i];
  const u = new SpeechSynthesisUtterance(text);
  u.rate = rate;
  const voice = currentVoice();
  if (voice) { u.voice = voice; u.lang = voice.lang; }
  u.onstart = () => {
    if (myToken !== speakToken) return;
    chunkStartTs = performance.now();
    clearHighlight();
    if (node) {
      node.classList.add('tts-speaking');
      node.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  };
  u.onend = () => { if (playing && myToken === speakToken) speakFrom(i + 1); };
  u.onerror = () => { if (playing && myToken === speakToken) speakFrom(i + 1); };
  window.speechSynthesis.speak(u);
}

function play() {
  if (!chunks.length) return;
  window.speechSynthesis.cancel();
  playing = true;
  setPlayIcon(true);
  startTick();
  speakFrom(idx >= chunks.length ? 0 : idx);
}

function pause() {
  playing = false;
  window.speechSynthesis.cancel(); // cancel (not pause) — more reliable across browsers; we resume by chunk
  setPlayIcon(false);
  stopTick();
}

function togglePlay() {
  if (playing) pause();
  else play();
}

function stop() {
  playing = false;
  idx = 0;
  window.speechSynthesis.cancel();
  clearHighlight();
  setPlayIcon(false);
  stopTick();
  renderProgress();
}

function seekToTime(t) {
  t = Math.max(0, Math.min(t, totalDur));
  let target = chunks.findIndex(c => t < c.start + c.dur);
  if (target < 0) target = chunks.length - 1;
  idx = target;
  if (playing) { window.speechSynthesis.cancel(); speakFrom(idx); }
  else renderProgress();
}

function skip(delta) { seekToTime(currentTime() + delta); }

function cycleSpeed() {
  rate = SPEEDS[(SPEEDS.indexOf(rate) + 1) % SPEEDS.length];
  localStorage.setItem(SPEED_KEY, String(rate));
  buildTimeline();
  if (ui?.speed) ui.speed.textContent = `${rate}×`;
  if (playing) { window.speechSynthesis.cancel(); speakFrom(idx); }
  else renderProgress();
}

// ---- scrubber tick -------------------------------------------------

function startTick() { if (!rafId) tick(); }
function stopTick() { if (rafId) { cancelAnimationFrame(rafId); rafId = null; } }
function tick() {
  renderProgress();
  rafId = requestAnimationFrame(tick);
}

function renderProgress() {
  if (!ui) return;
  const cur = currentTime();
  const pct = totalDur ? (cur / totalDur) * 100 : 0;
  ui.fill.style.width = `${pct}%`;
  ui.knob.style.left = `${pct}%`;
  ui.elapsed.textContent = fmt(cur);
  ui.total.textContent = fmt(totalDur);
  if (ui.miniFill) ui.miniFill.style.width = `${pct}%`;
}

function setPlayIcon(on) {
  if (!ui) return;
  ui.root.classList.toggle('playing', on);
  ui.playIc.style.display = on ? 'none' : '';
  ui.pauseIc.style.display = on ? '' : 'none';
  if (ui.miniPlayIc) ui.miniPlayIc.style.display = on ? 'none' : '';
  if (ui.miniPauseIc) ui.miniPauseIc.style.display = on ? '' : 'none';
}

// ---- player overlay (created once, reused) -------------------------

const SVG = {
  play: '<svg viewBox="0 0 24 24"><path d="M8 5v14l11-7z"/></svg>',
  pause: '<svg viewBox="0 0 24 24"><path d="M6 5h4v14H6zM14 5h4v14h-4z"/></svg>',
  chevronDown: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 9l6 6 6-6"/></svg>',
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  back15: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4 7 8l4 4"/><path d="M7 8h6a6 6 0 1 1-6 6"/></svg>',
  fwd30: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M13 4l4 4-4 4"/><path d="M17 8h-6a6 6 0 1 0 6 6"/></svg>',
  expand: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M6 15l6-6 6 6"/></svg>'
};

function ensurePlayer() {
  if (ui) return ui;
  const el = document.createElement('div');
  el.className = 'tts-player';
  el.innerHTML = `
    <div class="tts-overlay" data-tts-overlay></div>
    <div class="tts-sheet" role="dialog" aria-label="Audio player">
      <div class="tts-sheet-top">
        <button class="tts-icon-btn" data-tts-min aria-label="Minimize player">${SVG.chevronDown}</button>
        <button class="tts-icon-btn" data-tts-close aria-label="Close player">${SVG.close}</button>
      </div>
      <div class="tts-cover" data-tts-cover>
        <svg class="tts-cover-icon" width="64" height="64"><use data-tts-cover-icon href="#icon-book"/></svg>
        <div class="tts-cover-wave"><span></span><span></span><span></span><span></span><span></span></div>
      </div>
      <div class="tts-scrub" data-tts-scrub>
        <div class="tts-scrub-track"><div class="tts-scrub-fill" data-tts-fill></div><div class="tts-scrub-knob" data-tts-knob></div></div>
      </div>
      <div class="tts-times"><span data-tts-elapsed>0:00</span><button class="tts-speed" data-tts-speed>${rate}×</button><span data-tts-total>0:00</span></div>
      <div class="tts-controls">
        <button class="tts-skip" data-tts-skip="-15" aria-label="Back 15 seconds">${SVG.back15}<span class="tts-skip-num">15</span></button>
        <button class="tts-bigplay" data-tts-toggle aria-label="Play or pause">
          <span class="tts-ic-play">${SVG.play}</span><span class="tts-ic-pause" style="display:none">${SVG.pause}</span>
        </button>
        <button class="tts-skip" data-tts-skip="30" aria-label="Forward 30 seconds">${SVG.fwd30}<span class="tts-skip-num">30</span></button>
      </div>
      <div class="tts-meta">
        <div class="tts-meta-title" data-tts-title></div>
        <div class="tts-meta-sub" data-tts-sub></div>
      </div>
      <div class="tts-voice-row">
        <svg class="tts-voice-ic" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4"/></svg>
        <select class="tts-voice-select" data-tts-voice aria-label="Choose voice"></select>
      </div>
    </div>

    <div class="tts-mini" data-tts-mini>
      <button class="tts-mini-main" data-tts-expand>
        <span class="tts-mini-cover" data-tts-mini-cover><svg width="20" height="20"><use data-tts-mini-icon href="#icon-book"/></svg></span>
        <span class="tts-mini-title" data-tts-mini-title></span>
      </button>
      <button class="tts-icon-btn tts-mini-toggle" data-tts-toggle aria-label="Play or pause">
        <span class="tts-mini-ic-play">${SVG.play}</span><span class="tts-mini-ic-pause" style="display:none">${SVG.pause}</span>
      </button>
      <button class="tts-icon-btn" data-tts-close aria-label="Close">${SVG.close}</button>
      <div class="tts-mini-bar"><div class="tts-mini-fill" data-tts-mini-fill></div></div>
    </div>`;
  document.body.appendChild(el);

  const q = s => el.querySelector(s);
  ui = {
    root: el,
    overlay: q('[data-tts-overlay]'),
    sheet: q('.tts-sheet'),
    cover: q('[data-tts-cover]'),
    coverIcon: q('[data-tts-cover-icon]'),
    fill: q('[data-tts-fill]'),
    knob: q('[data-tts-knob]'),
    scrub: q('[data-tts-scrub]'),
    elapsed: q('[data-tts-elapsed]'),
    total: q('[data-tts-total]'),
    speed: q('[data-tts-speed]'),
    playIc: q('.tts-ic-play'),
    pauseIc: q('.tts-ic-pause'),
    title: q('[data-tts-title]'),
    sub: q('[data-tts-sub]'),
    voice: q('[data-tts-voice]'),
    mini: q('[data-tts-mini]'),
    miniTitle: q('[data-tts-mini-title]'),
    miniCover: q('[data-tts-mini-cover]'),
    miniIcon: q('[data-tts-mini-icon]'),
    miniFill: q('[data-tts-mini-fill]'),
    miniPlayIc: q('.tts-mini-ic-play'),
    miniPauseIc: q('.tts-mini-ic-pause')
  };

  // wire interactions
  el.querySelectorAll('[data-tts-toggle]').forEach(b => b.addEventListener('click', togglePlay));
  el.querySelectorAll('[data-tts-close]').forEach(b => b.addEventListener('click', closePlayer));
  q('[data-tts-min]').addEventListener('click', minimizePlayer);
  q('[data-tts-expand]').addEventListener('click', openPlayer);
  q('[data-tts-overlay]').addEventListener('click', minimizePlayer);
  q('[data-tts-speed]').addEventListener('click', cycleSpeed);
  el.querySelectorAll('[data-tts-skip]').forEach(b =>
    b.addEventListener('click', () => skip(parseFloat(b.dataset.ttsSkip))));

  ui.voice.addEventListener('change', () => {
    selectedURI = ui.voice.value;
    localStorage.setItem(VOICE_KEY, selectedURI);
    if (playing) { window.speechSynthesis.cancel(); speakFrom(idx); }
  });
  populateVoices();
  // Voices often load asynchronously; refresh the list when they arrive.
  window.speechSynthesis.addEventListener?.('voiceschanged', () => { loadVoices(); populateVoices(); });

  // scrubber seek (click + drag)
  const scrub = q('[data-tts-scrub]');
  const seekFromEvent = (clientX) => {
    const r = scrub.querySelector('.tts-scrub-track').getBoundingClientRect();
    const pct = Math.max(0, Math.min(1, (clientX - r.left) / r.width));
    seekToTime(pct * totalDur);
  };
  let dragging = false;
  scrub.addEventListener('pointerdown', e => { dragging = true; scrub.setPointerCapture(e.pointerId); seekFromEvent(e.clientX); });
  scrub.addEventListener('pointermove', e => { if (dragging) seekFromEvent(e.clientX); });
  scrub.addEventListener('pointerup', () => { dragging = false; });

  return ui;
}

function niceVoiceLabel(v) {
  // "Samantha" stays; "Google US English" stays; trim parenthetical locale noise.
  let n = v.name.replace(/\s*\(English \([^)]+\)\)/i, '');
  const region = { 'en-US': 'US', 'en-GB': 'UK', 'en-AU': 'AU', 'en-IE': 'IE', 'en-IN': 'IN', 'en-ZA': 'ZA' }[v.lang] || '';
  if (region && !n.includes(region)) n += ` · ${region}`;
  return n;
}

function populateVoices() {
  if (!ui?.voice) return;
  loadVoices();
  if (!voices.length) { ui.voice.innerHTML = '<option>Default voice</option>'; return; }
  const chosen = currentVoice();
  ui.voice.innerHTML = voices.map(v =>
    `<option value="${v.voiceURI}"${chosen && v.voiceURI === chosen.voiceURI ? ' selected' : ''}>${niceVoiceLabel(v)}</option>`
  ).join('');
}

function applyMeta() {
  if (!ui) return;
  ui.title.textContent = meta.title;
  ui.sub.textContent = meta.moduleName ? `${meta.moduleName}` : 'Learnable';
  ui.miniTitle.textContent = meta.title;
  ui.coverIcon.setAttribute('href', `#icon-${meta.icon}`);
  ui.miniIcon.setAttribute('href', `#icon-${meta.icon}`);
  ui.cover.style.setProperty('--cover-color', meta.moduleColor);
  ui.miniCover.style.background = meta.moduleColor;
  ui.root.style.setProperty('--tts-accent', meta.moduleColor);
}

function openPlayer() {
  ensurePlayer();
  applyMeta();
  renderProgress();
  ui.root.classList.add('open');
  ui.root.classList.remove('minimized');
}

function minimizePlayer() {
  if (!ui) return;
  ui.root.classList.remove('open');
  ui.root.classList.add('minimized'); // mini-player stays; playback continues
}

function closePlayer() {
  stop();
  if (ui) ui.root.classList.remove('open', 'minimized');
}

// ---- public API ----------------------------------------------------

/** The entry button injected into the topic header. */
export function ttsBarHTML() {
  if (!supported()) return '';
  return `
    <button class="tts-listen-btn" id="tts-listen" aria-label="Listen to this topic">
      ${SVG.play}<span>Listen</span>
    </button>`;
}

/** Wire up after a topic renders. Pass topic + module metadata for the player. */
export function initTTS(container, info = {}) {
  if (!supported()) return;
  // New topic → reset everything.
  window.speechSynthesis.cancel();
  if (ui) { ui.root.classList.remove('open', 'minimized'); }
  playing = false;
  idx = 0;
  stopTick();
  clearHighlight();

  chunks = collectChunks(container);
  buildTimeline();
  meta = {
    title: info.title || container.querySelector('.topic-title')?.textContent || 'This topic',
    moduleName: info.moduleName || '',
    moduleColor: info.moduleColor || '#4338CA',
    icon: info.icon || 'book'
  };

  const btn = container.querySelector('#tts-listen');
  if (!btn) return;
  btn.addEventListener('click', () => {
    ensurePlayer();
    openPlayer();
    if (!playing) play();
  });
}

if (supported()) {
  window.addEventListener('beforeunload', () => window.speechSynthesis.cancel());
  window.addEventListener('hashchange', () => { window.speechSynthesis.cancel(); if (ui) ui.root.classList.remove('open', 'minimized'); });
}
