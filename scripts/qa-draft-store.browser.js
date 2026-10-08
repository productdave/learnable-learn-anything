(async (page) => {
  return page.evaluate(async () => {
    const { createDraftStore, DRAFT_RETENTION_MS, draftExport } = await import('/js/draft-store.js?v=1');
    const checks = [];
    const check = (value, label) => { if (!value) throw new Error(label); checks.push(label); };
    const rejects = async (action, code, label) => {
      try { await action(); } catch (error) { check(error.code === code, label); return; }
      throw new Error(`Expected failure: ${label}`);
    };
    const name = `learnable-qa-drafts-${crypto.randomUUID()}`;
    let time = 1000;
    const store = createDraftStore({ dbName: name, now: () => time });
    const second = createDraftStore({ dbName: name, now: () => time });
    const draft = { id: 'draft-1', step: 'context', brief: { topic: 'Swim safely', apiKey: 'not-retained' }, sources: {
      notes: [{ id: 'n1', text: '😀'.repeat(12001) }], links: [{ id: 'u1', url: 'https://example.org/source' }],
      files: [{ id: 'f1', name: 'notes.txt', blob: new Blob(['source bytes'], { type: 'text/plain' }) }]
    } };
    try {
      check((await store.load('none')).status === 'missing', 'missing draft');
      const saved = await store.save(draft);
      check(saved.revision === 1 && saved.expiresAt === time + DRAFT_RETENTION_MS, 'first committed revision/retention');
      store.close();
      const restored = (await store.load(draft.id)).draft;
      check(restored.brief.topic === 'Swim safely', 'close/reopen text roundtrip');
      check(await restored.sources.files[0].blob.text() === 'source bytes', 'native file bytes roundtrip');
      check(Array.from(restored.sources.notes[0].text).length === 12001, 'oversized Unicode note remains lossless');
      check(!draftExport(restored).includes('not-retained') && !draftExport(restored).includes('source bytes'), 'export excludes credentials and file bytes');
      check((await store.load(draft.id, 'alice')).status === 'missing', 'account cannot read guest scope');
      await store.save({ ...draft, brief: { topic: 'Alice only' } }, { ownerId: 'alice' });
      check((await store.list('bob')).drafts.length === 0, 'different account list empty');
      check((await store.list()).drafts.length === 1, 'guest list excludes account draft');
      check(await store.remove(draft.id, { ownerId: 'bob', expectedRevision: 1 }) === false, 'wrong-owner delete touches nothing');
      const raced = await Promise.allSettled([
        store.save({ ...restored, brief: { topic: 'Tab A' } }, { expectedRevision: 1 }),
        second.save({ ...restored, brief: { topic: 'Tab B' } }, { expectedRevision: 1 })
      ]);
      check(raced.filter(r => r.status === 'fulfilled').length === 1 && raced.find(r => r.status === 'rejected')?.reason.code === 'conflict', 'two real transactions: one wins, one conflict');
      const winner = (await store.load(draft.id)).draft;
      await rejects(() => store.remove(draft.id, { expectedRevision: 1 }), 'conflict', 'stale deletion rejected');
      await rejects(() => store.save({ ...winner, sources: { files: [{ id: 'huge', size: 11 * 1024 * 1024 }] } }, { expectedRevision: 2 }), 'file-limit', 'file size rejection');
      check((await store.load(draft.id)).draft.revision === 2, 'failed validation preserves previous revision');
      // Isolated fault injection: only the temporary test database is affected.
      const put = IDBObjectStore.prototype.put;
      IDBObjectStore.prototype.put = function (...args) {
        if (this.transaction.db.name === name) throw new DOMException('Injected full disk', 'QuotaExceededError');
        return put.apply(this, args);
      };
      try { await rejects(() => store.save({ ...winner, brief: { topic: 'Must not commit' } }, { expectedRevision: 2 }), 'quota', 'quota failure reports no successful save'); }
      finally { IDBObjectStore.prototype.put = put; }
      check((await store.load(draft.id)).draft.brief.topic === winner.brief.topic, 'quota failure preserves last committed content');
      IDBObjectStore.prototype.put = function (...args) {
        const request = put.apply(this, args);
        if (this.transaction.db.name === name) this.transaction.abort();
        return request;
      };
      try { await rejects(() => store.save({ ...winner, brief: { topic: 'Aborted write' } }, { expectedRevision: 2 }), 'unavailable', 'transaction abort is not saved'); }
      finally { IDBObjectStore.prototype.put = put; }
      check((await store.load(draft.id)).draft.revision === 2, 'aborted write leaves revision intact');
      await store.save({ id: 'missing-file', sources: { files: [{ id: 'f1', name: 'reattach.pdf' }] } });
      check((await store.load('missing-file')).draft.sources.files[0].status === 'needs-reattach', 'missing file bytes explicitly need reattachment');
      await store.save({ id: 'second-draft', brief: { topic: 'Another course' } });
      check((await store.list()).drafts.length === 3, 'multiple independent drafts');
      const raw = await new Promise((resolve, reject) => { const req = indexedDB.open(name, 1); req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
      await new Promise((resolve, reject) => {
        const tx = raw.transaction('drafts', 'readwrite');
        tx.objectStore('drafts').put({ ...winner, id: 'future-schema', schemaVersion: 99 });
        tx.oncomplete = resolve; tx.onabort = () => reject(tx.error);
      });
      raw.close();
      check((await store.load('future-schema')).status === 'incompatible', 'unknown schema fails closed without overwrite');
      await rejects(() => store.save({ id: 'future-schema' }, { expectedRevision: 2 }), 'incompatible', 'unknown schema cannot be overwritten');
      time += DRAFT_RETENTION_MS + 1;
      check((await store.load(draft.id)).status === 'expired', 'expired draft returns no text or files');
      check((await store.load(draft.id)).status === 'missing', 'expired local copy purged on access');
      const listed = await store.list();
      check(listed.expiredCount === 2 && listed.incompatibleCount === 1, 'list prunes only expired compatible scoped drafts');
      check((await store.load(draft.id, 'alice')).status === 'expired', 'guest cleanup did not purge another owner');
      return { passed: checks.length, checks };
    } finally {
      store.close(); second.close();
      await new Promise((resolve, reject) => { const request = indexedDB.deleteDatabase(name); request.onsuccess = resolve; request.onerror = () => reject(request.error); });
    }
  });
})
