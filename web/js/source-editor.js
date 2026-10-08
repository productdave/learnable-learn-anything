import { NOTE_CHARACTER_LIMIT, noteCharacters } from './draft-store.js?v=5';
import { sourceCounts, sourceUrlIssue, splitNote, fileProblem } from './setup-model.js?v=7';
import { escapeHome as esc } from './home-model.js?v=7';

const kinds = { notes: 'Plain notes', links: 'Links', files: 'Files' };
const button = (action, label, extra = '') => `<button type="button" class="home-draft-link" data-source-action="${action}" ${extra}>${label}</button>`;
export function sourceEditorHTML({ context = 'setup' } = {}) {
  const heading = context === 'review' ? 'h3' : 'h2';
  return `<section class="setup-sources" aria-labelledby="source-heading"><${heading} id="source-heading">${context === 'review' ? 'Source material' : 'Add source material <span class="setup-optional">Optional</span>'}</${heading}>
    <p>${context === 'review' ? 'Use notes, transcripts, web links or documents to refine your research. Your current sources stay in use until you confirm the changes.' : 'Bring your own material: transcripts, raw text, web links or documents. Your inputs stay here while you complete setup.'}</p>
    <div class="source-switch" role="group" aria-label="Source type">${Object.entries(kinds).map(([key, label]) => `<button type="button" data-source-kind="${key}" aria-pressed="false">${label} <span data-source-count="${key}">0</span></button>`).join('')}</div>
    <div data-source-panel></div><div data-source-feedback role="status"></div>
  </section>`;
}

