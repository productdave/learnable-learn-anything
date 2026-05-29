// Learnable service worker — runs course generation in the background.
//
// Lives across page navigations and refreshes, so a long-running generation
// keeps making API calls even when the user reloads or closes the tab and
// reopens it (within the SW's idle window). Communicates with pages via
// postMessage; pages persist progress into the jobs registry in localStorage.
//
// Registered from app.js as { type: 'module' } so ES imports work here.

import { runIntake } from './js/generator/stages/intake.mjs';
import { runResearch } from './js/generator/stages/research.mjs';
import { runTopic } from './js/generator/stages/topic.mjs';
import { getTone } from './js/generator/tones/conversational.mjs';
import { createClient } from './js/generator/anthropic-fetch.js';
import { assembleCourse } from './js/generator/assemble-browser.js';
import { fetchExtractedUrls } from './js/generator/fetch-urls.js';

// Activate immediately on install — we want new versions to take over so
// updates ship without users having to close every tab.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Track active generations so duplicate start messages don't double-run a job
// and so we can keep the SW alive via event.waitUntil for the duration.
const active = new Map();

// Cancellation flags. When the page posts `gen-cancel`, the jobId lands here
// and the per-topic / per-module loops bail at the next dispatch boundary.
// In-flight Anthropic calls finish naturally (≤30s); we don't AbortController
// them so the model doesn't waste a partial completion.
const cancelled = new Set();
function isCancelled(id) { return cancelled.has(id); }

// Recently-completed results, kept briefly so a page that missed the live
// broadcast (e.g. reloaded during the last stage) can ask for the result.
const recentResults = new Map();
const RECENT_TTL = 10 * 60 * 1000; // 10 minutes

function rememberResult(jobId, payload) {
  recentResults.set(jobId, { at: Date.now(), payload });
  // Garbage-collect old ones.
  for (const [id, entry] of recentResults) {
    if (Date.now() - entry.at > RECENT_TTL) recentResults.delete(id);
  }
}

async function broadcast(msg) {
  const clients = await self.clients.matchAll({ includeUncontrolled: true, type: 'window' });
  for (const c of clients) c.postMessage(msg);
}

self.addEventListener('message', (event) => {
  const msg = event.data;
  if (!msg || !msg.type) return;

  if (msg.type === 'gen-start') {
    if (active.has(msg.jobId)) return; // already running
    cancelled.delete(msg.jobId);
    const p = runGeneration(msg.jobId, msg.userBrief, msg.apiKey, /*checkpoint*/ {});
    active.set(msg.jobId, p);
    // Keep the SW alive until the generation settles.
    if (event.waitUntil) event.waitUntil(p);
  }

  if (msg.type === 'gen-resume-checkpoint') {
    // Resume an interrupted/failed generation from the page's checkpoint —
    // skip Stage 1 / per-module Stage 2 / per-topic Stage 3 work that
    // already finished. Same runner as gen-start, different starting state.
    if (active.has(msg.jobId)) return;
    cancelled.delete(msg.jobId);
    const p = runGeneration(msg.jobId, msg.userBrief, msg.apiKey, msg.checkpoint || {});
    active.set(msg.jobId, p);
    if (event.waitUntil) event.waitUntil(p);
  }

  if (msg.type === 'gen-cancel') {
    // Mark the job cancelled. The runner checks this between dispatches,
    // drains in-flight calls, and broadcasts gen-cancelled when done.
    cancelled.add(msg.jobId);
  }

  if (msg.type === 'gen-query') {
    // Page asking for the result of a job it might have missed. Reply to
    // the sender only (not a broadcast).
    const result = recentResults.get(msg.jobId);
    if (result && event.source) event.source.postMessage(result.payload);
  }

  if (msg.type === 'gen-resume') {
    // Surgical retry — only re-runs Stage 3 for the listed missing topics,
    // reusing the original brief + research bundles so we don't re-pay for
    // intake or research.
    if (active.has(msg.jobId)) return;
    const p = resumeMissing(msg.jobId, msg.apiKey, msg.brief, msg.research, msg.existingContent, msg.missingTopics);
    active.set(msg.jobId, p);
    if (event.waitUntil) event.waitUntil(p);
  }
});

