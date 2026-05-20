export function renderPayoffMatrix(section) {
  const m = section.matrix;
  const id = section.id || `matrix-${Math.random().toString(36).slice(2, 8)}`;

  return `
    <div class="payoff-matrix-block" data-matrix-id="${id}" data-editable="${section.editable !== false}">
      <div class="payoff-matrix-header">
        <span class="payoff-matrix-badge">Payoff Matrix</span>
        ${section.title ? `<h3 class="payoff-matrix-title">${section.title}</h3>` : ''}
      </div>
      ${section.description ? `<p class="payoff-matrix-desc">${section.description}</p>` : ''}

      <div class="payoff-matrix-wrapper">
        <div class="payoff-matrix-labels">
          <div class="payoff-matrix-player-label player-row-label">${m.rowPlayer || 'Player 1'}</div>
          <div class="payoff-matrix-player-label player-col-label">${m.colPlayer || 'Player 2'}</div>
        </div>

        <table class="payoff-matrix-table">
          <thead>
            <tr>
              <th class="payoff-corner"></th>
              ${m.colStrategies.map(s => `<th class="payoff-col-header">${s}</th>`).join('')}
            </tr>
          </thead>
          <tbody>
            ${m.rowStrategies.map((rs, ri) => `
              <tr>
                <th class="payoff-row-header">${rs}</th>
                ${m.colStrategies.map((cs, ci) => {
                  const payoff = m.payoffs[ri][ci];
                  return `
                    <td class="payoff-cell" data-row="${ri}" data-col="${ci}">
                      <div class="payoff-values">
                        <span class="payoff-row-val" data-player="row"${section.editable !== false ? ' contenteditable="true"' : ''}>${payoff[0]}</span>
                        <span class="payoff-separator">,</span>
                        <span class="payoff-col-val" data-player="col"${section.editable !== false ? ' contenteditable="true"' : ''}>${payoff[1]}</span>
                      </div>
                    </td>`;
                }).join('')}
              </tr>
            `).join('')}
          </tbody>
        </table>
      </div>

      <div class="payoff-matrix-legend">
        <span class="payoff-legend-item"><span class="payoff-legend-dot row-dot"></span>${m.rowPlayer || 'Player 1'} payoff</span>
        <span class="payoff-legend-item"><span class="payoff-legend-dot col-dot"></span>${m.colPlayer || 'Player 2'} payoff</span>
        <span class="payoff-legend-item"><span class="payoff-legend-dot nash-dot"></span>Nash Equilibrium</span>
      </div>

      <div class="payoff-matrix-analysis" data-analysis></div>
    </div>`;
}

export function initPayoffMatrixInteractivity(container) {
  container.querySelectorAll('.payoff-matrix-block').forEach(block => {
    const isEditable = block.dataset.editable === 'true';
    analyzeMatrix(block);

    if (!isEditable) return;

    block.querySelectorAll('[contenteditable]').forEach(el => {
      el.addEventListener('input', () => {
        const val = el.textContent.trim();
        if (val === '' || isNaN(parseFloat(val))) return;
        analyzeMatrix(block);
      });

      el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          el.blur();
        }
      });

      el.addEventListener('focus', () => {
        const range = document.createRange();
        range.selectNodeContents(el);
        const sel = window.getSelection();
        sel.removeAllRanges();
        sel.addRange(range);
      });
    });
  });
}

function getPayoffs(block) {
  const rows = [];
  const trs = block.querySelectorAll('tbody tr');
  trs.forEach(tr => {
    const row = [];
    tr.querySelectorAll('.payoff-cell').forEach(cell => {
      const rv = parseFloat(cell.querySelector('.payoff-row-val').textContent) || 0;
      const cv = parseFloat(cell.querySelector('.payoff-col-val').textContent) || 0;
      row.push([rv, cv]);
    });
    rows.push(row);
  });
  return rows;
}

