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

      <div class="auth-section" data-cloud-sync-section>
        <div class="auth-section-label">Cloud sync</div>
        <div data-cloud-sync-body><span class="auth-help">Loading sync status…</span></div>
      </div>

      <div class="auth-section">
        <div class="auth-section-label">Migrate courses from another deployment</div>
        <p class="auth-help">localStorage is per-domain, so courses you generated on an older Learnable URL won't appear here automatically. On the old site, open DevTools (⌥⌘I) → Console → run <code>copy(localStorage.getItem('learnable-user-courses'))</code>, then paste below.</p>
        <textarea class="auth-input auth-mono" data-import-json rows="3" placeholder='{"course-id": { "config": {...}, ... }}' spellcheck="false" autocomplete="off"></textarea>
        <div class="auth-keyform" style="margin-top: var(--space-2)">
          <button class="auth-btn auth-btn--compact" data-import-run>Import courses</button>
          <button class="auth-btn auth-btn--ghost auth-btn--compact" data-export-run>Copy my courses</button>
        </div>
        <div class="auth-msg" data-import-msg style="display:none; margin-top: var(--space-2)"></div>
      </div>

      <button class="auth-btn auth-btn--ghost auth-signout">Sign out</button>`;

    body.querySelector('.auth-signout').addEventListener('click', async () => {
      await signOut();
      openAccount();
    });
    // Cloud-sync section is async — load + wire after the modal is mounted.
    renderCloudSyncSection(body).catch(() => {});
    body.querySelector('[data-import-run]')?.addEventListener('click', async () => {
      const ta = body.querySelector('[data-import-json]');
      const msg = body.querySelector('[data-import-msg]');
      const txt = (ta?.value || '').trim();
      if (!txt) {
        msg.style.display = ''; msg.className = 'auth-msg auth-msg--err';
        msg.textContent = 'Paste the JSON you copied from the old app first.';
        return;
      }
      const { importCoursesJson } = await import('./user-courses.js');
      const result = importCoursesJson(txt);
      msg.style.display = '';
      if (result.imported && !result.errors.length) {
        msg.className = 'auth-msg auth-msg--ok';
        msg.textContent = `Imported ${result.imported} course${result.imported === 1 ? '' : 's'}. Close this dialog to see them.`;
        if (ta) ta.value = '';
        // Tell the library to refresh.
        window.dispatchEvent(new CustomEvent('learnable-courses-imported'));
      } else if (result.imported) {
        msg.className = 'auth-msg auth-msg--ok';
        msg.textContent = `Imported ${result.imported}, skipped ${result.skipped}. ${result.errors.join(' ')}`;
        if (ta) ta.value = '';
        window.dispatchEvent(new CustomEvent('learnable-courses-imported'));
      } else {
        msg.className = 'auth-msg auth-msg--err';
        msg.textContent = result.errors.length ? result.errors.join(' ') : 'No courses found in that JSON.';
      }
    });
    body.querySelector('[data-export-run]')?.addEventListener('click', async () => {
      const { exportCoursesJson } = await import('./user-courses.js');
      const json = exportCoursesJson();
      const msg = body.querySelector('[data-import-msg]');
      try {
        await navigator.clipboard.writeText(json);
        msg.style.display = ''; msg.className = 'auth-msg auth-msg--ok';
        msg.textContent = 'Copied your courses JSON to the clipboard.';
      } catch {
        // Clipboard API can fail without permission — fall back to dumping in the textarea.
        const ta = body.querySelector('[data-import-json]');
        if (ta) ta.value = json;
        msg.style.display = ''; msg.className = 'auth-msg auth-msg--ok';
        msg.textContent = 'Clipboard blocked — JSON dropped into the textarea above for you to copy manually.';
      }
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

// ---- Cloud sync status (per-course backup to Supabase user_courses) ----

const MIGRATION_SQL = `-- Run once in Supabase → SQL Editor.
create table if not exists public.user_courses (
  id text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (id, owner_id)
);

alter table public.user_courses enable row level security;

drop policy if exists "owner_select" on public.user_courses;
drop policy if exists "owner_insert" on public.user_courses;
drop policy if exists "owner_update" on public.user_courses;
drop policy if exists "owner_delete" on public.user_courses;

