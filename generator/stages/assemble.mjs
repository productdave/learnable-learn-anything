// Stage 4 — Assemble + write
//
// Take the course brief + generated topics, build the renderer-shaped files
// (course.json, curriculum.json, modules/module-N.json), and write to disk.

import { writeFileSync, readFileSync, mkdirSync, rmSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';

function defaultCourseConfig(brief) {
  return {
    id: brief.id,
    schemaVersion: 1,
    name: brief.title,
    title: brief.title,
    subtitle: brief.subtitle,
    eyebrow: brief.eyebrow || 'Free Course',
    storageKeyPrefix: brief.id,
    documentTitle: `${brief.title} | Learnable`,
    searchPlaceholder: `Search topics in ${brief.title}…`,
    chatPlaceholder: `Ask about ${brief.title.toLowerCase()}… (Enter to send)`,
    chatAssistantName: 'AI Learning Assistant',
    chatWelcomeBody: `Highlight any text in the lesson to ask the AI about it, or type a question below.`,
    chatSystemPrompt: `You are a learning assistant embedded in an interactive course called "${brief.title}". The course is for: ${brief.learner_persona} Your tone is casual, direct, and practical. Think smart friend at a coffee shop, not a professor at a lectern. Use short paragraphs and concrete examples from real life. Keep the ego low — say "from what I've seen" rather than making absolute claims.`,
    chatTrailingPrompt: 'Be concise (150-250 words per response unless asked for more). Focus on practical application, not abstract theory. Use real-world examples. Write in plain paragraphs or short bullet lists. No filler phrases.',
    completionMessage: 'great work building your knowledge',
    dashboardCTA: brief.modules.length === 1
      ? `Work through the topics in order. Each one builds on the last.`
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

function buildModuleFiles(brief, topicResults) {
  // Group topic content by moduleId, in module order, in topic order.
  const out = {};
  const byKey = new Map(topicResults.filter(r => r.content).map(r => [`${r.moduleId}/${r.topicId}`, r.content]));

  for (const mod of brief.modules) {
    const mapping = {};
    for (const topic of mod.topics) {
      const key = `${mod.id}/${topic.id}`;
      const content = byKey.get(key);
      if (content) mapping[topic.id] = content;
    }
    out[mod.number] = mapping;
  }
  return out;
}

// === Incremental (module-by-module) writers ================================
// Used by the per-module orchestration so a failure in one module never
// destroys other modules, and resume can skip/merge completed topics.

/** Write course.json + curriculum.json + persist the brief for resume. */
export function writeManifests(brief, outputDir) {
  const courseDir = resolve(outputDir, brief.id);
  mkdirSync(resolve(courseDir, 'modules'), { recursive: true });
  writeFileSync(resolve(courseDir, 'course.json'), JSON.stringify(defaultCourseConfig(brief), null, 2), 'utf8');
  writeFileSync(resolve(courseDir, 'curriculum.json'), JSON.stringify(buildCurriculum(brief), null, 2), 'utf8');
  writeFileSync(resolve(courseDir, '_brief.json'), JSON.stringify(brief, null, 2), 'utf8');
  return courseDir;
}

/** Load a previously-persisted brief (for --resume). */
export function loadSavedBrief(outputDir, courseId) {
  const p = resolve(outputDir, courseId, '_brief.json');
  if (!existsSync(p)) throw new Error(`No saved brief at ${p} — can't resume "${courseId}"`);
  return JSON.parse(readFileSync(p, 'utf8'));
}

/** Read the existing topic map for one module: { [topicId]: content } or {}. */
export function readModuleMap(brief, mod, outputDir) {
  const p = resolve(outputDir, brief.id, 'modules', `module-${mod.number}.json`);
  if (!existsSync(p)) return {};
  try { return JSON.parse(readFileSync(p, 'utf8')); } catch { return {}; }
}

/** Write a module's topic map (already merged by the caller). */
export function writeModuleMap(brief, mod, map, outputDir) {
  const modulesDir = resolve(outputDir, brief.id, 'modules');
  mkdirSync(modulesDir, { recursive: true });
  writeFileSync(resolve(modulesDir, `module-${mod.number}.json`), JSON.stringify(map, null, 2), 'utf8');
  return Object.keys(map).length;
}

export function assembleAndWrite(brief, topicResults, outputDir) {
  const courseDir = resolve(outputDir, brief.id);
  const modulesDir = resolve(courseDir, 'modules');

  // Guard: if the whole run failed (0 topics), do NOT touch the existing
  // course dir. A wipe here would destroy good output from a prior run —
  // e.g. when this run dies on a mid-pipeline credit/network error.
  const succeeded = topicResults.filter(r => r.content).length;
  if (succeeded === 0) {
    return {
      courseDir,
      written: [],
      totalTopics: topicResults.length,
      succeededTopics: 0,
      failedTopics: topicResults.map(f => `${f.moduleId}/${f.topicId}: ${f.error || 'unknown error'}`),
      skippedWrite: true
    };
  }

  // Wipe any stale files from a previous run of the same course id —
  // otherwise old module-N.json files survive and confuse downstream tools.
  if (existsSync(courseDir)) rmSync(courseDir, { recursive: true, force: true });
  mkdirSync(modulesDir, { recursive: true });

  const courseConfig = defaultCourseConfig(brief);
  const curriculum = buildCurriculum(brief);
  const moduleFiles = buildModuleFiles(brief, topicResults);

  const write = (p, obj) => {
    writeFileSync(p, JSON.stringify(obj, null, 2), 'utf8');
    return p;
  };

  const written = [];
  written.push(write(resolve(courseDir, 'course.json'), courseConfig));
  written.push(write(resolve(courseDir, 'curriculum.json'), curriculum));
  for (const [num, mapping] of Object.entries(moduleFiles)) {
    written.push(write(resolve(modulesDir, `module-${num}.json`), mapping));
  }

  // Summary of any failures
  const failed = topicResults.filter(r => !r.content);
  return {
    courseDir,
    written,
    totalTopics: topicResults.length,
    succeededTopics: topicResults.length - failed.length,
    failedTopics: failed.map(f => `${f.moduleId}/${f.topicId}: ${f.error || 'unknown error'}`)
  };
}
