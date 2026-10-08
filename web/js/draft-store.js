// Device-local setup only. This module never authenticates, uploads or generates.
import { CREATION_COMPONENTS, creationComponents } from './generator/component-policy.mjs?v=3';
export const DRAFT_SCHEMA = 1;
export const DRAFT_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
export const NOTE_CHARACTER_LIMIT = 12000;
export const DRAFT_FILE_LIMIT = 5;
export const DRAFT_FILE_BYTES = 10 * 1024 * 1024;
const DB_NAME = 'learnable-creation-drafts';
const briefFields = ['topic', 'goal', 'audience', 'starting_point', 'depth', 'experience', 'context'];
const steps = ['home', 'goal', 'experience', 'context', 'review'];
export const DRAFT_COMPONENTS = [...CREATION_COMPONENTS];

export class DraftError extends Error {
  constructor(code, message) { super(message); this.name = 'DraftError'; this.code = code; }
}

export function draftScope(ownerId = null) {
  if (ownerId === null || ownerId === '') return 'guest';
  if (typeof ownerId !== 'string') throw new DraftError('invalid', 'Invalid draft owner.');
  return `account:${ownerId}`;
}

function identifier(value) {
  if (typeof value !== 'string' || !value || value.length > 200) throw new DraftError('invalid', 'Invalid draft identifier.');
  return value;
}
const text = value => typeof value === 'string' ? value : '';

// Explicit allowlist: account credentials, generation IDs and arbitrary imported
// properties must not hitch a ride in a local draft or a downloaded setup.
export function draftContent(input = {}) {
  const sources = input.sources || {};
  const brief = Object.fromEntries(briefFields.map(key => [key, text(input.brief?.[key])]));
  const notes = (sources.notes || []).map(note => ({ id: identifier(note.id), title: text(note.title), text: text(note.text) }));
  const links = (sources.links || []).map(link => ({ id: identifier(link.id), title: text(link.title), url: text(link.url) }));
  const files = (sources.files || []).map(file => {
    const blob = file.blob instanceof Blob ? file.blob : null;
    const size = blob ? blob.size : Number(file.size) || 0;
    if (size < 0 || size > DRAFT_FILE_BYTES) throw new DraftError('file-limit', 'Each file must be 10 MB or smaller.');
    return { id: identifier(file.id), name: text(file.name), type: text(file.type || blob?.type), size, blob,
      status: blob ? 'saved-local' : 'needs-reattach' };
  });
  if (files.length > DRAFT_FILE_LIMIT) throw new DraftError('file-limit', 'Keep at most five files in one draft.');
  for (const collection of [notes, links, files]) {
    if (new Set(collection.map(item => item.id)).size !== collection.length) throw new DraftError('invalid', 'Duplicate source identifier.');
  }
  const components = creationComponents(input.components);
  return { step: steps.includes(input.step) ? input.step : 'goal', brief, components, sources: { notes, links, files } };
}

export function noteCharacters(value) { return Array.from(text(value)).length; }

export function draftExport(draft) {
  const content = draftContent(draft);
  return JSON.stringify({ format: 'learnable-setup', schemaVersion: DRAFT_SCHEMA,
    notice: 'Text-only backup. Original files are not included; keep them separately and reattach them.',
    ...content, sources: { ...content.sources, files: content.sources.files.map(({ blob, ...file }) => ({ ...file, status: 'needs-reattach' })) }
  }, null, 2);
}

function storageError(error) {
  if (error instanceof DraftError) return error;
  const code = error?.name === 'QuotaExceededError' ? 'quota' : 'unavailable';
  return new DraftError(code, code === 'quota' ? 'This browser has no space to save the draft.' : 'This browser could not save or load drafts.');
}

