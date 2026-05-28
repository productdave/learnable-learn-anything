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

import Anthropic from 'https://esm.sh/@anthropic-ai/sdk@0.32.1';
import { runIntake } from './stages/intake.mjs';
import { runResearch } from './stages/research.mjs';
import { runTopic } from './stages/topic.mjs';
import { getTone } from './tones/conversational.mjs';

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

  const client = new Anthropic({ apiKey, dangerouslyAllowBrowser: true });
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
  onProgress({ stage: 'done', course });
  return course;
}

// === In-memory assemble (browser equivalent of stages/assemble.mjs) ====

function assembleCourse(brief, topicResults) {
  return {
    config: defaultCourseConfig(brief),
    curriculum: buildCurriculum(brief),
    modules: buildModuleMaps(brief, topicResults),
    failedTopics: topicResults.filter(r => !r.content).map(r => `${r.moduleId}/${r.topicId}`)
  };
}

function defaultCourseConfig(brief) {
  return {
    id: brief.id,
    schemaVersion: 1,
    name: brief.title,
    title: brief.title,
    subtitle: brief.subtitle,
    eyebrow: brief.eyebrow || 'Generated course',
    emoji: brief.emoji || '',
    storageKeyPrefix: brief.id,
    documentTitle: `${brief.title} | Learnable`,
    searchPlaceholder: `Search topics in ${brief.title}…`,
    chatPlaceholder: `Ask about ${brief.title.toLowerCase()}… (Enter to send)`,
    chatAssistantName: 'AI Learning Assistant',
    chatWelcomeBody: 'Highlight any text in the lesson to ask the AI about it, or type a question below.',
    chatSystemPrompt: `You are a learning assistant embedded in an interactive course called "${brief.title}". The course is for: ${brief.learner_persona}. Your tone is casual, direct, and practical. Think smart friend at a coffee shop, not a professor at a lectern. Use short paragraphs and concrete examples from real life. Keep the ego low — say "from what I've seen" rather than making absolute claims.`,
    chatTrailingPrompt: 'Be concise (150-250 words per response unless asked for more). Focus on practical application, not abstract theory. Use real-world examples. Write in plain paragraphs or short bullet lists. No filler phrases.',
    completionMessage: 'great work building your knowledge',
    dashboardCTA: brief.modules.length === 1
      ? 'Work through the topics in order. Each one builds on the last.'
      : `Each module builds on the one before. Start with "${brief.modules[0].title}" and work your way through.`,
    moduleColorAccents: ['#4338CA', '#D97706', '#059669', '#8B5CF6', '#0EA5E9']
  };
}

function buildCurriculum(brief) {
  return {
    title: brief.title,
    subtitle: brief.subtitle,
    modules: brief.modules.map(m => ({
      id: m.id,
      number: m.number,
      title: m.title,
      description: m.description,
      icon: m.icon,
      color: m.color,
      topics: m.topics.map(t => ({ id: t.id, title: t.title, quiz_plan: t.quiz_plan }))
    }))
  };
}

function buildModuleMaps(brief, topicResults) {
  const out = {};
  const byKey = new Map(topicResults.filter(r => r.content).map(r => [`${r.moduleId}/${r.topicId}`, r.content]));
  for (const mod of brief.modules) {
    const map = {};
    for (const topic of mod.topics) {
      const c = byKey.get(`${mod.id}/${topic.id}`);
      if (c) map[topic.id] = c;
    }
    out[mod.number] = map;
  }
  return out;
}
