// Shared in-memory assemble step used by the cloud generation runner and
// renderer-side course previews.
//
// `opts.pdfThumbs`: [{ file_index, name, pageThumbs: [dataUrl, ...] }] used
// to resolve image sections with ref_kind:'pdf' into a renderer-facing shape
// where `src` is a data:image/jpeg;base64,... URL. Refs that don't resolve
// (file_index/page out of range, or no thumbs at all) are dropped silently.

import { componentPolicy } from './component-policy.mjs';
import { topicContentSchemaFor } from './schema.mjs';

export function assembleCourse(brief, topicResults, opts = {}) {
  const policy = componentPolicy(brief);
  const pdfThumbs = opts.pdfThumbs || [];
  // Walk every topic's sections and resolve image sections in place.
  const resolved = topicResults.map(r => {
    if (!r.content) return r;
    if (policy.explicit) {
      const topic = brief.modules.find(m => m.id === r.moduleId)?.topics.find(t => t.id === r.topicId);
      topicContentSchemaFor(brief, topic).parse(r.content);
    }
    const sections = [];
    let authoredIndex = 0, resolvedAuthoredIndex = 0, visual = r.content.visual;
    for (const section of r.content.sections || []) {
      const resolved = resolveImageSection(section, pdfThumbs);
      const generated = section.type === 'image' && section.generated_by === 'openai';
      // A source image may disappear when its PDF page cannot be resolved.
      // Keep the planned illustration anchored to its original concept, not
      // the next section that happens to occupy its former numeric position.
      if (!generated) {
        if (visual?.decision === 'generate' && authoredIndex === r.content.visual.afterSectionIndex) {
          visual = { ...visual, afterSectionIndex: resolvedAuthoredIndex };
        }
        authoredIndex++;
        if (resolved) resolvedAuthoredIndex++;
      }
      if (resolved) sections.push(resolved);
    }
    return { ...r, content: { ...r.content, sections, ...(visual ? { visual } : {}) } };
  });
  return {
    config: defaultCourseConfig(brief),
    curriculum: buildCurriculum(brief),
    modules: buildModuleMaps(brief, resolved),
    failedTopics: resolved.filter(r => !r.content).map(r => `${r.moduleId}/${r.topicId}`)
  };
}

/** Resolve a single section; drop unresolvable image refs. */
function resolveImageSection(section, pdfThumbs) {
  if (!section || section.type !== 'image') return section;
  // Generated private assets use a stable, authenticated identity, never an
  // expiring URL. Preserve accepted draft assets when assembling a preview.
  if (section.asset_id && section.generated_by === 'openai' && section.image_slot === 'instruction') return section;
  // Already-resolved (assemble re-run scenario): pass through.
  if (section.src && !section.ref_kind) return section;
  // Web ref — copy url verbatim into src.
  if (section.ref_kind === 'web' || (!section.ref_kind && section.url)) {
    if (!section.url) return null; // malformed
    return {
      type: 'image',
      src: section.url,
      alt: section.alt || '',
      caption: section.caption,
      source_title: section.source_title,
      source_url: section.source_url
    };
  }
  // PDF ref — look up the page thumb data URL.
  if (section.ref_kind === 'pdf') {
    const file = pdfThumbs.find(p => p.file_index === section.file_index);
    const thumb = file?.pageThumbs?.[section.page - 1];
    if (!thumb) return null; // can't resolve — drop the section
    return {
      type: 'image',
      src: thumb,
      alt: section.alt || '',
      caption: section.caption,
      source_title: file?.name || section.source_title
    };
  }
  // Unknown shape — drop rather than break the topic.
  return null;
}

function defaultCourseConfig(brief) {
  return {
    id: brief.id,
    schemaVersion: 1,
    ...(brief.materials_policy ? { materials_policy: brief.materials_policy } : {}),
    ...(brief.visual_designer_policy ? { visual_designer_policy: brief.visual_designer_policy } : {}),
    ...(Object.hasOwn(brief, 'components') ? { components: componentPolicy(brief).components } : {}),
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
