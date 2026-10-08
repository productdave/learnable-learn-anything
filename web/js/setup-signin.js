import { accountSetupURL, setupReturnURL } from './setup-handoff.js?v=6';
import { setupURL } from './setup-model.js?v=7';
import { escapeHome as esc } from './home-model.js?v=7';
import { setupAuthReturnProblem } from './setup-account-client.js?v=12';
import { briefTitle } from './brief-presentation.js?v=1';

// This is an interruption of Review, not a fifth step or a backup workflow.
export function createSetupSignIn({ sessions, handoffs, getUser, sendLink, navigate }) {
  const states = new Map();
  let dialog = null, events = null, timer = null, generation = 0;
  function dispose() {
    generation++;
    events?.abort(); clearInterval(timer);
    dialog?.close(); dialog?.remove(); dialog = null;
  }
  async function begin(target) {
    if (getUser()) return false;
    if (!await sessions.flush(target)) return false;
    if (getUser()) return false;
    if (!handoffs.begin(target.id, true)) throw new Error('We couldn’t preserve your return to this setup. Keep this tab open and try again.');
    navigate(accountSetupURL(target.id));
    return true;
  }
  function show(container, id, target) {
    dispose();
    if (getUser()) return;
    const attempt = generation;
    if (!states.has(id)) states.set(id, { email: '', sent: false, sending: false, nextSend: 0, error: '' });
    const state = states.get(id);
    dialog = document.createElement('dialog');
    dialog.className = 'home-experience setup-signin-dialog';
    dialog.setAttribute('aria-labelledby', 'setup-signin-title');
    dialog.setAttribute('aria-describedby', 'setup-signin-description setup-signin-next');
    container.append(dialog);
    const live = () => attempt === generation && dialog?.isConnected && !getUser();
    const close = () => { navigate(setupURL(id, 'review')); };
    const countdown = () => {
      if (!live() || !state.sent) return;
      const seconds = Math.max(0, Math.ceil((state.nextSend - Date.now()) / 1000));
      const button = dialog.querySelector('[data-signin-resend]');
      if (button) button.disabled = state.sending || seconds > 0;
      const status = dialog.querySelector('[data-signin-countdown]');
      if (status) status.textContent = seconds ? `Resend available in ${seconds}s.` : 'No email? Check spam or request another link.';
    };
    const paint = () => {
      if (!live()) return;
      dialog.innerHTML = `<div class="setup-card setup-signin-content">
        <button type="button" class="setup-signin-close" data-signin-close aria-label="Close sign-in">×</button>
        <h2 id="setup-signin-title" tabindex="-1">${state.sent ? 'Check your email' : 'Sign in to create your course'}</h2>
        <p id="setup-signin-description">${state.sent ? `We sent a sign-in link to <strong>${esc(state.email)}</strong>. Your course setup is still here.` : 'Sign in so we know which account to save your course to. Your setup stays here while you sign in.'}</p>
        ${target ? `<p class="setup-signin-topic"><span>Course you’re creating</span><strong>${esc(briefTitle(target.draft.brief.topic, 'Your course'))}</strong></p>` : '<p>For an unfinished setup, use the browser where you started. An email link alone doesn’t transfer your notes or files.</p>'}
        <div class="setup-signin-next"><h3>What happens next</h3><p id="setup-signin-next">${target ? state.sent ? 'Open the link in this browser. You’ll return to Review with your details filled in, then click Create course to continue.' : 'We’ll email you a sign-in link. Open it in this browser to return to Review, then click Create course to continue.' : 'After sign-in, we’ll try to reopen this setup. If you started it in another browser, return there to continue.'}</p></div>
        ${state.sent ? `<button type="button" class="home-button" data-signin-resend>Resend sign-in link</button><p class="source-help" data-signin-countdown></p><button type="button" class="home-draft-link" data-signin-change>Use a different email</button>` : `<form data-setup-signin novalidate><label for="setup-email">Email address</label><input id="setup-email" type="email" autocomplete="email" required value="${esc(state.email)}" placeholder="you@example.com" aria-describedby="setup-signin-error"><button class="home-button" type="submit" ${state.sending ? 'disabled' : ''}>${state.sending ? 'Sending…' : 'Continue with email'}</button><p class="source-help">New to Learnable? The same link creates your account. No password needed.</p></form>`}
        <p id="setup-signin-error" class="setup-field-error" role="status">${esc(state.error || (!state.sent ? setupAuthReturnProblem() : ''))}</p>
        <button type="button" class="home-draft-link" data-signin-close>Back to review</button>
      </div>`;
      countdown();
    };
    async function send() {
      if (!live() || state.sending || Date.now() < state.nextSend) return;
      const email = state.email.trim();
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        state.error = 'Enter a complete email address.'; paint();
        dialog.querySelector('#setup-email')?.setAttribute('aria-invalid', 'true');
        dialog.querySelector('#setup-email')?.focus(); return;
      }
      state.sending = true; state.error = ''; paint();
      try {
        if (target && !await sessions.flush(target)) throw new Error('We couldn’t preserve your latest edits. Return to review and retry before opening your email.');
        if (!live()) return;
        if (!handoffs.begin(id, target?.owner === null)) throw new Error('We couldn’t preserve your return to this setup. Keep this tab open and try again.');
        await sendLink(email, setupReturnURL(id, location.origin));
        state.email = email; state.sent = true; state.nextSend = Date.now() + 60000;
      } catch (error) { state.error = error.message || 'Couldn’t send the link. Your setup is still here. Please try again.'; }
      finally {
        state.sending = false;
        if (live()) { paint(); dialog.querySelector(state.sent ? 'h2' : '#setup-email')?.focus(); }
      }
    }
    events = new AbortController(); const signal = events.signal;
    dialog.addEventListener('cancel', event => { event.preventDefault(); close(); }, { signal });
    dialog.addEventListener('input', event => { if (event.target.id === 'setup-email') state.email = event.target.value; }, { signal });
    dialog.addEventListener('submit', event => { event.preventDefault(); void send(); }, { signal });
    dialog.addEventListener('click', event => {
      if (event.target.closest('[data-signin-close]')) close();
      if (event.target.closest('[data-signin-resend]')) void send();
      if (event.target.closest('[data-signin-change]') && !state.sending) { state.sent = false; state.error = ''; paint(); dialog.querySelector('#setup-email')?.focus(); }
    }, { signal });
    paint(); dialog.showModal(); dialog.querySelector('h2')?.focus();
    timer = setInterval(countdown, 1000);
  }
  return { begin, show, dispose, forget: id => states.delete(id) };
}
