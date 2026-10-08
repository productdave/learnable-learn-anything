import { sourceUrlIssue } from './setup-model.js?v=7';
import { isUsableResearchBundle } from './generator/research-policy.mjs';

const text = value => typeof value === 'string' ? value.trim() : '';
const list = value => Array.isArray(value) ? value : [];
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
export const researchTextItems = value => (Array.isArray(value) ? value : [value]).map(text).filter(Boolean);

export function safeEvidenceURL(value) {
  const url = text(value);
  if (!url || sourceUrlIssue(url)) return '';
  return new URL(url).href;
}

function references(value) {
  const seen = new Set();
  return (Array.isArray(value) ? value : [value]).flatMap(item => {
    if (typeof item !== 'string' && (!item || typeof item !== 'object')) return [];
    const title = text(typeof item === 'string' ? item : item.title);
    const rawURL = text(item?.url);
    const url = safeEvidenceURL(rawURL);
    if (!title && !rawURL) return [];
    // Do not display raw unsafe URLs: they may contain embedded credentials.
    const reference = { title: title || url || 'Untitled reference', url,
      linkStatus: url ? 'linked' : rawURL ? 'invalid' : 'missing' };
    const key = url || `${reference.title}|${reference.linkStatus}`;
    if (seen.has(key)) return [];
    seen.add(key);
    return [reference];
  });
}

export function researchEvidence(job = {}) {
  const modules = list(job?.review?.researchResults).map((result, index) => {
    const bundle = result?.bundle;
    const available = isUsableResearchBundle(bundle);
    return { key: `module-${index}`, title: text(result?.mod?.title) || `Module ${index + 1}`, available,
      concepts: researchTextItems(bundle?.key_concepts), examples: researchTextItems(bundle?.examples),
      misconceptions: researchTextItems(bundle?.misconceptions), references: available ? references(bundle.sources) : [] };
  });
  const request = job?.brief || job?.checkpoint?.brief || {};
  const manifestLinks = list(request.source_manifest?.links);
  const requested = Array.isArray(request.source_urls) ? request.source_urls : manifestLinks.map(link => link?.url);
  const extracted = list(job?.checkpoint?.extractedUrls);
  const seen = new Set();
  const submitted = requested.flatMap(raw => {
    if (!text(raw)) return [];
    const url = safeEvidenceURL(raw);
    const key = url || text(raw);
    if (seen.has(key)) return [];
    seen.add(key);
    // Match the requested address, not a prefix or a redirect destination belonging
    // to a different request. Unknown legacy records must not become false success.
    const result = url ? [...extracted].reverse().find(item => safeEvidenceURL(item?.requestedUrl || item?.url) === url) : null;
    const manifest = url ? manifestLinks.find(link => safeEvidenceURL(link?.url) === url) : null;
    const status = !url ? 'invalid' : result?.ok === false ? 'failed' : text(result?.textContent) ? 'available' : 'unknown';
    const destination = safeEvidenceURL(result?.url);
    return [{ url, title: text(manifest?.title) || text(result?.title) || url || 'Submitted link',
      status, redirected: !!(destination && destination !== url), destination }];
  });
  const missing = modules.filter(module => !module.available).length;
  return { modules, submitted, missing, complete: modules.length > 0 && missing === 0,
    referenced: modules.filter(module => module.available && module.references.length).length,
    unreferenced: modules.filter(module => module.available && !module.references.length).length,
    unread: submitted.filter(link => link.status !== 'available').length };
}

function linkHTML(title, url) {
  return `<a class="research-reference-link" href="${esc(url)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"><span>${esc(title)}</span><small>${esc(new URL(url).hostname)} <span aria-hidden="true">↗</span><span class="sr-only"> (opens in a new tab)</span></small></a>`;
}

function fullLearningNotesHTML(module) {
  if (module.concepts.length <= 4 && module.examples.length <= 3 && module.misconceptions.length <= 2) return '';
  const groups = [['Key concepts', module.concepts], ['Examples and activities', module.examples], ['Misconceptions', module.misconceptions]];
  const count = groups.reduce((total, [, items]) => total + items.length, 0);
  return `<details class="research-sources" data-evidence-panel="${module.key}-notes">
    <summary>View all learning notes (${count})<span class="sr-only"> for ${esc(module.title)}</span></summary>
    <p>The preview above is shortened. Review every concept, example and misconception here before approving lesson writing. Add corrections in your feedback.</p>
    ${groups.filter(([, items]) => items.length).map(([label, items]) => `<p><strong>${label} (${items.length})</strong></p><ul>${items.map(item => `<li>${esc(item)}</li>`).join('')}</ul>`).join('')}
  </details>`;
}

