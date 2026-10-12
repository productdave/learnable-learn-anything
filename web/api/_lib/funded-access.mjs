// F-01 deliberately never enables funded dispatch. Provider dollars and learner
// credits remain separate; F-02 must add holds/debits before this changes.
export async function readFundedAccess(client, ownerId, { rollout = process.env.LEARNABLE_FUNDED_ACCESS || 'legacy', now = Date.now() } = {}) {
  if (!ownerId) throw new Error('Verified owner required');
  if (!['legacy','pilot'].includes(rollout)) throw new Error('Invalid funding rollout');
  const { data: row, error } = await client.rpc('learnable_account_access', { p_owner_id: ownerId });
  if (error) throw new Error('Account access unavailable');
  if (row == null) return rollout === 'legacy'
    ? { mode: 'legacy', status: 'legacy', balance: null, canCreate: false }
    : { mode: 'platform', status: 'not_invited', balance: null, canCreate: false };
  if (row.ownerId !== ownerId || !['legacy','platform'].includes(row.mode) || !['active','paused','revoked'].includes(row.state)
    || !Number.isSafeInteger(row.granted) || row.granted < 0
    || (row.expiresAt !== null && !Number.isFinite(Date.parse(row.expiresAt)))) throw new Error('Invalid account access');
  if (row.mode === 'legacy') return { mode: 'legacy', status: 'legacy', balance: null, canCreate: false };
  // Switching rollout off must never switch an enrolled account back to BYOK.
  const status = row.state !== 'active' ? row.state : row.expiresAt && Date.parse(row.expiresAt) <= now ? 'expired' : rollout === 'legacy' ? 'paused' : row.granted === 0 ? 'empty' : 'included';
  // This migration supports grants only. No charge/hold writer exists in F-01.
  return { mode: 'platform', status, expiresAt: row.expiresAt,
    balance: { available: row.granted, reserved: 0, used: 0 }, canCreate: false };
}

export function fundedStartBlock(access) {
  return { code: 'funded_creation_unavailable', funding: 'platform', access,
    ready: false, enabled: false, issues: [], sources: null,
    error: 'Credit-based creation is not available yet. Your setup is saved and no credits were used.' };
}
