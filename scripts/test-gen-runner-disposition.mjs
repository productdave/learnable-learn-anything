import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { failurePatch, finalGenerationDisposition, shouldCleanupSourceUploadsAfterFinalize } from '../web/api/_lib/gen-runner.mjs';

const root = new URL('..', import.meta.url).pathname;
const runner = readFileSync(join(root, 'web/api/_lib/gen-runner.mjs'), 'utf8');
const runBody = runner.slice(
  runner.indexOf('export async function runGeneration'),
  runner.indexOf('async function resolvePdfs')
);

assert.deepEqual(
  finalGenerationDisposition({ failedCount: 0, totalTopics: 3 }),
  { status: 'completed', shouldSaveCourse: true, message: 'Done!' }
);

assert.deepEqual(
  finalGenerationDisposition({ failedCount: 1, totalTopics: 3 }),
  { status: 'partial', shouldSaveCourse: true, message: '2 of 3 topics done — 1 failed.' }
);

assert.deepEqual(
  finalGenerationDisposition({ failedCount: 3, totalTopics: 3 }),
  { status: 'failed', shouldSaveCourse: false, message: 'Generation failed — no topics produced (3 errors).' }
);

assert.deepEqual(
  finalGenerationDisposition({ failedCount: 0, totalTopics: 0 }),
  { status: 'failed', shouldSaveCourse: false, message: 'Generation failed — no topics produced (0 errors).' }
);

assert.equal(shouldCleanupSourceUploadsAfterFinalize('completed'), true);
assert.equal(shouldCleanupSourceUploadsAfterFinalize('partial'), false);
assert.equal(shouldCleanupSourceUploadsAfterFinalize('failed'), false);

const failed = failurePatch(new Error('Anthropic credits exhausted.'), {
  stage: 'topics'
});
assert.equal(failed.status, 'failed');
assert.equal(failed.stage, 'topics');
assert.equal(failed.error, 'Anthropic credits exhausted.');
assert.match(failed.message, /resume from the saved checkpoint/i);
assert.ok(failed.completed_at);
assert.ok(failed.updated_at);

assert.ok(runBody.includes('let client = null;'));
assert.ok(runBody.includes('let tone = null;'));
const mainTry = runBody.indexOf('try {\n    const aiModels = getAiModelRegistry();');
const clientStartup = runBody.indexOf('ensureTextClient();', mainTry);
assert.equal(runBody.split('createAnthropic({ apiKey, requestBudget, beforeDispatch: assertRunnerWritable });').length, 2,
  'one lazy factory retains the shared deadline/live-run guard for all writing roles');
const persistedCatch = runBody.indexOf('} catch (err) {\n    console.error(`[gen ${jobId}] FAILED:`');
assert.ok(
  mainTry >= 0 && clientStartup > mainTry && persistedCatch > clientStartup,
  'Anthropic client startup with shared deadline and live-run guard should be inside the persisted failure boundary.'
);
assert.ok(
  clientStartup <
  runBody.indexOf("await ensurePdfsForApi('PDF source resolution for curriculum design')"),
  'The runner should fail fast on API key/client setup before preparing source fetches.'
);
assert.ok(
  runBody.indexOf('if (await bailIfInactive()) return;') <
  runBody.indexOf('const sourceUrls = (userBrief.source_urls || []).filter(Boolean);'),
  'Cancelled or superseded runners should stop before source resolution.'
);
assert.ok(
  runBody.indexOf('const sourceUrls = (userBrief.source_urls || []).filter(Boolean);') <
  runBody.indexOf("await ensurePdfsForApi('PDF source resolution for curriculum design')"),
  'PDF document bytes should be fetched lazily only when a model stage needs them.'
);
assert.ok(
  runner.includes('let pdfThumbs = pdfThumbsFromRefs(pdfRefs);') &&
  runner.includes('function pdfThumbsFromRefs(pdfRefs = [])') &&
  runBody.includes('assembleCourse(brief, imageResolvedTopicResults, { pdfThumbs })'),
  'PDF page thumbnails should come from durable refs so topic-only recovery can assemble without downloading source PDFs.'
);
assert.ok(runner.includes('const STAGE2_CONCURRENCY = 3;'));
assert.ok(
  runBody.includes('const researchResults = new Array(brief.modules.length);') &&
  runBody.includes('const researchWorkers = Array.from({ length: Math.min(STAGE2_CONCURRENCY, brief.modules.length) }') &&
  runBody.indexOf('const researchWorkers = Array.from') < runBody.indexOf('withLeaseHeartbeat(`research for ${mod.id}`') &&
  runBody.includes('async () => runResearch(client, brief, mod'),
  'Research should use a bounded worker pool instead of firing every module at once.'
);
const researchStart = runBody.indexOf('const researchWorkers = Array.from');
const researchDrain = runBody.indexOf('await drainWorkers(researchWorkers);');
assert.ok(researchStart >= 0 && researchDrain > researchStart, 'Research workers must drain before finalizing their stage.');
const researchWorkerBody = runBody.slice(researchStart, researchDrain);
assert.ok(
  researchWorkerBody.indexOf('const i = researchCursor++;') <
    researchWorkerBody.indexOf('if (await runnerStopReason()) return;'),
  'Research workers should claim the cursor before awaiting so parallel workers cannot read past the module array.'
);
assert.ok(
  runBody.includes('const workers = Array.from({ length: Math.min(STAGE3_CONCURRENCY, work.length) }'),
  'Topic writing should keep its bounded worker pool.'
);
const topicStart = runBody.indexOf('const workers = Array.from');
const topicDrain = runBody.indexOf('await drainWorkers(workers);');
assert.ok(topicStart >= 0 && topicDrain > topicStart, 'Topic workers must drain before finalizing the job.');
const topicWorkerBody = runBody.slice(topicStart, topicDrain);
assert.ok(
  topicWorkerBody.indexOf('const i = cursor++;') <
    topicWorkerBody.indexOf('if (await runnerStopReason()) return;'),
  'Topic workers should claim the cursor before awaiting so parallel workers cannot read past the work queue.'
);
assert.ok(runBody.includes('failurePatch(err)'));
assert.ok(runBody.includes('const results = await Promise.allSettled(workers);'), 'Worker draining must await every sibling outcome.');
assert.ok(runBody.includes('if (courseSaveAttempt && err?.code !== GENERATION_IO_UNCERTAIN)'), 'Unknown save acknowledgements must not trigger destructive rollback.');
assert.ok(
  runBody.includes('if (shouldCleanupSourceUploadsAfterFinalize(status)) {') &&
  runBody.includes('await removePdfUploadsForJob(supabase, ownerId, jobId);') &&
  runBody.indexOf("status,\n        message,\n        ...(courseRowId ? { saved_course_id: courseRowId } : {}),") <
    runBody.indexOf('if (shouldCleanupSourceUploadsAfterFinalize(status)) {'),
  'Completed source uploads should be cleaned only after the terminal job row is finalized.'
);
assert.ok(
  runBody.includes('console.warn(`[gen ${jobId}] completed but source upload cleanup failed:`'),
  'Source upload cleanup should be best-effort and must not fail completed jobs.'
);
assert.ok(
  runBody.includes('rolledBack && (courseSaveAttempt.inserted || courseSaveAttempt.priorSavedCourseId !== courseSaveAttempt.courseId)') &&
  runBody.includes('await clearSavedCourseIdForJob({'),
  'Failed finalization should clear any saved_course_id pointer introduced by that failed save attempt.'
);

console.log('gen runner disposition tests passed');