// A single editor contract for setup now and evidence adjustment later. No
// uploads, URL requests, extraction or AI calls happen in this component.
export function mountSourceEditor(host, { draft, changed, fileState, signal, initialKind = 'notes', onKind = () => {}, context = 'setup' }) {
  let kind = initialKind, undo = null, replacing = '';
  const panel = host.querySelector('[data-source-panel]');
  const feedback = host.querySelector('[data-source-feedback]');
  const id = () => crypto.randomUUID();
  function tell(message) { feedback.textContent = message; }
  function changedAndPaint(focus) { changed(); paint(); if (focus) panel.querySelector(focus)?.focus(); }
  function counters() {
    const counts = sourceCounts(draft);
    for (const key of Object.keys(kinds)) {
      host.querySelector(`[data-source-kind="${key}"]`).setAttribute('aria-pressed', String(kind === key));
      host.querySelector(`[data-source-count="${key}"]`).textContent = counts[key];
    }
  }
  function noteHTML(note, index) {
    return `<div class="source-item" data-source-id="${esc(note.id)}"><div class="source-item-head"><h3>Note ${index + 1}</h3>${button('remove', 'Remove note')}</div>
      <label for="note-title-${esc(note.id)}">Title <span class="setup-optional">Optional</span></label><input id="note-title-${esc(note.id)}" data-source-field="title" value="${esc(note.title)}" placeholder="e.g. Lesson transcript, part 1">
      <label for="note-text-${esc(note.id)}">Notes, transcript or raw text</label><textarea id="note-text-${esc(note.id)}" data-source-field="text" rows="7" aria-describedby="note-count-${esc(note.id)}" placeholder="Paste or write your text here…">${esc(note.text)}</textarea>
      <div class="source-note-meta"><span id="note-count-${esc(note.id)}" data-note-count></span>${button('split', 'Split into smaller notes', 'data-note-split hidden')}</div></div>`;
  }
  function linkHTML(link, index) {
    return `<div class="source-item" data-source-id="${esc(link.id)}"><div class="source-item-head"><h3>Link ${index + 1}</h3>${button('remove', 'Remove link')}</div>
      <label for="link-url-${esc(link.id)}">Website URL</label><input id="link-url-${esc(link.id)}" data-source-field="url" type="url" inputmode="url" autocapitalize="off" spellcheck="false" value="${esc(link.url)}" placeholder="https://example.com/article" aria-describedby="link-error-${esc(link.id)}">
      <p class="setup-field-error" id="link-error-${esc(link.id)}" data-link-error></p></div>`;
  }
  function fileHTML(file) {
    return `<div class="source-item source-file" data-source-id="${esc(file.id)}"><div><h3>${esc(file.name)}</h3><p>${(file.size / 1024 / 1024).toFixed(2)} MB · <span data-file-state></span></p></div><div class="source-file-actions">${!file.blob ? button('reattach', 'Reattach file') : ''}${button('remove', 'Remove file')}</div></div>`;
  }
  function update() {
    counters();
    for (const row of panel.querySelectorAll('[data-source-id]')) {
      const item = draft.sources[kind].find(item => item.id === row.dataset.sourceId);
      if (!item) continue;
      if (kind === 'notes') {
        const count = noteCharacters(item.text), over = count > NOTE_CHARACTER_LIMIT;
        row.querySelector('[data-note-count]').textContent = `${count.toLocaleString()} / 12,000 characters${over ? ' · Too long. Split this note; all text is preserved.' : ''}`;
        row.querySelector('textarea').setAttribute('aria-invalid', String(over));
        row.querySelector('[data-note-split]').hidden = !over;
        row.querySelector('.source-note-meta').classList.toggle('setup-field-error', over);
      } else if (kind === 'links') {
        const problem = sourceUrlIssue(item.url);
        row.querySelector('[data-link-error]').textContent = problem;
        row.querySelector('input').setAttribute('aria-invalid', String(!!problem));
      } else row.querySelector('[data-file-state]').textContent = fileState(item);
    }
  }
  function paint() {
    if (kind === 'notes') panel.innerHTML = `<p class="source-help">Up to 12,000 characters per note (roughly 3,000 English tokens; other languages vary). Split longer transcripts into multiple notes. Pasting never cuts off your text.</p>${draft.sources.notes.map(noteHTML).join('')}${button('add', '+ Add a note')}`;
    if (kind === 'links') panel.innerHTML = `<p class="source-help">Add a public http:// or https:// address. Links are saved, not fetched or checked for access yet. Don’t include private access tokens.</p>${draft.sources.links.map(linkHTML).join('')}${button('add', '+ Add a link')}`;
    if (kind === 'files') panel.innerHTML = `<div class="source-drop" data-source-drop><label for="source-files">Choose files or drop them here</label><p>PDF, DOCX or TXT · up to 5 files · 10 MB each</p><input id="source-files" type="file" multiple accept=".pdf,.docx,.txt" aria-describedby="source-file-help"></div><p class="source-help" id="source-file-help">${context === 'review' ? 'Checking changes uploads originals privately to your account and shows the extracted text. It does not start AI or replace your accepted sources.' : 'We’ll save the originals to your account when you create, then let you check the extracted text before any AI work starts.'} Use searchable PDFs (up to 100 pages), DOCX or UTF-8 TXT. Images and scanned pages aren’t read. Notes and file text share a 48,000-character limit. Keep your own copies.</p>${draft.sources.files.map(fileHTML).join('')}<input type="file" data-reattach-input accept=".pdf,.docx,.txt" aria-label="Reattach missing source file" hidden>`;
    update();
  }
  function addFiles(files, replaceId = '') {
    if (host.closest('fieldset')?.disabled) return;
    const errors = []; let accepted = 0;
    for (const file of files) {
      const issue = fileProblem(file, draft.sources.files, replaceId);
      if (issue) { errors.push(`${file.name}: ${issue}`); continue; }
      const value = { id: replaceId || id(), name: file.name, type: file.type, size: file.size, blob: file };
      if (replaceId) {
        const index = draft.sources.files.findIndex(item => item.id === replaceId);
        if (index < 0) continue;
        draft.sources.files.splice(index, 1, value);
      } else draft.sources.files.push(value);
      accepted++;
    }
    if (accepted) changedAndPaint();
    tell([accepted ? `${accepted} ${accepted === 1 ? 'file added' : 'files added'}.` : '', ...errors].filter(Boolean).join(' '));
  }
  host.addEventListener('input', event => {
    const field = event.target.dataset.sourceField;
    if (!field) return;
    const item = draft.sources[kind].find(item => item.id === event.target.closest('[data-source-id]')?.dataset.sourceId);
    if (!item) return;
    item[field] = event.target.value; changed(); update();
  }, { signal });
  host.addEventListener('click', event => {
    const target = event.target.closest('button');
    if (!target) return;
    if (target.dataset.sourceKind) { kind = target.dataset.sourceKind; onKind(kind); paint(); return; }
    const action = target.dataset.sourceAction;
    const index = draft.sources[kind].findIndex(item => item.id === target.closest('[data-source-id]')?.dataset.sourceId);
    if (action === 'add') {
      const next = { id: id(), title: '', ...(kind === 'notes' ? { text: '' } : { url: '' }) };
      draft.sources[kind].push(next); changedAndPaint(kind === 'notes' ? 'textarea:last-of-type' : '.source-item:last-of-type input');
      panel.querySelector(`[data-source-id="${next.id}"] ${kind === 'notes' ? 'textarea' : 'input'}`)?.focus();
    }
    if (action === 'remove' && index >= 0) {
      undo = { kind, index, item: draft.sources[kind][index] };
      draft.sources[kind].splice(index, 1); changedAndPaint();
      feedback.innerHTML = `Source removed. ${button('undo', 'Undo removal')}`;
      feedback.querySelector('button').focus();
    }
    if (action === 'undo' && undo) {
      if (undo.kind === 'files' && draft.sources.files.length >= 5) { tell('Remove a file first to restore this one; the five-file limit still applies.'); return; }
      kind = undo.kind; onKind(kind); draft.sources[kind].splice(undo.index, 0, undo.item); undo = null;
      changedAndPaint(); tell('Source restored.'); panel.querySelector('input, textarea')?.focus();
    }
    if (action === 'split' && index >= 0) {
      const parts = splitNote(draft.sources.notes[index], id);
      draft.sources.notes.splice(index, 1, ...parts); changedAndPaint();
      panel.querySelector(`[data-source-id="${parts[0].id}"] textarea`)?.focus(); tell(`Split into ${parts.length} notes. All text is preserved.`);
    }
    if (action === 'reattach' && index >= 0) { replacing = draft.sources.files[index].id; panel.querySelector('[data-reattach-input]').click(); }
  }, { signal });
  host.addEventListener('change', event => {
    if (event.target.id === 'source-files') addFiles([...event.target.files]);
    if (event.target.matches('[data-reattach-input]')) { addFiles([...event.target.files], replacing); replacing = ''; }
    if (event.target.type === 'file') event.target.value = '';
  }, { signal });
  host.addEventListener('dragover', event => { if (event.target.closest('[data-source-drop]')) event.preventDefault(); }, { signal });
  host.addEventListener('drop', event => {
    if (!event.target.closest('[data-source-drop]')) return;
    event.preventDefault(); addFiles([...event.dataTransfer.files]);
  }, { signal });
  paint();
  return { update };
}