create policy "owner_select" on public.user_courses for select using (auth.uid() = owner_id);
create policy "owner_insert" on public.user_courses for insert with check (auth.uid() = owner_id);
create policy "owner_update" on public.user_courses for update using (auth.uid() = owner_id);
create policy "owner_delete" on public.user_courses for delete using (auth.uid() = owner_id);`;

async function renderCloudSyncSection(body) {
  const host = body.querySelector('[data-cloud-sync-body]');
  if (!host) return;
  const { getStatus, onSyncStatus, pushAllNow, syncCoursesNow } = await import('./course-sync.js?v=1');
  const { _readAllCourses } = await import('./user-courses.js');

  function render(status) {
    const localCount = Object.keys(_readAllCourses()).length;
    const cloudCount = status.lastPullCloudCount;
    const fmtAgo = (ms) => {
      if (!ms) return 'never';
      const s = Math.round((Date.now() - ms) / 1000);
      if (s < 60) return `${s}s ago`;
      if (s < 3600) return `${Math.round(s / 60)}m ago`;
      return `${Math.round(s / 3600)}h ago`;
    };
    const pullErrHTML = status.lastPullError ? `<p class="auth-msg auth-msg--err" style="margin-top: var(--space-2)">${escapeText(status.lastPullError)}</p>` : '';
    const failuresHTML = status.pushFailures.length ? `
      <details class="auth-help" style="margin-top: var(--space-2)">
        <summary style="cursor:pointer">${status.pushFailures.length} course${status.pushFailures.length === 1 ? '' : 's'} failed to push — details</summary>
        <ul style="margin: var(--space-1) 0 0 var(--space-4); padding: 0">
          ${status.pushFailures.map(f => `<li><code>${escapeText(f.id)}</code> — ${escapeText(f.error)}</li>`).join('')}
        </ul>
      </details>` : '';
    const needsMigration =
      (status.lastPullError && /table does not exist|migration SQL/i.test(status.lastPullError)) ||
      status.pushFailures.some(f => f.kind === 'missing_table' || /table does not exist/i.test(f.error || ''));
    const sqlHTML = needsMigration ? `
      <details open class="auth-help" style="margin-top: var(--space-3); padding: var(--space-3); background: color-mix(in srgb, var(--color-rose, #E11D48) 8%, transparent); border: 1px solid color-mix(in srgb, var(--color-rose, #E11D48) 25%, transparent); border-radius: 8px;">
        <summary style="cursor:pointer; font-weight:600; color: var(--color-rose, #E11D48)">⚠ The user_courses table doesn't exist yet — run this SQL</summary>
        <p style="margin-top: var(--space-2)">Open <a href="https://supabase.com/dashboard/project/olzardlkaxgjqvwnjzil/sql/new" target="_blank" rel="noopener">Supabase → SQL Editor</a>, paste the block below, click Run. Then come back and hit "Sync all to cloud now".</p>
        <pre style="margin-top: var(--space-2); padding: var(--space-2); background: var(--bg-secondary); border-radius: 6px; font-size: 11px; overflow-x: auto; white-space: pre-wrap; max-height: 240px; overflow-y: auto"><code>${escapeText(MIGRATION_SQL)}</code></pre>
        <button class="auth-btn auth-btn--compact" data-copy-sql style="margin-top: var(--space-2)">Copy SQL</button>
      </details>` : '';
    host.innerHTML = `
      <div class="auth-keyrow" style="margin-bottom: var(--space-2)">
        <div style="flex: 1">
          <strong>${localCount}</strong> course${localCount === 1 ? '' : 's'} on this device · ${cloudCount === null ? '<span class="auth-help">cloud unknown</span>' : `<strong>${cloudCount}</strong> in cloud`}
          <div class="auth-help" style="margin-top: var(--space-1)">
            Last pull: ${fmtAgo(status.lastPullAt)}${status.lastPushAt ? ` · last push: ${fmtAgo(status.lastPushAt)}` : ''}
          </div>
        </div>
      </div>
      <div class="auth-keyform">
        <button class="auth-btn auth-btn--compact" data-sync-push>Sync all to cloud now</button>
        <button class="auth-btn auth-btn--ghost auth-btn--compact" data-sync-pull>Pull from cloud</button>
      </div>
      <div class="auth-msg" data-sync-msg style="display:none; margin-top: var(--space-2)"></div>
      ${pullErrHTML}
      ${failuresHTML}
      ${sqlHTML}`;

    host.querySelector('[data-sync-push]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Syncing…';
      const msgEl = host.querySelector('[data-sync-msg]');
      const result = await pushAllNow();
      msgEl.style.display = '';
      if (result.failed === 0) {
        msgEl.className = 'auth-msg auth-msg--ok';
        msgEl.textContent = `Pushed ${result.pushed} course${result.pushed === 1 ? '' : 's'} to the cloud.`;
      } else {
        msgEl.className = 'auth-msg auth-msg--err';
        msgEl.textContent = `Pushed ${result.pushed}, failed ${result.failed}. See details below.`;
      }
      btn.disabled = false; btn.textContent = 'Sync all to cloud now';
    });
    host.querySelector('[data-sync-pull]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Pulling…';
      await syncCoursesNow();
      btn.disabled = false; btn.textContent = 'Pull from cloud';
    });
    host.querySelector('[data-copy-sql]')?.addEventListener('click', async () => {
      try { await navigator.clipboard.writeText(MIGRATION_SQL); } catch {}
      const b = host.querySelector('[data-copy-sql]');
      if (b) { b.textContent = 'Copied ✓'; setTimeout(() => { b.textContent = 'Copy SQL'; }, 1500); }
    });
  }

  // First render with whatever status is currently known.
  render(getStatus());
  // Subscribe so the panel updates live as pushes/pulls finish.
  const unsub = onSyncStatus((s) => { render(s); });
  // When the modal closes, drop the subscription.
  const modal = document.getElementById('auth-modal');
  const observer = new MutationObserver(() => {
    if (modal?.style.display === 'none') { unsub(); observer.disconnect(); }
  });
  if (modal) observer.observe(modal, { attributes: true, attributeFilter: ['style'] });
}

function escapeText(s) {
  return String(s ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
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
