import { escapeHome as esc } from './home-model.js?v=7';

export function renderSetupSourceReview(sources, { reviewed = false, busy = false, contextURL, context = 'setup' } = {}) {
  if (!sources?.files?.length) return '';
  const number = value => Number(value).toLocaleString('en-US');
  return `<section class="setup-source-review" aria-labelledby="source-review-title">
    <div class="source-review-heading"><h3 id="source-review-title">Check your source text</h3>${contextURL ? `<a class="home-draft-link" href="${esc(contextURL)}">Edit sources</a>` : ''}</div>
    <p>Files are read here without AI. ${context === 'review' ? 'Before rechecking research' : 'Before creating'}, check that the text you want to teach from is present and in the right order.</p>
    <p class="source-review-budget${sources.characters > sources.limit ? ' setup-field-error' : ''}"><strong>${number(sources.characters)} / ${number(sources.limit)} characters</strong> · Notes and readable files, including labels${sources.complete ? '' : ' · Check incomplete'}</p>
    <p class="source-help">Links are fetched ${context === 'review' ? 'when you recheck research' : 'after you create'}. Images, diagrams and scanned pages are not read here. Nothing is silently shortened.</p>
    <div class="source-review-files">${sources.files.map(file => `<article class="source-review-file">
      <div class="source-review-heading"><strong>${esc(file.name)}</strong><span class="source-review-status${file.status === 'error' ? ' source-review-status--error' : ''}">${file.status === 'ready' ? 'Text ready' : 'Needs attention'}</span></div>
      ${file.status === 'ready' ? `<p class="source-help">${esc(file.kind.toUpperCase())} · ${number(file.characters)} characters${file.pages ? ` · ${number(file.pages)} ${file.pages === 1 ? 'page' : 'pages'}` : ''}</p>
        ${(file.warnings || []).map(w => `<p class="source-help">${esc(w)}</p>`).join('')}
        <details class="source-text-preview"><summary>Preview text from ${esc(file.name)}</summary><pre tabindex="0" aria-label="Extracted text from ${esc(file.name)}">${esc(file.text)}</pre></details>`
        : `<p class="setup-field-error">${esc(file.message)}</p>${contextURL ? `<a class="home-draft-link" href="${esc(contextURL)}">Replace file or use Notes</a>` : '<p class="source-help">Replace the file above or paste its text into Plain notes.</p>'}`}
    </article>`).join('')}</div>
    ${sources.requiresReview && sources.complete ? `<label class="source-review-confirm"><input type="checkbox" data-source-reviewed ${reviewed ? 'checked' : ''} ${busy ? 'disabled' : ''}><span>I’ve checked the extracted text and want to use it.</span></label><p class="source-help" id="source-review-next">Confirm the text above before ${context === 'review' ? 'rechecking research' : 'creating your course plan'}.</p>` : ''}
  </section>`;
}
