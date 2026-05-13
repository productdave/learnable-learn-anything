import { curriculum } from '../data/curriculum.js';

let searchIndex = [];
let isInitialized = false;

function stripHtml(html) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return div.textContent || div.innerText || '';
}

async function buildIndex() {
  if (isInitialized) return;

  const moduleImports = {
    'ai-foundations': () => import('../data/modules/module-1.js'),
    'business-translation': () => import('../data/modules/module-2.js'),
    'evaluation-deployment': () => import('../data/modules/module-3.js'),
    'portfolio-building': () => import('../data/modules/module-4.js'),
    'pitch-preparation': () => import('../data/modules/module-5.js')
  };

  for (const mod of curriculum.modules) {
    try {
      const moduleData = await moduleImports[mod.id]();
      const data = moduleData.default || moduleData[Object.keys(moduleData).find(k => k !== 'default')];
      if (!data) continue;

      for (const topicId of Object.keys(data)) {
        const topic = data[topicId];
        if (!topic?.sections) continue;

        searchIndex.push({
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
            searchIndex.push({
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
            searchIndex.push({
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

  isInitialized = true;
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
        entry.text.slice(start, idx) +
        '<mark>' + entry.text.slice(idx, idx + query.length) + '</mark>' +
        entry.text.slice(idx + query.length, end) +
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
          <span class="search-group-module" style="color: ${group.moduleColor}">${group.moduleName}</span>
          <span class="search-group-topic">${group.topicTitle}</span>
        </a>
        ${group.items.map(item => `
          <a href="#/${item.moduleId}/${item.topicId}" class="search-result-item" onclick="document.getElementById('search-overlay').style.display='none'">
            <span class="search-result-type">${item.type}</span>
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
    buildIndex();
  }

  function close() {
    overlay.style.display = 'none';
    input.value = '';
  }

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
