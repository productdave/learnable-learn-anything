// Flat legacy maps have no reliable course ownership and are never auto-assigned.
export const LEARNING_KEYS = ['progress', 'quizAnswers', 'exerciseDrafts', 'flashcardState', 'practiceProgress'];
export const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const entries = value => Object.entries(record(value)).filter(([key]) => !['__proto__', 'constructor', 'prototype'].includes(key));
export const emptyLearning = () => Object.fromEntries(LEARNING_KEYS.map(key => [key, {}]));
// A stalled request must eventually expose the retry action, not spin forever.
export const boundedLearningQuery = query => query.abortSignal && globalThis.AbortSignal?.timeout
  ? query.abortSignal(AbortSignal.timeout(15000)) : query;
const stamp = value => Date.parse(value?.updatedAt || value?.answeredAt || value?.savedAt || value?.completedAt || '') || 0;
function newer(a, b) {
  if (a === undefined) return b;
  if (b === undefined) return a;
  const difference = stamp(a) - stamp(b);
  return difference ? difference > 0 ? a : b : JSON.stringify(a) >= JSON.stringify(b) ? a : b;
}
function mergeMap(a, b, merge = newer) {
  const out = Object.fromEntries(entries(a));
  for (const [key, value] of entries(b)) out[key] = merge(out[key], value);
  return out;
}
function mergePractice(a, b) {
  const left = record(a), right = record(b), out = { ...record(newer(a, b)), steps: {}, skills: {}, stepUpdatedAt: {}, skillUpdatedAt: {} };
  for (const [field, dates] of [['steps', 'stepUpdatedAt'], ['skills', 'skillUpdatedAt']]) {
    for (const key of new Set([...entries(left[field]), ...entries(right[field])].map(([key]) => key))) {
      const wrap = source => Object.hasOwn(record(source[field]), key) ? { value: source[field][key], updatedAt: source[dates]?.[key] || source.updatedAt } : undefined;
      const winner = newer(wrap(left), wrap(right));
      out[field][key] = winner.value;
      if (winner.updatedAt) out[dates][key] = winner.updatedAt;
    }
  }
  return out;
}
export function mergeLearning(a, b) {
  const left = record(a), right = record(b), out = emptyLearning();
  out.progress = mergeMap(left.progress, right.progress, (x, y) => mergeMap(x, y));
  for (const key of ['quizAnswers', 'exerciseDrafts', 'flashcardState']) out[key] = mergeMap(left[key], right[key]);
  out.practiceProgress = mergeMap(left.practiceProgress, right.practiceProgress, mergePractice);
  return out;
}
export const mergeCourses = (a, b) => mergeMap(a, b, mergeLearning);
export function latestLearningTime(courses) {
  let latest = 0;
  for (const [, course] of entries(courses)) {
    for (const [, topics] of entries(course.progress)) for (const [, value] of entries(topics)) latest = Math.max(latest, stamp(value));
    for (const field of ['quizAnswers', 'exerciseDrafts', 'flashcardState', 'practiceProgress']) for (const [, value] of entries(course[field])) {
      latest = Math.max(latest, stamp(value));
      for (const dates of ['stepUpdatedAt', 'skillUpdatedAt']) for (const [, date] of entries(value?.[dates])) latest = Math.max(latest, Date.parse(date) || 0);
    }
  }
  return latest;
}
export function legacyLearning(value) {
  return Object.fromEntries(LEARNING_KEYS.filter(key => Object.keys(record(value?.[key])).length).map(key => [key, value[key]]));
}

// Optimistic compare-and-swap protects other courses and preserves legacy fields
// and provider keys. No new table, migration, service credential or RPC required.
export async function writeLearningSnapshot(client, owner, snapshot, { isCurrent = () => true, providerKeys = {}, attempts = 4 } = {}) {
  return updateAccountState(client, owner, remote => {
    const state = { ...remote, _learningV2: { ...record(remote._learningV2), courses: mergeCourses(remote._learningV2?.courses, snapshot.courses) } };
    if (Object.keys(providerKeys).length) {
      state._apiKeys = { ...record(remote._apiKeys), ...providerKeys };
      if (providerKeys.anthropic) state._apiKey = providerKeys.anthropic;
    }
    return state;
  }, { isCurrent, attempts });
}

// Re-read on a row conflict so a preference save and a learning-progress save
// preserve one another. A transform may reject its own field-level conflict.
export async function updateAccountState(client, owner, transform, { isCurrent = () => true, attempts = 4 } = {}) {
  for (let attempt = 0; attempt < attempts; attempt++) {
    if (!isCurrent()) return null;
    const { data, error } = await boundedLearningQuery(client.from('user_state').select('state,updated_at').eq('user_id', owner).maybeSingle());
    if (error) throw error;
    if (!isCurrent()) return null;
    const remote = record(data?.state);
    const state = transform(remote);
    const updated_at = new Date(Math.max(Date.now(), (Date.parse(data?.updated_at) || 0) + 1)).toISOString();
    const query = data
      ? client.from('user_state').update({ state, updated_at }).eq('user_id', owner).eq('updated_at', data.updated_at)
      : client.from('user_state').insert({ user_id: owner, state, updated_at });
    if (!isCurrent()) return null;
    const result = await boundedLearningQuery(query.select('state').maybeSingle());
    if (result.error && result.error.code !== '23505') throw result.error;
    if (!isCurrent()) return null;
    if (!result.error && result.data) return result.data.state;
  }
  throw new Error('Progress changed on another device. Your work is retained here; retry sync.');
}
