// Shared in-memory assemble step — replaces the Node `fs`-based assemble.mjs
// for both the in-page generator and the service-worker generator.

export function assembleCourse(brief, topicResults) {
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