function findNashEquilibria(payoffs) {
  const numRows = payoffs.length;
  const numCols = payoffs[0].length;
  const nash = [];

  for (let r = 0; r < numRows; r++) {
    for (let c = 0; c < numCols; c++) {
      let rowBest = true;
      for (let r2 = 0; r2 < numRows; r2++) {
        if (payoffs[r2][c][0] > payoffs[r][c][0]) { rowBest = false; break; }
      }

      let colBest = true;
      for (let c2 = 0; c2 < numCols; c2++) {
        if (payoffs[r][c2][1] > payoffs[r][c][1]) { colBest = false; break; }
      }

      if (rowBest && colBest) nash.push([r, c]);
    }
  }
  return nash;
}

function findDominantStrategies(payoffs) {
  const numRows = payoffs.length;
  const numCols = payoffs[0].length;
  const result = { row: null, col: null };

  for (let r = 0; r < numRows; r++) {
    let dominant = true;
    for (let r2 = 0; r2 < numRows; r2++) {
      if (r2 === r) continue;
      let dominates = true;
      for (let c = 0; c < numCols; c++) {
        if (payoffs[r][c][0] <= payoffs[r2][c][0]) { dominates = false; break; }
      }
      if (!dominates) { dominant = false; break; }
    }
    if (dominant) { result.row = r; break; }
  }

  for (let c = 0; c < numCols; c++) {
    let dominant = true;
    for (let c2 = 0; c2 < numCols; c2++) {
      if (c2 === c) continue;
      let dominates = true;
      for (let r = 0; r < numRows; r++) {
        if (payoffs[r][c][1] <= payoffs[r][c2][1]) { dominates = false; break; }
      }
      if (!dominates) { dominant = false; break; }
    }
    if (dominant) { result.col = c; break; }
  }

  return result;
}

function analyzeMatrix(block) {
  const payoffs = getPayoffs(block);
  const nash = findNashEquilibria(payoffs);
  const dominant = findDominantStrategies(payoffs);

  block.querySelectorAll('.payoff-cell').forEach(cell => cell.classList.remove('nash-eq'));
  nash.forEach(([r, c]) => {
    const cell = block.querySelector(`.payoff-cell[data-row="${r}"][data-col="${c}"]`);
    if (cell) cell.classList.add('nash-eq');
  });

  const rowHeaders = block.querySelectorAll('.payoff-row-header');
  const colHeaders = block.querySelectorAll('.payoff-col-header');
  rowHeaders.forEach(h => h.classList.remove('dominant'));
  colHeaders.forEach(h => h.classList.remove('dominant'));

  if (dominant.row !== null && rowHeaders[dominant.row]) {
    rowHeaders[dominant.row].classList.add('dominant');
  }
  if (dominant.col !== null && colHeaders[dominant.col]) {
    colHeaders[dominant.col].classList.add('dominant');
  }

  const analysisEl = block.querySelector('[data-analysis]');
  if (!analysisEl) return;

  let analysis = [];

  if (nash.length > 0) {
    const nashDescs = nash.map(([r, c]) => {
      const rs = rowHeaders[r]?.textContent || `Row ${r+1}`;
      const cs = colHeaders[c]?.textContent || `Col ${c+1}`;
      return `(${rs}, ${cs}) with payoffs (${payoffs[r][c][0]}, ${payoffs[r][c][1]})`;
    });
    analysis.push(`<strong>Nash Equilibrium:</strong> ${nashDescs.join('; ')}`);
  } else {
    analysis.push('<strong>Nash Equilibrium:</strong> No pure-strategy Nash equilibrium exists.');
  }

  if (dominant.row !== null) {
    analysis.push(`<strong>Dominant strategy for ${block.querySelector('.player-row-label')?.textContent || 'Player 1'}:</strong> ${rowHeaders[dominant.row]?.textContent}`);
  }
  if (dominant.col !== null) {
    analysis.push(`<strong>Dominant strategy for ${block.querySelector('.player-col-label')?.textContent || 'Player 2'}:</strong> ${colHeaders[dominant.col]?.textContent}`);
  }

  analysisEl.innerHTML = analysis.map(a => `<div class="payoff-analysis-item">${a}</div>`).join('');
}
