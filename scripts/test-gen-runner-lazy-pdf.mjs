import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const root = process.cwd();
const runner = readFileSync(join(root, 'web/api/_lib/gen-runner.mjs'), 'utf8');
const runBody = runner.slice(
  runner.indexOf('export async function runGeneration'),
  runner.indexOf('async function resolvePdfs')
);

assert.ok(
  runBody.includes('let pdfThumbs = pdfThumbsFromRefs(pdfRefs);'),
  'runner should derive final course PDF thumbnails from durable refs immediately.'
);
assert.ok(
  runner.includes('function pdfThumbsFromRefs(pdfRefs = [])') &&
  runner.includes('pageThumbs: ref?.pageThumbs || []'),
  'runner should not need to download source PDFs just to assemble saved thumbnails.'
);
assert.ok(
  runBody.includes('let pdfResolutionPromise = null;') &&
  runBody.includes('async function ensurePdfsForApi') &&
  runBody.includes('if (pdfsForApi.length || !pdfRefs?.length) return pdfsForApi;'),
  'runner should cache PDF document hydration for model stages.'
);
assert.ok(
  runBody.includes("pdfResolutionPromise = withLeaseHeartbeat(label, async () => {") &&
  runBody.includes('const pdfs = await resolvePdfs(supabase, pdfRefs, { ownerId, jobId, requestBudget });'),
  'lazy PDF hydration should heartbeat the active job lease and share its deadline.'
);
assert.ok(
  runBody.indexOf('const sourceUrls = (userBrief.source_urls || []).filter(Boolean);') <
  runBody.indexOf("await ensurePdfsForApi('PDF source resolution for curriculum design')"),
  'source URL extraction and checkpoint inspection should happen before PDF document downloads.'
);
assert.ok(
  runBody.includes("await ensurePdfsForApi('PDF source resolution for curriculum design')"),
  'curriculum design should hydrate PDF documents when no curriculum checkpoint exists.'
);
assert.ok(
  runBody.includes('await ensurePdfsForApi(`PDF source resolution for research ${mod.id}`)'),
  'research should hydrate PDF documents only for missing module research.'
);
assert.ok(
  !runBody.includes('runTopic(client, brief, mod, topic, bundle, tone, { pdfs') &&
  !runBody.includes('runTopic(client, brief, mod, topic, bundle, tone, pdfs'),
  'topic-only recovery should not require source PDF downloads.'
);
assert.ok(
  runBody.includes("withLeaseHeartbeat('image embedding', () => requestBudget.runOperation(signal =>") &&
  runBody.includes('embedWebImagesInTopicResults(topicResults, { signal, onProgress:') &&
  runBody.includes('timeoutMs: 20_000, code: GENERATION_MEDIA_TIMEOUT') &&
  runBody.includes('assembleCourse(brief, imageResolvedTopicResults, { pdfThumbs })'),
  'bounded image preparation and final assembly should retain PDF thumbnails.'
);

console.log('gen runner lazy PDF tests passed');
