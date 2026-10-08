import { escapeHome as esc } from './home-model.js?v=7';
import { setupURL, sourceCounts } from './setup-model.js?v=7';
import { renderSetupSourceReview } from './setup-source-review.js?v=5';
import { componentSummaryHTML, mountCourseImageInfo } from './setup-components.js?v=10';
import { createCourseImageClient } from './course-image-client.js?v=5';
import { briefTitle, briefPreviewHTML } from './brief-presentation.js?v=1';

export const creationURL = id => `?draft=${encodeURIComponent(id)}&step=create`;

// A saved request and a provider connection do not themselves authorize a run.
// Only the explicit Create course action calls the metered start endpoint.
export function createSetupCreation({ sessions, getUser, accountClient, client, navigate, openJob, imageClient = createCourseImageClient() }) {
  let state = null, version = 0, events = null, connectionEvents = null;
  const active = current => state === current && current.version === version && getUser()?.id === current.session.owner;
  function dispose() { version++; events?.abort(); connectionEvents?.abort(); connectionEvents = null; events = null; state = null; }
  function refreshConnection(current) {
    if (!active(current)) return;
    current.connectionDirty = true;
    current.check = null; // Never leave a stale paid-start action enabled.
    if (current.busy) return; // Reconcile after the in-flight check/save settles.
    void task(current, 'Rechecking your AI connections…', async () => {
      current.connectionDirty = false;
      await check(current);
    });
  }
  async function check(current) {
    const result = await client.check(current.session.owner, current.session.id, current.revision);
    if (!active(current)) return;
    if (result.existing) { await openJob(result.jobId, current.session.owner); return; }
    let openAI;
    try { openAI = await imageClient.connection(current.session.owner); }
    catch (error) { openAI = { connected: false, error: error.message || 'Couldn’t check OpenAI. Try again before creating your course.' }; }
    if (!active(current)) return;
    current.check = { ...result, openAI, ready: result.ready && openAI.connected === true && openAI.generationEnabled !== false };
    if (current.reviewedDigest !== result.sources?.digest) current.reviewedDigest = '';
  }
  async function task(current, label, fn) {
    if (!active(current) || current.busy) return;
    current.busy = label; current.error = ''; draw(current);
    try { await fn(); }
    catch (error) { if (active(current)) { current.error = error.message || 'Couldn’t continue. Please retry.'; if (error.readiness) { current.check = error.readiness; current.reviewedDigest = ''; } } }
    finally {
      if (active(current)) {
        current.busy = '';
        if (current.connectionDirty) { refreshConnection(current); return; }
        draw(current);
        const nextFocus = current.error ? '[data-creation-error]' : current.check?.sources?.requiresReview && !current.reviewedDigest ? '[data-source-reviewed]' : current.check?.ready ? '[data-create-action="start"]' : 'h1';
        if (!document.querySelector('dialog[open]')) (current.host.querySelector(nextFocus) || current.host.querySelector('h1'))?.focus({ preventScroll: true });
      }
    }
  }
  async function prepare(current) {
    await task(current, 'Saving your request and checking what’s needed…', async () => {
      const session = current.session;
      if (!await sessions.flush(session)) throw new Error('Your latest edits couldn’t be saved. Return to Review to recover them before continuing.');
      if (!active(current)) return;
      const snapshotVersion = session.version;
      const saved = await accountClient.save(session.owner, session.id, structuredClone(session.draft), session.record?.cloud?.revision || 0);
      if (!active(current)) return;
      if (snapshotVersion !== session.version) throw new Error('Your setup changed while it was being saved. Return to Review to check the latest version.');
      const acknowledged = await sessions.acknowledge(session, saved);
      if (!active(current)) return;
      if (!acknowledged) throw new Error('Your request reached your account, but this tab couldn’t record the confirmation. Return to Review and retry.');
      current.revision = saved.revision;
      current.busy = session.draft.sources.files.length ? 'Reading your source files and checking what’s needed…' : 'Checking what’s needed…'; draw(current);
      await check(current);
    });
  }
  function draw(current) {
    if (!active(current)) return;
    events?.abort(); events = new AbortController();
    const { session, host, check: readiness, busy, error } = current;
    const counts = sourceCounts(session.draft), disabled = busy ? 'disabled' : '';
    const reviewed = !!readiness?.sources?.digest && current.reviewedDigest === readiness.sources.digest;
    const needsReview = readiness?.sources?.requiresReview && !reviewed;
    document.title = 'Create your course | Learnable';
    host.innerHTML = `<div class="home-experience course-setup setup-creation">
      <a class="home-back" href="${esc(setupURL(session.id, 'review'))}">← Back to Review</a>
      <header class="setup-heading"><span class="home-eyebrow">Ready for the next step</span><h1 tabindex="-1">Let’s create your course</h1><p>Review the plan and research as we go. Then Learnable creates your lessons, learning tools and useful images in one flow.</p></header>
      <section class="setup-card" aria-label="Creation checks"><h2>${esc(briefTitle(session.draft.brief.topic))}</h2>
        ${briefTitle(session.draft.brief.topic) !== session.draft.brief.topic ? briefPreviewHTML(session.draft.brief.topic, { label: 'course description' }) : ''}
        <p>${counts.notes} ${counts.notes === 1 ? 'note' : 'notes'} · ${counts.links} ${counts.links === 1 ? 'link' : 'links'} · ${counts.files} ${counts.files === 1 ? 'file' : 'files'}</p>
        ${componentSummaryHTML(session.draft.components)}
        <p class="source-help">${current.revision ? 'Request saved' : 'Saving this request'} to <strong>${esc(getUser()?.email || 'your account')}</strong>. No AI work starts until you confirm below.</p>
        <p role="status" aria-live="polite">${esc(busy)}</p>
        <p class="setup-field-error" data-creation-error role="alert" tabindex="-1">${esc(error)}</p>
        ${readiness ? `${!readiness.enabled ? '<div class="home-notice home-notice--warning"><strong>Course creation is paused on this server.</strong><p>Your setup is saved. Creation is temporarily unavailable; this is not a problem with your API key. No generation has started and no AI charge has been made. Select Check again when creation is available to continue.</p></div>' : ''}
          ${readiness.issues.filter(issue => !issue.fileId).length ? `<section class="setup-create-issues"><h3>Before creation can start</h3><p>Your setup stays saved while these items are resolved.</p><ul>${readiness.issues.filter(issue => !issue.fileId).map(issue => `<li>${esc(issue.text)} ${issue.step !== 'create' ? `<a class="home-draft-link" href="${esc(setupURL(session.id, issue.step))}">Edit ${esc(issue.step)}</a>` : ''}</li>`).join('')}</ul></section>` : ''}
          ${renderSetupSourceReview(readiness.sources, { reviewed, busy: !!busy, contextURL: setupURL(session.id, 'context') })}
          <section class="setup-create-provider"><h3>${readiness.connected ? 'Claude is connected' : 'Connect Claude for course writing'}</h3>
          <p>${readiness.connected ? `Using ${esc(readiness.model)}. Your key stays on the server, encrypted at rest.` : 'Learnable uses your own Claude API account. Connect it once to create your course. Checking the connection does not generate content.'}</p>
          ${readiness.connected ? `<button type="button" class="home-draft-link" data-create-action="disconnect" ${disabled}>Disconnect Claude</button>` : `<form data-connection-form><div class="setup-field"><label for="setup-provider-key">Claude API key</label><input id="setup-provider-key" name="api-key" type="password" autocomplete="off" spellcheck="false" required placeholder="sk-ant-…" aria-describedby="setup-key-help" ${disabled}><p id="setup-key-help" class="source-help">Stored encrypted on the server, never in your course or browser storage. You can disconnect it here.</p></div><button class="home-button" type="submit" ${disabled}>Connect Claude</button></form><a class="home-draft-link" href="https://platform.claude.com/settings/keys" target="_blank" rel="noopener noreferrer">Get a Claude API key ↗</a>`}
          </section>
          <section class="setup-create-provider"><h3>${readiness.openAI?.connected ? 'OpenAI is connected' : 'Connect OpenAI for instructional images'}</h3><p>When an image helps explain a lesson, Learnable creates and saves it automatically with the course. Your OpenAI account pays for these images.</p>
          ${readiness.openAI?.error ? `<p class="setup-field-error" role="status">${esc(readiness.openAI.error)}</p>` : ''}
          ${readiness.openAI?.generationEnabled === false ? '<p class="setup-field-error">Image generation is unavailable on this server. Your setup is saved; check again when creation is enabled.</p>' : ''}
          ${readiness.openAI?.connected ? `<p class="source-help">Your key is encrypted on the server. Checking this connection does not generate an image.</p><button type="button" class="home-draft-link" data-create-action="disconnect-images" ${disabled}>Disconnect OpenAI</button>` : `<form data-image-connection-form><div class="setup-field"><label for="setup-image-provider-key">OpenAI API key</label><input id="setup-image-provider-key" type="password" autocomplete="off" spellcheck="false" required placeholder="sk-…" aria-describedby="setup-image-key-help" ${disabled}><p id="setup-image-key-help" class="source-help">Stored encrypted on the server, never in course content or browser storage. Connecting does not create images.</p></div><button class="home-button" type="submit" ${disabled}>Connect OpenAI</button></form>`}</section>
          ${readiness.ready ? '<aside class="setup-create-consent"><h3>What happens when you create?</h3><p>Your request and source text go to Claude, and supplied links are fetched. Lesson-specific illustration descriptions go to OpenAI. Creating your course includes these text and image charges to your connected provider accounts.</p><p>We’ll pause for your course plan and research reviews, then create the complete draft, including useful images. No separate image approvals are needed. The draft stays private for you to review.</p></aside>' : ''}` : ''}
        ${error && readiness?.ready ? `<button class="home-draft-link" type="button" data-create-action="retry" ${disabled}>Recheck sources and connection</button>` : ''}
        <footer class="setup-footer"><a class="home-button home-button--secondary" href="${esc(setupURL(session.id, 'review'))}">Keep editing</a><button class="home-button${readiness?.ready ? '' : ' home-button--secondary'}" type="button" data-create-action="${readiness?.ready ? 'start' : 'retry'}" ${busy || (readiness?.ready && needsReview) ? 'disabled' : ''} ${readiness?.ready && needsReview ? 'aria-describedby="source-review-next"' : ''}>${busy ? 'Please wait…' : readiness?.ready ? 'Create course →' : 'Check again'}</button></footer>
      </section></div>`;
    mountCourseImageInfo(host, { signal: events.signal });
    host.addEventListener('change', event => {
      if (!event.target.matches('[data-source-reviewed]') || !active(current) || current.busy) return;
      current.reviewedDigest = event.target.checked ? current.check?.sources?.digest || '' : '';
      const button = host.querySelector('[data-create-action="start"]');
      if (button) { button.disabled = !current.reviewedDigest; if (current.reviewedDigest) button.removeAttribute('aria-describedby'); else button.setAttribute('aria-describedby', 'source-review-next'); }
    }, { signal: events.signal });
    host.addEventListener('submit', event => {
      if (event.target.matches('[data-image-connection-form]')) {
        event.preventDefault();
        const input = host.querySelector('#setup-image-provider-key'), key = input.value.trim();
        if (!key) { input.focus(); return; }
        input.value = '';
        void task(current, 'Checking your OpenAI connection…', async () => {
          await imageClient.connect(session.owner, key);
          if (active(current)) await check(current);
        });
        return;
      }
      if (!event.target.matches('[data-connection-form]')) return;
      event.preventDefault();
      const input = host.querySelector('#setup-provider-key'), key = input.value.trim();
      if (!key) { input.focus(); return; }
      input.value = '';
      void task(current, 'Checking your Claude connection…', async () => {
        await client.connect(session.owner, key);
        if (active(current)) await check(current);
      });
    }, { signal: events.signal });
    host.addEventListener('click', event => {
      const name = event.target.closest('[data-create-action]')?.dataset.createAction;
      if (!name || !active(current) || current.busy) return;
      if (name === 'retry') { void prepare(current); return; }
      if (name === 'disconnect-images') {
        if (!window.confirm('Disconnect OpenAI? Saved courses and images stay in your account. Running image work may still finish. Reconnect before creating another course.')) return;
        void task(current, 'Disconnecting OpenAI…', async () => { await imageClient.disconnect(session.owner); if (active(current)) await check(current); });
      }
      if (name === 'disconnect') {
        if (!window.confirm('Disconnect Claude? Existing courses stay saved. Running AI work may still finish. You’ll need to reconnect before creating another plan.')) return;
        void task(current, 'Disconnecting Claude…', async () => { await client.disconnect(session.owner); if (active(current)) await check(current); });
      }
      if (name === 'start' && current.check?.ready && (!current.check.sources?.requiresReview || current.reviewedDigest === current.check.sources.digest)) void task(current, 'Starting your course…', async () => {
        const result = await client.start(session.owner, session.id, current.revision, current.reviewedDigest);
        if (active(current)) await openJob(result.jobId, session.owner);
      });
    }, { signal: events.signal });
  }
  return {
    dispose,
    begin(session) { if (getUser()?.id === session.owner) navigate(creationURL(session.id)); },
    render(host, session) {
      dispose();
      const current = { host, session, version, revision: null, check: null, reviewedDigest: '', busy: '', error: '' };
      state = current; draw(current);
      connectionEvents = new AbortController();
      window.addEventListener('learnable-provider-connection-changed', event => {
        if (event.detail?.owner !== session.owner) return;
        if (event.detail.provider !== 'openai' && typeof event.detail.connected === 'boolean' && current.check?.connected === event.detail.connected && !current.connectionDirty) return;
        refreshConnection(current);
      }, { signal: connectionEvents.signal });
      host.querySelector('h1')?.focus({ preventScroll: true }); window.scrollTo({ top: 0, behavior: 'instant' });
      void prepare(current);
    }
  };
}
