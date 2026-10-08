import { createHash } from 'node:crypto';
import { normalizeAccountPayload, setupIdentifier } from '../../js/setup-account-model.js';
import { inspectSetupSources } from './setup-generation.mjs';

const issue = (statusCode, message) => Object.assign(new Error(message), { statusCode });
export function requireSourceCheckpoint(job, expectedRunId) {
  if (job?.status !== 'review_research' || !job.brief) throw issue(409, 'Research has moved on. Return to the latest review before adjusting sources.');
  if (expectedRunId !== undefined && expectedRunId !== (job.run_id || null)) throw issue(409, 'This review changed in another tab. Your edits have not replaced it. Return to the latest review.');
}

export async function reviewSourceDraft(job, owner, client) {
  requireSourceCheckpoint(job);
  const request = job.user_brief || {};
  let sources = request.source_manifest;
  let storageId = request.source_storage_id || request.setup_reference?.id || job.id;
  if (!sources && request.setup_reference) {
    const { data, error } = await client.from('course_setups').select('payload,content_hash').eq('owner_id', owner).eq('id', request.setup_reference.id).maybeSingle();
    if (error) throw issue(503, 'Couldn’t load the original sources. Retry in a moment.');
    if (!data || data.content_hash !== request.setup_reference.hash) throw issue(409, 'The original setup has changed. Its sources cannot safely replace this review.');
    sources = data.payload.sources;
  }
  if (!sources) {
    // Older requests have flat text/URLs. Split without losing any characters.
    const characters = Array.from(request.source_text || '');
    const notes = [];
    for (let start = 0; start < characters.length; start += 12000) notes.push({ id: `original-note-${notes.length + 1}`, title: 'Original source text', text: characters.slice(start, start + 12000).join('') });
    sources = { notes, links: (request.source_urls || []).map((url, i) => ({ id: `original-link-${i + 1}`, title: '', url })), files: [] };
    storageId = job.id;
  }
  setupIdentifier(storageId);
  const brief = Object.fromEntries(['topic', 'audience', 'goal', 'starting_point', 'context', 'depth'].map(key => [key, String(request[key] || '')]));
  brief.topic ||= job.brief.title || 'Course';
  brief.audience ||= job.brief.learner_persona || 'Learners';
  brief.experience = request.learning_approach || 'understand';
  const draft = normalizeAccountPayload({ schemaVersion: 1, brief, components: request.components || ['lessons', 'quizzes', 'flashcards'], sources });
  return { draft, storageId, runId: job.run_id || null, legacyFiles: (request.pdfRefs || []).map(file => ({ name: String(file.name || 'Original PDF') })) };
}

export async function inspectReviewSources(job, owner, client, input) {
  requireSourceCheckpoint(job, input?.expectedRunId);
  if (!Object.hasOwn(input || {}, 'expectedRunId')) throw issue(400, 'Reload the source editor before checking changes.');
  const current = await reviewSourceDraft(job, owner, client);
  let payload;
  try { payload = normalizeAccountPayload({ ...current.draft, sources: input.sources }); }
  catch (error) { throw issue(400, error.message); }
  if (payload.sources.links.length > 10) throw issue(400, 'Use up to 10 source links.');
  if (payload.sources.files.length + current.legacyFiles.length > 5) throw issue(400, 'Use up to 5 files, including the original PDFs.');
  const hash = createHash('sha256').update(JSON.stringify(payload.sources)).digest('hex');
  const inspection = await inspectSetupSources({ id: current.storageId, payload, content_hash: hash }, owner, client);
  return { ...current, previousSources: current.draft.sources, draft: payload, inspection };
}

export async function acceptedReviewSources(job, owner, client, input) {
  const checked = await inspectReviewSources(job, owner, client, input);
  if (checked.inspection.issues.length) throw issue(400, checked.inspection.issues.map(value => value.text).join(' '));
  if (!input.sourceReview || input.sourceReview !== checked.inspection.review.digest) throw issue(409, 'Check the source changes again before using them.');
  return {
    source_text: checked.inspection.source_text,
    source_urls: checked.draft.sources.links.filter(link => link.url.trim()).map(link => link.url),
    source_manifest: checked.draft.sources,
    source_storage_id: checked.storageId,
    source_review: { previous_research: job.research || {}, previous_sources: checked.previousSources, changed_at: new Date().toISOString() }
  };
}
