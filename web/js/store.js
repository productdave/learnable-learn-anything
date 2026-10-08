import { createLearningStore, learningStorageKey } from './learning-store.js?v=3';
export { createLearningStore, learningStorageKey, LEGACY_STORAGE_KEY } from './learning-store.js?v=3';
export const store = createLearningStore();
globalThis.addEventListener?.('storage', event => { if (event.key === learningStorageKey(store.scope().owner)) store.refreshFromStorage(); });
