import { draftExport } from './draft-store.js?v=3';
import { accountSetupURL, setupReturnURL } from './setup-handoff.js?v=1';
import { setupURL, sourceCounts, setupIssues } from './setup-model.js?v=7';
import { escapeHome as esc, homeURL } from './home-model.js?v=4';
import { setupAuthReturnProblem } from './setup-account-client.js?v=1';

const home = homeURL({ filter: 'mine' });
export function createSetupAccountController({ sessions, handoffs, getUser, client, sendLink, signOut, navigate }) {
  let host = null, session = null, id = '', version = 0, events = null, timer = null, busy = false;
  const views = new Map();
  const current = () => views.get(id);
  function dispose() { host = null; session = null; version++; events?.abort(); clearInterval(timer); }
  function paint() {
    if (!host) return;
    const state = current(), user = getUser();
    const signedIn = !!user;
    const canRead = session && (session.owner === (user?.id || null) || (!session.owner && handoffs.read(id)?.guest));
    const counts = canRead ? sourceCounts(session.draft) : null;
    const summary = canRead ? `<div class="setup-account-summary"><span class="home-eyebrow">Selected setup</span><h2>${esc(briefTitle(session.draft.brief.topic))}</h2>${briefPreviewHTML(session.draft.brief.topic, { label: 'course description' })}${briefPreviewHTML(session.draft.brief.audience, { label: 'audience' })}<p>${counts.notes} ${counts.notes === 1 ? 'note' : 'notes'} · ${counts.links} ${counts.links === 1 ? 'link' : 'links'} · ${counts.files} ${counts.files === 1 ? 'file' : 'files'}</p></div>` : '';
    const missing = signedIn && !canRead;
    const issue = state.error || (!user && !state.sent ? setupAuthReturnProblem() : '');
    const identity = signedIn ? `<div class="setup-identity"><span>Signed in as</span><strong>${esc(user.email || 'Your current account')}</strong><button type="button" class="home-draft-link" data-account-action="switch" ${state.saving ? 'disabled' : ''}>Switch account</button></div>` : '';
    const backup = session?.record?.cloud;
    const content = missing ? `<h2>This browser doesn’t have the selected setup</h2><p>If you opened your email on another device, return to the browser where you started. A sign-in link doesn’t transfer local notes or files. The original browser may still need sign-in.</p><p>The setup may also have expired, or belong to a different account. No other local draft will be imported automatically.</p><a class="home-button" href="${home}">Open Your Courses</a>`
      : state.success ? `<div class="setup-ready"><span aria-hidden="true">✓</span><div><h2>Saved to your account</h2><p>This revision and ${counts?.files || 0} original files are backed up privately. No course has been generated or published.</p></div></div><p data-account-success-detail>${esc(state.success)}</p><a class="home-button" href="${home}">Return to Your Courses →</a>`
      : signedIn ? `<h2>Save this setup to your account?</h2><p>Save only this setup, its notes, links and original files. It stays private. Other device drafts won’t be imported.</p>${backup ? `<p class="source-help">An account backup exists (revision ${backup.revision}). Save again to back up your current device edits.</p>` : ''}<p class="source-help">After you confirm, the recovery copy on this browser belongs to this account. Sign in to the same account if a transfer fails.</p><button type="button" class="home-button" data-account-action="save" ${state.saving ? 'disabled' : ''}>${state.saving ? 'Saving to your account…' : 'Save setup to this account'}</button>${state.conflict ? '<button type="button" class="home-button home-button--secondary" data-account-action="copy">Make a separate setup copy</button>' : ''}`
      : `<h2>${state.sent ? 'Check your email' : 'Sign in to save your setup'}</h2><p>${state.sent ? `We sent a sign-in link to <strong>${esc(state.email)}</strong>. Open it in this browser to continue with your device draft.` : 'We’ll email you a sign-in link—no password. You’ll confirm the account before anything is uploaded.'}</p>${state.sent ? `<div class="setup-account-actions"><button type="button" class="home-button" data-account-action="resend" ${state.sending || Date.now() < state.nextSend ? 'disabled' : ''}>${state.sending ? 'Sending…' : 'Resend sign-in link'}</button><button type="button" class="home-draft-link" data-account-action="change">Change email</button></div><p data-resend-wait class="source-help"></p><p class="source-help">Already opened the link? This page updates when this browser signs in. You can keep editing while you wait.</p>` : `<form data-setup-signin><label for="setup-email">Email address</label><input id="setup-email" type="email" autocomplete="email" required value="${esc(state.email)}" aria-describedby="setup-auth-message" placeholder="you@example.com"><button class="home-button" type="submit" ${state.sending ? 'disabled' : ''}>${state.sending ? 'Sending…' : 'Email me a sign-in link'}</button></form>`}`;
    host.innerHTML = `<div class="home-experience course-setup" data-account-root><a class="home-back" href="${esc(setupURL(id, 'review'))}">← Review setup</a><header class="setup-heading"><span class="home-eyebrow">Save and continue later</span><h1 tabindex="-1">Keep your setup across devices</h1><p>Signing in, saving your setup and generating a course are separate choices.</p></header><div class="setup-card setup-account-card">${summary}${identity}<div data-account-content>${content}</div><p id="setup-auth-message" class="setup-field-error" role="status">${esc(issue)}</p>${state.files.length ? `<ul class="setup-transfer-list" aria-label="Original file transfers">${state.files.map(file => `<li><span>${esc(file.name)}</span><strong>${esc(file.status)}</strong></li>`).join('')}</ul>` : ''}<div class="setup-account-footer">${canRead ? `<a class="home-draft-link" href="${esc(setupURL(id, 'review'))}">Keep editing</a><button type="button" class="home-draft-link" data-account-action="download">Download text backup</button>` : `<a class="home-draft-link" href="${home}">Back to Your Courses</a>`}</div></div><aside class="setup-boundary"><h2>Generation is a separate next step</h2><p>This preview adds private setup backups. Provider setup, source processing and explicit generation confirmation are the next phase. Saving will not start AI work or charge a provider.</p></aside></div>`;
    updateCountdown();
  }
  function updateCountdown() {
    if (!host || !current()?.sent) return;
    const seconds = Math.max(0, Math.ceil((current().nextSend - Date.now()) / 1000));
    const text = host.querySelector('[data-resend-wait]');
    if (text) text.textContent = seconds ? `You can request another link in ${seconds}s. The email service may apply a longer limit.` : 'If the email hasn’t arrived, check spam or request another link.';
    const resend = host.querySelector('[data-account-action="resend"]');
    if (resend) resend.disabled = !!seconds || current().sending;
  }
  async function render(container, setupId) {
    dispose(); host = container; id = setupId;
    document.title = 'Save setup | Learnable';
    const attempt = version, owner = getUser()?.id || null;
    if (!views.has(id)) views.set(id, { email: '', sent: false, sending: false, nextSend: 0, error: '', files: [], saving: false, success: '', conflict: false });
    // Successful UI is owner-scoped too; never reuse another account's success.
    if (current().owner !== owner) {
      if (current().owner) { current().email = ''; current().sent = false; }
      current().success = ''; current().error = ''; current().files = []; current().conflict = false; current().owner = owner;
    }
    container.innerHTML = '<div class="home-experience home-loading" role="status">Opening selected setup…</div>';
    let result;
    try {
      result = await sessions.open(id);
      if (owner && result.status === 'missing' && handoffs.read(id)?.guest) result = await sessions.selectedGuest(id);
      if (owner && ['missing', 'expired'].includes(result.status)) {
        try {
          const backup = await client.restore(owner, id);
          if (attempt !== version || owner !== (getUser()?.id || null)) return;
          const restored = await sessions.restoreAccount(id, backup.draft, backup.cloud);
          if (restored) result = { status: 'found', session: restored };
        } catch (error) { if (error.code !== 'missing') current().error = error.message; }
      }
    } catch (error) { result = { status: 'unavailable' }; }
    if (attempt !== version || owner !== (getUser()?.id || null)) return;
    session = result.status === 'found' ? result.session : null;
    if (current().success && session?.record?.revision !== current().savedLocalRevision) { current().success = ''; current().files = []; }
    if (result.status === 'unavailable' || result.status === 'unsaved-guest') current().error = 'The selected setup could not be recovered safely. Keep the original tab open, return to editing and retry device saving before signing in.';
    if (result.status === 'expired') current().error = 'The local setup expired. Your downloaded text backup, if any, is separate from sign-in.';
    events = new AbortController(); const signal = events.signal;
    host.addEventListener('input', event => { if (event.target.id === 'setup-email') current().email = event.target.value; }, { signal });
    host.addEventListener('submit', event => { if (event.target.matches('[data-setup-signin]')) { event.preventDefault(); void send(); } }, { signal });
    host.addEventListener('click', async event => {
      const action = event.target.closest('[data-account-action]')?.dataset.accountAction;
      if (!action) return;
      if (action === 'download' && session) {
        const url = URL.createObjectURL(new Blob([draftExport(session.draft)], { type: 'application/json' }));
        const link = document.createElement('a'); link.href = url; link.download = 'learnable-setup.json'; link.click(); setTimeout(() => URL.revokeObjectURL(url), 2000); return;
      }
      if (action === 'resend') { if (Date.now() >= current().nextSend) void send(); return; }
      if (action === 'change') { current().sent = false; paint(); host.querySelector('#setup-email')?.focus(); return; }
      if (busy) return;
      if (action === 'switch') { try { await signOut(); } catch { current().error = 'Couldn’t sign out. Try again before choosing another account.'; paint(); } return; }
      if (action === 'save') void save();
      if (action === 'copy' && session?.owner === getUser()?.id) {
        busy = true; const target = session;
        try { const copy = await sessions.fork(target); if (copy && attempt === version) { handoffs.begin(copy.id, false); navigate(accountSetupURL(copy.id)); } }
        finally { busy = false; }
      }
    }, { signal });
    paint(); window.scrollTo({ top: 0, behavior: 'instant' }); host.querySelector('h1')?.focus({ preventScroll: true });
    timer = setInterval(updateCountdown, 1000);
  }
  async function send() {
    const state = current(), attempt = version, selectedId = id;
    const target = session, email = state.email.trim();
    if (state.sending || getUser()) return;
    if (!state.email.trim() || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(state.email.trim())) { state.error = 'Enter a complete email address.'; paint(); host.querySelector('#setup-email')?.focus(); return; }
    if (Date.now() < state.nextSend) { state.error = 'Please wait before requesting another link.'; paint(); return; }
    state.sending = true; state.error = ''; paint();
    try {
      if (target && !await sessions.flush(target)) throw new Error('Save your device draft first. Keep this tab open, retry saving or download your text before leaving for email.');
      if (attempt !== version || getUser()) return;
      if (!handoffs.begin(selectedId, target?.owner === null)) throw new Error('This browser could not save the return address. Keep editing here or enable browser storage before requesting a sign-in link.');
      await sendLink(email, setupReturnURL(selectedId, location.origin));
      state.email = email; state.sent = true; state.nextSend = Date.now() + 60000;
    } catch (error) { state.error = error.message || 'Couldn’t send the link. Your draft is still here.'; }
    finally { state.sending = false; if (attempt === version && !getUser()) { paint(); const focus = host.querySelector(state.sent ? '[data-account-content] h2' : '#setup-email'); focus?.setAttribute('tabindex', '-1'); focus?.focus(); } }
  }
  async function save() {
    const state = current(), owner = getUser()?.id, attempt = version, selectedId = id;
    let target = session;
    if (busy || !owner || !target) return;
    busy = true; state.saving = true; state.error = ''; state.conflict = false; state.success = ''; paint();
    try {
      const issue = setupIssues(target.draft)[0]; if (issue) throw new Error(issue.text + ' Return to editing to fix it.');
      if (!target.owner) {
        if (!handoffs.read(selectedId)?.guest) throw new Error('The sign-in handoff expired. Return to your original guest setup before attaching it.');
        target = await sessions.claim(target); handoffs.clear(selectedId);
      } else if (target.owner !== owner) throw new Error('Switch back to the account that owns this setup.');
      if (getUser()?.id !== owner) throw new Error('Your account changed. No new account was selected automatically.');
      if (attempt === version) session = target;
      if (!await sessions.flush(target)) throw new Error('Your local recovery copy could not be saved. Keep this tab open and retry device saving first.');
      const snapshot = structuredClone(target.draft), savingVersion = target.version;
      const ack = await client.save(owner, selectedId, snapshot, target.record?.cloud?.revision || 0, files => { if (state.owner !== owner) return; state.files = files; if (attempt === version && getUser()?.id === owner) paint(); });
      if (getUser()?.id !== owner) return;
      const retained = await sessions.acknowledge(target, ack);
      if (getUser()?.id !== owner || state.owner !== owner) return;
      state.savedLocalRevision = target.record?.revision;
      state.success = retained ? `Account backup revision ${ack.revision}. Later edits on this device need another explicit save.` : 'Account backup confirmed, but its device acknowledgement could not be saved. Keep this tab open and retry; the server will recognize the same revision.';
      state.files = snapshot.sources.files.map(file => ({ name: file.name, status: 'Saved to account' }));
      if (target.version !== savingVersion + 1) { state.success = ''; state.error = 'The earlier revision was saved to your account. Newer device edits were not included; save again to back them up.'; }
    } catch (error) { if (state.owner === owner) { state.error = error.message || 'The account save could not be confirmed. Keep your device copy and retry.'; state.conflict = error.code === 'conflict'; } }
    finally { busy = false; state.saving = false; if (attempt === version && getUser()?.id === owner) { paint(); const focus = host.querySelector(state.success ? '[data-account-content] h2' : '#setup-auth-message'); focus?.setAttribute('tabindex', '-1'); focus?.focus(); } }
  }
  return {
    render, dispose,
    async begin(target) {
      const attempt = version;
      if (!await sessions.flush(target)) return false;
      if (attempt !== version) return false;
      handoffs.begin(target.id, !target.owner); navigate(accountSetupURL(target.id)); return true;
    }
  };
}
import { briefTitle, briefPreviewHTML } from './brief-presentation.js?v=1';
