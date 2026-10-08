// Test-double adapter only. Real authorization/trigger tests live separately.
import { randomUUID } from 'node:crypto';
export function withCourseCommitRpc(client) {
  client.rpc = async (name, p) => {
    if (name !== 'commit_user_course') throw new Error(`Unexpected RPC ${name}`);
    const read = await client.from('user_courses').select('id,payload,updated_at').eq('owner_id', p.p_owner).eq('id', p.p_id).maybeSingle();
    if (read.error) return read;
    const row = read.data, conflict = () => ({ data: { error: 'conflict' } });
    if (row ? row.updated_at !== p.p_updated_at || (row.payload?._courseRevision || null) !== p.p_expected_revision : p.p_updated_at || p.p_expected_revision || p.p_action === 'delete') return conflict();
    if (p.p_action === 'delete') {
      const deleted = await client.from('user_courses').delete().eq('owner_id', p.p_owner).eq('id', p.p_id).eq('updated_at', p.p_updated_at).select('id').maybeSingle();
      return deleted.error ? deleted : deleted.data ? { data: { deleted: true } } : conflict();
    }
    const updatedAt = new Date(Math.max(Date.now(), (Date.parse(row?.updated_at) || 0) + 1)).toISOString();
    const payload = { ...p.p_payload, _courseRevision: randomUUID(), _courseUpdatedAt: updatedAt, updatedAt: Date.parse(updatedAt) };
    const value = { payload, updated_at: updatedAt };
    const result = row
      ? await client.from('user_courses').update(value).eq('owner_id', p.p_owner).eq('id', p.p_id).eq('updated_at', p.p_updated_at).select('id').maybeSingle()
      : await client.from('user_courses').insert({ ...value, id: p.p_id, owner_id: p.p_owner });
    if (result.error?.code === '23505') return conflict();
    if (result.error) return result;
    if (row && !result.data) return conflict();
    return { data: { saved: true, payload, updatedAt } };
  };
  return client;
}
