// Server-side contract for private, explicitly accepted course edits. No provider
// calls, routes or learner mutations live here. UI integration is a separate gate.
import { createHash } from 'node:crypto';
import { parseHTML } from 'linkedom';
import { commitCourseRow } from './course-commit.mjs';
import { SectionSchema, FlashcardSchema, topicContentSchemaFor } from '../../js/generator/schema.mjs';

const clone = value => structuredClone(value);
const own = (object, key) => !!object && Object.hasOwn(object, key);
const idOK = value => typeof value === 'string' && /^[a-z0-9-]+$/.test(value);
const same = (a, b) => refinementFingerprint(a) === refinementFingerprint(b);
const fail = (code, message, statusCode = 400) => { const error = new Error(message); Object.assign(error, { code, statusCode }); throw error; };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const refinementFingerprint = value => createHash('sha256').update(JSON.stringify(canonical(value)) ?? 'null').digest('hex');
// A pending AI suggestion is private request metadata, not accepted course content.
// Keep the generic hash above unchanged for item identities and operation hashes.
export function courseRefinementFingerprint(course) {
  if (!course || typeof course !== 'object') return refinementFingerprint(course);
  const { _refinementProposal, _courseRevision, _courseUpdatedAt, _syncedAt, updatedAt, ...accepted } = course;
  return refinementFingerprint(accepted);
}

export function refinementTarget(course, input) {
  if (!course?.config?.id || !Array.isArray(course?.curriculum?.modules)) fail('unavailable', 'The saved learning path is not available.', 409);
  if (!input || !['lesson', 'section', 'flashcard'].includes(input.kind) || !idOK(input.moduleId) || !idOK(input.topicId)) fail('target', 'Choose a saved lesson or an item within it.');
  const mods = course.curriculum.modules.filter(mod => mod?.id === input.moduleId);
  if (mods.length !== 1) fail('target', 'The selected module is missing or ambiguous.');
  const mod = mods[0], topics = (Array.isArray(mod.topics) ? mod.topics : []).filter(topic => topic?.id === input.topicId);
  if (!Number.isInteger(Number(mod.number)) || Number(mod.number) < 1 || course.curriculum.modules.filter(item => String(item?.number) === String(mod.number)).length !== 1) fail('target', 'The saved module address is missing or ambiguous.');
  if (topics.length !== 1) fail('target', 'The selected lesson is missing or ambiguous.');
  if (!own(course.modules, mod.number) || !own(course.modules[mod.number], input.topicId)) fail('unavailable', 'This lesson has not been saved. Use build recovery first.', 409);
  const lesson = course.modules[mod.number][input.topicId];
  if (lesson?.id !== input.topicId || lesson?.moduleId !== input.moduleId || !Array.isArray(lesson.sections)) fail('unavailable', 'Saved lesson identifiers do not match the learning path.', 409);
  const target = { kind: input.kind, moduleId: mod.id, topicId: topics[0].id };
  let current = lesson;
  if (input.kind !== 'lesson') {
    const items = input.kind === 'section' ? lesson.sections : lesson.flashcards;
    if (!Number.isInteger(input.index) || input.index < 0 || !Array.isArray(items) || input.index >= items.length || !items[input.index]) fail('target', 'The selected item is no longer available.', 409);
    target.index = input.index; current = items[input.index];
  }
  return { target, mod, meta: topics[0], lesson, current, baseHash: courseRefinementFingerprint(course) };
}

function withoutTracking(value) {
  if (Array.isArray(value)) return value.map(withoutTracking);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => !['_progressId', '_contentRevision'].includes(key)).map(([key, val]) => [key, withoutTracking(val)]));
}

function validateMedia(section) {
  if (section.type !== 'image') return;
  if (section.asset_id && section.generated_by === 'openai' && section.image_slot === 'instruction' && section.alt?.trim()) return;
  const src = section.src;
  if (typeof src !== 'string' || !src.trim()) fail('media', 'Choose a saved image file or link; unresolved image references cannot replace saved content.');
  const embedded = /^data:image\/(png|jpeg|webp|gif);base64,[A-Za-z0-9+/]+={0,2}$/.test(src);
  const local = /^\/(?!\/)[a-zA-Z0-9/_.,@%+-]+$/.test(src) && !src.split('/').includes('..');
  let remote = false;
  try { const url = new URL(src); remote = url.protocol === 'https:' && !url.username && !url.password; } catch {}
  if (!embedded && !local && !remote) fail('media', 'Use an HTTPS image link or a supported saved raster image.');
  if (typeof section.alt !== 'string' || !section.alt.trim()) fail('media', 'Describe the instructional image with alternative text.');
  if (section.source_url) {
    let safe = false;
    try { const url = new URL(section.source_url); safe = url.protocol === 'https:' && !url.username && !url.password; } catch {}
    if (!safe) fail('media', 'Use an HTTPS source reference without credentials.');
  }
}

