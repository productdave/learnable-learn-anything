(async page => {
  return page.evaluate(async () => {
    const { createDraftStore } = await import('/js/draft-store.js?v=3');
    const checks = [], check = (ok, name) => { if (!ok) throw new Error(name); checks.push(name); };
    const dbName = `qa-claim-${crypto.randomUUID()}`, store = createDraftStore({ dbName });
    const initial = { id: 'claim-me', step: 'review', brief: { topic: 'Selected', audience: 'Learner' }, sources: { files: [{ id: 'source-one', name: 'original.txt', blob: new Blob(['bytes']) }] } };
    await store.save(initial);
    const originalPut = IDBObjectStore.prototype.put;
    IDBObjectStore.prototype.put = function (...args) { if (this.transaction.db.name === dbName && args[0]?.scope === 'account:alice') throw new DOMException('QA quota', 'QuotaExceededError'); return originalPut.apply(this, args); };
    try {
      let failed = false; try { await store.claim('claim-me', { ownerId: 'alice', expectedRevision: 1 }); } catch { failed = true; }
      check(failed, 'claim quota failure reported');
      check((await store.load('claim-me')).status === 'found', 'failed account write never deletes guest recovery');
      check((await store.load('claim-me', 'alice')).status === 'missing', 'failed transaction leaves no partial account copy');
    } finally { IDBObjectStore.prototype.put = originalPut; }
    const competing = await Promise.allSettled([store.claim('claim-me', { ownerId: 'alice', expectedRevision: 1 }), store.claim('claim-me', { ownerId: 'bob', expectedRevision: 1 })]);
    check(competing.filter(result => result.status === 'fulfilled').length === 1, 'simultaneous claims bind to exactly one owner');
    const owner = (await store.load('claim-me', 'alice')).status === 'found' ? 'alice' : 'bob';
    check((await store.load('claim-me')).status === 'missing', 'successful claim removes guest visibility atomically');
    check(await (await store.load('claim-me', owner)).draft.sources.files[0].blob.text() === 'bytes', 'successful claim preserves original file bytes');
    let resurrected = false; try { await store.save(initial, { expectedRevision: 1 }); resurrected = true; } catch {}
    check(!resurrected, 'stale guest tab cannot resurrect an attached draft');
    await store.save({ ...initial, id: 'collision' });
    await store.save({ ...initial, id: 'collision', brief: { topic: 'Existing account version' } }, { ownerId: 'alice' });
    let conflict = false; try { await store.claim('collision', { ownerId: 'alice', expectedRevision: 1 }); } catch (error) { conflict = error.code === 'conflict'; }
    check(conflict && (await store.load('collision')).status === 'found' && (await store.load('collision', 'alice')).draft.brief.topic === 'Existing account version', 'target collision preserves both copies');
    store.close(); await new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase(dbName); request.onsuccess = resolve; request.onerror = reject; });
    return { passed: checks.length, checks };
  });
})
