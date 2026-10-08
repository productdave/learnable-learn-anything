// Server-side generation runner:
//   - State persists to the generation_jobs Supabase row after every stage
//     boundary, so a function timeout / crash / cancel can resume.
//   - Cancellation is signalled by setting generation_jobs.status to
//     cancelling; the runner checks between dispatches and finalizes it.
//   - Failures are categorised (api / schema / unknown) and written to the
//     row's `failures` jsonb column.
//   - The assembled course is written to user_courses on success — the
//     existing course-sync layer on the client will pull it down.
//
// Reuses the stage modules from web/js/generator/stages/*.mjs as pure
// generation steps. The browser no longer orchestrates course generation.

import { runIntake } from '../../js/generator/stages/intake.mjs';
import { runResearch } from '../../js/generator/stages/research.mjs';
import { runTopic } from '../../js/generator/stages/topic.mjs';
import { getTone } from '../../js/generator/tones/conversational.mjs';
import { createClient as createAnthropic } from '../../js/generator/anthropic-fetch.js';
import { assembleCourse } from '../../js/generator/assemble-course.js';
import { retainComponentChoices } from '../../js/generator/component-policy.mjs';
import { compatibleTopicCheckpoint } from '../../js/generator/schema.mjs';
import { signedPdfUrl } from './supabase-server.mjs';
import { agentMessage, agentNameForStage } from '../../js/generator/agents.mjs';
import { clearSavedCourseIdForJob, reconcileGeneratedCourseRun, rollbackGeneratedCourseSave, saveGeneratedCourse } from './course-save.mjs';
import { clearResearchFailure, clearTopicFailure, pruneResolvedFailures, replaceResearchFailure, replaceTopicFailure } from './gen-failures.mjs';
import { outlineForBrief, topicCountForBrief } from './gen-brief.mjs';
import { missingResearchModules } from './gen-research-checkpoint.mjs';
import { extractUrlContent } from './url-extract.mjs';
import { embedWebImagesInTopicResults } from './media-resolve.mjs';
import { removePdfUploadsForJob } from '../gen/delete.js';
import { CANCELLATION_STATUSES, generationCancelledTerminalFields, generationLeaseFields, generationTerminalFields, RUNNER_CANCELLATION_WRITABLE_STATUSES, RUNNER_WRITABLE_STATUSES } from './gen-state.mjs';
import { anthropicWebSearchTool, assertCloudGenerationModelSupport, getAiModelRegistry } from './ai-models.mjs';
import { compactTokenUsage, createTokenUsageLedger, recordTokenUsage } from './token-usage.mjs';
import { bindGenerationClient, createGenerationRequestBudget, GENERATION_IO_UNCERTAIN, GENERATION_MEDIA_TIMEOUT, isGenerationBudgetStop, isGenerationPause } from './gen-request-budget.mjs';
import { publicFetch } from './public-fetch.mjs';
import { pauseForContinuation } from './gen-continuation.mjs';
import { runIntegratedCourseImages, usesIntegratedVisuals } from './integrated-course-images.mjs';
import { runVisualDesigner, usesVisualDesigner, assertDesignComplete } from './visual-designer.mjs';

const STAGE2_CONCURRENCY = 3;
const STAGE3_CONCURRENCY = 4;
const SOURCE_URL_LIMIT = 10;
const SOURCE_URL_CONCURRENCY = 4;
const PDF_FETCH_TIMEOUT_MS = 15_000;
const MAX_PDF_BYTES = 12 * 1024 * 1024;
const ACTIVE_HEARTBEAT_MS = 60 * 1000;
const CHECKPOINT_WRITE_ERROR = 'CheckpointWriteError';

export function finalGenerationDisposition({ failedCount, totalTopics }) {
  const failed = Math.max(0, Number(failedCount || 0) || 0);
  const total = Math.max(0, Number(totalTopics || 0) || 0);
  if (failed === 0 && total > 0) return { status: 'completed', shouldSaveCourse: true, message: 'Done!' };
  if (total === 0 || failed >= total) {
    return {
      status: 'failed',
      shouldSaveCourse: false,
      message: `Generation failed — no topics produced (${failed} errors).`
    };
  }
  return {
    status: 'partial',
    shouldSaveCourse: true,
    message: `${total - failed} of ${total} topics done — ${failed} failed.`
  };
}

export function shouldCleanupSourceUploadsAfterFinalize(status) {
  return status === 'completed';
}

function leasePatch(extra = {}) {
  return {
    ...extra,
    ...generationLeaseFields()
  };
}

function terminalPatch(extra = {}) {
  return {
    ...extra,
    ...generationTerminalFields()
  };
}

