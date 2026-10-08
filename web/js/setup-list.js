import { prepareAccountPayload } from './setup-account-model.js?v=7';

const started = new Set(['running', 'queued', 'cancelling', 'review_curriculum', 'review_research', 'completed', 'partial', 'failed', 'timed_out']);

// A setup remains recoverable at its URL. Omit only unchanged requests already
// represented by a job/course from the unfinished list; never delete originals.
export async function mergeUnfinishedSetups(local, remote, fingerprint = prepareAccountPayload) {
  const drafts = new Map(), byId = new Map(remote.map(row => [row.id, row]));
  const represented = row => row?.generation?.id && started.has(row.generation.status);
  for (const row of remote) if (!represented(row)) drafts.set(row.id, { id: row.id, brief: row.brief, step: 'review', cloudOnly: true, updatedAt: Date.parse(row.updated_at) });
  for (const draft of local) {
    const row = byId.get(draft.id);
    if (represented(row) && !draft.unsaved && draft.cloud?.contentHash === row.content_hash) {
      try {
        // Compare actual current inputs, not only an old save acknowledgement.
        // Edited notes/components or replaced files must stay discoverable.
        if ((await fingerprint(draft)).hash === row.content_hash) continue;
      } catch { /* Unreadable/missing local material stays available for recovery. */ }
    }
    drafts.set(draft.id, draft);
  }
  return [...drafts.values()];
}
