// CAS against the version captured with the original content, never a freshly
// fetched version attached to stale content. No direct-write compatibility fallback.
export async function commitCourseRow({ supabase, ownerId, courseId, row = null, payload = null, action = 'save' }) {
  const { data, error } = await supabase.rpc('commit_user_course', {
    p_owner: ownerId, p_id: courseId,
    p_expected_revision: row?.payload?._courseRevision || null,
    p_updated_at: row?.updated_at || null, p_payload: payload, p_action: action
  });
  if (error) throw error;
  if (data?.error === 'conflict') return null;
  if (data?.deleted === true && action === 'delete') return { deleted: true };
  if (!data?.saved || !data.payload?._courseRevision || !data.updatedAt) throw new Error('The course save could not be confirmed. Check the saved course before retrying.');
  return { id: courseId, payload: data.payload, updated_at: data.updatedAt };
}