export function failurePatch(err, extra = {}) {
  return terminalPatch({
    status: 'failed',
    message: 'Generation failed. You can resume from the saved checkpoint, restart from the original request, or delete this job.',
    error: err?.message || String(err || 'Unknown generation failure.'),
    ...extra
  });
}

function stableJsonClone(value) {
  if (value == null) return value;
  return JSON.parse(JSON.stringify(value));
}

function hasObjectKeys(value) {
  return value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length > 0;
}

function isProgressCheckpoint(fields = {}) {
  if (Object.prototype.hasOwnProperty.call(fields, 'brief') && fields.brief) return true;
  if (Array.isArray(fields.extracted_urls) && fields.extracted_urls.length > 0) return true;
  if (hasObjectKeys(fields.research)) return true;
  if (hasObjectKeys(fields.topics_by_key)) return true;
  if (fields.saved_course_id) return true;
  if (hasObjectKeys(fields.image_progress)) return true;
  if (hasObjectKeys(fields.design_progress)) return true;
  return false;
}

export function checkpointPatchFields(fields = {}) {
  if (!isProgressCheckpoint(fields)) return fields;
  return {
    ...fields,
    recovery_attempts: 0,
    last_recovery_at: null
  };
}

function checkpointWriteError(message) {
  const err = new Error(message);
  err.name = CHECKPOINT_WRITE_ERROR;
  err.code = CHECKPOINT_WRITE_ERROR;
  return err;
}

function isCheckpointWriteError(err) {
  return err?.name === CHECKPOINT_WRITE_ERROR || err?.code === CHECKPOINT_WRITE_ERROR;
}

function isDispatchStopError(err) {
  return isCheckpointWriteError(err) || isGenerationBudgetStop(err) || err?.name === 'StagingSpendError'
    || ['uncertain', 'pending', 'ledger', 'budget', 'approval', 'configuration', 'disabled', 'provider', 'unsupported'].includes(err?.code);
}

function isRunnerWritableStatus(status) {
  return RUNNER_WRITABLE_STATUSES.includes(status);
}

/** Public entry. Driven by /api/gen/start.js, /api/gen/review.js, and /api/gen/resume.js.
 *  mode:
 *  - curriculum: run through Stage 1, then pause at human curriculum review.
 *  - research: run through Stage 2, then pause at human research review.
 *  - complete: run Stage 3/4 and save the course. */