async function resumeMissing(jobId, apiKey, brief, research, existingContent, missingTopics) {
  const client = createClient({ apiKey });
  const tone = getTone(brief?.tone || 'conversational');
  const total = missingTopics.length;
  let done = 0;
  try {
    await broadcast({ type: 'gen-progress', jobId, stage: 'topics', total });
    const fresh = [];
    for (const { moduleId, topicId } of missingTopics) {
      const mod = brief.modules.find(m => m.id === moduleId);
      const topic = mod?.topics.find(t => t.id === topicId);
      if (!mod || !topic) {
        done++;
        await broadcast({ type: 'gen-progress', jobId, stage: 'topic_failed', moduleId, topicId, done, total, error: 'topic missing from brief' });
        fresh.push({ moduleId, topicId, content: null, error: 'topic missing from brief' });
        continue;
      }
      const bundle = research?.[moduleId] || null;
      try {
        const content = await runTopic(client, brief, mod, topic, bundle, tone);
        done++;
        await broadcast({ type: 'gen-progress', jobId, stage: 'topic_done', moduleId, topicId, done, total });
        fresh.push({ moduleId, topicId, content });
      } catch (err) {
        done++;
        await broadcast({ type: 'gen-progress', jobId, stage: 'topic_failed', moduleId, topicId, done, total, error: err.message });
        fresh.push({ moduleId, topicId, content: null, error: err.message });
      }
    }

    // Merge old + fresh into the full result set, in brief order.
    const merged = [];
    for (const mod of brief.modules) {
      for (const topic of mod.topics) {
        const old = existingContent?.[mod.number]?.[topic.id];
        if (old) { merged.push({ moduleId: mod.id, topicId: topic.id, content: old }); continue; }
        const f = fresh.find(r => r.moduleId === mod.id && r.topicId === topic.id);
        if (f) merged.push(f);
        else merged.push({ moduleId: mod.id, topicId: topic.id, content: null });
      }
    }

    await broadcast({ type: 'gen-progress', jobId, stage: 'assemble' });
    // Surgical retry has no PDF thumb cache (PDFs aren't persisted with the
    // course in v1). Any pdf-ref image sections from rerun topics are dropped
    // by assemble; web-ref images still resolve normally.
    const course = assembleCourse(brief, merged, { pdfThumbs: [] });
    const donePayload = {
      type: 'gen-progress', jobId, stage: 'done',
      course, _brief: brief, _research: research
    };
    rememberResult(jobId, donePayload);
    await broadcast(donePayload);
  } catch (err) {
    const failPayload = { type: 'gen-error', jobId, error: err.message || String(err) };
    rememberResult(jobId, failPayload);
    await broadcast(failPayload);
  } finally {
    active.delete(jobId);
  }
}

/**
 * Generation runner. Accepts an optional `checkpoint` of work already done
 * so it can resume after a SW death / page refresh without re-billing for
 * stages that already succeeded.
 *
 * checkpoint = {
 *   brief?,                     // Stage 1 result, if reached
 *   researchByModule?,          // { [moduleId]: bundle } — modules already researched
 *   topicsByKey?                // { [`${modId}/${topicId}`]: content } — topics already written
 * }
 *
 * Each broadcast carries the produced artifact (brief / bundle / topic
 * content) so the page can persist it as a checkpoint for next time.
 */
