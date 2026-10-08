// Automatic, initial-draft learner-experience refinement. This is not the
// user-facing editor. Every paid action has a durable intent before dispatch;
// course content and its progress commit atomically under the generation lease.
import { createHash, randomUUID } from 'node:crypto';
import { runCourseVisualReview, runLessonVisualDesign, usesVisualDesigner, VISUAL_DESIGNER_POLICY, visualDesignFailureDiagnostic } from '../../js/generator/stages/visual-design.mjs';
import { compactTokenUsage, createTokenUsageLedger, recordTokenUsage } from './token-usage.mjs';
import { isGenerationPause, GENERATION_IO_UNCERTAIN } from './gen-request-budget.mjs';

export { usesVisualDesigner };
const clone = value => structuredClone(value);
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
export const designHash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');

export function designLessons(course) {
  if (!usesVisualDesigner(course?._brief)) fail('VISUAL_DESIGN_POLICY', 'This saved draft does not use the Visual Designer. No lesson was changed.');
  const rows = [];
  for (const mod of course.curriculum?.modules || []) for (const topic of mod.topics || []) {
    const lesson = course.modules?.[mod.number]?.[topic.id];
    if (!lesson || lesson.id !== topic.id || lesson.moduleId !== mod.id || !Array.isArray(lesson.sections)) {
      fail('VISUAL_DESIGN_INCOMPLETE', 'Finish the missing lessons before refining this course. Your saved content is retained.');
    }
    rows.push({ key: `${mod.id}/${topic.id}`, number: mod.number, target: { moduleId: mod.id, topicId: topic.id }, lesson });
  }
  if (!rows.length || rows.length > 48 || new Set(rows.map(row => row.key)).size !== rows.length || course.failedTopics?.length) {
    fail('VISUAL_DESIGN_INCOMPLETE', 'The complete learning path is not available for refinement. Your saved content is retained.');
  }
  return rows;
}

// Ignore generated draft assets so image-only continuation can verify the same
// refined teaching content after some images have been attached. All authored
// content, source images, plans and course identity remain in the fingerprint.
export function designContentHash(course) {
  const modules = clone(course.modules || {});
  for (const lessons of Object.values(modules)) for (const lesson of Object.values(lessons || {})) {
    lesson.sections = (lesson.sections || []).filter(s => !(s.type === 'image' && s.generated_by === 'openai' && s.image_slot === 'instruction'));
  }
  return designHash({ config: course.config, curriculum: course.curriculum, modules, brief: course._brief });
}
export function designProgress(course) {
  const state = course._visualDesign, rows = designLessons(course);
  const items = Object.fromEntries(rows.filter(row => state?.items?.[row.key]?.status === 'saved')
    .map(row => [row.key, { status: 'saved', outputHash: state.items[row.key].outputHash }]));
  return { version: 1, status: state?.status || 'reviewing', cycle: state?.cycle || null,
    total: rows.length, completed: Object.keys(items).length, reviewed: !!state?.review, items };
}
export function assertDesignComplete(course) {
  const state = course._visualDesign, progress = designProgress(course);
  if (state?.policy !== VISUAL_DESIGNER_POLICY || state?.version !== 1 || state.status !== 'complete'
    || state.pending || !progress.reviewed || progress.completed !== progress.total
    || state.contentHash !== designContentHash(course)) {
    fail('VISUAL_DESIGN_INCOMPLETE', 'The refined lesson draft is not confirmed. Resume this course before creating its illustrations.');
  }
  return progress;
}

