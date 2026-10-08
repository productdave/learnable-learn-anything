import { sb } from './auth.js?v=33';
import { createCourseImageClient } from './course-image-client.js?v=5';

const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const errors = {
  credentials: 'OpenAI did not accept that key. Check it and try again.',
  access: 'This key cannot access the configured image model. Check its model permissions and your OpenAI account verification.',
  disabled: 'OpenAI connections are not enabled on this server yet. Your key was not saved.',
  account: 'Your sign-in changed. Sign in again before connecting a key.',
};

export async function mountOpenAIConnection(root, { getClient = sb, makeClient = createCourseImageClient } = {}) {
  let user = null, client, api, busy = false, connected = false, checked = false, enabled = false;
  let loading = true, error = '', notice = '', sent = false, replacing = false, epoch = 0, subscription, disposed = false;
  const clearKey = () => { const field = root.querySelector('#openai-key'); if (field) field.value = ''; };
  function paint() {
    if (disposed) return;
    root.setAttribute('aria-busy', String(loading || busy));
    if (loading) { root.innerHTML = '<p role="status">Checking your connection…</p>'; return; }
    root.innerHTML = `${error ? `<p class="error" role="alert">${esc(error)}</p>` : ''}${notice ? `<p class="success" role="status">${esc(notice)}</p>` : ''}
      ${!user ? `<h2>First, sign in to Learnable</h2><p>Use the account where your course is saved. We’ll email you a link that brings you back here.</p>
        ${sent ? '<p class="status" role="status">Check your inbox and spam folder. Open the sign-in link in this browser to continue.</p><button class="secondary" data-action="check" type="button">I’ve signed in — check again</button><p class="help">If the link opens another tab, continue there. For a new link, return to this page after a minute.</p>' : `<form data-form="signin"><label for="connection-email">Email address</label><input id="connection-email" type="email" autocomplete="email" placeholder="you@example.com" required ${busy ? 'disabled' : ''}><button type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Sending link…' : 'Send sign-in link'}</button></form>`}` : `
        <p class="account">Signed in as <strong>${esc(user.email)}</strong></p>
        ${!checked ? '<button class="secondary" data-action="check" type="button">Check connection again</button>' : connected && !replacing ? `<h2 class="connected">✓ OpenAI is connected</h2><p>Your key is saved securely. No image has been generated.</p><button class="link-button" data-action="replace" type="button">Replace your key</button><br><button class="link-button" data-action="disconnect" type="button" ${busy ? 'disabled' : ''}>${busy ? 'Disconnecting…' : 'Disconnect OpenAI'}</button>` : `<form data-form="connect"><label for="openai-key">OpenAI API key</label><input id="openai-key" type="password" autocomplete="off" spellcheck="false" autocapitalize="off" maxlength="503" placeholder="sk-…" required aria-describedby="key-help" ${busy ? 'disabled' : ''}><p class="help" id="key-help">Only enter your key here, not in a chat. <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">Get an OpenAI API key ↗</a></p><button type="submit" ${busy ? 'disabled' : ''}>${busy ? 'Checking and saving…' : connected ? 'Replace connection' : 'Connect OpenAI'}</button>${replacing ? '<button class="link-button" data-action="cancel-replace" type="button">Keep current connection</button>' : ''}</form>`}
        ${checked ? `<p class="status">${enabled ? 'Connecting does not start generation. Review and confirm image requests separately in your course.' : 'Image generation is currently off. You can connect your key now; no images will be generated from this screen.'}</p>` : ''}
        <div class="actions"><a href="/?filter=mine">Return to your courses →</a></div>`}`;
  }
  async function refresh(nextUser) {
    const run = ++epoch;
    clearKey(); user = nextUser; loading = true; connected = false; checked = false; replacing = false; busy = false; paint();
    try {
      if (user) {
        const result = await api.connection(user.id);
        if (run !== epoch || disposed) return;
        connected = result.connected === true; enabled = result.generationEnabled === true; checked = true;
      }
    } catch (e) { if (run === epoch) error = errors[e.code] || 'We couldn’t check your saved connection. Check again before entering a key.'; }
    finally { if (run === epoch && !disposed) { loading = false; paint(); } }
  }
  root.addEventListener('submit', async event => {
    event.preventDefault(); if (busy || loading || disposed) return;
    const form = event.target.dataset.form, owner = user?.id, run = epoch;
    if (form === 'signin') {
      const email = root.querySelector('#connection-email').value.trim();
      busy = true; error = notice = ''; paint();
      try {
        const result = await client.auth.signInWithOtp({ email, options: { shouldCreateUser: false, emailRedirectTo: location.origin + location.pathname } });
        if (result.error) throw new Error();
        if (run === epoch) sent = true;
      } catch { if (run === epoch) error = 'We couldn’t send a link. Check your email address and try again in a minute.'; }
    } else if (form === 'connect' && owner) {
      let key = root.querySelector('#openai-key').value.trim(); clearKey();
      if (!/^sk-(?!ant-)[A-Za-z0-9_-]{20,500}$/.test(key)) { key = ''; error = 'Enter a complete OpenAI API key beginning with sk-.'; paint(); root.querySelector('#openai-key')?.focus(); return; }
      busy = true; error = notice = ''; paint();
      try {
        const result = await api.connect(owner, key);
        if (run !== epoch || user?.id !== owner || disposed) return;
        connected = result.connected === true; enabled = result.generationEnabled === true; replacing = false;
        notice = 'Connection saved. No image has been generated or charged.';
      } catch (e) { if (run === epoch) { error = errors[e.code] || 'We couldn’t confirm the save. Use “Check connection again” before replacing your key.'; checked = false; } }
      finally { key = ''; }
    }
    if (run === epoch && !disposed) { busy = false; paint(); }
  });
  root.addEventListener('click', async event => {
    const action = event.target.closest('[data-action]')?.dataset.action;
    if (!action || busy || loading || disposed) return;
    error = notice = '';
    if (action === 'replace' || action === 'cancel-replace') { clearKey(); replacing = action === 'replace'; paint(); root.querySelector('#openai-key')?.focus(); return; }
    if (action === 'check') { const { data, error: authError } = await client.auth.getSession(); if (authError) { error = 'Couldn’t check your sign-in. Reload this page and try again.'; paint(); return; } return refresh(data?.session?.user || null); }
    if (action === 'disconnect') {
      const owner = user?.id, run = epoch; busy = true; paint();
      try { await api.disconnect(owner); if (run === epoch) { connected = false; notice = 'OpenAI disconnected. Your saved course is unchanged.'; } }
      catch { if (run === epoch) { error = 'The disconnect could not be confirmed. Check the connection again.'; checked = false; } }
      finally { if (run === epoch) { busy = false; paint(); } }
    }
  });
  const dispose = () => { disposed = true; epoch++; clearKey(); subscription?.unsubscribe(); };
  window.addEventListener('pagehide', dispose, { once: true });
  paint();
  try {
    client = await getClient(); if (!client) throw new Error();
    api = makeClient({ getIdentity: () => user, getClient: async () => client });
    const { data, error: authError } = await client.auth.getSession(); if (authError) throw new Error();
    const callbackError = /(?:error|error_code)=/.test(location.hash);
    if (location.hash) history.replaceState(null, '', location.pathname + location.search);
    if (callbackError) error = 'That sign-in link expired or has already been used. Request a fresh link below.';
    await refresh(data?.session?.user || null);
    subscription = client.auth.onAuthStateChange((_event, session) => {
      if ((session?.user?.id || null) !== user?.id && !(!session?.user && !user)) {
        const next = session?.user || null;
        clearKey(); epoch++; user = next; loading = true; paint();
        setTimeout(() => { if (!disposed && user === next) { error = notice = ''; refresh(next); } }, 0);
      }
    }).data.subscription;
  } catch { loading = false; error = 'We couldn’t load secure sign-in. Check your connection and reload this page.'; paint(); }
  return dispose;
}

if (typeof document !== 'undefined') {
  const root = document.getElementById('openai-connection');
  if (root) void mountOpenAIConnection(root);
}
