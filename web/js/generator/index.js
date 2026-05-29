// Browser-side course generator. Runs the same 4-stage pipeline as the Node
// CLI, but in the user's tab using their own Anthropic API key (same pattern
// as the AI tutor). No backend, no serverless timeout, no per-course cost to
// the platform.
//
// Public API:
//   hasApiKey() / setApiKey(key)        — manage the user's Anthropic key
//   generateCourse(brief, onProgress)   — returns { config, curriculum, modules }
//
// Progress callback receives one object per event. Stages emitted:
//   { stage: 'intake' }                                     — Stage 1 starting
//   { stage: 'intake_done', brief }                         — outline ready
//   { stage: 'research' }                                   — Stage 2 starting
//   { stage: 'research_module', moduleId, status }          — one bundle done
//   { stage: 'topics' }                                     — Stage 3 starting
//   { stage: 'topic_done', moduleId, topicId, done, total } — one topic done
//   { stage: 'topic_failed', ..., error }                   — one topic failed
//   { stage: 'assemble' }                                   — Stage 4
//   { stage: 'done', course }                               — full course ready

import { createClient } from './anthropic-fetch.js';
import { runIntake } from './stages/intake.mjs';
import { runResearch } from './stages/research.mjs';
import { runTopic } from './stages/topic.mjs';
import { getTone } from './tones/conversational.mjs';
import { assembleCourse } from './assemble-browser.js';

// Reuse the AI tutor's existing key slot so users only have to enter their
// Anthropic key once. (The slot name is legacy from the original app — kept
// for zero migration friction.)
const KEY_STORE = 'gametheory-api-key';

export function hasApiKey() {
  return !!localStorage.getItem(KEY_STORE);
}
export function getApiKey() {
  return localStorage.getItem(KEY_STORE) || '';
}
export function setApiKey(k) {
  localStorage.setItem(KEY_STORE, (k || '').trim());
}

export async function generateCourse(userBrief, onProgress = () => {}) {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('Anthropic API key not set');

  const client = createClient({ apiKey });
  const tone = getTone(userBrief.tone || 'conversational');

  // --- Stage 1: intake → course brief --------------------------------
  onProgress({ stage: 'intake' });
  const brief = await runIntake(client, userBrief);
  onProgress({ stage: 'intake_done', brief });

  // --- Stage 2: research per module, in parallel ---------------------
  onProgress({ stage: 'research', moduleCount: brief.modules.length });
  const researchResults = await Promise.all(
    brief.modules.map(async mod => {
      try {
        const bundle = await runResearch(client, brief, mod);
        onProgress({ stage: 'research_module', moduleId: mod.id, status: 'ok' });
        return { mod, bundle };
      } catch (err) {
        onProgress({ stage: 'research_module', moduleId: mod.id, status: 'fail', error: err.message });
        return { mod, bundle: null };
      }
    })
  );

  // --- Stage 3: topics, parallel-per-module --------------------------
  const total = brief.modules.reduce((n, m) => n + m.topics.length, 0);
  let done = 0;
  onProgress({ stage: 'topics', total });
  const topicResults = [];
  for (const { mod, bundle } of researchResults) {
    const chunk = await Promise.all(mod.topics.map(async topic => {
      try {
        const content = await runTopic(client, brief, mod, topic, bundle, tone);
        done++;
        onProgress({ stage: 'topic_done', moduleId: mod.id, topicId: topic.id, done, total });
        return { moduleId: mod.id, topicId: topic.id, content };
      } catch (err) {
        done++;
        onProgress({ stage: 'topic_failed', moduleId: mod.id, topicId: topic.id, done, total, error: err.message });
        return { moduleId: mod.id, topicId: topic.id, content: null, error: err.message };
      }
    }));
    topicResults.push(...chunk);
  }

  // --- Stage 4: assemble in memory (no fs) ---------------------------
  onProgress({ stage: 'assemble' });
  const course = assembleCourse(brief, topicResults);
  // Keep brief + per-module research bundles around the result so the caller
  // can persist them — surgical retry of failed topics needs both to skip
  // Stage 1/2 on the rerun.
  const researchByModule = Object.fromEntries(
    researchResults.map(({ mod, bundle }) => [mod.id, bundle])
  );
  onProgress({ stage: 'done', course });
  return { course, brief, research: researchByModule };
}

// In-memory assemble moved to assemble-browser.js so the service-worker
// generator can reuse it without duplication.