export async function runGeneration({ supabase, jobId, ownerId, runId, ownerEmail = null, apiKey, userBrief, checkpoint, pdfRefs, mode = 'complete', requestBudget = createGenerationRequestBudget(), retryFailedImages = false, retryFailedDesign = false }) {
  if (!runId) throw new Error('runGeneration requires runId so stale cloud runners cannot write checkpoints.');
  supabase = bindGenerationClient(supabase, requestBudget);

  let client = null;
  let tone = null;
  let pdfsForApi = [];
  let pdfThumbs = pdfThumbsFromRefs(pdfRefs);
  let pdfResolutionPromise = null;
  let courseSaveAttempt = null;
  const tokenUsage = createTokenUsageLedger();

  function onUsage(task, usage, meta = {}, aiModels = {}) {
    const config = aiModels[task] || {};
    recordTokenUsage(tokenUsage, {
      task,
      provider: config.provider || 'anthropic',
      model: config.model || null,
      usage,
      meta
    });
  }

  async function currentJobState() {
    const { data } = await supabase
      .from('generation_jobs')
      .select('status, run_id')
      .eq('id', jobId)
      .eq('owner_id', ownerId)
      .maybeSingle();
    return data ? { status: data.status || null, runId: data.run_id || null } : { status: null, runId: null };
  }

  async function currentJobStatus() {
    return (await currentJobState()).status;
  }

  // Cancellation check — read from row mid-flight.
  async function isCancelled() {
    const status = await currentJobStatus();
    return CANCELLATION_STATUSES.includes(status);
  }

  async function runnerStopReason() {
    const { status, runId: activeRunId } = await currentJobState();
    if (activeRunId && activeRunId !== runId) return 'superseded';
    if (CANCELLATION_STATUSES.includes(status)) return 'cancelled';
    if (status && !isRunnerWritableStatus(status)) return 'inactive';
    return null;
  }

  async function assertRunnerWritable() {
    const { status, runId: activeRunId } = await currentJobState();
    if (activeRunId && activeRunId !== runId) {
      throw checkpointWriteError(`Job is owned by another runner lease; refusing stale write from ${runId}.`);
    }
    if (!isRunnerWritableStatus(status)) {
      throw checkpointWriteError(status
        ? `Job is ${status}; refusing to revive it with a late runner write.`
        : 'Could not persist generation checkpoint; job no longer exists.');
    }
  }

  let patchQueue = Promise.resolve();

  function patch(fields) {
    const snapshot = stableJsonClone(leasePatch(checkpointPatchFields(fields)));
    patchQueue = patchQueue.then(async () => {
      const { data, error } = await supabase
        .from('generation_jobs')
        .update(snapshot)
        .eq('id', jobId)
        .eq('owner_id', ownerId)
        .eq('run_id', runId)
        .in('status', RUNNER_WRITABLE_STATUSES)
        .select('id')
        .maybeSingle();
      if (error) throw checkpointWriteError(error.message || String(error));
      if (!data) {
        await assertRunnerWritable();
        throw checkpointWriteError('Could not persist generation checkpoint even though the job is still active.');
      }
    });
    return patchQueue;
  }

  async function heartbeatLease(label = '') {
    const { data, error } = await supabase
      .from('generation_jobs')
      .update(leasePatch({}))
      .eq('id', jobId)
      .eq('owner_id', ownerId)
      .eq('run_id', runId)
      .in('status', RUNNER_WRITABLE_STATUSES)
      .select('id')
      .maybeSingle();
    if (error) throw error;
    if (!data) return false;
    if (label) console.info(`[gen ${jobId}] heartbeat while ${label}`);
    return true;
  }

  async function withLeaseHeartbeat(label, work) {
    let stopped = false;
    let inFlight = false;
    const timer = setInterval(async () => {
      if (stopped || inFlight) return;
      inFlight = true;
      try {
        const renewed = await heartbeatLease(label);
        if (!renewed) console.warn(`[gen ${jobId}] heartbeat could not renew lease while ${label}; runner may be stale.`);
      } catch (err) {
        console.warn(`[gen ${jobId}] heartbeat failed while ${label}:`, err?.message || err);
      } finally {
        inFlight = false;
      }
    }, ACTIVE_HEARTBEAT_MS);
    if (typeof timer.unref === 'function') timer.unref();
    try {
      return await work();
    } finally {
      stopped = true;
      clearInterval(timer);
    }
  }

  async function ensurePdfsForApi(label = 'PDF source resolution') {
    if (pdfsForApi.length || !pdfRefs?.length) return pdfsForApi;
    if (!pdfResolutionPromise) {
      pdfResolutionPromise = withLeaseHeartbeat(label, async () => {
        const pdfs = await resolvePdfs(supabase, pdfRefs, { ownerId, jobId, requestBudget });
        return pdfs.map(p => ({
          file_index: p.file_index, name: p.name, base64: p.base64,
          pageCount: (p.pageThumbs || []).length
        }));
      });
    }
    pdfsForApi = await pdfResolutionPromise;
    return pdfsForApi;
  }

  async function bailIfInactive() {
    const reason = await runnerStopReason();
    if (reason === 'cancelled') {
      await supabase
        .from('generation_jobs')
        .update(generationCancelledTerminalFields())
        .eq('id', jobId)
        .eq('owner_id', ownerId)
        .eq('run_id', runId)
        .in('status', RUNNER_CANCELLATION_WRITABLE_STATUSES);
      await removePdfUploadsForJob(supabase, ownerId, jobId);
      return true;
    }
    return !!reason;
  }

  async function shouldLeaveTerminalStateAlone(err) {
    if (!isCheckpointWriteError(err) && err?.code !== GENERATION_IO_UNCERTAIN) return false;
    const { status, runId: activeRunId } = await currentJobState();
    if (activeRunId && activeRunId !== runId) return true;
    return !!status && status !== 'cancelling' && !isRunnerWritableStatus(status);
  }

  async function drainWorkers(workers) {
    // Never terminalize on the first rejection while siblings are still saving
    // successful paid output. Unknown outcomes outrank a safe pre-dispatch pause.
    const results = await Promise.allSettled(workers);
    const errors = results.filter(result => result.status === 'rejected').map(result => result.reason);
    const error = errors.find(err => !isGenerationPause(err)) || errors[0];
    if (error) throw error;
  }

  async function finishCourseJob({ status, message, courseRowId, done }) {
    if (status === 'completed' && courseRowId) {
      await assertRunnerWritable();
      await reconcileGeneratedCourseRun({ supabase, ownerId, jobId, runId, courseId: courseRowId });
    }
    const { data: finalRow, error: finalErr } = await supabase
      .from('generation_jobs')
      .update(terminalPatch({
        stage: 'done', status, message,
        ...(courseRowId ? { saved_course_id: courseRowId } : {}), topics_done: done
      }))
      .eq('id', jobId).eq('owner_id', ownerId).eq('run_id', runId)
      .in('status', RUNNER_WRITABLE_STATUSES).select('id').maybeSingle();
    if (finalErr) throw checkpointWriteError(finalErr.message || String(finalErr));
    if (!finalRow) {
      await assertRunnerWritable();
      throw checkpointWriteError('Could not finalize generation job even though the runner lease is still active.');
    }
    if (shouldCleanupSourceUploadsAfterFinalize(status)) {
      try { await removePdfUploadsForJob(supabase, ownerId, jobId); }
      catch (cleanupErr) { console.warn(`[gen ${jobId}] completed but source upload cleanup failed:`, cleanupErr?.message || cleanupErr); }
    }
  }

  async function finishIntegratedImages(courseId) {
    if (usesVisualDesigner(userBrief)) {
      const { data: saved, error } = await supabase.from('user_courses').select('payload')
        .eq('owner_id', ownerId).eq('id', courseId).maybeSingle();
      if (error) throw error;
      if (saved?.payload?._generationJobId !== jobId) throw checkpointWriteError('The refined draft does not belong to this generation job.');
      if (saved.payload._visualDesign?.status === 'complete') {
        await patch({ design_progress: assertDesignComplete(saved.payload) });
      } else {
        const models = getAiModelRegistry();
        assertCloudGenerationModelSupport(models);
        ensureTextClient();
        await runVisualDesigner({ supabase, ownerId, jobId, runId, courseId, client,
          model: models.lesson.model, requestBudget, assertRunnerWritable, patch,
          withHeartbeat: withLeaseHeartbeat, retryFailedDesign });
      }
      await patch({ stage: 'images', message: 'Visual Designer is creating illustrations from the refined lessons…' });
    }
    await runIntegratedCourseImages({ supabase, ownerId, jobId, runId, courseId, requestBudget,
      assertRunnerWritable, checkpoint: checkpoint?.image_progress || {}, patch,
      withHeartbeat: withLeaseHeartbeat, retryFailedImages });
    await patch({ stage: 'assemble', message: agentMessage('assemble') });
  }

  // Keep a single lazy factory site: staging packaging injects the same guarded
  // creator-funded client here for both lesson writing and learner refinement.
  function ensureTextClient() {
    if (!client) client = createAnthropic({ apiKey, requestBudget, beforeDispatch: assertRunnerWritable });
    return client;
  }

  try {
    const aiModels = getAiModelRegistry();
    if (await bailIfInactive()) return;
    // A saved complete text draft is now the source of truth. Image continuation
    // must never reassemble it from old topic checkpoints or overwrite assets
    // already attached by a previous time slice.
    if (mode === 'complete' && usesIntegratedVisuals(userBrief) && checkpoint?.saved_course_id
        && (checkpoint.stage === 'images' || checkpoint.stage === 'assemble' && checkpoint.image_progress?.status === 'complete'
          || usesVisualDesigner(userBrief) && ['topics', 'design', 'assemble'].includes(checkpoint.stage))) {
      const { data: saved, error } = await supabase.from('user_courses').select('payload')
        .eq('owner_id', ownerId).eq('id', checkpoint.saved_course_id).maybeSingle();
      if (error) throw error;
      if (saved?.payload?._generationJobId === jobId && usesIntegratedVisuals(saved.payload._brief)
          && !(saved.payload.failedTopics || []).length) {
        await finishIntegratedImages(checkpoint.saved_course_id);
        if (await bailIfInactive()) return;
        await finishCourseJob({ status: 'completed', message: 'Your course draft is ready to review.',
          courseRowId: checkpoint.saved_course_id, done: topicCountForBrief(checkpoint.brief) });
        return;
      }
      if (checkpoint.stage !== 'topics' || saved?.payload?._visualDesign) {
        throw checkpointWriteError('The saved course no longer matches its refinement checkpoint. Your retained draft was not overwritten.');
      }
    }
    assertCloudGenerationModelSupport(aiModels);
    ensureTextClient();
    tone = getTone(userBrief?.tone || 'conversational');
    if (await bailIfInactive()) return;

    // Stage 0 — URLs. Checkpoint incrementally so a timeout during a slow
    // source batch keeps every URL that already settled.
    const sourceUrls = (userBrief.source_urls || []).filter(Boolean);
    let extractedUrls = checkpoint?.extracted_urls || [];
    const pendingSourceUrls = sourceUrls.filter(url => !sourceUrlHasResult(url, extractedUrls));
    if (pendingSourceUrls.length) {
      await patch({ stage: 'intake', status: 'running', message: `${agentNameForStage('intake')} is reading ${pendingSourceUrls.length} source URL${pendingSourceUrls.length === 1 ? '' : 's'}…` });
      const fetchedUrls = await withLeaseHeartbeat('source URL extraction', () => serverFetchUrls(pendingSourceUrls, {
        requestBudget,
        onProgress: async partialResults => {
          extractedUrls = mergeSourceUrlResults(extractedUrls, partialResults);
          await patch({ extracted_urls: extractedUrls });
        }
      }));
      extractedUrls = mergeSourceUrlResults(extractedUrls, fetchedUrls);
      await patch({ extracted_urls: extractedUrls });
    }
    const enrichedBrief = { ...userBrief, extracted_urls: extractedUrls };
    if (await bailIfInactive()) return;

    // Stage 1 — brief.
    let brief = checkpoint?.brief ? retainComponentChoices(checkpoint.brief, userBrief) : null;
    if (!brief) {
      await patch({ stage: 'intake', status: 'running', message: agentMessage('intake') });
      brief = await withLeaseHeartbeat('curriculum design', async () => runIntake(client, enrichedBrief, {
        model: aiModels.curriculum.model,
        onUsage: (usage, meta) => onUsage('curriculum', usage, meta, aiModels),
        pdfs: await ensurePdfsForApi('PDF source resolution for curriculum design')
      }).catch(err => {
        if (err?.name === 'ZodError' || err?.message === 'Stage 1: model did not call the brief tool') {
          throw new Error('The AI returned an incomplete course plan. Your request and sources are saved. Retry to generate a new plan; this uses more tokens.', { cause: err });
        }
        throw err;
      }));
      const outline = outlineForBrief(brief);
      const topicsTotal = topicCountForBrief(brief);
      await patch({
        brief, outline,
        extracted_urls: extractedUrls,
        stage: mode === 'curriculum' ? 'intake' : 'research',
        status: mode === 'curriculum' ? 'review_curriculum' : 'running',
        message: mode === 'curriculum'
          ? 'Review the curriculum direction before research starts.'
          : `${agentNameForStage('research')} is researching ${brief.modules.length} module${brief.modules.length === 1 ? '' : 's'} in parallel…`,
        topics_total: topicsTotal
      });
      if (mode === 'curriculum') return;
    } else {
      if (mode === 'curriculum') {
        await patch({
          brief,
          outline: outlineForBrief(brief),
          stage: 'intake',
          status: 'review_curriculum',
          message: 'Review the curriculum direction before research starts.',
          topics_total: topicCountForBrief(brief)
        });
        return;
      }
      await patch({ stage: 'research', message: `${agentNameForStage('research')} is resuming from checkpoint…` });
    }
    if (await bailIfInactive()) return;

    // Stage 2 — research per module.
    const researchByModule = checkpoint?.research || {};
    let failures = checkpoint?.failures || [];
    const researchResults = new Array(brief.modules.length);
    let researchCursor = 0;
    const researchWorkers = Array.from({ length: Math.min(STAGE2_CONCURRENCY, brief.modules.length) }, async () => {
      while (true) {
        const i = researchCursor++;
        if (i >= brief.modules.length) return;
        if (await runnerStopReason()) return;
        const mod = brief.modules[i];
        if (researchByModule[mod.id]) {
          researchResults[i] = { mod, bundle: researchByModule[mod.id] };
          continue;
        }
        try {
          const bundle = await withLeaseHeartbeat(`research for ${mod.id}`, async () => runResearch(client, brief, mod, {
            model: aiModels.research.model,
            searchTool: anthropicWebSearchTool(),
            onUsage: (usage, meta) => onUsage('research', usage, meta, aiModels),
            pdfs: await ensurePdfsForApi(`PDF source resolution for research ${mod.id}`),
            extracted_urls: extractedUrls
          }));
          researchByModule[mod.id] = bundle;
          failures = clearResearchFailure(failures, mod.id);
          const done = Object.keys(researchByModule).length;
          const total = brief.modules.length;
          await patch({
            research: researchByModule,
            failures,
            stage: 'research',
            message: `${agentNameForStage('research')} finished ${done}/${total} · “${mod.title}”`
          });
          researchResults[i] = { mod, bundle };
        } catch (err) {
          if (isDispatchStopError(err)) { requestBudget.stop(err); throw err; }
          console.error(`[gen ${jobId}] research failed for ${mod.id}:`, err);
          failures = replaceResearchFailure(failures, {
            moduleId: mod.id,
            moduleTitle: mod.title,
            error: err.message || String(err),
            attempts: err.attempts || null,
            at: Date.now()
          });
          await patch({
            failures,
            stage: 'research',
            message: `${agentNameForStage('research')} could not finish “${mod.title}”. Review or rerun research.`
          });
          researchResults[i] = { mod, bundle: null };
        }
      }
    });
    await drainWorkers(researchWorkers);
    if (await bailIfInactive()) return;

    const missingResearch = missingResearchModules(brief, researchByModule);
    if (mode === 'research' || missingResearch.length) {
      await patch({
        status: 'review_research',
        stage: 'research',
        research: researchByModule,
        failures,
        message: missingResearch.length
          ? `${missingResearch.length} module${missingResearch.length === 1 ? '' : 's'} still need research before lessons are written.`
          : 'Review the research direction before lessons are written.'
      });
      return;
    }

    // Stage 3 — topics. Per-module parallel, capped concurrency, checkpointed.
    const total = topicCountForBrief(brief);
    // Old checkpoints may predate explicit component support. Reuse only lessons
    // matching this job's saved choices; the existing retry loop repairs the rest.
    const topicsByKey = compatibleTopicCheckpoint(brief, checkpoint?.topics_by_key || {});
    failures = pruneResolvedFailures(failures, topicsByKey, researchByModule);
    let done = Object.keys(topicsByKey).length;
    await patch({ stage: 'topics', message: agentMessage('topics'), topics_done: done, topics_total: total, failures });

    const work = [];
    for (const { mod, bundle } of researchResults) {
      for (const topic of mod.topics) {
        const key = `${mod.id}/${topic.id}`;
        if (!topicsByKey[key]) work.push({ mod, topic, bundle });
      }
    }

    let cursor = 0;
    const workers = Array.from({ length: Math.min(STAGE3_CONCURRENCY, work.length) }, async () => {
      while (true) {
        const i = cursor++;
        if (i >= work.length) return;
        if (await runnerStopReason()) return;
        const { mod, topic, bundle } = work[i];
        const key = `${mod.id}/${topic.id}`;
        try {
          const content = await withLeaseHeartbeat(`lesson writing for ${key}`, () => runTopic(client, brief, mod, topic, bundle, tone, {
            model: aiModels.lesson.model,
            onUsage: (usage, meta) => onUsage('lesson', usage, meta, aiModels)
          }));
          topicsByKey[key] = content;
          failures = clearTopicFailure(failures, mod.id, topic.id);
          done++;
          await patch({
            topics_by_key: topicsByKey,
            failures,
            topics_done: done,
            message: `${agentNameForStage('topics')} wrote “${topic.title}” — ${done}/${total} lessons done`
          });
        } catch (err) {
          if (isDispatchStopError(err)) { requestBudget.stop(err); throw err; }
          done++;
          failures = replaceTopicFailure(failures, {
            moduleId: mod.id, topicId: topic.id, topicTitle: topic.title,
            error: err.message,
            kind: err.kind || null,
            attempts: err.attempts || null,
            at: Date.now()
          });
          await patch({
            failures,
            topics_done: done,
            message: `${agentNameForStage('topics')} skipped “${topic.title}” — ${done}/${total} lessons checked`
          });
          console.error(`[gen ${jobId}] topic failed ${key}:`, err);
        }
      }
    });
    await drainWorkers(workers);
    if (await bailIfInactive()) return;

    // Stage 4 — assemble + save course.
    await patch({ stage: usesIntegratedVisuals(userBrief) ? 'topics' : 'assemble',
      message: usesIntegratedVisuals(userBrief) ? 'Saving the lesson draft before creating its illustrations…' : agentMessage('assemble') });
    await assertRunnerWritable();
    const topicResults = [];
    for (const mod of brief.modules) {
      for (const topic of mod.topics) {
        const key = `${mod.id}/${topic.id}`;
        const content = topicsByKey[key] || null;
        topicResults.push({ moduleId: mod.id, topicId: topic.id, content });
      }
    }
    // Optional web-image fetching gets one batch allowance, not a fresh timeout
    // for every candidate. Keep completed embeds and original references when
    // time runs out; all paid text has already been checkpointed.
    let imageResolvedTopicResults = topicResults;
    try {
      imageResolvedTopicResults = await withLeaseHeartbeat('image embedding', () => requestBudget.runOperation(signal =>
        embedWebImagesInTopicResults(topicResults, { signal, onProgress: results => { imageResolvedTopicResults = results; } }),
      { timeoutMs: 20_000, code: GENERATION_MEDIA_TIMEOUT }));
    } catch (error) {
      if (error?.code !== GENERATION_MEDIA_TIMEOUT && !isGenerationPause(error)) throw error;
    }
    const course = assembleCourse(brief, imageResolvedTopicResults, { pdfThumbs });
    const failedCount = (course.failedTopics || []).length;
    const totalTopics = topicResults.length;
    const { status, message, shouldSaveCourse } = finalGenerationDisposition({ failedCount, totalTopics });

    let courseRowId = null;
    if (shouldSaveCourse) {
      // Save to user_courses. Course ids are claimed insert-first so two jobs
      // with the same generated slug cannot overwrite each other; retries reuse
      // generation_jobs.saved_course_id and update the same account course.
      courseSaveAttempt = await saveGeneratedCourse({
        supabase,
        ownerId,
        jobId,
        runId,
        baseCourseId: brief.id,
        course,
        brief,
          researchByModule,
          ownerEmail,
          tokenUsage: compactTokenUsage(tokenUsage)
        });
      courseRowId = courseSaveAttempt.courseId;
    }

    if (courseRowId && usesIntegratedVisuals(userBrief)) {
      // Paid text is an intentionally retained draft checkpoint, not a temporary
      // save to roll back when one illustration fails or hosting time runs out.
      courseSaveAttempt = null;
      if (status === 'completed') {
        await patch({ stage: usesVisualDesigner(userBrief) ? 'design' : 'images', message: usesVisualDesigner(userBrief)
          ? 'Visual Designer is reviewing the finished course…' : 'Preparing the course illustrations…' });
        await finishIntegratedImages(courseRowId);
        if (await bailIfInactive()) return;
      }
    }
    await finishCourseJob({ status, message: status === 'completed' && usesIntegratedVisuals(userBrief)
      ? 'Your course draft is ready to review.' : message, courseRowId, done });
  } catch (err) {
    console.error(`[gen ${jobId}] FAILED:`, err);
    // A remote save/finalization can commit before its acknowledgement is lost.
    // Do not delete a confirmed course to compensate for an unknown outcome.
    if (courseSaveAttempt && err?.code !== GENERATION_IO_UNCERTAIN) {
      try {
        const rolledBack = await rollbackGeneratedCourseSave({
          supabase,
          ownerId,
          jobId,
          runId,
          courseId: courseSaveAttempt.courseId,
          priorPayload: courseSaveAttempt.priorPayload,
          priorUpdatedAt: courseSaveAttempt.priorUpdatedAt,
          savedRevision: courseSaveAttempt.savedRevision,
          savedUpdatedAt: courseSaveAttempt.savedUpdatedAt
        });
        if (rolledBack && (courseSaveAttempt.inserted || courseSaveAttempt.priorSavedCourseId !== courseSaveAttempt.courseId)) {
          await clearSavedCourseIdForJob({
            supabase,
            ownerId,
            jobId,
            runId,
            courseId: courseSaveAttempt.courseId
          });
        }
      } catch (rollbackErr) {
        console.error(`[gen ${jobId}] failed to roll back unfinalized course save:`, rollbackErr);
      }
    }
    if (await shouldLeaveTerminalStateAlone(err)) return;
    if (isGenerationPause(err)) {
      if (await bailIfInactive()) return;
      if (await pauseForContinuation({ supabase, jobId, ownerId, runId, requestBudget })) return;
      const { data, error } = await supabase.from('generation_jobs').update(terminalPatch({
        status: 'timed_out', error: null,
        message: 'Generation paused before the hosting time limit. Your completed work is saved. Resume to continue.'
      })).eq('id', jobId).eq('owner_id', ownerId).eq('run_id', runId)
        .in('status', RUNNER_WRITABLE_STATUSES).select('id').maybeSingle();
      if (error) throw checkpointWriteError(error.message || String(error));
      if (!data) await assertRunnerWritable();
      return;
    }
    if (await isCancelled()) {
      await supabase
        .from('generation_jobs')
        .update(generationCancelledTerminalFields())
        .eq('id', jobId)
        .eq('owner_id', ownerId)
        .eq('run_id', runId)
        .in('status', RUNNER_CANCELLATION_WRITABLE_STATUSES);
      await removePdfUploadsForJob(supabase, ownerId, jobId);
      return;
    }
    await supabase.from('generation_jobs').update(
      failurePatch(err)
    ).eq('id', jobId).eq('owner_id', ownerId).eq('run_id', runId).in('status', RUNNER_WRITABLE_STATUSES);
    throw err;
  }
}

