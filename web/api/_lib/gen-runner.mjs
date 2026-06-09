// Server-side generation runner. Same 4-stage pipeline that runs in the
// Service Worker today (web/sw.js), but:
//   - State persists to the generation_jobs Supabase row after every stage
//     boundary, so a function timeout / crash / cancel can resume.
//   - Cancellation is signalled by setting generation_jobs.status to
//     'cancelling'; the runner checks between dispatches.
//   - Failures are categorised (api / schema / unknown) and written to the
//     row's `failures` jsonb column.
//   - The assembled course is written to user_courses on success — the
//     existing course-sync layer on the client will pull it down.
//
// Reuses the stage modules from web/js/generator/stages/*.mjs which are
// framework-agnostic (run in browser, SW, and Node).

import { runIntake } from '../../js/generator/stages/intake.mjs';
import { runResearch } from '../../js/generator/stages/research.mjs';
import { runTopic } from '../../js/generator/stages/topic.mjs';
import { getTone } from '../../js/generator/tones/conversational.mjs';
import { createClient as createAnthropic } from '../../js/generator/anthropic-fetch.js';
import { assembleCourse } from '../../js/generator/assemble-browser.js';
import { signedPdfUrl } from './supabase-server.mjs';

const STAGE3_CONCURRENCY = 4;

