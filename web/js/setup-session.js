import { createDraftStore, draftContent, draftScope } from './draft-store.js?v=5';
import { setupDraft } from './setup-model.js?v=7';

// Keep unsaved buffers through SPA navigation, but never transfer them between
// owners. A save resolves only after the atomic IndexedDB transaction commits.
export function createSetupSessions({ store = createDraftStore(), getOwner = () => null, notify = () => {} } = {}) {
  const sessions = new Map();
  const key = (id, owner) => JSON.stringify([draftScope(owner), id]);
  const ownerNow = () => getOwner() || null;
  function wrap(id, owner, input, record = null) {
    return { id, owner, draft: draftContent(input), record, version: record ? 0 : 1, savedVersion: 0, pending: null, timer: null, error: null, sourceKind: 'notes' };
  }
  async function flush(session) {
    clearTimeout(session.timer);
    if (session.pending) return session.pending;
    if (session.owner !== ownerNow() || session.deleting || session.deleted) return false;
    if (['conflict', 'expired', 'incompatible'].includes(session.error?.code)) return false;
    session.pending = (async () => {
      while (session.version !== session.savedVersion && session.owner === ownerNow() && !session.deleting && !session.deleted) {
        const version = session.version;
        const snapshot = draftContent(session.draft);
        session.error = null; notify(session);
        try {
          session.record = await store.save({ id: session.id, ...snapshot, cloud: session.record?.cloud }, { ownerId: session.owner, expectedRevision: session.record?.revision || 0 });
          session.savedVersion = version;
        } catch (error) { session.error = error; if(error.code==='deleted'){session.deleted=true;clearTimeout(session.timer);} return false; }
      }
      return session.version === session.savedVersion;
    })().finally(() => { session.pending = null; notify(session); });
    notify(session);
    return session.pending;
  }
  return {
    async start(brief = {}, { components, materialsNotice = '' } = {}) {
      const id = `setup-${crypto.randomUUID()}`, owner = ownerNow();
      const draft = setupDraft(brief.topic || '');
      // Allow reuse of an existing request without bringing job IDs, auth state
      // or source attachment promises into a new setup.
      draft.brief = draftContent({ brief: { ...draft.brief, ...brief } }).brief;
      if (Array.isArray(components)) draft.components = draftContent({ components }).components;
      const session = wrap(id, owner, draft);
      session.materialsNotice = materialsNotice;
      sessions.set(key(id, owner), session); void flush(session); return session;
    },
    async open(id) {
      const owner = ownerNow(), cached = sessions.get(key(id, owner));
      if (cached?.pending) await cached.pending;
      if (owner !== ownerNow()) return { status: 'owner-changed' };
      const result = await store.load(id, owner);
      if (owner !== ownerNow()) return { status: 'owner-changed' };
      if (result.status === 'deleted') { if(cached){cached.deleted=true;clearTimeout(cached.timer);} sessions.delete(key(id,owner)); return result; }
      if (cached && cached.version !== cached.savedVersion) return { status: 'found', session: cached };
      if (result.status !== 'found') { sessions.delete(key(id, owner)); return result; }
      if (result.draft.step === 'home') return { status: 'missing' };
      const session = wrap(id, owner, result.draft, result.draft);
      session.sourceKind = cached?.sourceKind || 'notes';
      session.materialsNotice = cached?.materialsNotice || '';
      sessions.set(key(id, owner), session); return { status: 'found', session };
    },
    edit(session) {
      if (session.owner !== ownerNow() || session.deleting || session.deleted) return;
      session.version++; notify(session);
      clearTimeout(session.timer); session.timer = setTimeout(() => void flush(session), 180);
    },
    flush,
    async deletionSnapshot(id) {
      const owner=ownerNow(), cached=sessions.get(key(id,owner));
      // Settle this tab's scheduled autosave before capturing the revision the
      // user is confirming. A different tab's later edit still causes conflict.
      if(cached) await flush(cached);
      const result=await store.load(id,owner);
      if(owner!==ownerNow()) throw new Error('Your account changed. Reopen the draft before deleting.');
      return {owner,id,revision:result.status==='found'?result.draft.revision:0,
        title:cached?.draft.brief.topic || result.draft?.brief.topic || '', local:result.status==='found'||!!cached};
    },
    async remove(snapshot, removeAccount = async()=>{}) {
      const {id,owner,revision}=snapshot, cached=sessions.get(key(id,owner));
      const guard=()=>{if(owner!==ownerNow())throw new Error('Your account changed. Reopen the draft before deleting.');};
      guard();if(cached){cached.deleting=true;clearTimeout(cached.timer);if(cached.pending)await cached.pending;}
      try {
        guard();const current=await store.load(id,owner);guard();
        if(current.status==='found'&&current.draft.revision!==revision)throw new Error('This draft changed. Close this confirmation and review it before deleting.');
        await removeAccount();guard();
        await store.remove(id,{ownerId:owner,expectedRevision:revision,tombstone:true});guard();
        if(cached)cached.deleted=true;sessions.delete(key(id,owner));
        return true;
      } finally {if(cached)cached.deleting=false;}
    },
    async selectedGuest(id) {
      // Caller must validate an unexpired local handoff marker for this exact ID.
      const cached = sessions.get(key(id, null));
      if (cached?.pending) await cached.pending;
      if (cached && cached.version !== cached.savedVersion) return { status: 'unsaved-guest' };
      const result = await store.load(id, null);
      return result.status === 'found' ? { status: 'found', session: wrap(id, null, result.draft, result.draft) } : result;
    },
    async claim(session) {
      const owner = ownerNow();
      if (!owner || session.owner) throw new Error('An unattached guest setup and signed-in account are required.');
      const record = await store.claim(session.id, { ownerId: owner, expectedRevision: session.record.revision });
      const claimed = wrap(session.id, owner, record, record);
      sessions.delete(key(session.id, null)); sessions.set(key(session.id, owner), claimed);
      return claimed;
    },
    async acknowledge(session, cloud) {
      if (session.pending) await session.pending;
      if (session.owner !== ownerNow()) return false;
      session.record = { ...session.record, cloud }; session.version++;
      return flush(session);
    },
    async restoreAccount(id, input, cloud) {
      const owner = ownerNow();
      if (!owner) return null;
      // New browser only: never overwrite any existing device version.
      const existing = await store.load(id, owner);
      if (existing.status === 'found') return null;
      const record = await store.save({ id, ...draftContent(input), cloud }, { ownerId: owner, expectedRevision: 0 });
      const session = wrap(id, owner, record, record); sessions.set(key(id, owner), session); return session;
    },
    async fork(session) {
      if (session.owner !== ownerNow()) return null;
      if (session.pending) await session.pending;
      if (session.owner !== ownerNow()) return null;
      const copy = wrap(`setup-${crypto.randomUUID()}`, session.owner, session.draft);
      sessions.set(key(copy.id, copy.owner), copy);
      await flush(copy);
      if (copy.error) { sessions.delete(key(copy.id, copy.owner)); session.error = copy.error; notify(session); return null; }
      // Retire only this in-tab conflicting buffer after a successful copy. The
      // other tab's durable version remains untouched under the original ID.
      sessions.delete(key(session.id, session.owner));
      clearTimeout(session.timer);
      return copy;
    },
    async list() {
      const owner = ownerNow();
      let result, error;
      try { result = await store.list(owner); } catch (failure) { result = { drafts: [] }; error = failure; }
      if (owner !== ownerNow()) return { drafts: [] };
      const items = new Map(result.drafts.filter(draft => draft.step !== 'home').map(draft => [draft.id, draft]));
      for (const session of sessions.values()) if (!session.deleted && session.owner === owner && session.version !== session.savedVersion) {
        try { if((await store.load(session.id,owner)).status==='deleted'){session.deleted=true;clearTimeout(session.timer);continue;} } catch { /* Keep genuinely unsaved edits available on storage failure. */ }
        if(owner!==ownerNow())return {drafts:[]};
        items.set(session.id, { id: session.id, ...session.draft, updatedAt: Date.now(), unsaved: true });
      }
      return { ...result, error, drafts: [...items.values()].sort((a, b) => b.updatedAt - a.updatedAt) };
    },
    hasUnsaved() { return [...sessions.values()].some(session => !session.deleted && session.version !== session.savedVersion); }
  };
}
