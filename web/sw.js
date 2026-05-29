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

// Activate immediately on install — we want new versions to take over so
// updates ship without users having to close every tab.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Track active generations so duplicate start messages don't double-run a job
// and so we can keep the SW alive via event.waitUntil for the duration.
const active = new Map();

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
    const p = runGeneration(msg.jobId, msg.userBrief, msg.apiKey);
    active.set(msg.jobId, p);
    // Keep the SW alive until the generation settles.
    if (event.waitUntil) event.waitUntil(p);
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
    const course = assembleCourse(brief, merged);
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

async function runGeneration(jobId, userBrief, apiKey) {
  const client = createClient({ apiKey });
  const tone = getTone(userBrief.tone || 'conversational');

  try {
    await broadcast({ type: 'gen-progress', jobId, stage: 'intake' });
    const brief = await runIntake(client, userBrief);
    await broadcast({ type: 'gen-progress', jobId, stage: 'intake_done', brief });

    await broadcast({ type: 'gen-progress', jobId, stage: 'research', moduleCount: brief.modules.length });
    const researchResults = await Promise.all(
      brief.modules.map(async (mod) => {
        try {
          const bundle = await runResearch(client, brief, mod);
          await broadcast({ type: 'gen-progress', jobId, stage: 'research_module', moduleId: mod.id, status: 'ok' });
          return { mod, bundle };
        } catch (err) {
          await broadcast({ type: 'gen-progress', jobId, stage: 'research_module', moduleId: mod.id, status: 'fail', error: err.message });
          return { mod, bundle: null };
        }
      })
    );

    const total = brief.modules.reduce((n, m) => n + m.topics.length, 0);
    let done = 0;
    await broadcast({ type: 'gen-progress', jobId, stage: 'topics', total });
    const topicResults = [];
    for (const { mod, bundle } of researchResults) {
      const chunk = await Promise.all(mod.topics.map(async (topic) => {
        try {
          const content = await runTopic(client, brief, mod, topic, bundle, tone);
          done++;
          await broadcast({ type: 'gen-progress', jobId, stage: 'topic_done', moduleId: mod.id, topicId: topic.id, done, total });
          return { moduleId: mod.id, topicId: topic.id, content };
        } catch (err) {
          done++;
          await broadcast({ type: 'gen-progress', jobId, stage: 'topic_failed', moduleId: mod.id, topicId: topic.id, done, total, error: err.message });
          return { moduleId: mod.id, topicId: topic.id, content: null, error: err.message };
        }
      }));
      topicResults.push(...chunk);
    }

    await broadcast({ type: 'gen-progress', jobId, stage: 'assemble' });
    const course = assembleCourse(brief, topicResults);
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
  }
}
