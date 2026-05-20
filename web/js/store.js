const STORAGE_KEY = 'gametheory-learning-state';
const VERSION = 1;

function createDefaultState() {
  return {
    version: VERSION,
    theme: 'light',
    currentPath: '',
    progress: {},
    quizAnswers: {},
    exerciseDrafts: {},
    flashcardState: {}
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createDefaultState();
    const state = JSON.parse(raw);
    if (state.version !== VERSION) return createDefaultState();
    return state;
  } catch {
    return createDefaultState();
  }
}

function saveState(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* storage full - silently fail */ }
}

let state = loadState();
const listeners = new Set();

export const store = {
  get() {
    return state;
  },

  set(partial) {
    state = { ...state, ...partial };
    saveState(state);
    listeners.forEach(fn => fn(state));
  },

  subscribe(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  getTheme() {
    return state.theme;
  },

  setTheme(theme) {
    this.set({ theme });
    document.documentElement.setAttribute('data-theme', theme);
  },

  toggleTheme() {
    this.setTheme(state.theme === 'light' ? 'dark' : 'light');
  },

  isTopicCompleted(moduleId, topicId) {
    return state.progress?.[moduleId]?.[topicId]?.completed === true;
  },

  completeTopic(moduleId, topicId) {
    const progress = { ...state.progress };
    if (!progress[moduleId]) progress[moduleId] = {};
    progress[moduleId] = {
      ...progress[moduleId],
      [topicId]: { completed: true, completedAt: new Date().toISOString() }
    };
    this.set({ progress });
  },

  uncompleteTopic(moduleId, topicId) {
    const progress = { ...state.progress };
    if (progress[moduleId]?.[topicId]) {
      progress[moduleId] = { ...progress[moduleId] };
      progress[moduleId][topicId] = { completed: false };
      this.set({ progress });
    }
  },

  getModuleProgress(moduleId, topicCount) {
    const mod = state.progress?.[moduleId];
    if (!mod) return 0;
    const completed = Object.values(mod).filter(t => t.completed).length;
    return topicCount > 0 ? completed / topicCount : 0;
  },

  getOverallProgress(modules) {
    let total = 0;
    let completed = 0;
    for (const mod of modules) {
      total += mod.topics.length;
      const modProgress = state.progress?.[mod.id];
      if (modProgress) {
        completed += Object.values(modProgress).filter(t => t.completed).length;
      }
    }
    return total > 0 ? completed / total : 0;
  },

  saveQuizAnswer(quizId, answer) {
    const quizAnswers = {
      ...state.quizAnswers,
      [quizId]: { ...answer, answeredAt: new Date().toISOString() }
    };
    this.set({ quizAnswers });
  },

  getQuizAnswer(quizId) {
    return state.quizAnswers?.[quizId] || null;
  },

  saveExerciseDraft(exerciseId, text) {
    const exerciseDrafts = {
      ...state.exerciseDrafts,
      [exerciseId]: { text, savedAt: new Date().toISOString() }
    };
    this.set({ exerciseDrafts });
  },

  getExerciseDraft(exerciseId) {
    return state.exerciseDrafts?.[exerciseId] || null;
  },

  getFlashcardState(cardId) {
    return state.flashcardState?.[cardId] || null;
  },

  saveFlashcardState(cardId, cardState) {
    const flashcardState = {
      ...state.flashcardState,
      [cardId]: cardState
    };
    this.set({ flashcardState });
  }
};