export function researchEvidenceHTML(evidence) {
  const status = { available: 'Text available', failed: 'Couldn’t read', unknown: 'Read status unavailable', invalid: 'Link unavailable' };
  return `
    <div class="intake-review-meta"><span>${evidence.referenced} of ${evidence.modules.length} modules list references</span></div>
    <p>References are AI-reported, not independently verified. Open them to check credibility and support; flag gaps or conflicting advice in your feedback.</p>
    ${evidence.unreferenced || evidence.unread ? `<div class="research-warning"><strong>Check the evidence before continuing</strong><p>${evidence.unreferenced ? `${evidence.unreferenced} module${evidence.unreferenced === 1 ? ' has' : 's have'} no references listed. ` : ''}${evidence.unread ? `${evidence.unread} submitted link${evidence.unread === 1 ? ' has' : 's have'} no readable text available. ` : ''}Review your material or adjust sources. Other material may still be sufficient.</p></div>` : ''}
    ${evidence.submitted.length ? `<details class="research-sources" data-evidence-panel="submitted" ${evidence.unread ? 'open' : ''}>
      <summary>Your submitted links (${evidence.submitted.length})</summary>
      <p>Read status describes available excerpts, not verification or proof a source was used.</p>
      <ul class="research-reference-list">${evidence.submitted.map(link => `<li>${link.url ? linkHTML(link.title, link.url) : `<strong>${esc(link.title)}</strong>`}<span class="research-read-status ${link.status === 'available' ? '' : 'research-read-status--warning'}">${status[link.status]}</span>${link.redirected ? `<p>Text came from a redirected page on ${esc(new URL(link.destination).hostname)}.</p>` : ''}</li>`).join('')}</ul>
      ${evidence.unread ? '<p>Use <strong>Adjust sources</strong> to replace a link, paste its text as a note, or confirm the sources again to retry reading them. This rechecks every module. A plain research rerun may reuse earlier link-read results.</p>' : ''}
    </details>` : '<p class="research-source-note">No web links were submitted. Your notes and files can still provide source material; use Adjust sources to review them.</p>'}
    <div class="intake-review-list">${evidence.modules.map(module => `<section>
      <h4>${esc(module.title)}</h4>
      ${module.available ? `
        ${module.concepts.length ? `<p>${esc(module.concepts.slice(0, 4).join(' · '))}</p>` : '<p>No key concepts were returned. Review this module before approving.</p>'}
        ${module.examples.length || module.misconceptions.length ? `<ul>${module.examples.slice(0, 3).map(item => `<li>${esc(item)}</li>`).join('')}${module.misconceptions.slice(0, 2).map(item => `<li>Misconception: ${esc(item)}</li>`).join('')}</ul>` : ''}
        ${fullLearningNotesHTML(module)}
        ${module.references.length ? `<details class="research-sources" data-evidence-panel="${module.key}"><summary>Research references (${module.references.length})<span class="sr-only"> for ${esc(module.title)}</span></summary><ul class="research-reference-list">${module.references.map(reference => `<li>${reference.url ? linkHTML(reference.title, reference.url) : `<strong>${esc(reference.title)}</strong><span class="research-read-status research-read-status--warning">${reference.linkStatus === 'invalid' ? 'Link unavailable — check the reference manually.' : 'No link supplied — check the reference manually.'}</span>`}</li>`).join('')}</ul></details>` : '<p class="research-missing">No references listed. Check your submitted material or ask for sources in your feedback.</p>'}
      ` : '<p class="research-missing">Research is missing for this module. Rerun research before writing lessons.</p>'}
    </section>`).join('')}</div>`;
}

// Keep in-progress review input local to this exact checkpoint, not a different
// account/run/status. No extra persistence or new draft product is introduced.
export function reviewIdentity(job) {
  return ['review_curriculum', 'review_research'].includes(job?.status)
    ? JSON.stringify([job.id, job.ownerId || '', job.runId || '', job.status]) : '';
}
const focusSelectors = ['[data-review-feedback]', '[data-review-continue]', '[data-review-regenerate]', '[data-adjust-sources]', '.intake-close'];
export function captureReviewState(card, identity) {
  if (!identity || card.dataset.reviewIdentity !== identity) return null;
  const input = card.querySelector('[data-review-feedback]');
  if (!input) return null;
  const focused = card.ownerDocument.activeElement;
  return { feedback: input.value, selection: [input.selectionStart, input.selectionEnd],
    panels: [...card.querySelectorAll('[data-evidence-panel]')].map(el => [el.dataset.evidencePanel, el.open]),
    focus: focusSelectors.find(selector => card.querySelector(selector) === focused),
    summary: focused?.matches('summary') ? focused.parentElement.dataset.evidencePanel : null,
    link: focused?.matches('a.research-reference-link') ? { panel: focused.closest('[data-evidence-panel]')?.dataset.evidencePanel, href: focused.getAttribute('href') } : null,
    scroll: card.closest('.intake-modal')?.scrollTop };
}
export function restoreReviewState(card, state) {
  if (!state) return;
  const input = card.querySelector('[data-review-feedback]');
  if (input) input.value = state.feedback;
  const panels = [...card.querySelectorAll('[data-evidence-panel]')];
  for (const [key, open] of state.panels) { const panel = panels.find(el => el.dataset.evidencePanel === key); if (panel) panel.open = open; }
  const linkPanel = state.link && panels.find(el => el.dataset.evidencePanel === state.link.panel);
  const focus = state.focus ? card.querySelector(state.focus) : state.link
    ? [...(linkPanel?.querySelectorAll('a.research-reference-link') || [])].find(el => el.getAttribute('href') === state.link.href)
    : panels.find(el => el.dataset.evidencePanel === state.summary)?.querySelector('summary');
  if (focus && !focus.disabled) {
    focus.focus({ preventScroll: true });
    if (focus === input) input.setSelectionRange(...state.selection);
  }
  const scroller = card.closest('.intake-modal'); if (scroller && state.scroll !== undefined) scroller.scrollTop = state.scroll;
}