// A proposal may contain HTML for concept bodies. Reject active markup instead
// of silently accepting a sanitised version different from what was previewed.
function validateMarkup(value) {
  if (typeof value === 'string') {
    if (!value.includes('<')) return;
    const { document } = parseHTML(`<html><body><div>${value}</div></body></html>`);
    const tags = new Set(['HTML', 'HEAD', 'BODY', 'DIV', 'P', 'STRONG', 'EM', 'B', 'I', 'U', 'BR', 'UL', 'OL', 'LI', 'BLOCKQUOTE', 'CODE', 'PRE', 'H3', 'H4', 'A', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD']);
    for (const element of document.querySelectorAll('*')) {
      if (!tags.has(element.tagName)) fail('markup', 'Use simple text formatting, without active HTML or embedded controls.');
      const safeNewTab = element.tagName === 'A' && element.getAttribute('target') === '_blank'
        && /^(noopener noreferrer|noreferrer noopener)$/.test(element.getAttribute('rel') || '');
      for (const attribute of element.attributes) {
        if (!(element.tagName === 'A' && (['href', 'title'].includes(attribute.name) || safeNewTab && ['target', 'rel'].includes(attribute.name)))) fail('markup', 'Remove active HTML attributes from the replacement.');
        if (attribute.name === 'href') {
          let safe = false;
          try { const url = new URL(attribute.value); safe = url.protocol === 'https:' && !url.username && !url.password; } catch {}
          if (!safe) fail('markup', 'Use HTTPS links without embedded credentials.');
        }
      }
    }
    return;
  }
  if (Array.isArray(value)) value.forEach(validateMarkup);
  else if (value && typeof value === 'object') Object.values(value).forEach(validateMarkup);
}

function validateQuiz(section) {
  if (section.type !== 'quiz') return;
  if (section.variant === 'multiple-choice' && (new Set(section.options.map(option => option.id)).size !== section.options.length || !section.options.some(option => option.id === section.correct))) fail('validation', 'The quiz must have unique options and an answer that matches one of them.');
}

function revisionId(original, content, position) {
  const prefix = String(original || 'item').replace(/[^a-z0-9-]/gi, '-').toLowerCase().slice(0, 70);
  return `${prefix}-r-${refinementFingerprint({ content: withoutTracking(content), position }).slice(0, 16)}`;
}

function versionChangedItems(before, after, target) {
  after.sections = after.sections.map((section, index) => {
    if (!section.id) return section;
    const original = target.kind === 'section' && index === target.index ? before.sections[index]
      : before.sections.find(saved => saved.id === section.id);
    if (original && same(original, section)) return section;
    return { ...section, id: revisionId(section.id, section, index) };
  });
  after.flashcards = after.flashcards.map((card, index) => {
    const original = before.flashcards?.[index];
    if (original && same(withoutTracking(original), withoutTracking(card))) return clone(original);
    return { ...card, _progressId: revisionId(`${before.moduleId}-${before.id}-${index}`, card, index) };
  });
  after._contentRevision = refinementFingerprint(withoutTracking(after)).slice(0, 24);
}

export function proposeCourseRefinement(course, input, replacement, { allowedImageAssetId } = {}) {
  if (Buffer.byteLength(JSON.stringify(replacement) || '') > 1024 * 1024) fail('size', 'The replacement is too large. Edit a smaller item.');
  const selected = refinementTarget(course, input), { target, mod, meta, lesson, current } = selected;
  const brief = { ...(course._brief || {}), ...(Array.isArray(course.config.components) ? { components: course.config.components } : {}) };
  let next = clone(lesson), value;
  try {
    if (target.kind === 'lesson') {
      if (replacement?.id !== lesson.id || replacement?.moduleId !== lesson.moduleId) fail('identity', 'The replacement must stay in the selected lesson.');
      value = topicContentSchemaFor(brief, meta).parse(replacement); next = { ...next, ...value };
    } else if (target.kind === 'section') {
      if (replacement?.type !== current.type || current.type === 'quiz' && replacement?.variant !== current.variant) fail('identity', 'Keep the selected item type and quiz format.');
      value = SectionSchema.parse(replacement);
      if (current.id) value.id = current.id;
      next.sections[target.index] = value;
    } else {
      value = FlashcardSchema.parse(replacement); next.flashcards[target.index] = value;
    }
    // Validation must not strip or replace untouched legacy metadata.
    topicContentSchemaFor(brief, meta).parse(next);
  } catch (error) {
    if (error.code) throw error;
    const details = error.issues?.slice(0, 3).map(issue => `${issue.path.join(' → ') || 'Content'}: ${issue.message}`).join('; ');
    fail('validation', `Check the replacement before saving.${details ? ` ${details}` : ' It must meet the lesson’s selected-material requirements.'}`);
  }
  validateMarkup(value);
  if (next.sections.some(section => section.asset_id && section.asset_id !== allowedImageAssetId && !lesson.sections.some(old => old.asset_id === section.asset_id))) fail('media', 'Accept a generated image through Course images before adding it to a lesson.');
  (target.kind === 'lesson' ? next.sections : target.kind === 'section' ? [value] : []).forEach(section => { validateMedia(section); validateQuiz(section); });
  const changed = !same(withoutTracking(current), withoutTracking(value));
  if (!changed) return { target, baseHash: selected.baseHash, changed: false, replacement: clone(value), lesson: clone(lesson), course: clone(course), impact: { interactions: 0, flashcards: 0, lessonCompletion: false } };
  versionChangedItems(lesson, next, target);
  // ID changes cannot create ambiguous progress keys.
  const ids = next.sections.filter(section => section.id).map(section => section.id);
  if (new Set(ids).size !== ids.length) fail('validation', 'Interactive item identifiers must be unique.');
  const result = clone(course);
  result.modules[mod.number][meta.id] = next;
  const resultMeta = result.curriculum.modules.find(item => item.id === mod.id).topics.find(item => item.id === meta.id);
  resultMeta.contentRevision = next._contentRevision;
  if (target.kind === 'lesson') resultMeta.title = next.title;
  return { target, baseHash: selected.baseHash, changed: true, replacement: clone(value), lesson: next, course: result,
    impact: {
      interactions: next.sections.filter(section => section.id && !lesson.sections.some(old => old.id === section.id)).length,
      flashcards: next.flashcards.filter((card, index) => card._progressId !== lesson.flashcards?.[index]?._progressId).length,
      lessonCompletion: true
    } };
}

// Supabase must be user-scoped for public API callers. Explicit owner filters are
// still applied, so integration/service clients cannot accidentally widen scope.
export async function acceptCourseRefinement({ supabase, ownerId, courseId, target, replacement, baseHash, operationId, now = () => Date.now() }) {
  if (!ownerId || !/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,159}$/.test(courseId || '')) fail('identity', 'An account and saved course are required.');
  if (!/^[a-f0-9]{64}$/.test(baseHash || '') || !/^[a-zA-Z0-9_-]{16,80}$/.test(operationId || '')) fail('request', 'The saved revision and operation identifier are required.');
  const requestHash = refinementFingerprint({ target, replacement, baseHash });
  const { data: row, error } = await supabase.from('user_courses').select('id,payload,updated_at').eq('owner_id', ownerId).eq('id', courseId).maybeSingle();
  if (error) throw error;
  if (!row) fail('not_found', 'This saved course is not available to your account.', 404);
  if (row.payload?.config?.id !== courseId) fail('identity', 'The saved course identifier does not match its account record.', 409);
  if (row.payload?._lastRefinement?.operationId === operationId) {
    if (row.payload._lastRefinement.requestHash !== requestHash) fail('conflict', 'This operation already belongs to a different change.', 409);
    return { saved: true, replayed: true, payload: row.payload, updatedAt: row.updated_at };
  }
  if (courseRefinementFingerprint(row.payload) !== baseHash) fail('conflict', 'The saved course changed. Review its latest version before replacing anything.', 409);
  if (row.payload?.failedTopics?.length) fail('building', 'Finish recovering this course before editing its saved result.', 409);
  if (row.payload?._generationJobId) {
    const { data: job, error: jobError } = await supabase.from('generation_jobs').select('status').eq('owner_id', ownerId).eq('id', row.payload._generationJobId).maybeSingle();
    if (jobError) throw jobError;
    if (job && job.status !== 'completed') fail('building', 'Finish or recover the current build before editing its saved result.', 409);
  }
  const proposal = proposeCourseRefinement(row.payload, target, replacement);
  if (!proposal.changed) return { saved: false, unchanged: true, payload: row.payload, updatedAt: row.updated_at };
  const timestamp = Math.max(now(), (Date.parse(row.updated_at) || 0) + 1), updatedAt = new Date(timestamp).toISOString();
  const payload = { ...proposal.course, updatedAt: timestamp, _lastRefinement: { operationId, requestHash, target: proposal.target, at: updatedAt } };
  const suggestion = row.payload._refinementProposal;
  if (['ready', 'stale'].includes(suggestion?.status) && same(suggestion.target, proposal.target) && same(suggestion.proposal?.replacement, proposal.replacement)) {
    payload._refinementProposal = { ...suggestion, status: 'applied', proposal: null, finishedAt: updatedAt };
  }
  const saved = await commitCourseRow({ supabase, ownerId, courseId, row, payload });
  if (!saved) fail('conflict', 'A newer course was saved while you were editing. Your change has not replaced it.', 409);
  return { saved: true, replayed: false, payload: saved.payload, updatedAt: saved.updated_at, impact: proposal.impact };
}
