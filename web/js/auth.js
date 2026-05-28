// Supabase auth — magic-link login + account UI.
//
// Graceful degradation: if config.js still holds placeholders, isConfigured()
// is false and the whole module is inert — the app behaves exactly as the
// local-only version (localStorage progress, no login UI).

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js';

const ANTHROPIC_KEY_STORE = 'gametheory-api-key'; // shared with chat.js + generator/index.js + sync.js
function getAnthropicKey() { return localStorage.getItem(ANTHROPIC_KEY_STORE) || ''; }
function setAnthropicKey(k) {
  if (k) localStorage.setItem(ANTHROPIC_KEY_STORE, k.trim());
  else localStorage.removeItem(ANTHROPIC_KEY_STORE);
}
function maskKey(k) {
  if (!k) return '';
  if (k.length <= 14) return '••••••••';
  return k.slice(0, 8) + '…' + k.slice(-4);
}

let client = null;
let currentUser = null;
const userListeners = new Set();

export function isConfigured() {
  return SUPABASE_URL && !SUPABASE_URL.includes('YOUR-PROJECT')
    && SUPABASE_ANON_KEY && !SUPABASE_ANON_KEY.includes('YOUR-ANON-KEY');
}

/** Lazily create the Supabase client (loads the SDK from a CDN, zero-build). */
export async function sb() {
  if (!isConfigured()) return null;
  if (client) return client;
  const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2');
  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: true }
  });
  return client;
}

export function getUser() { return currentUser; }
export function onUserChange(fn) { userListeners.add(fn); return () => userListeners.delete(fn); }
function emitUser() { userListeners.forEach(fn => { try { fn(currentUser); } catch {} }); }

// ---- account button + login modal ---------------------------------

function accountButtonHTML() {
  return `
    <button class="header-btn" id="account-trigger" aria-label="Account" title="Account">
      <svg width="20" height="20"><use href="#icon-user"/></svg>
    </button>`;
}

function injectAccountButton() {
  const right = document.querySelector('.header-right');
  if (!right || document.getElementById('account-trigger')) return;
  // place it before the theme toggle
  const theme = document.getElementById('theme-toggle');
  const wrap = document.createElement('div');
  wrap.style.display = 'contents';
  wrap.innerHTML = accountButtonHTML();
  right.insertBefore(wrap.firstElementChild, theme);
  document.getElementById('account-trigger').addEventListener('click', openAccount);
}

function refreshAccountButton() {
  const btn = document.getElementById('account-trigger');
  if (!btn) return;
  btn.title = currentUser ? `Signed in as ${currentUser.email}` : 'Sign in';
  btn.classList.toggle('signed-in', !!currentUser);
}

function ensureModal() {
  let m = document.getElementById('auth-modal');
  if (m) return m;
  m = document.createElement('div');
  m.id = 'auth-modal';
  m.className = 'auth-modal';
  m.style.display = 'none';
  m.innerHTML = `
    <div class="auth-card" role="dialog" aria-label="Account">
      <button class="auth-close" aria-label="Close"><svg width="18" height="18"><use href="#icon-x"/></svg></button>
      <div class="auth-body"></div>
    </div>`;
  document.body.appendChild(m);
  // Backdrop click + ESC intentionally do NOT close — avoids losing a
  // typed email / API key to an accidental dismiss. Only the X closes.
  m.querySelector('.auth-close').addEventListener('click', () => { m.style.display = 'none'; });
  return m;
}

