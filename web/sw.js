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
});

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
    const donePayload = { type: 'gen-progress', jobId, stage: 'done', course };
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
