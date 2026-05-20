import { store } from './store.js';
import { loadAllModules, getCourseConfig } from './course-loader.js';

const capitalizeFirst = (s) => s ? s.charAt(0).toUpperCase() + s.slice(1) : '';

function sm2(card, quality) {
  let { ease, interval, repetitions } = card;

  if (quality < 3) {
    repetitions = 0;
    interval = 1;
  } else {
    if (repetitions === 0) {
      interval = 1;
    } else if (repetitions === 1) {
      interval = 3;
    } else {
      interval = Math.round(interval * ease);
    }
    repetitions++;
  }

  ease = Math.max(1.3, ease + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02)));

  const nextReview = new Date();
  nextReview.setDate(nextReview.getDate() + interval);

  return {
    ease,
    interval,
    repetitions,
    nextReview: nextReview.toISOString().split('T')[0]
  };
}

async function getAllFlashcards() {
  const cards = [];
  const loaded = await loadAllModules();

  for (const { mod, data } of loaded) {
    if (!data) continue;

    for (const topicId of Object.keys(data)) {
      const topic = data[topicId];
      if (!topic?.flashcards) continue;

      topic.flashcards.forEach((card, i) => {
        const cardId = `${mod.id}-${topicId}-${i}`;
        cards.push({
          id: cardId,
          front: card.front,
          back: card.back,
          moduleId: mod.id,
          moduleName: mod.title,
          moduleColor: mod.color,
          topicTitle: topic.title
        });
      });
    }
  }

  return cards;
}

function getDueCards(cards) {
  const today = new Date().toISOString().split('T')[0];
  return cards.filter(card => {
    const state = store.getFlashcardState(card.id);
    if (!state) return true;
    return state.nextReview <= today;
  });
}

function renderFlashcardUI(overlay, cards) {
  if (cards.length === 0) {
    overlay.innerHTML = `
      <div class="flashcard-container">
        <div class="flashcard-header">
          <h2>Flashcard Review</h2>
          <button class="flashcard-close-btn" id="fc-close">
            <svg width="24" height="24"><use href="#icon-x"/></svg>
          </button>
        </div>
        <div class="flashcard-empty">
          <svg width="48" height="48"><use href="#icon-check-circle"/></svg>
          <h3>All caught up!</h3>
          <p>No flashcards due for review. Come back tomorrow or study new topics to add more cards.</p>
        </div>
      </div>`;
    overlay.querySelector('#fc-close').addEventListener('click', () => { overlay.style.display = 'none'; });
    return;
  }

  let currentIndex = 0;
  let isFlipped = false;

  function renderCard() {
    const card = cards[currentIndex];
    const state = store.getFlashcardState(card.id) || { ease: 2.5, interval: 0, repetitions: 0 };

    overlay.innerHTML = `
      <div class="flashcard-container">
        <div class="flashcard-header">
          <h2>Flashcard Review</h2>
          <div class="flashcard-progress">
            <span>${currentIndex + 1} / ${cards.length}</span>
            <div class="flashcard-progress-bar">
              <div class="flashcard-progress-fill" style="width: ${((currentIndex) / cards.length) * 100}%"></div>
            </div>
          </div>
          <button class="flashcard-close-btn" id="fc-close">
            <svg width="24" height="24"><use href="#icon-x"/></svg>
          </button>
        </div>

        <div class="flashcard-meta">
          <span style="color: ${card.moduleColor}">${card.moduleName}</span>
          <span>${card.topicTitle}</span>
        </div>

        <div class="flashcard-card ${isFlipped ? 'flipped' : ''}" id="fc-card">
          <div class="flashcard-card-inner">
            <div class="flashcard-front">
              <p>${card.front}</p>
              <span class="flashcard-tap-hint">Click to reveal answer</span>
            </div>
            <div class="flashcard-back">
              <p>${card.back}</p>
            </div>
          </div>
        </div>

        <div class="flashcard-rating ${isFlipped ? 'visible' : ''}" id="fc-rating">
          <p class="flashcard-rating-label">How well did you know this?</p>
          <div class="flashcard-rating-btns">
            <button class="fc-rate-btn fc-rate-again" data-quality="0">Again</button>
            <button class="fc-rate-btn fc-rate-hard" data-quality="3">Hard</button>
            <button class="fc-rate-btn fc-rate-good" data-quality="4">Good</button>
            <button class="fc-rate-btn fc-rate-easy" data-quality="5">Easy</button>
          </div>
        </div>
      </div>`;

    overlay.querySelector('#fc-close').addEventListener('click', () => {
      overlay.style.display = 'none';
      isFlipped = false;
    });

    overlay.querySelector('#fc-card').addEventListener('click', () => {
      if (!isFlipped) {
        isFlipped = true;
        renderCard();
      }
    });

    overlay.querySelectorAll('.fc-rate-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const quality = parseInt(btn.dataset.quality);
        const currentState = store.getFlashcardState(card.id) || { ease: 2.5, interval: 0, repetitions: 0 };
        const newState = sm2(currentState, quality);
        store.saveFlashcardState(card.id, newState);

        currentIndex++;
        isFlipped = false;

        if (currentIndex >= cards.length) {
          renderComplete(overlay, cards.length);
        } else {
          renderCard();
        }
      });
    });
  }

  renderCard();
}

function renderComplete(overlay, totalCards) {
  overlay.innerHTML = `
    <div class="flashcard-container">
      <div class="flashcard-header">
        <h2>Flashcard Review</h2>
        <button class="flashcard-close-btn" id="fc-close">
          <svg width="24" height="24"><use href="#icon-x"/></svg>
        </button>
      </div>
      <div class="flashcard-empty">
        <svg width="48" height="48"><use href="#icon-trophy"/></svg>
        <h3>Session Complete!</h3>
        <p>You reviewed ${totalCards} card${totalCards !== 1 ? 's' : ''}. ${capitalizeFirst(getCourseConfig().completionMessage || 'great work')}.</p>
      </div>
    </div>`;
  overlay.querySelector('#fc-close').addEventListener('click', () => { overlay.style.display = 'none'; });
}

export function initFlashcards() {
  const trigger = document.getElementById('flashcard-trigger');
  const overlay = document.getElementById('flashcard-overlay');

  if (!trigger || !overlay) return;

  trigger.addEventListener('click', async () => {
    overlay.style.display = '';
    overlay.innerHTML = '<div class="flashcard-container"><div class="flashcard-loading">Loading flashcards...</div></div>';

    const allCards = await getAllFlashcards();
    const dueCards = getDueCards(allCards);
    renderFlashcardUI(overlay, dueCards.length > 0 ? dueCards : allCards);
  });
}
