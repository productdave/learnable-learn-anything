const STRATEGIES = {
  'always-cooperate': {
    name: 'Always Cooperate',
    desc: 'Always cooperates regardless of opponent',
    fn: () => 'C'
  },
  'always-defect': {
    name: 'Always Defect',
    desc: 'Always defects regardless of opponent',
    fn: () => 'D'
  },
  'tit-for-tat': {
    name: 'Tit for Tat',
    desc: 'Cooperates first, then copies opponent\'s last move',
    fn: (myHistory, theirHistory) => theirHistory.length === 0 ? 'C' : theirHistory[theirHistory.length - 1]
  },
  'generous-tft': {
    name: 'Generous Tit for Tat',
    desc: 'Like TFT but forgives defections 30% of the time',
    fn: (myHistory, theirHistory) => {
      if (theirHistory.length === 0) return 'C';
      if (theirHistory[theirHistory.length - 1] === 'D') return Math.random() < 0.3 ? 'C' : 'D';
      return 'C';
    }
  },
  'pavlov': {
    name: 'Pavlov (Win-Stay Lose-Shift)',
    desc: 'Repeats last move if it scored well, switches if not',
    fn: (myHistory, theirHistory) => {
      if (myHistory.length === 0) return 'C';
      const lastMe = myHistory[myHistory.length - 1];
      const lastThem = theirHistory[theirHistory.length - 1];
      if ((lastMe === 'C' && lastThem === 'C') || (lastMe === 'D' && lastThem === 'D')) return lastMe;
      return lastMe === 'C' ? 'D' : 'C';
    }
  },
  'random': {
    name: 'Random',
    desc: 'Cooperates or defects with equal probability',
    fn: () => Math.random() < 0.5 ? 'C' : 'D'
  }
};

const PAYOFFS = {
  'CC': [3, 3],
  'CD': [0, 5],
  'DC': [5, 0],
  'DD': [1, 1]
};

export function renderSimulator(section) {
  const id = section.id || `sim-${Math.random().toString(36).slice(2, 8)}`;
  const rounds = section.rounds || 20;

  const strategyOptions = (defaultKey) => Object.entries(STRATEGIES).map(([key, s]) =>
    `<option value="${key}"${key === defaultKey ? ' selected' : ''}>${s.name}</option>`
  ).join('');

  return `
    <div class="simulator-block" data-sim-id="${id}" data-rounds="${rounds}">
      <div class="simulator-header">
        <span class="simulator-badge">Strategy Simulator</span>
        ${section.title ? `<h3 class="simulator-title">${section.title}</h3>` : ''}
      </div>
      ${section.description ? `<p class="simulator-desc">${section.description}</p>` : ''}

      <div class="simulator-payoff-ref">
        <div class="simulator-payoff-label">Payoff Rules (per round):</div>
        <div class="simulator-payoff-grid">
          <span>Both Cooperate: <strong>3, 3</strong></span>
          <span>Both Defect: <strong>1, 1</strong></span>
          <span>You Cooperate, They Defect: <strong>0, 5</strong></span>
          <span>You Defect, They Cooperate: <strong>5, 0</strong></span>
        </div>
      </div>

      <div class="simulator-controls">
        <div class="strategy-select-group">
          <label class="strategy-label">Your Strategy</label>
          <select class="strategy-select" data-player="you">
            ${strategyOptions('always-cooperate')}
          </select>
          <div class="strategy-desc" data-desc-for="you">${STRATEGIES['always-cooperate'].desc}</div>
        </div>
        <div class="simulator-vs">VS</div>
        <div class="strategy-select-group">
          <label class="strategy-label">Opponent Strategy</label>
          <select class="strategy-select" data-player="opponent">
            ${strategyOptions('always-defect')}
          </select>
          <div class="strategy-desc" data-desc-for="opponent">${STRATEGIES['always-defect'].desc}</div>
        </div>
      </div>

      <div class="simulator-actions">
        <button class="simulator-run-btn">Run ${rounds} Rounds</button>
        <button class="simulator-reset-btn" style="display:none">Reset</button>
      </div>

      <div class="simulator-results" style="display:none">
        <div class="simulator-scoreboard">
          <div class="simulator-score you-score">
            <span class="score-label">Your Score</span>
            <span class="score-value" data-score="you">0</span>
          </div>
          <div class="simulator-score opponent-score">
            <span class="score-label">Opponent Score</span>
            <span class="score-value" data-score="opponent">0</span>
          </div>
        </div>

        <div class="simulator-rounds-container">
          <div class="simulator-rounds-header">
            <span>Round</span>
            <span>You</span>
            <span>Opponent</span>
            <span>Your Points</span>
            <span>Their Points</span>
            <span>Running Total</span>
          </div>
          <div class="simulator-rounds" data-rounds-list></div>
        </div>

        <div class="simulator-score-bars">
          <div class="score-bar-group">
            <div class="score-bar-label">You</div>
            <div class="score-bar-track">
              <div class="score-bar-fill you-bar" style="width:0%"></div>
            </div>
          </div>
          <div class="score-bar-group">
            <div class="score-bar-label">Opponent</div>
            <div class="score-bar-track">
              <div class="score-bar-fill opponent-bar" style="width:0%"></div>
            </div>
          </div>
        </div>

        <div class="simulator-insight" data-insight></div>
      </div>
    </div>`;
}

