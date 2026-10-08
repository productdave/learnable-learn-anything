import { emptyLearning, mergeCourses, mergeLearning, legacyLearning, latestLearningTime } from './learning-state.js?v=2';

export const LEGACY_STORAGE_KEY = 'gametheory-learning-state';
export const learningStorageKey = owner => `learnable-learning-v2:${owner ? `account:${encodeURIComponent(owner)}` : 'guest'}`;
const THEME_KEY = 'learnable-theme';

export function createLearningStore({ storage, now = () => Date.now() } = {}) {
  if (!storage) {
    try { storage = globalThis.localStorage; } catch {}
    storage ||= { getItem() { throw new Error('Device storage unavailable'); }, setItem() { throw new Error('Device storage unavailable'); } };
  }
  let owner = null, course = null, lesson = null, epoch = 0, clock = 0, persisted = true, syncStatus = 'idle';
  const snapshots = new Map(), durability = new Map(), listeners = new Set(), unreadable = new Set();
  const learningPaths = new Map();
  let theme = 'light';
  try { theme = storage.getItem(THEME_KEY) || JSON.parse(storage.getItem(LEGACY_STORAGE_KEY) || '{}').theme || 'light'; } catch {}
  if (!['light', 'dark'].includes(theme)) theme = 'light';
  const key = () => learningStorageKey(owner);
  function read(key) {
    try {
      const raw = storage.getItem(key);
      if (!raw) return { version: 2, courses: {} };
      const value = JSON.parse(raw);
      if (value.version !== 2 || !value.courses || typeof value.courses !== 'object' || Array.isArray(value.courses)) throw new Error('Unreadable learning snapshot');
      unreadable.delete(key); return value;
    } catch { unreadable.add(key); return { version: 2, courses: {} }; }
  }
  function snapshot() {
    if (!snapshots.has(key())) snapshots.set(key(), read(key()));
    return snapshots.get(key());
  }
  const scope = () => ({ owner, course, lesson, epoch, path: learningPaths.get(course) });
  const itemKey = (id, context) => context.lesson ? JSON.stringify([...context.lesson, id]) : id;
  const valid = context => context?.owner === owner && context.epoch === epoch && !!context.course && context.path === learningPaths.get(context.course);
  const topicKey = (module, topic, context) => context.path?.[module]?.[topic] ? `${topic}~${context.path[module][topic]}` : topic;
  const view = context => valid(context) ? mergeLearning({}, snapshot().courses[context.course]) : emptyLearning();
  function emit(reason) { for (const fn of listeners) fn(api.get(), { reason, scope: scope() }); }
  function persist() {
    const current = snapshot(), disk = read(key());
    current.courses = mergeCourses(disk.courses, current.courses);
    if (disk.legacyRemote || current.legacyRemote) current.legacyRemote = mergeLearning(disk.legacyRemote, current.legacyRemote);
    if (unreadable.has(key())) { persisted = false; durability.set(key(), false); return false; }
    try { storage.setItem(key(), JSON.stringify(current)); persisted = true; } catch { persisted = false; }
    durability.set(key(), persisted);
    return persisted;
  }
  const timestamp = () => new Date(clock = Math.max(now(), clock + 1)).toISOString();
  function change(context, fn) {
    if (!valid(context)) return { ok: false, stale: true };
    const current = snapshot(); current.courses = mergeCourses(read(key()).courses, current.courses);
    clock = Math.max(clock, latestLearningTime(current.courses));
    current.courses[context.course] = fn(view(context), timestamp());
    if (owner) syncStatus = 'pending';
    const ok = persist(); emit('local'); return { ok };
  }
  function saveItem(field, id, value, context) {
    return change(context, (state, updatedAt) => ({ ...state, [field]: { ...state[field], [id]: { ...value, updatedAt } } }));
  }
  function savePractice(field, dates, id, item, value, context) {
    return change(context, (state, updatedAt) => {
      const saved = state.practiceProgress[id] || { steps: {}, skills: {} };
      return { ...state, practiceProgress: { ...state.practiceProgress, [id]: { ...saved, updatedAt, [field]: { ...saved[field], [item]: value }, [dates]: { ...saved[dates], [item]: updatedAt } } } };
    });
  }
  const api = {
    get: () => ({ ...view(scope()), version: 2, theme, currentPath: '' }),
    scope,
    isCurrent: context => valid(context),
    setOwner(next) { next = next || null; if (next === owner) return; owner = next; epoch++; learningPaths.clear(); persisted = durability.get(key()) ?? true; syncStatus = 'idle'; snapshot(); emit('scope'); },
    setCourse(next) { if (next !== course) { course = next || null; lesson = null; snapshot(); emit('scope'); } },
    setLearningPath(modules = []) {
      if (!course) return;
      const path = Object.fromEntries(modules.map(mod => [mod.id, Object.fromEntries((mod.topics || []).map(topic => [topic.id, /^[a-f0-9]{24}$/.test(topic.contentRevision || '') ? topic.contentRevision : '']))]));
      if (JSON.stringify(path) === JSON.stringify(learningPaths.get(course))) return;
      learningPaths.set(course, path);
    },
    setLesson(module, topic) { lesson = module && topic ? [module, topic] : null; },
    getSaveStatus: () => ({ persisted, sync: syncStatus, signedIn: !!owner }),
    setSyncStatus(status, context = scope()) { if (context.owner !== owner || context.epoch !== epoch) return; syncStatus = status; emit('status'); },
    retryLocalSave() { const ok = persist(); emit('status'); return { ok }; },
    exportSnapshot: () => structuredClone({ courses: snapshot().courses }),
    applyRemote(remote, context = scope()) {
      if (context.owner !== owner || context.epoch !== epoch) return false;
      const current = snapshot(); current.courses = mergeCourses(remote?._learningV2?.courses, current.courses);
      const legacy = legacyLearning(remote);
      if (Object.keys(legacy).length) current.legacyRemote = mergeLearning(current.legacyRemote, legacy);
      persist(); emit('remote'); return true;
    },
    retainedLegacy: () => structuredClone(snapshot().legacyRemote || {}),
    refreshFromStorage() { const current = snapshot(); current.courses = mergeCourses(read(key()).courses, current.courses); emit('remote'); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    getTheme: () => theme,
    setTheme(next) { theme = next === 'dark' ? 'dark' : 'light'; try { storage.setItem(THEME_KEY, theme); } catch {} globalThis.document?.documentElement.setAttribute('data-theme', theme); emit('theme'); },
    toggleTheme() { api.setTheme(theme === 'light' ? 'dark' : 'light'); },
    bind() {
      const context = scope(), bound = { scope: context, isCurrent: () => valid(context) };
      for (const name of ['isTopicCompleted', 'completeTopic', 'uncompleteTopic', 'getQuizAnswer', 'saveQuizAnswer', 'getExerciseDraft', 'saveExerciseDraft', 'getFlashcardState', 'saveFlashcardState', 'getPracticeProgress', 'savePracticeStep', 'savePracticeSkill']) bound[name] = (...args) => api[name](...args, context);
      return bound;
    },
    isTopicCompleted(module, topic, context = scope()) { return view(context).progress[module]?.[topicKey(module, topic, context)]?.completed === true; },
    completeTopic(module, topic, context = scope()) { return change(context, (state, updatedAt) => ({ ...state, progress: { ...state.progress, [module]: { ...state.progress[module], [topicKey(module, topic, context)]: { completed: true, completedAt: updatedAt, updatedAt } } } })); },
    uncompleteTopic(module, topic, context = scope()) { return change(context, (state, updatedAt) => ({ ...state, progress: { ...state.progress, [module]: { ...state.progress[module], [topicKey(module, topic, context)]: { completed: false, updatedAt } } } })); },
    getModuleProgress(module, count) {
      const topics = learningPaths.get(course)?.[module];
      const done = topics ? Object.keys(topics).filter(topic => api.isTopicCompleted(module, topic)).length : Object.entries(view(scope()).progress[module] || {}).filter(([id, value]) => !id.includes('~') && value.completed).length;
      return count > 0 ? Math.min(1, done / count) : 0;
    },
    getOverallProgress(modules) { const topics = (modules || []).flatMap(mod => (mod.topics || []).map(topic => [mod.id, topic.id])); return topics.length ? topics.filter(([mid, tid]) => api.isTopicCompleted(mid, tid)).length / topics.length : 0; },
    getQuizAnswer(id, context = scope()) { return view(context).quizAnswers[itemKey(id, context)] || null; },
    saveQuizAnswer(id, answer, context = scope()) { return saveItem('quizAnswers', itemKey(id, context), { ...answer, answeredAt: timestamp() }, context); },
    getExerciseDraft(id, context = scope()) { return view(context).exerciseDrafts[itemKey(id, context)] || null; },
    saveExerciseDraft(id, text, context = scope()) { return saveItem('exerciseDrafts', itemKey(id, context), { text, savedAt: timestamp() }, context); },
    getFlashcardState(id, context = scope()) { return view(context).flashcardState[id] || null; },
    saveFlashcardState(id, value, context = scope()) { return saveItem('flashcardState', id, value, context); },
    getPracticeProgress(id, context = scope()) { return view(context).practiceProgress[id] || { steps: {}, skills: {} }; },
    savePracticeStep(id, item, value, context = scope()) { return savePractice('steps', 'stepUpdatedAt', id, item, !!value, context); },
    savePracticeSkill(id, item, value, context = scope()) { return savePractice('skills', 'skillUpdatedAt', id, item, value, context); }
  };
  return api;
}
