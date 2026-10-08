import { loadAllModules } from './course-loader.js?v=8';
import { store } from './store.js?v=5';
const esc = value => String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));

let searchIndex = [];
let indexTicket = 0;

function stripHtml(html) {
  const div = document.createElement('template');
  div.innerHTML = html;
  return div.content.textContent || '';
}

async function buildIndex() {
  const ticket=++indexTicket,entries=[];searchIndex=[];
  const loaded = await loadAllModules();

  for (const { mod, data } of loaded) {
    if (!data) continue;
    try {
      for (const topicId of Object.keys(data)) {
        const topic = data[topicId];
        if (!topic?.sections) continue;

        entries.push({
          moduleId: mod.id,
          moduleName: mod.title,
          moduleColor: mod.color,
          topicId,
          topicTitle: topic.title,
          text: topic.title,
          type: 'title'
        });

        topic.sections.forEach((section, i) => {
          let text = '';
          if (section.title) text += section.title + ' ';
          if (section.content) text += stripHtml(section.content) + ' ';
          if (section.question) text += section.question + ' ';
          if (section.prompt) text += section.prompt + ' ';
          if (section.points) text += section.points.join(' ');

          if (text.trim()) {
            entries.push({
              moduleId: mod.id,
              moduleName: mod.title,
              moduleColor: mod.color,
              topicId,
              topicTitle: topic.title,
              sectionIndex: i,
              text: text.trim(),
              sectionTitle: section.title || '',
              type: section.type
            });
          }
        });

        if (topic.flashcards) {
          topic.flashcards.forEach(card => {
            entries.push({
              moduleId: mod.id,
              moduleName: mod.title,
              moduleColor: mod.color,
              topicId,
              topicTitle: topic.title,
              text: card.front + ' ' + card.back,
              type: 'flashcard'
            });
          });
        }
      }
    } catch { /* module not loaded yet */ }
  }

  if(ticket===indexTicket)searchIndex=entries;
}

function search(query) {
  if (!query || query.length < 2) return [];
  const lower = query.toLowerCase();
  const results = [];

  for (const entry of searchIndex) {
    if (entry.text.toLowerCase().includes(lower)) {
      const idx = entry.text.toLowerCase().indexOf(lower);
      const start = Math.max(0, idx - 40);
      const end = Math.min(entry.text.length, idx + query.length + 60);
      let snippet = (start > 0 ? '...' : '') +
        esc(entry.text.slice(start, idx)) +
        '<mark>' + esc(entry.text.slice(idx, idx + query.length)) + '</mark>' +
        esc(entry.text.slice(idx + query.length, end)) +
        (end < entry.text.length ? '...' : '');

      results.push({
        ...entry,
        snippet,
        score: entry.type === 'title' ? 100 : 50
      });
    }
  }

  results.sort((a, b) => b.score - a.score);
  return results.slice(0, 20);
}

function renderResults(results, container) {
  if (results.length === 0) {
    container.innerHTML = '<div class="search-empty">No results found</div>';
    return;
  }

  const grouped = {};
  for (const r of results) {
    const key = `${r.moduleId}/${r.topicId}`;
    if (!grouped[key]) {
      grouped[key] = {
        moduleId: r.moduleId,
        moduleName: r.moduleName,
        moduleColor: r.moduleColor,
        topicId: r.topicId,
        topicTitle: r.topicTitle,
        items: []
      };
    }
    grouped[key].items.push(r);
  }

  let html = '';
  for (const group of Object.values(grouped)) {
    html += `
      <div class="search-group">
        <a href="#/${group.moduleId}/${group.topicId}" class="search-group-header" onclick="document.getElementById('search-overlay').style.display='none'">
          <span class="search-group-module" style="color: ${group.moduleColor}">${esc(group.moduleName)}</span>
          <span class="search-group-topic">${esc(group.topicTitle)}</span>
        </a>
        ${group.items.map(item => `
          <a href="#/${item.moduleId}/${item.topicId}" class="search-result-item" onclick="document.getElementById('search-overlay').style.display='none'">
            <span class="search-result-type">${esc(item.type)}</span>
            <span class="search-result-snippet">${item.snippet}</span>
          </a>
        `).join('')}
      </div>`;
  }

  container.innerHTML = html;
}

export function initSearch() {
  const overlay = document.getElementById('search-overlay');
  const input = document.getElementById('search-input');
  const resultsEl = document.getElementById('search-results');
  const trigger = document.getElementById('search-trigger');

  if (!overlay || !input || !trigger) return;

  let debounceTimer;

  function open() {
    overlay.style.display = '';
    input.value = '';
    resultsEl.innerHTML = '<div class="search-empty">Start typing to search across all topics</div>';
    setTimeout(() => input.focus(), 50);
    buildIndex().then(()=>{if(overlay.style.display!=='none'&&input.value)renderResults(search(input.value),resultsEl);}).catch(()=>{resultsEl.textContent='Search could not be loaded. Close and try again.';});
  }

  function close() {
    overlay.style.display = 'none';
    input.value = '';
  }
  store.subscribe((_,event)=>{if(event.reason==='scope'){indexTicket++;searchIndex=[];resultsEl.replaceChildren();close();}});

  trigger.addEventListener('click', open);

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close();
  });

  input.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      const results = search(input.value);
      renderResults(results, resultsEl);
    }, 200);
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && overlay.style.display !== 'none') {
      close();
    }
  });
}
