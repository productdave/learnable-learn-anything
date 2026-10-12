import { createSetupGenerationClient } from './setup-generation-client.js?v=10';
import { escapeHome as esc } from './home-model.js?v=7';
import { fundedAccessHTML } from './funded-access-view.js?v=1';

let currentDialog = null;

// Workspace creation owns a server-vault connection. Legacy tutor keys are not
// read, migrated or erased here. Closing/connecting never authorizes generation.
export function openWorkspaceAccount({ getUser, onUserChange, signOut, recoverCredentials = false, client = createSetupGenerationClient() }) {
  if (currentDialog?.isConnected) { currentDialog.focus(); return; }
  const user = getUser();
  if (!user?.id) return;
  const owner = user.id, opener = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'auth-card workspace-account';
  dialog.setAttribute('aria-labelledby', 'workspace-account-title');
  dialog.setAttribute('aria-describedby', 'workspace-account-intro');
  dialog.innerHTML = `<button type="button" class="auth-close" aria-label="Close account">×</button>
    <h2 class="auth-title" id="workspace-account-title" tabindex="-1">Your account</h2>
    <p class="auth-email">${esc(user.email || 'Signed in')}</p>
    <p class="auth-note" id="workspace-account-intro">Your courses and requests stay saved to this account.</p>
    <div data-funded-account aria-live="polite"></div>
    <section class="workspace-account-connection" data-legacy-account hidden aria-labelledby="workspace-claude-title">
      <h3 id="workspace-claude-title">Claude · course creation</h3>
      <p class="auth-note">Use your own Claude API account for plans, research and lessons. Generation is billed by your provider only when you explicitly start it. Connecting checks access; it does not generate content.</p>
      <div data-account-connection></div>
    </section>
    <details class="workspace-account-other" data-legacy-other hidden><summary>Images and tutor connections</summary>
      <p class="auth-note">Useful course images are created with OpenAI during course creation. You can connect OpenAI on the Create course screen; there is no separate image workspace to complete.</p>
      <p class="auth-note">The existing tutor uses a separate browser-stored key, managed in the tutor. Connecting or disconnecting here does not change that key.</p>
    </details>
    <button type="button" class="auth-btn auth-btn--ghost" data-account-signout>Sign out</button>
    <p class="auth-msg auth-msg--err" data-account-signout-error role="alert" tabindex="-1" hidden></p>`;
  const host = dialog.querySelector('[data-account-connection]');
  const state = { connection: null, busy: '', error: '', notice: '', replacing: false, confirming: false, recoveryPending: recoverCredentials };
  let disposed = false, ticket = 0, accessTicket = 0, legacyAllowed = false;
  const sameOwner = () => getUser()?.id === owner;
  const active = () => !disposed && sameOwner();
  const notify = (connection, cleared) => window.dispatchEvent(new CustomEvent('learnable-provider-connection-changed', { detail: { owner, connected: connection?.connected, cleared } }));
  const unsubscribe = onUserChange(() => { if (!sameOwner()) close(); });
  function close() {
    if (disposed) return;
    disposed = true; ticket++; accessTicket++; unsubscribe();
    dialog.querySelectorAll('input').forEach(input => { input.value = ''; });
    dialog.close(); dialog.remove();
    if (currentDialog === dialog) currentDialog = null;
    if (opener?.isConnected) opener.focus({ preventScroll: true });
  }
  function draw(focus = '') {
    if (!active()) return;
    const connected = state.connection?.connected === true, known = state.connection !== null;
    const disabled = state.busy ? 'disabled' : '';
    host.setAttribute('aria-busy', String(!!state.busy));
    host.innerHTML = `<p class="workspace-account-status" role="status" tabindex="-1">${esc(state.busy || state.notice || (known ? connected ? 'Connected securely' : 'Not connected' : 'Connection status unavailable'))}</p>
      ${state.error ? `<p class="auth-msg auth-msg--err" role="alert" tabindex="-1" data-account-error>${esc(state.error)}</p>` : ''}
      ${known ? `<p class="auth-note">${connected ? `Using ${esc(state.connection.model || 'your account’s course model')}. ` : ''}This connection is encrypted on the server, not stored in this browser or in your course.</p>` : ''}
      ${known && state.recoveryPending && state.error ? `<button type="button" class="auth-btn" data-account-action="check" ${disabled}>Check status</button>` : ''}
      ${!known ? `<button type="button" class="auth-btn" data-account-action="check" ${disabled}>${state.busy ? 'Checking…' : 'Check status'}</button>` : state.confirming ? `
        <fieldset class="workspace-account-confirm"><legend>Disconnect Claude?</legend><p>Saved courses stay available. Work already running may still finish. You’ll need to reconnect before starting new course creation. Your separate tutor key is unchanged.</p>
        <div class="workspace-account-actions"><button type="button" class="auth-btn auth-btn--ghost" data-account-action="keep" ${disabled}>Keep connected</button><button type="button" class="auth-btn" data-account-action="disconnect" ${disabled}>Disconnect Claude</button></div></fieldset>` : `
        ${!connected || state.replacing ? `<form data-account-connect>
          <label for="workspace-claude-key">${connected ? 'New Claude API key' : 'Claude API key'}</label>
          <input id="workspace-claude-key" name="api-key" class="auth-input" type="password" autocomplete="off" spellcheck="false" required aria-describedby="workspace-key-help" ${disabled}>
          <p class="auth-note" id="workspace-key-help">${connected ? 'Your current connection stays in place unless the new key is accepted. ' : ''}Your key clears from this form when you submit or close it.</p>
          <div class="workspace-account-actions"><button class="auth-btn" type="submit" ${disabled}>${connected ? 'Replace connection' : 'Connect Claude'}</button>${connected ? `<button class="auth-btn auth-btn--ghost" type="button" data-account-action="cancel-replace" ${disabled}>Cancel</button>` : ''}</div>
          <a href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener noreferrer">Get a Claude API key ↗</a>
        </form>` : `<div class="workspace-account-actions"><button type="button" class="auth-btn auth-btn--ghost" data-account-action="replace" ${disabled}>Replace key</button><button type="button" class="auth-btn auth-btn--ghost" data-account-action="confirm-disconnect" ${disabled}>Disconnect…</button></div>`}`}`;
    dialog.querySelector('[data-account-signout]').disabled = !!state.busy;
    if (focus) host.querySelector(focus)?.focus({ preventScroll: true });
  }
  async function run(action) {
    if (!active() || state.busy || !legacyAllowed) return;
    const mine = ++ticket;
    const initiatedHere = host.contains(document.activeElement);
    if (typeof action === 'object') state.recoveryPending = true;
    state.error = ''; state.notice = ''; state.busy = action === 'check' ? 'Checking your connection…' : action === 'disconnect' ? 'Disconnecting Claude…' : 'Checking and saving your connection…';
    draw();
    try {
      const result = await (action === 'check' ? client.connection(owner) : action === 'disconnect' ? client.disconnect(owner) : client.connect(owner, action.key));
      let cleared;
      if (sameOwner() && result.connected && (action !== 'check' || state.recoveryPending)) {
        state.recoveryPending = true;
        if (active()) { state.connection = result; state.busy = 'Connected. Updating paused course status…'; draw(); }
        try {
          const recovery = await client.refreshCredentials(owner);
          if (sameOwner()) { cleared = recovery.cleared; state.recoveryPending = false; }
        } catch {
          state.error = 'Claude is connected, but course status could not be refreshed. Check status to make Resume available. No course was restarted.';
        }
      }
      if (sameOwner()) notify(result, cleared);
      if (!active() || ticket !== mine) return;
      state.connection = result; state.replacing = false; state.confirming = false;
      state.notice = action === 'check' ? '' : action === 'disconnect' ? 'Claude disconnected. Saved courses are unchanged.' : 'Claude connected securely. No course generation has started.';
    } catch {
      // A failed response cannot establish whether a mutation reached the server.
      if (sameOwner() && action !== 'check') notify();
      if (!active() || ticket !== mine) return;
      state.connection = null; state.replacing = false; state.confirming = false;
      state.error = action === 'check' ? 'We couldn’t read your connection. Check your network and try again.' : 'We couldn’t confirm that change. Check status before trying again. If the key was rejected, verify it in your provider dashboard.';
    } finally {
      if (active() && ticket === mine) {
        state.busy = '';
        draw(state.error ? '[data-account-error]' : !initiatedHere ? '' : action === 'check' ? '.workspace-account-status' : '[data-account-action], input');
      }
    }
  }
  const fundingHost = dialog.querySelector('[data-funded-account]');
  async function checkAccess() {
    const mine = ++accessTicket;
    const restoreFocus = fundingHost.contains(document.activeElement);
    legacyAllowed = false;
    dialog.querySelector('[data-legacy-account]').hidden = true;
    dialog.querySelector('[data-legacy-other]').hidden = true;
    fundingHost.innerHTML = '<p role="status">Checking your account…</p>';
    try {
      const access = await client.access(owner);
      if (!active() || mine !== accessTicket) return;
      if (!['legacy','platform'].includes(access?.mode)) throw new Error('Unknown access');
      legacyAllowed = access.mode === 'legacy' || recoverCredentials;
      fundingHost.innerHTML = access.mode === 'legacy' ? '' : `${fundedAccessHTML(access)}
        <div class="workspace-account-actions"><button type="button" class="auth-btn auth-btn--ghost" disabled aria-describedby="credit-tools-help">Add credits</button><button type="button" class="auth-btn auth-btn--ghost" disabled aria-describedby="credit-tools-help">Usage history</button></div>
        <p class="auth-note" id="credit-tools-help">Credit purchases and usage history are coming later. Nothing is charged from this screen.</p>
        <button type="button" class="auth-btn auth-btn--ghost" data-access-refresh>Refresh balance</button>`;
      dialog.querySelector('[data-legacy-account]').hidden = !legacyAllowed;
      dialog.querySelector('[data-legacy-other]').hidden = !legacyAllowed;
      if (access.mode === 'platform' && recoverCredentials) {
        dialog.querySelector('#workspace-claude-title').textContent = 'Connection for an older course';
        dialog.querySelector('[data-legacy-account] .auth-note').textContent = 'This connection is only for recovering older courses created with your own key. Connecting does not restart a course or enable credit-based creation.';
      }
      if (legacyAllowed) void run('check');
    } catch {
      if (!active() || mine !== accessTicket) return;
      fundingHost.innerHTML = `${fundedAccessHTML(null)}<button type="button" class="auth-btn auth-btn--ghost" data-access-refresh>Try again</button>`;
    } finally {
      if (active() && mine === accessTicket && restoreFocus) fundingHost.querySelector('[data-access-refresh]')?.focus({ preventScroll: true });
    }
  }
  fundingHost.addEventListener('click', event => {
    if (event.target.closest('[data-access-refresh]') && active()) void checkAccess();
  });
  dialog.querySelector('.auth-close').addEventListener('click', close);
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });
  host.addEventListener('submit', event => {
    if (!event.target.matches('[data-account-connect]')) return;
    event.preventDefault();
    if (state.busy || !active()) return;
    const input = host.querySelector('input'), key = input.value.trim();
    if (!key) { input.focus(); return; }
    input.value = '';
    void run({ key });
  });
  host.addEventListener('click', event => {
    const action = event.target.closest('[data-account-action]')?.dataset.accountAction;
    if (!action || !active() || state.busy) return;
    if (action === 'check' || action === 'disconnect') { void run(action); return; }
    state.replacing = action === 'replace'; state.confirming = action === 'confirm-disconnect';
    state.notice = '';
    draw(state.confirming ? '[data-account-action="keep"]' : state.replacing ? 'input' : '[data-account-action="replace"]');
  });
  dialog.querySelector('[data-account-signout]').addEventListener('click', async event => {
    if (state.busy || !active()) return;
    const button = event.currentTarget, error = dialog.querySelector('[data-account-signout-error]');
    button.disabled = true; error.hidden = true;
    state.busy = 'Signing out…'; draw();
    try { await signOut(); close(); }
    catch { if (active()) { state.busy = ''; draw(); error.hidden = false; error.textContent = 'Sign-out couldn’t be confirmed. Try again.'; error.focus(); } }
  });
  currentDialog = dialog; document.body.append(dialog); draw(); dialog.showModal();
  dialog.querySelector('h2').focus();
  void checkAccess();
  return { close };
}