async function runGeneration(jobId, userBrief, apiKey, checkpoint = {}) {
  const client = createClient({ apiKey });
  const tone = getTone(userBrief.tone || 'conversational');
  // PDFs come in as [{ file_index, name, base64, pageThumbs }]. base64 →
  // `document` content blocks for Stages 1/2 (the model reads pages natively).
  // pageThumbs → resolved into image-section `src` data URLs by assemble.
  // Keep two lightweight views so we don't pass heavy data URLs into prompts.
  const pdfs = userBrief.pdfs || [];
  const pdfsForApi = pdfs.map(p => ({
    file_index: p.file_index, name: p.name, base64: p.base64,
    pageCount: (p.pageThumbs || []).length
  }));
  const pdfThumbs = pdfs.map(p => ({
    file_index: p.file_index, name: p.name, pageThumbs: p.pageThumbs || []
  }));

  // Bail helper — used at each safe boundary. Pushes a final gen-cancelled
  // event and exits cleanly.
  async function bailIfCancelled() {
    if (!isCancelled(jobId)) return false;
    await broadcast({ type: 'gen-cancelled', jobId });
    return true;
  }

  try {
    // Stage 0 — fetch + Readability-extract any user-provided URLs. Cheap +
    // idempotent; we re-run on every resume rather than checkpointing them.
    const sourceUrls = (userBrief.source_urls || []).filter(Boolean);
    let extractedUrls = [];
    if (sourceUrls.length) {
      await broadcast({ type: 'gen-progress', jobId, stage: 'fetching_urls', done: 0, total: sourceUrls.length });
      extractedUrls = await fetchExtractedUrls(sourceUrls, (p) => {
        broadcast({ type: 'gen-progress', jobId, stage: 'fetching_urls', ...p });
      });
    }
    const enrichedBrief = { ...userBrief, extracted_urls: extractedUrls };
    if (await bailIfCancelled()) return;

    // Stage 1 — use checkpoint if present, else run.
    let brief = checkpoint.brief;
    if (!brief) {
      await broadcast({ type: 'gen-progress', jobId, stage: 'intake' });
      brief = await runIntake(client, enrichedBrief, { pdfs: pdfsForApi });
      await broadcast({ type: 'gen-progress', jobId, stage: 'intake_done', brief });
    } else {
      // Resumed — still emit intake_done so the outline card renders.
      await broadcast({ type: 'gen-progress', jobId, stage: 'intake_done', brief, resumed: true });
    }
    if (await bailIfCancelled()) return;

    // Stage 2 — per-module, parallel. Skip modules with a checkpoint bundle.
    await broadcast({ type: 'gen-progress', jobId, stage: 'research', moduleCount: brief.modules.length });
    const existingBundles = checkpoint.researchByModule || {};
    const researchResults = await Promise.all(
      brief.modules.map(async (mod) => {
        if (existingBundles[mod.id]) {
          await broadcast({ type: 'gen-progress', jobId, stage: 'research_module', moduleId: mod.id, status: 'ok', bundle: existingBundles[mod.id], resumed: true });
          return { mod, bundle: existingBundles[mod.id] };
        }
        if (isCancelled(jobId)) return { mod, bundle: null };
        try {
          const bundle = await runResearch(client, brief, mod, { pdfs: pdfsForApi, extracted_urls: extractedUrls });
          await broadcast({ type: 'gen-progress', jobId, stage: 'research_module', moduleId: mod.id, status: 'ok', bundle });
          return { mod, bundle };
        } catch (err) {
          await broadcast({ type: 'gen-progress', jobId, stage: 'research_module', moduleId: mod.id, status: 'fail', error: err.message });
          return { mod, bundle: null };
        }
      })
    );
    if (await bailIfCancelled()) return;

    // Stage 3 — per-topic, parallel-per-module. Skip topics with checkpoint content.
    const total = brief.modules.reduce((n, m) => n + m.topics.length, 0);
    const existingTopics = checkpoint.topicsByKey || {};
    let done = Object.keys(existingTopics).length;
    await broadcast({ type: 'gen-progress', jobId, stage: 'topics', total, done });
    const topicResults = [];
    for (const { mod, bundle } of researchResults) {
      if (isCancelled(jobId)) break;
      const chunk = await Promise.all(mod.topics.map(async (topic) => {
        const key = `${mod.id}/${topic.id}`;
        if (existingTopics[key]) {
          await broadcast({ type: 'gen-progress', jobId, stage: 'topic_done', moduleId: mod.id, topicId: topic.id, done, total, content: existingTopics[key], resumed: true });
          return { moduleId: mod.id, topicId: topic.id, content: existingTopics[key] };
        }
        if (isCancelled(jobId)) return { moduleId: mod.id, topicId: topic.id, content: null, error: 'cancelled' };
        try {
          const content = await runTopic(client, brief, mod, topic, bundle, tone);
          done++;
          await broadcast({ type: 'gen-progress', jobId, stage: 'topic_done', moduleId: mod.id, topicId: topic.id, done, total, content });
          return { moduleId: mod.id, topicId: topic.id, content };
        } catch (err) {
          done++;
          await broadcast({ type: 'gen-progress', jobId, stage: 'topic_failed', moduleId: mod.id, topicId: topic.id, done, total, error: err.message });
          return { moduleId: mod.id, topicId: topic.id, content: null, error: err.message };
        }
      }));
      topicResults.push(...chunk);
    }
    if (await bailIfCancelled()) return;

    await broadcast({ type: 'gen-progress', jobId, stage: 'assemble' });
    const course = assembleCourse(brief, topicResults, { pdfThumbs });
    // Persist enough state with the course to enable surgical retry of any
    // topics that failed (no re-paying for ones that worked).
    const researchByModule = Object.fromEntries(
      researchResults.map(({ mod, bundle }) => [mod.id, bundle])
    );
    const donePayload = {
      type: 'gen-progress', jobId, stage: 'done',
      course, _brief: brief, _research: researchByModule
    };
    rememberResult(jobId, donePayload);
    await broadcast(donePayload);
  } catch (err) {
    const failPayload = { type: 'gen-error', jobId, error: err.message || String(err) };
    rememberResult(jobId, failPayload);
    await broadcast(failPayload);
  } finally {
    active.delete(jobId);
    cancelled.delete(jobId);
  }
}