async function resolvePdfs(supabase, pdfRefs, { ownerId, jobId, requestBudget }) {
  if (!pdfRefs?.length) return [];
  const out = [];
  for (const ref of pdfRefs) {
    assertPdfRefBelongsToJob(ref, ownerId, jobId);
    const buf = await requestBudget.runOperation(async signal => {
      const signed = await signedPdfUrl(supabase, ref.storage_path);
      signal.throwIfAborted();
      return fetchPdfBuffer(signed, ref.name, { signal });
    }, { timeoutMs: PDF_FETCH_TIMEOUT_MS });
    out.push({
      file_index: ref.file_index,
      name: ref.name,
      base64: buf.toString('base64'),
      pageThumbs: ref.pageThumbs || []
    });
  }
  return out;
}

function pdfThumbsFromRefs(pdfRefs = []) {
  return (pdfRefs || []).map(ref => ({
    file_index: ref?.file_index,
    name: ref?.name,
    pageThumbs: ref?.pageThumbs || []
  }));
}

export async function fetchPdfBuffer(url, name = 'source.pdf', { fetchImpl = fetch, timeoutMs = PDF_FETCH_TIMEOUT_MS, maxBytes = MAX_PDF_BYTES, signal } = {}) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetchImpl(url, { signal: signal ? AbortSignal.any([ctl.signal, signal]) : ctl.signal });
    if (!r.ok) throw new Error(`Could not download PDF ${name}: HTTP ${r.status}`);
    const bytes = r.body?.getReader
      ? await readStreamWithLimit(r.body, maxBytes)
      : new Uint8Array(await r.arrayBuffer());
    if (bytes.length > maxBytes) {
      throw new Error(`Could not download PDF ${name}: response exceeded ${maxBytes} bytes`);
    }
    signal?.throwIfAborted();
    return Buffer.from(bytes);
  } catch (err) {
    if (err?.name === 'AbortError') {
      throw new Error(`Could not download PDF ${name}: timed out after ${timeoutMs}ms`);
    }
    if (/^PDF response exceeded/i.test(err?.message || '')) {
      throw new Error(`Could not download PDF ${name}: ${err.message}`);
    }
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

async function readStreamWithLimit(stream, maxBytes) {
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > maxBytes) {
      try { await reader.cancel(); } catch {}
      throw new Error(`PDF response exceeded ${maxBytes} bytes`);
    }
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}

