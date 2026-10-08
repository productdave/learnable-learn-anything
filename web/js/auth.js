// Supabase auth — magic-link login, account UI, and API key management for
// cloud course generation.
//
// Graceful degradation: if config.js still holds placeholders, isConfigured()
// is false and the whole module is inert.

import { SUPABASE_URL, SUPABASE_ANON_KEY } from './config.js?v=1';
import { API_KEY_PROVIDERS, getProviderKey, maskKey, setProviderKey } from './api-keys.js?v=1';

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

export function openAccount(options = {}) {
  if (currentUser && document.body.dataset.experience === 'workspace') {
    const owner = currentUser.id;
    return import('./workspace-account.js?v=3').then(({ openWorkspaceAccount }) => {
      if (currentUser?.id === owner) return openWorkspaceAccount({ getUser, onUserChange, signOut, recoverCredentials: options.intent === 'course-generation' });
    });
  }
  const m = ensureModal();
  const body = m.querySelector('.auth-body');
  const intent = options.intent || '';
  const jobId = options.jobId || '';
  if (currentUser) {
    body.innerHTML = `
      <h2 class="auth-title">Your account</h2>
      <p class="auth-email">${currentUser.email}</p>
      <p class="auth-note">Your progress and bring-your-own model keys sync across every device you sign in on.</p>

      <div class="auth-section">
        <div class="auth-section-label">Model API keys</div>
        <p class="auth-help" style="margin-bottom: var(--space-3)">Temporary testing setup: you bring your own provider keys. Later, Learnable can move to platform credits and hide this from learners.</p>
        ${apiKeySettingsHTML()}
      </div>

      <div class="auth-section" data-cloud-sync-section>
        <div class="auth-section-label">Courses</div>
        <div data-cloud-sync-body><span class="auth-help">Loading sync status…</span></div>
      </div>

      <button class="auth-btn auth-btn--ghost auth-signout">Sign out</button>`;

    body.querySelector('.auth-signout').addEventListener('click', async () => {
      await signOut();
      openAccount();
    });
    // Courses section is async — load + wire after the modal is mounted.
    renderCloudSyncSection(body).catch(() => {});
    body.querySelectorAll('[data-key-clear]').forEach(btn => btn.addEventListener('click', async () => {
      setProviderKey(btn.dataset.keyClear, '');
      const { kickSync } = await import('./sync.js?v=27');
      kickSync();
      openAccount({ intent, jobId });
    }));
    body.querySelectorAll('.auth-keyform').forEach(form => form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const provider = e.target.dataset.provider;
      const val = e.target.apiKey.value.trim();
      if (!val) return;
      setProviderKey(provider, val);
      const { flushSync } = await import('./sync.js?v=27');
      let synced = false;
      try { await flushSync(); synced = true; }
      catch { /* account modal can retry via the Courses panel */ }
      if (synced && provider === 'anthropic') {
        window.dispatchEvent(new CustomEvent('learnable-api-key-saved', {
          detail: { intent, jobId }
        }));
      }
      openAccount({ intent, jobId });
    }));
  } else {
    const intentNote = intent === 'course-generation'
      ? `<div class="auth-msg auth-msg--ok" style="display:block; margin-bottom: var(--space-3)">Sign in first so generated courses can save to your account.</div>`
      : '';
    body.innerHTML = `
      <h2 class="auth-title">Sign in to Learnable</h2>
      <p class="auth-note">We'll email you a magic link — no password. Your progress then follows you across devices.</p>
      ${intentNote}
      <form class="auth-form">
        <input type="email" class="auth-input" placeholder="you@example.com" autocomplete="email" required />
        <button type="submit" class="auth-btn">Send magic link</button>
      </form>
      <div class="auth-msg" data-auth-submit-msg style="display:none"></div>`;
    const form = body.querySelector('.auth-form');
    const msg = body.querySelector('[data-auth-submit-msg]');
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
        msg.textContent = authErrorMessage(err);
      }
    });
  }
  m.style.display = '';
}

function apiKeySettingsHTML() {
  return API_KEY_PROVIDERS.map(provider => {
    const key = getProviderKey(provider.id);
    return `
      <div class="auth-provider-key">
        <div class="auth-keyrow">
          <div style="flex:1">
            <strong>${escapeText(provider.label)}</strong>
            <div class="auth-help">${escapeText(provider.status)}</div>
          </div>
          ${key ? `<code class="auth-keymask">${escapeText(maskKey(key))}</code>` : '<span class="auth-help">Not saved</span>'}
        </div>
        <p class="auth-help">${escapeText(provider.help)}
          <a href="${provider.dashboardUrl}" target="_blank" rel="noopener">Dashboard</a> ·
          <a href="${provider.guideUrl}" target="_blank" rel="noopener">How to create a key</a>
        </p>
        <form class="auth-keyform" data-provider="${provider.id}">
          <input class="auth-input auth-mono" type="password" name="apiKey"
            placeholder="${escapeText(provider.placeholder)}" autocomplete="off" spellcheck="false" required>
          <button type="submit" class="auth-btn auth-btn--compact">${key ? 'Replace' : 'Save key'}</button>
          ${key ? `<button type="button" class="auth-btn auth-btn--ghost auth-btn--compact" data-key-clear="${provider.id}">Remove</button>` : ''}
        </form>
      </div>`;
  }).join('');
}

