import { escapeHome as esc } from './home-model.js?v=7';

// Presentation only. Never replace the saved description with this short label.
export function briefTitle(value, fallback = 'Untitled course') {
  const firstLine = String(value || '').trim().split(/\r?\n/)[0].replace(/\s+/g, ' ');
  const characters = Array.from(firstLine);
  return characters.length > 96 ? characters.slice(0, 95).join('').trimEnd() + '…' : firstLine || fallback;
}

// Native disclosure keeps the whole request available without making a review
// page, sign-in prompt or summary card as long as the source document.
export function briefPreviewHTML(value, { label = 'text', fallback = 'Not specified', preview = 320 } = {}) {
  const text = String(value || '') || fallback;
  const characters = Array.from(text);
  if (characters.length <= preview + 80) return `<p class="setup-prewrap brief-text">${esc(text)}</p>`;
  const excerpt = characters.slice(0, preview).join('').trimEnd() + '…';
  return `<div class="brief-preview"><details class="brief-preview-details"><summary><span class="brief-preview-show">Show full ${esc(label)}</span><span class="brief-preview-hide">Show less</span> <span class="brief-preview-count">${characters.length.toLocaleString('en-US')} characters</span></summary><div class="brief-preview-full setup-prewrap" role="region" aria-label="Full ${esc(label)}" tabindex="0">${esc(text)}</div></details><p class="brief-preview-excerpt setup-prewrap">${esc(excerpt)}</p></div>`;
}