export async function runVisualDesigner({ supabase, ownerId, jobId, runId, courseId, client,
  model, requestBudget, assertRunnerWritable, patch, withHeartbeat = (_label, work) => work(),
  retryFailedDesign = false, review = runCourseVisualReview, refine = runLessonVisualDesign } = {}) {
  async function load() {
    const { data, error } = await supabase.from('user_courses').select('payload,updated_at')
      .eq('owner_id', ownerId).eq('id', courseId).maybeSingle();
    if (error) throw error;
    if (!data?.payload || data.payload._generationJobId !== jobId) fail('VISUAL_DESIGN_CONFLICT', 'The saved draft no longer belongs to this generation job. No lesson was changed.');
    designLessons(data.payload);
    return data;
  }
  let row = await load(), course = row.payload;
  if (course._visualDesign?.status === 'complete') {
    const progress = assertDesignComplete(course);
    await patch({ design_progress: progress });
    return { course, progress };
  }
  await patch({ stage: 'design', message: 'Visual Designer is reviewing the finished course…' });
  async function commit(next) {
    await assertRunnerWritable();
    const progress = designProgress(next);
    const { data, error } = await supabase.rpc('commit_generation_design', {
      p_owner: ownerId, p_job: jobId, p_run: runId, p_course: courseId,
      p_updated_at: row.updated_at, p_revision: row.payload._courseRevision,
      p_payload: next, p_progress: progress,
    });
    if (error) throw Object.assign(new Error('The refined draft save could not be confirmed. Check the saved state before trying again.'), { code: GENERATION_IO_UNCERTAIN });
    if (data?.error || !data?.saved || !data.payload?._courseRevision || !data.updatedAt) {
      fail('VISUAL_DESIGN_CONFLICT', 'The course or generation changed while refining. Your saved work is retained; no stale edit was applied.');
    }
    row = { payload: data.payload, updated_at: data.updatedAt }; course = row.payload;
    return progress;
  }
  if (!course._visualDesign) {
    if (designLessons(course).some(x => x.lesson.sections.some(s => s.asset_id && s.generated_by === 'openai'))) {
      fail('VISUAL_DESIGN_CONFLICT', 'This draft already has generated images. It will not be automatically rewritten.');
    }
    const next = clone(course);
    next._visualDesign = { version: 1, policy: VISUAL_DESIGNER_POLICY, cycle: randomUUID(),
      sourceRevision: course._courseRevision, status: 'reviewing', review: null, items: {}, pending: null,
      contentHash: designContentHash(course), usage: compactTokenUsage(createTokenUsageLedger()) };
    await commit(next);
  }
  if (course._visualDesign.policy !== VISUAL_DESIGNER_POLICY || course._visualDesign.contentHash !== designContentHash(course)) {
    fail('VISUAL_DESIGN_CONFLICT', 'The course changed after refinement began. Your latest content is retained; review it before continuing.');
  }
  const pending = course._visualDesign.pending;
  if (pending && !(pending.status === 'failed' && retryFailedDesign)) {
    fail('VISUAL_DESIGN_UNCERTAIN', pending.status === 'failed'
      ? 'The Visual Designer needs attention. Your lessons are saved. Resume the course to retry the failed step.'
      : 'A Visual Designer request has an unconfirmed result or charge. Your lessons are saved. No replacement request will run automatically.');
  }

  async function action(key, work, apply) {
    await assertRunnerWritable();
    requestBudget.assertCanStart(); // Safe scheduling check before persisting a paid intent.
    // The database bounds this checkpoint to 128 KiB. Reserve the largest valid
    // next audit result plus intent/usage before spending. Never trim review flags.
    const reserve = key === 'course' ? 28000 : 4000;
    if (Buffer.byteLength(JSON.stringify(course._visualDesign, null, 1), 'utf8') + reserve > 124000) {
      fail('VISUAL_DESIGN_CAPACITY', 'The saved review notes have reached this draft’s limit. Your lessons and prior results are retained. No further AI request was sent.');
    }
    let next = clone(course);
    next._visualDesign.pending = { id: randomUUID(), key, status: 'started' };
    next._visualDesign.status = key === 'course' ? 'reviewing' : 'refining';
    await commit(next); // If acknowledgement is lost, don't dispatch or overwrite it.
    let received = false;
    const usage = createTokenUsageLedger();
    let result;
    try {
      result = await withHeartbeat(key === 'course' ? 'course visual review' : `refining ${key}`, () => work({
        model, onDispatch: () => { received = false; }, onUsage: (value, meta = {}) => {
          received = true;
          recordTokenUsage(usage, { task: key === 'course' ? 'visual_review' : 'visual_refinement', provider: 'anthropic', model, usage: value,
            meta: { operationId: course._visualDesign.pending.id, ...(key === 'course' ? {} : { lesson: key }),
              stage: 'visual_design', operation: meta.operation || null } });
        },
      }));
    } catch (error) {
      // Both bounded proposals failed validation, or a provider dispatch failed.
      // Only the latest response determines certainty; all returned usage stays.
      // Transport/crash outcomes remain held. A pre-dispatch time slice is safe.
      next = clone(course);
      const safe = isGenerationPause(error);
      const known = received || error?.kind === 'visual_design' || Number.isInteger(error?.status) && error.status >= 400 && error.status < 500 && error.status !== 408;
      const diagnostic = { ...visualDesignFailureDiagnostic(error, received),
        operation: key === 'course' ? 'course_review' : 'lesson_refinement',
        operationId: next._visualDesign.pending.id, at: new Date().toISOString() };
      if (!safe) next._visualDesign.lastFailure = diagnostic;
      next._visualDesign.pending = safe ? null : { ...next._visualDesign.pending, status: known ? 'failed' : 'unknown' };
      next._visualDesign.status = safe ? (key === 'course' ? 'reviewing' : 'refining') : 'attention';
      mergeUsage(next._visualDesign.usage, usage);
      next._tokenUsage ||= compactTokenUsage(createTokenUsageLedger());
      mergeUsage(next._tokenUsage, usage);
      await commit(next);
      if (safe) throw error;
      const actionLabel = key === 'course' ? 'course review' : 'lesson refinement';
      const message = known
        ? `The Visual Designer stopped during ${actionLabel}. Your saved lessons are retained. Resume retries this step only. Reference: ${diagnostic.code}.`
        : `The Visual Designer ${actionLabel} result or charge is uncertain. Your saved lessons are retained. No replacement request will run automatically. Reference: ${diagnostic.code}.`;
      throw Object.assign(new Error(message), { code: known ? 'VISUAL_DESIGN_FAILED' : 'VISUAL_DESIGN_UNCERTAIN', diagnostic });
    }
    await assertRunnerWritable();
    next = clone(course);
    apply(next, result);
    next._visualDesign.pending = null;
    mergeUsage(next._visualDesign.usage, usage);
    next._tokenUsage ||= compactTokenUsage(createTokenUsageLedger());
    mergeUsage(next._tokenUsage, usage);
    next._visualDesign.contentHash = designContentHash(next);
    await commit(next); // Lost ACK stays reconcilable; never discard a returned edit.
  }

  if (!course._visualDesign.review) {
    await action('course', opts => review(client, course, opts), (next, result) => {
      next._visualDesign.review = result;
      next._visualDesign.status = 'refining';
    });
  }
  for (const selected of designLessons(course)) {
    if (course._visualDesign.items[selected.key]?.status === 'saved') continue;
    const inputHash = designHash(course.modules[selected.number][selected.target.topicId]);
    await patch({ message: `Visual Designer is refining lessons — ${designProgress(course).completed}/${designProgress(course).total} saved` });
    await action(selected.key, opts => refine(client, course, selected.target, course._visualDesign.review, opts), (next, result) => {
      next.modules[selected.number][selected.target.topicId] = result.lesson;
      const title = result.lesson.title;
      if (title) {
        const meta = next.curriculum.modules.find(mod => mod.id === selected.target.moduleId)?.topics.find(topic => topic.id === selected.target.topicId);
        if (meta) meta.title = title;
      }
      next._visualDesign.items[selected.key] = { status: 'saved', inputHash, outputHash: designHash(result.lesson),
        flags: result.flags || [], summary: result.summary || '', changed: !!result.changed };
    });
  }
  const next = clone(course); next._visualDesign.status = 'complete';
  const progress = await commit(next);
  assertDesignComplete(course);
  return { course, progress };
}

function mergeUsage(target, added) {
  for (const key of Object.keys(added.total)) target.total[key] = (target.total[key] || 0) + added.total[key];
  for (const [task, bucket] of Object.entries(added.byTask)) {
    target.byTask[task] ||= Object.fromEntries(Object.keys(bucket).map(key => [key, 0]));
    for (const key of Object.keys(bucket)) target.byTask[task][key] += bucket[key];
  }
  target.calls.push(...added.calls);
}