function authErrorMessage(err) {
  if (location.protocol === 'file:') {
    return 'Sign-in needs the HTTP app URL, not file://. Open http://localhost:8765/index.html or http://10.0.0.102:8765/index.html and try again.';
  }
  const msg = err?.message || String(err || '');
  if (/failed to fetch|network/i.test(msg)) {
    return 'Could not reach Supabase auth. Check that this page is opened from http://localhost:8765 or your LAN URL, and that the Supabase project is reachable.';
  }
  return msg || 'Could not send link. Is this email on the allowlist?';
}

export async function signOut() {
  const c = await sb();
  if (c) { const result = await c.auth.signOut(); if (result?.error) throw result.error; }
  currentUser = null;
  refreshAccountButton();
  emitUser();
}

// ---- Account course status (per-course backup to Supabase user_courses) ----

const MIGRATION_SQL = `-- Quick repair for account course sync.
-- For the full cloud course-builder workflow, run db/04-agentic-workflow.sql from this repo.
-- Run in Supabase SQL Editor.
create table if not exists public.user_courses (
  id text not null,
  owner_id uuid not null references auth.users(id) on delete cascade,
  payload jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (id, owner_id)
);

alter table public.user_courses add column if not exists created_at timestamptz not null default now();
alter table public.user_courses add column if not exists updated_at timestamptz not null default now();

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
  const { getStatus, onSyncStatus, syncCoursesNow } = await import('./course-sync.js?v=31');

  function render(status) {
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
        <summary style="cursor:pointer">${status.pushFailures.length} course${status.pushFailures.length === 1 ? '' : 's'} could not save to your account — details</summary>
        <ul style="margin: var(--space-1) 0 0 var(--space-4); padding: 0">
          ${status.pushFailures.map(f => `<li><code>${escapeText(f.id)}</code> — ${escapeText(f.error)}</li>`).join('')}
        </ul>
      </details>` : '';
    const needsMigration =
      (status.lastPullError && /table does not exist|migration SQL/i.test(status.lastPullError)) ||
      status.pushFailures.some(f => f.kind === 'missing_table' || /table does not exist/i.test(f.error || ''));
    const sqlHTML = needsMigration ? `
      <details open class="auth-help" style="margin-top: var(--space-3); padding: var(--space-3); background: color-mix(in srgb, var(--color-rose, #E11D48) 8%, transparent); border: 1px solid color-mix(in srgb, var(--color-rose, #E11D48) 25%, transparent); border-radius: 8px;">
        <summary style="cursor:pointer; font-weight:600; color: var(--color-rose, #E11D48)">⚠ Account course sync needs its table — run this SQL</summary>
        <p style="margin-top: var(--space-2)">Open <a href="https://supabase.com/dashboard/project/olzardlkaxgjqvwnjzil/sql/new" target="_blank" rel="noopener">Supabase → SQL Editor</a>, paste the block below, click Run. For cloud course generation, also run <code>db/04-agentic-workflow.sql</code> from this repo.</p>
        <pre style="margin-top: var(--space-2); padding: var(--space-2); background: var(--bg-secondary); border-radius: 6px; font-size: 11px; overflow-x: auto; white-space: pre-wrap; max-height: 240px; overflow-y: auto"><code>${escapeText(MIGRATION_SQL)}</code></pre>
        <button class="auth-btn auth-btn--compact" data-copy-sql style="margin-top: var(--space-2)">Copy SQL</button>
      </details>` : '';
    host.innerHTML = `
      <div class="auth-keyrow" style="margin-bottom: var(--space-2)">
        <div style="flex: 1">
          ${cloudCount === null
            ? '<span class="auth-help">Course count will appear after the next cloud refresh.</span>'
            : `<strong>${cloudCount}</strong> course${cloudCount === 1 ? '' : 's'} saved to your account`}
          <div class="auth-help" style="margin-top: var(--space-1)">
            Last refreshed: ${fmtAgo(status.lastPullAt)}${status.lastPushAt ? ` · last saved: ${fmtAgo(status.lastPushAt)}` : ''}
          </div>
        </div>
      </div>
      <div class="auth-keyform">
        <button class="auth-btn auth-btn--ghost auth-btn--compact" data-sync-pull>Refresh from cloud</button>
      </div>
      <div class="auth-msg" data-sync-msg style="display:none; margin-top: var(--space-2)"></div>
      ${pullErrHTML}
      ${failuresHTML}
      ${sqlHTML}`;

    host.querySelector('[data-sync-pull]')?.addEventListener('click', async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true; btn.textContent = 'Refreshing…';
      await syncCoursesNow();
      btn.disabled = false; btn.textContent = 'Refresh from cloud';
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
