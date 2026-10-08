import { SUPPORTED_COMPONENTS, creationComponents } from './generator/component-policy.mjs?v=3';
import { boundedLearningQuery, updateAccountState } from './learning-state.js?v=2';

export const STANDARD_MATERIALS = creationComponents();
const key = '_courseMaterialDefaults';
const issue = (code, message) => Object.assign(new Error(message), { code });
export function canonicalMaterials(value) {
  if (!Array.isArray(value) || !value.includes('lessons') || value.some(item => !SUPPORTED_COMPONENTS.includes(item))) {
    throw issue('unsupported', 'Choose currently available materials, including lessons, before saving defaults.');
  }
  // Older account defaults may contain Practice or omit images. Adapt their
  // choices for a new course without rewriting the stored account preference.
  return creationComponents(value);
}
export function readMaterialDefaults(state) {
  const value = state?.[key];
  if (value == null) return { revision: null, components: [...STANDARD_MATERIALS], custom: false };
  if (value.version !== 1 || typeof value.revision !== 'string' || !value.revision) throw issue('unsupported', 'Your saved material defaults need a newer version of Learnable. They have not been changed.');
  let components;
  try { components = canonicalMaterials(value.components); }
  catch { throw issue('unsupported', 'Some saved defaults aren’t available in this version. Your account defaults have not been changed.'); }
  return { revision: value.revision, components, custom: true };
}

// No persistent browser cache: new setups read the current account. Existing
// drafts are never passed to this client, and a late result cannot edit them.
export function createMaterialDefaultsClient({ getClient, getIdentity, subscribeIdentity = () => () => {} }) {
  let owner = getIdentity()?.id || null, epoch = 0;
  const changed = () => { const next = getIdentity()?.id || null; if (next !== owner) { owner = next; epoch++; } };
  subscribeIdentity(changed);
  function context(expected) {
    changed(); const version = epoch;
    const active = () => { changed(); return !!expected && owner === expected && epoch === version; };
    if (!active()) throw issue('auth', 'Your account changed. Reopen this setup to continue.');
    return active;
  }
  async function connection(active) {
    const client = await getClient();
    if (!active()) throw issue('auth', 'Your account changed. Reopen this setup to continue.');
    if (!client) throw issue('unavailable', 'Account defaults are unavailable. Your course choices are unchanged.');
    return client;
  }
  return {
    async load(expected) {
      const active = context(expected), client = await connection(active);
      const { data, error } = await boundedLearningQuery(client.from('user_state').select('state').eq('user_id', expected).maybeSingle());
      if (!active()) throw issue('auth', 'Your account changed. Reopen this setup to continue.');
      if (error) throw issue('unavailable', 'Couldn’t load your material defaults. Your course choices are unchanged.');
      return readMaterialDefaults(data?.state);
    },
    async save(expected, components, previousRevision) {
      const selected = canonicalMaterials(components), active = context(expected), client = await connection(active);
      const revision = crypto.randomUUID();
      try {
        const state = await updateAccountState(client, expected, remote => {
          if (readMaterialDefaults(remote).revision !== previousRevision) throw issue('conflict', 'Your defaults changed elsewhere. Reload defaults, then choose whether to save these materials again.');
          return { ...remote, [key]: { version: 1, revision, components: selected } };
        }, { isCurrent: active });
        if (!state || !active()) throw issue('auth', 'Your account changed. Reopen this setup to continue.');
        return readMaterialDefaults(state);
      } catch (error) {
        if (['auth', 'conflict', 'unsupported'].includes(error.code)) throw error;
        throw issue('unavailable', 'Couldn’t confirm the defaults save. Reload defaults to check before trying again. Your course choices are unchanged.');
      }
    }
  };
}