/** Public entry. Driven by /api/gen/start.js and /api/gen/resume.js. */
export async function runGeneration({ supabase, jobId, ownerId, apiKey, userBrief, checkpoint, pdfRefs }) {
  const client = createAnthropic({ apiKey });
  const tone = getTone(userBrief.tone || 'conversational');

  // PDFs: refs look like [{ file_index, name, storage_path, pageThumbs:[dataUrl,...] }]
  // We fetch the actual PDF bytes from Storage once, base64-encode them for
  // the Anthropic document blocks. pageThumbs ride along into assembleCourse
  // for inline image-section resolution.
  const pdfs = await resolvePdfs(supabase, pdfRefs);
  const pdfsForApi = pdfs.map(p => ({
    file_index: p.file_index, name: p.name, base64: p.base64,
    pageCount: (p.pageThumbs || []).length
  }));
  const pdfThumbs = pdfs.map(p => ({
    file_index: p.file_index, name: p.name, pageThumbs: p.pageThumbs || []
  }));

  // Cancellation check — read from row mid-flight.
  async function isCancelled() {
    const { data } = await supabase
      .from('generation_jobs')
      .select('status')
      .eq('id', jobId)
      .maybeSingle();
    return data?.status === 'cancelling' || data?.status === 'cancelled';
  }

  async function patch(fields) {
    await supabase.from('generation_jobs').update({ ...fields, updated_at: new Date().toISOString() }).eq('id', jobId);
  }

  async function bailIfCancelled() {
    if (await isCancelled()) {
      await patch({ status: 'cancelled', stage: 'done', message: 'Cancelled by user' });
      return true;
    }
    return false;
  }

  try {
    // Stage 0 — URLs (cheap, idempotent; re-run on resume rather than checkpointing).
    const sourceUrls = (userBrief.source_urls || []).filter(Boolean);
    let extractedUrls = checkpoint?.extracted_urls || [];
    if (sourceUrls.length && !extractedUrls.length) {
      await patch({ stage: 'intake', status: 'running', message: `Reading ${sourceUrls.length} source URL${sourceUrls.length === 1 ? '' : 's'}…` });
      extractedUrls = await serverFetchUrls(sourceUrls);
    }
    const enrichedBrief = { ...userBrief, extracted_urls: extractedUrls };
    if (await bailIfCancelled()) return;

    // Stage 1 — brief.
    let brief = checkpoint?.brief;
    if (!brief) {
      await patch({ stage: 'intake', status: 'running', message: 'Designing the outline…' });
      brief = await runIntake(client, enrichedBrief, { pdfs: pdfsForApi });
      const outline = {
        title: brief.title,
        subtitle: brief.subtitle,
        modules: brief.modules.map(m => ({ title: m.title, topicCount: m.topics.length }))
      };
      const topicsTotal = brief.modules.reduce((n, m) => n + m.topics.length, 0);
      await patch({
        brief, outline,
        stage: 'research',
        message: `Researching ${brief.modules.length} module${brief.modules.length === 1 ? '' : 's'} in parallel…`,
        topics_total: topicsTotal
      });
    } else {
      await patch({ stage: 'research', message: 'Resuming from checkpoint…' });
    }
    if (await bailIfCancelled()) return;

    // Stage 2 — research per module.
    const researchByModule = checkpoint?.research || {};
    const researchResults = await Promise.all(
      brief.modules.map(async (mod) => {
        if (researchByModule[mod.id]) return { mod, bundle: researchByModule[mod.id] };
        if (await isCancelled()) return { mod, bundle: null };
        try {
          const bundle = await runResearch(client, brief, mod, { pdfs: pdfsForApi, extracted_urls: extractedUrls });
          researchByModule[mod.id] = bundle;
          const done = Object.keys(researchByModule).length;
          const total = brief.modules.length;
          await patch({
            research: researchByModule,
            stage: 'research',
            message: `Researched ${done}/${total} · just finished “${mod.title}”`
          });
          return { mod, bundle };
        } catch (err) {
          console.error(`[gen ${jobId}] research failed for ${mod.id}:`, err);
          return { mod, bundle: null };
        }
      })
    );
    if (await bailIfCancelled()) return;

    // Stage 3 — topics. Per-module parallel, capped concurrency, checkpointed.
    const total = brief.modules.reduce((n, m) => n + m.topics.length, 0);
    const topicsByKey = checkpoint?.topics_by_key || {};
    const failures = (checkpoint?.failures || []).slice();
    let done = Object.keys(topicsByKey).length;
    await patch({ stage: 'topics', message: 'Writing topic content…', topics_done: done, topics_total: total });

    const work = [];
    for (const { mod, bundle } of researchResults) {
      for (const topic of mod.topics) {
        const key = `${mod.id}/${topic.id}`;
        if (!topicsByKey[key]) work.push({ mod, topic, bundle });
      }
    }

    let cursor = 0;
    const workers = Array.from({ length: Math.min(STAGE3_CONCURRENCY, work.length) }, async () => {
      while (cursor < work.length) {
        if (await isCancelled()) return;
        const i = cursor++;
        const { mod, topic, bundle } = work[i];
        const key = `${mod.id}/${topic.id}`;
        try {
          const content = await runTopic(client, brief, mod, topic, bundle, tone);
          topicsByKey[key] = content;
          done++;
          await patch({
            topics_by_key: topicsByKey,
            topics_done: done,
            message: `Wrote “${topic.title}” — ${done}/${total} topics done`
          });
        } catch (err) {
          done++;
          failures.push({
            moduleId: mod.id, topicId: topic.id, topicTitle: topic.title,
            error: err.message,
            kind: err.kind || null,
            attempts: err.attempts || null,
            at: Date.now()
          });
          await patch({
            failures,
            topics_done: done,
            message: `Skipped (error) “${topic.title}” — ${done}/${total} topics done`
          });
          console.error(`[gen ${jobId}] topic failed ${key}:`, err);
        }
      }
    });
    await Promise.all(workers);
    if (await bailIfCancelled()) return;

    // Stage 4 — assemble + save course.
    await patch({ stage: 'assemble', message: 'Finalising…' });
    const topicResults = [];
    for (const mod of brief.modules) {
      for (const topic of mod.topics) {
        const key = `${mod.id}/${topic.id}`;
        const content = topicsByKey[key] || null;
        topicResults.push({ moduleId: mod.id, topicId: topic.id, content });
      }
    }
    const course = assembleCourse(brief, topicResults, { pdfThumbs });
    const failedCount = (course.failedTopics || []).length;
    const totalTopics = topicResults.length;
    let status, message;
    if (failedCount === 0)            { status = 'completed'; message = 'Done!'; }
    else if (failedCount >= totalTopics) { status = 'failed';  message = `Generation failed — no topics produced (${failedCount} errors).`; }
    else                              { status = 'partial';  message = `${totalTopics - failedCount} of ${totalTopics} topics done — ${failedCount} failed.`; }

    // Save to user_courses. The client's existing course-sync layer will pull
    // this down via its own Realtime / pullAll cycle.
    const courseRowId = brief.id;
    const fullCoursePayload = {
      ...course,
      _brief: brief,
      _research: researchByModule,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      createdBy: (await supabase.auth.getUser()).data?.user?.email || null
    };
    const { error: upsertErr } = await supabase
      .from('user_courses')
      .upsert(
        { id: courseRowId, owner_id: ownerId, payload: fullCoursePayload, updated_at: new Date().toISOString() },
        { onConflict: 'id,owner_id' }
      );
    if (upsertErr) throw upsertErr;

    await patch({
      stage: 'done',
      status,
      message,
      saved_course_id: courseRowId,
      topics_done: done
    });
  } catch (err) {
    console.error(`[gen ${jobId}] FAILED:`, err);
    await supabase.from('generation_jobs').update({
      status: 'failed',
      error: err.message || String(err),
      updated_at: new Date().toISOString()
    }).eq('id', jobId);
    throw err;
  }
}

async function resolvePdfs(supabase, pdfRefs) {
  if (!pdfRefs?.length) return [];
  const out = [];
  for (const ref of pdfRefs) {
    const signed = await signedPdfUrl(supabase, ref.storage_path);
    const r = await fetch(signed);
    if (!r.ok) throw new Error(`Could not download PDF ${ref.name}: HTTP ${r.status}`);
    const buf = Buffer.from(await r.arrayBuffer());
    out.push({
      file_index: ref.file_index,
      name: ref.name,
      base64: buf.toString('base64'),
      pageThumbs: ref.pageThumbs || []
    });
  }
  return out;
}

/** Server-side URL fetch. Re-implements the small loop in fetch-urls.js using
 *  the same /api/fetch-url function we already have. */
async function serverFetchUrls(urls) {
  const base = process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : '';
  const out = [];
  await Promise.all(urls.map(async (url) => {
    try {
      const r = await fetch(`${base}/api/fetch-url`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const d = await r.json();
      if (d.ok) out.push(d);
    } catch { /* skip */ }
  }));
  return out;
}
