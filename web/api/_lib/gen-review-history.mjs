const MAX_REVIEW_HISTORY = 50;

export function appendReviewHistory(history, { action, feedback = '', fromStatus = '', runId = '', at = new Date().toISOString() } = {}) {
  const prior = Array.isArray(history) ? history : [];
  const entry = {
    action: String(action || ''),
    from_status: String(fromStatus || ''),
    feedback: String(feedback || '').trim(),
    run_id: String(runId || ''),
    at
  };
  const last = prior.at(-1);
  if (last
    && last.action === entry.action
    && last.from_status === entry.from_status
    && String(last.feedback || '').trim() === entry.feedback) {
    return [...prior.slice(0, -1), entry].slice(-MAX_REVIEW_HISTORY);
  }
  return [...prior, entry].slice(-MAX_REVIEW_HISTORY);
}