export function createDraftStore({ indexedDB = globalThis.indexedDB, dbName = DB_NAME, now = Date.now } = {}) {
  let connection = null;
  let opening = null;

  function open() {
    if (connection) return Promise.resolve(connection);
    if (opening) return opening;
    opening = new Promise((resolve, reject) => {
      if (!indexedDB) { reject(new DraftError('unavailable', 'Draft storage is unavailable in this browser.')); return; }
      let settled = false;
      const timer = setTimeout(() => fail(new DraftError('unavailable', 'Draft storage did not respond.')), 2000);
      function fail(error) { if (!settled) { settled = true; clearTimeout(timer); reject(storageError(error)); } }
      let request;
      try { request = indexedDB.open(dbName, 1); } catch (error) { fail(error); return; }
      request.onupgradeneeded = () => {
        const store = request.result.createObjectStore('drafts', { keyPath: ['scope', 'id'] });
        store.createIndex('scope', 'scope');
      };
      request.onblocked = () => fail(new DraftError('blocked', 'Close the older Learnable tab and retry saving.'));
      request.onerror = () => fail(request.error);
      request.onsuccess = () => {
        const db = request.result;
        if (settled) { db.close(); return; }
        settled = true; clearTimeout(timer); connection = db;
        db.onversionchange = () => { db.close(); connection = null; };
        db.onclose = () => { if (connection === db) connection = null; };
        resolve(db);
      };
    }).finally(() => { opening = null; });
    return opening;
  }

  async function transaction(mode, work) {
    const db = await open();
    return new Promise((resolve, reject) => {
      let tx, result, failure;
      try { tx = db.transaction('drafts', mode); } catch (error) { connection = null; reject(storageError(error)); return; }
      const timer = setTimeout(() => { failure = new DraftError('unavailable', 'Draft storage did not respond.'); try { tx.abort(); } catch {} }, 5000);
      const fail = error => { failure = error; try { tx.abort(); } catch {} };
      tx.oncomplete = () => { clearTimeout(timer); resolve(result); };
      tx.onabort = () => { clearTimeout(timer); reject(storageError(failure || tx.error)); };
      tx.onerror = () => {}; // onabort reports the failed transaction, never request success.
      try { work(tx.objectStore('drafts'), value => { result = value; }, fail); } catch (error) { fail(error); }
    });
  }

  function state(record) {
    if (!record) return 'missing';
    if (record.deleted) return 'deleted';
    if (record.schemaVersion !== DRAFT_SCHEMA || !Number.isInteger(record.revision) || !Number.isFinite(record.expiresAt)) return 'incompatible';
    return record.expiresAt <= now() ? 'expired' : 'found';
  }

  return {
    async load(id, ownerId = null) {
      identifier(id);
      const scope = draftScope(ownerId);
      return transaction('readwrite', (store, done) => {
        const request = store.get([scope, id]);
        request.onsuccess = () => {
          const record = request.result;
          const status = state(record);
          // Expiry is only for this new local store. Never touch old auth intents,
          // account cloud copies, or another owner's records.
          if (status === 'expired') store.delete([scope, id]);
          done(status === 'found' ? { status, draft: record } : { status });
        };
      });
    },
    async list(ownerId = null) {
      const scope = draftScope(ownerId);
      return transaction('readwrite', (store, done) => {
        const request = store.index('scope').getAll(scope);
        request.onsuccess = () => {
          const drafts = []; let expiredCount = 0; let incompatibleCount = 0;
          for (const record of request.result) {
            const status = state(record);
            if (status === 'expired') { store.delete([scope, record.id]); expiredCount++; }
            else if (status === 'incompatible') incompatibleCount++;
            else if (status === 'found') drafts.push(record);
          }
          done({ drafts: drafts.sort((a, b) => b.updatedAt - a.updatedAt || b.revision - a.revision), expiredCount, incompatibleCount });
        };
      });
    },
    async save(input, { ownerId = null, expectedRevision = 0 } = {}) {
      const id = identifier(input.id);
      const scope = draftScope(ownerId);
      const content = draftContent(input);
      if (!Number.isInteger(expectedRevision) || expectedRevision < 0) throw new DraftError('invalid', 'Invalid draft revision.');
      return transaction('readwrite', (store, done, fail) => {
        const request = store.get([scope, id]);
        request.onsuccess = () => {
          try {
          const old = request.result;
          if (old && state(old) !== 'found') { fail(new DraftError(state(old), 'This saved draft cannot be replaced. Save your text as a new draft.')); return; }
          if ((old?.revision || 0) !== expectedRevision) { fail(new DraftError('conflict', 'Another tab saved a newer version. Your text has not been overwritten.')); return; }
          const time = now();
          const cloud = input.cloud && Number.isInteger(input.cloud.revision) && input.cloud.revision > 0 && /^[a-f0-9]{64}$/.test(input.cloud.contentHash)
            ? { revision: input.cloud.revision, contentHash: input.cloud.contentHash, updatedAt: text(input.cloud.updatedAt) } : undefined;
          const record = { id, scope, schemaVersion: DRAFT_SCHEMA, revision: expectedRevision + 1,
            createdAt: old?.createdAt || time, updatedAt: time, expiresAt: time + DRAFT_RETENTION_MS, ...content };
          if (cloud) record.cloud = cloud;
          store.put(record);
          done(record);
          } catch (error) { fail(error); }
        };
      });
    },
    async claim(id, { ownerId, expectedRevision } = {}) {
      identifier(id);
      if (!ownerId) throw new DraftError('invalid', 'Choose an account before attaching a setup.');
      const scope = draftScope(ownerId);
      return transaction('readwrite', (store, done, fail) => {
        const source = store.get(['guest', id]);
        source.onsuccess = () => {
          const guest = source.result;
          if (state(guest) !== 'found' || guest.revision !== expectedRevision) { fail(new DraftError('conflict', 'The guest setup changed. Reopen it before attaching.')); return; }
          const target = store.get([scope, id]);
          target.onsuccess = () => {
            try {
              if (target.result) { fail(new DraftError('conflict', 'An account-local setup already exists. Neither copy was replaced.')); return; }
              const record = { ...guest, scope, updatedAt: now(), expiresAt: now() + DRAFT_RETENTION_MS };
              store.put(record); store.delete(['guest', id]); done(record);
            } catch (error) { fail(error); }
          };
        };
      });
    },
    async remove(id, { ownerId = null, expectedRevision, tombstone = false } = {}) {
      identifier(id);
      const scope = draftScope(ownerId);
      return transaction('readwrite', (store, done, fail) => {
        const request = store.get([scope, id]);
        request.onsuccess = () => {
          if (request.result?.deleted) { done(true); return; }
          if (!request.result && !tombstone) { done(false); return; }
          if ((request.result?.revision || 0) !== expectedRevision) { fail(new DraftError('conflict', 'The draft changed. Reload it before deleting.')); return; }
          // Tiny content-free marker prevents a delayed first save or old tab
          // from recreating this ID. Attached local file bytes are released.
          if (tombstone) store.put({scope,id,deleted:true,schemaVersion:DRAFT_SCHEMA,revision:expectedRevision+1});
          else store.delete([scope,id]);
          done(true);
        };
      });
    },
    close() { connection?.close(); connection = null; }
  };
}