function openAccount() {
  const m = ensureModal();
  const body = m.querySelector('.auth-body');
  if (currentUser) {
    const hasKey = !!getAnthropicKey();
    body.innerHTML = `
      <h2 class="auth-title">Your account</h2>
      <p class="auth-email">${currentUser.email}</p>
      <p class="auth-note">Your progress and Anthropic key sync across every device you sign in on.</p>

      <div class="auth-section">
        <div class="auth-section-label">Anthropic API key</div>
        ${hasKey ? `
          <div class="auth-keyrow">
            <code class="auth-keymask">${maskKey(getAnthropicKey())}</code>
            <button class="auth-link" data-action="edit-key">Replace</button>
            <button class="auth-link auth-link--danger" data-action="clear-key">Remove</button>
          </div>
          <p class="auth-help">Used by the AI tutor and course generation. Runs in your browser only.</p>
        ` : `
          <form class="auth-keyform">
            <input class="auth-input auth-mono" type="password" name="anthropicKey"
              placeholder="sk-ant-..." autocomplete="off" spellcheck="false" required>
            <button type="submit" class="auth-btn auth-btn--compact">Save key</button>
          </form>
          <p class="auth-help">Runs in your browser, never leaves your device.
            <a href="https://console.anthropic.com/" target="_blank" rel="noopener">Get one</a> — roughly $1–3 of credit per generated course.</p>
        `}
      </div>

      <button class="auth-btn auth-btn--ghost auth-signout">Sign out</button>`;

    body.querySelector('.auth-signout').addEventListener('click', async () => {
      await signOut();
      openAccount();
    });
    body.querySelector('[data-action="edit-key"]')?.addEventListener('click', () => {
      setAnthropicKey('');
      // Re-render so the form shows
      openAccount();
    });
    body.querySelector('[data-action="clear-key"]')?.addEventListener('click', async () => {
      setAnthropicKey('');
      const { kickSync } = await import('./sync.js?v=2');
      kickSync();
      openAccount();
    });
    body.querySelector('.auth-keyform')?.addEventListener('submit', async (e) => {
      e.preventDefault();
      const val = e.target.anthropicKey.value.trim();
      if (!val) return;
      setAnthropicKey(val);
      const { kickSync } = await import('./sync.js?v=2');
      kickSync();
      openAccount();
    });
  } else {
    body.innerHTML = `
      <h2 class="auth-title">Sign in to Learnable</h2>
      <p class="auth-note">We'll email you a magic link — no password. Your progress then follows you across devices.</p>
      <form class="auth-form">
        <input type="email" class="auth-input" placeholder="you@example.com" autocomplete="email" required />
        <button type="submit" class="auth-btn">Send magic link</button>
      </form>
      <div class="auth-msg" style="display:none"></div>`;
    const form = body.querySelector('.auth-form');
    const msg = body.querySelector('.auth-msg');
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = form.querySelector('.auth-input').value.trim();
      if (!email) return;
      const btn = form.querySelector('.auth-btn');
      btn.disabled = true; btn.textContent = 'Sending…';
      try {
        const c = await sb();
        const { error } = await c.auth.signInWithOtp({
          email,
          options: { emailRedirectTo: window.location.origin + window.location.pathname }
        });
        if (error) throw error;
        form.style.display = 'none';
        msg.style.display = '';
        msg.className = 'auth-msg auth-msg--ok';
        msg.textContent = `Check ${email} for your sign-in link.`;
      } catch (err) {
        btn.disabled = false; btn.textContent = 'Send magic link';
        msg.style.display = '';
        msg.className = 'auth-msg auth-msg--err';
        msg.textContent = err.message || 'Could not send link. Is this email on the allowlist?';
      }
    });
  }
  m.style.display = '';
}

export async function signOut() {
  const c = await sb();
  if (c) await c.auth.signOut();
  currentUser = null;
  refreshAccountButton();
  emitUser();
}

/** Call once at app boot. No-op if Supabase isn't configured. */
export async function initAuth() {
  if (!isConfigured()) return;
  injectAccountButton();
  const c = await sb();
  if (!c) return;

  const { data } = await c.auth.getSession();
  currentUser = data?.session?.user || null;
  refreshAccountButton();
  emitUser();

  c.auth.onAuthStateChange((_event, session) => {
    const next = session?.user || null;
    const changed = (next?.id || null) !== (currentUser?.id || null);
    currentUser = next;
    refreshAccountButton();
    if (changed) emitUser();
  });
}