function assertPdfRefBelongsToJob(ref, ownerId, jobId) {
  const path = String(ref?.storage_path || '');
  const expectedPrefix = `${ownerId}/${jobId}/`;
  if (!path || !path.startsWith(expectedPrefix) || path.includes('..')) {
    throw new Error(`PDF "${ref?.name || 'upload'}" is not attached to this generation job.`);
  }
}

/** Server-side URL extraction for the durable cloud runner. */
export async function serverFetchUrls(urls, options = {}) {
  const all = (urls || []).map(url => String(url || '').trim()).filter(Boolean);
  const list = all.slice(0, SOURCE_URL_LIMIT);
  const skipped = all.slice(SOURCE_URL_LIMIT).map(url => ({
    ok: false,
    requestedUrl: url,
    url,
    error: `Skipped because Learnable fetches at most ${SOURCE_URL_LIMIT} source URLs per course.`
  }));
  if (!list.length) return [];
  const onProgress = typeof options?.onProgress === 'function' ? options.onProgress : null;
  const results = new Array(list.length);
  async function reportProgress() {
    if (!onProgress) return;
    const snapshot = [...results.filter(Boolean), ...skipped];
    if (snapshot.length) await onProgress(snapshot);
  }
  let cursor = 0;
  const workers = Array.from({ length: Math.min(SOURCE_URL_CONCURRENCY, list.length) }, async () => {
    while (cursor < list.length) {
      const i = cursor++;
      const url = list[i];
      try {
        const extract = signal => extractUrlContent(url, { ...options, fetchImpl: (input, init) =>
          (options.fetchImpl || publicFetch)(input, { ...init, signal: signal ? AbortSignal.any([signal, init.signal]) : init.signal }) });
        results[i] = {
          requestedUrl: url,
          ...(await (options.requestBudget ? options.requestBudget.runOperation(extract) : extract()))
        };
      } catch (err) {
        if (isGenerationBudgetStop(err)) throw err;
        results[i] = {
          ok: false,
          requestedUrl: url,
          url,
          error: err?.message || String(err || 'Unknown URL extraction failure.')
        };
      }
      await reportProgress();
    }
  });
  const settled = await Promise.allSettled(workers);
  const failure = settled.find(result => result.status === 'rejected');
  if (failure) throw failure.reason;
  return [...results, ...skipped];
}

export function sourceUrlHasResult(url, results = []) {
  const key = normalizeSourceUrl(url);
  if (!key) return false;
  return (results || []).some(result => {
    return normalizeSourceUrl(result?.requestedUrl) === key
      || normalizeSourceUrl(result?.url) === key;
  });
}

export function mergeSourceUrlResults(existing = [], next = []) {
  const byUrl = new Map();
  for (const result of [...(existing || []), ...(next || [])]) {
    if (!result) continue;
    const key = normalizeSourceUrl(result.requestedUrl || result.url);
    if (!key) continue;
    byUrl.set(key, result);
  }
  return [...byUrl.values()];
}

function normalizeSourceUrl(url) {
  return String(url || '').trim();
}