export function initSimulatorInteractivity(container) {
  container.querySelectorAll('.simulator-block').forEach(block => {
    const rounds = parseInt(block.dataset.rounds) || 20;
    const runBtn = block.querySelector('.simulator-run-btn');
    const resetBtn = block.querySelector('.simulator-reset-btn');
    const resultsEl = block.querySelector('.simulator-results');
    const selects = block.querySelectorAll('.strategy-select');

    selects.forEach(sel => {
      sel.addEventListener('change', () => {
        const player = sel.dataset.player;
        const descEl = block.querySelector(`[data-desc-for="${player}"]`);
        if (descEl) descEl.textContent = STRATEGIES[sel.value]?.desc || '';
      });
    });

    runBtn.addEventListener('click', () => {
      const yourStrategy = block.querySelector('[data-player="you"]').value;
      const opponentStrategy = block.querySelector('[data-player="opponent"]').value;
      runSimulation(block, yourStrategy, opponentStrategy, rounds);
      runBtn.style.display = 'none';
      resetBtn.style.display = '';
    });

    resetBtn.addEventListener('click', () => {
      resultsEl.style.display = 'none';
      runBtn.style.display = '';
      resetBtn.style.display = 'none';
    });
  });
}

function runSimulation(block, yourKey, opponentKey, numRounds) {
  const yourFn = STRATEGIES[yourKey].fn;
  const opponentFn = STRATEGIES[opponentKey].fn;
  const resultsEl = block.querySelector('.simulator-results');
  const roundsList = block.querySelector('[data-rounds-list]');

  let yourHistory = [];
  let opponentHistory = [];
  let yourTotal = 0;
  let opponentTotal = 0;
  const roundData = [];

  for (let i = 0; i < numRounds; i++) {
    const yourMove = yourFn(yourHistory, opponentHistory);
    const opponentMove = opponentFn(opponentHistory, yourHistory);
    const key = yourMove + opponentMove;
    const [yourPts, opponentPts] = PAYOFFS[key];

    yourTotal += yourPts;
    opponentTotal += opponentPts;
    yourHistory.push(yourMove);
    opponentHistory.push(opponentMove);

    roundData.push({ round: i + 1, you: yourMove, opponent: opponentMove, yourPts, opponentPts, yourTotal, opponentTotal });
  }

  roundsList.innerHTML = roundData.map(r => `
    <div class="simulator-round-row">
      <span class="round-num">${r.round}</span>
      <span class="round-choice ${r.you === 'C' ? 'cooperate' : 'defect'}">${r.you === 'C' ? 'Cooperate' : 'Defect'}</span>
      <span class="round-choice ${r.opponent === 'C' ? 'cooperate' : 'defect'}">${r.opponent === 'C' ? 'Cooperate' : 'Defect'}</span>
      <span class="round-pts">${r.yourPts}</span>
      <span class="round-pts">${r.opponentPts}</span>
      <span class="round-total">${r.yourTotal} - ${r.opponentTotal}</span>
    </div>
  `).join('');

  block.querySelector('[data-score="you"]').textContent = yourTotal;
  block.querySelector('[data-score="opponent"]').textContent = opponentTotal;

  const maxScore = Math.max(yourTotal, opponentTotal, 1);
  block.querySelector('.you-bar').style.width = `${(yourTotal / maxScore) * 100}%`;
  block.querySelector('.opponent-bar').style.width = `${(opponentTotal / maxScore) * 100}%`;

  const insightEl = block.querySelector('[data-insight]');
  insightEl.innerHTML = generateInsight(yourKey, opponentKey, yourTotal, opponentTotal, yourHistory, opponentHistory);

  resultsEl.style.display = '';
}

function generateInsight(yourKey, opponentKey, yourTotal, opponentTotal, yourHistory, opponentHistory) {
  const mutualCoops = yourHistory.filter((m, i) => m === 'C' && opponentHistory[i] === 'C').length;
  const mutualDefects = yourHistory.filter((m, i) => m === 'D' && opponentHistory[i] === 'D').length;
  const totalRounds = yourHistory.length;

  let insight = '';

  if (yourTotal > opponentTotal) {
    insight += `<strong>You won!</strong> `;
  } else if (yourTotal < opponentTotal) {
    insight += `<strong>Opponent won!</strong> `;
  } else {
    insight += `<strong>It's a tie!</strong> `;
  }

  insight += `Final score: ${yourTotal} to ${opponentTotal}. `;

  const coopRate = Math.round((mutualCoops / totalRounds) * 100);
  insight += `Mutual cooperation occurred in ${coopRate}% of rounds. `;

  if (mutualCoops === totalRounds) {
    insight += 'Both players achieved the best collective outcome through full cooperation.';
  } else if (mutualDefects > totalRounds * 0.7) {
    insight += 'Heavy mutual defection led to a poor outcome for both. This is the classic trap of the Prisoner\'s Dilemma.';
  } else if (yourKey === 'tit-for-tat' || opponentKey === 'tit-for-tat') {
    insight += 'Tit for Tat\'s strength is in being nice (starting with cooperation), retaliatory (punishing defection), forgiving (returning to cooperation), and clear (easy to understand).';
  }

  return insight;
}
