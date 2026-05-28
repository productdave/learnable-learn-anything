// Stage 1 — Intake → Course Brief
//
// Takes a user brief (topic + variables) and produces a structured CourseBrief
// that decides scope, module breakdown, and topic titles. Single Haiku call,
// forced JSON output via tool use.

import { CourseBriefSchema, QUIZ_VARIANTS } from '../schema.mjs';

const TOOL_NAME = 'submit_course_brief';

const briefTool = {
  name: TOOL_NAME,
  description: 'Submit the proposed course brief once you have decided on scope, modules, and topics.',
  input_schema: {
    type: 'object',
    required: ['id', 'title', 'subtitle', 'scope', 'learner_persona', 'learning_objectives', 'modules'],
    properties: {
      id: { type: 'string', description: 'kebab-case identifier for the course, e.g. "pour-over-coffee"' },
      title: { type: 'string', description: 'Short, evocative course title (2-5 words)' },
      subtitle: { type: 'string', description: 'One-sentence promise of what the learner will be able to do' },
      eyebrow: { type: 'string', description: 'Optional small label, e.g. "Free Course"' },
      emoji: {
        type: 'string',
        description: 'A single emoji that captures this course at a glance, used as the course icon. Pick one that visually communicates the subject — e.g. ☕ for coffee, 🧠 for AI/ML, 📊 for analytics/metrics, 🎯 for negotiation/strategy, 💼 for work/PM, 🎲 for game theory, 🏷️ for data annotation, 💻 for code, 🎨 for design, ✍️ for writing, 💰 for finance, 💪 for fitness, 🍳 for cooking. Choose ONE; do not return multiple.'
      },
      scope: {
        type: 'string',
        enum: ['single_module', 'mini_course', 'full_course'],
        description: 'single_module = 1 module / 4-6 topics. mini_course = 3 modules / 9-12 topics. full_course = 6 modules / 18-24 topics. Choose based on topic breadth and the learner\'s depth preference.'
      },
      learner_persona: {
        type: 'string',
        description: 'One sentence describing who this is for, in plain English. e.g. "Hobbyist home brewer who just bought their first V60 and wants café-quality results."'
      },
      learning_objectives: {
        type: 'array',
        items: { type: 'string' },
        description: '3-5 concrete things the learner will be able to do after finishing.'
      },
      modules: {
        type: 'array',
        minItems: 1,
        maxItems: 6,
        items: {
          type: 'object',
          required: ['id', 'number', 'title', 'description', 'icon', 'color', 'topics'],
          properties: {
            id: { type: 'string', description: 'kebab-case module id' },
            number: { type: 'integer', description: '1-indexed module number' },
            title: { type: 'string' },
            description: { type: 'string', description: '1-2 sentence description of what this module covers' },
            icon: {
              type: 'string',
              description: 'One of: target, scale, briefcase, users, repeat, settings, brain, lightbulb, book, compass'
            },
            color: {
              type: 'string',
              description: 'Hex color for the module accent. Pick from: #4338CA, #D97706, #059669, #0EA5E9, #E11D48, #8B5CF6 — use a different color for each module.'
            },
            topics: {
              type: 'array',
              minItems: 3,
              maxItems: 6,
              items: {
                type: 'object',
                required: ['id', 'title', 'quiz_plan'],
                properties: {
                  id: { type: 'string' },
                  title: { type: 'string' },
                  quiz_plan: {
                    type: 'array',
                    minItems: 3,
                    maxItems: 5,
                    uniqueItems: true,
                    items: {
                      type: 'string',
                      enum: ['multiple-choice', 'true-false', 'drag-match', 'fill-in-blank', 'short-answer']
                    },
                    description: '3-5 quiz variants for THIS topic, distinct, chosen to fit the topic substance. Pick based on what works:\n- multiple-choice: plausible distractors testing judgement (default workhorse)\n- true-false: a sharp claim or a common misconception worth nailing\n- drag-match: 3-5 pairs (term↔definition, scenario↔strategy, problem↔fix)\n- fill-in-blank: ONE specific value/name/ratio is the lesson\n- short-answer: synthesis required, no single right wording\n\nMatch the variant to the substance — do not pick randomly. A "1:16 ratio" topic should include fill-in-blank. A "common pitfalls" topic should include true-false. A "matching style to context" topic wants drag-match.'
                  }
                }
              }
            }
          }
        }
      }
    }
  }
};

const SYSTEM = `You are a curriculum designer. Given a learner's topic and constraints, design a course outline that genuinely fits the topic's breadth.

Critical rules:
- SCOPE is yours to decide. Don't default to 6 modules. A narrow practical topic ("pour-over coffee", "negotiating a salary") usually wants single_module. A broad subject ("game theory", "personal finance") may want full_course. Match the topic to the scope honestly.
- Topic titles should be specific and concrete, not generic. "What Makes Good Coffee Good" beats "Introduction to Coffee".
- Module descriptions should preview the *substance*, not just restate the title.
- Pick module colors from the provided palette. Use a DIFFERENT color for each module.
- Use kebab-case ids ("pour-over-basics", not "Pour Over Basics").

QUIZ PLANNING per topic — this is critical:
- Every topic must include a quiz_plan: an array of 3-5 distinct quiz variant names.
- Choose variants that genuinely fit the substance of that topic. Quiz variant fit options:
  - "multiple-choice" — best for applied judgement with plausible distractors. Use most often.
  - "true-false" — best for testing a sharp claim or surfacing a common misconception.
  - "drag-match" — best for vocab, taxonomies, scenario↔strategy pairs.
  - "fill-in-blank" — best when ONE specific value, name, ratio, or short phrase is the whole lesson.
  - "short-answer" — best when synthesis is required and no single fixed answer exists.
- Variants within a topic MUST be distinct (no repeats inside one topic).
- Across the course, mix variants — a course where every topic is the same 3 variants is monotonous.
- A topic on "the 1:16 brew ratio" SHOULD include fill-in-blank. A topic on "common pour-over mistakes" SHOULD include true-false. A topic on "matching feedback style to situation" SHOULD include drag-match.

Submit your answer by calling the submit_course_brief tool. Do not write a long preamble.`;

export async function runIntake(client, userBrief) {
  const urls = (userBrief.source_urls || []).filter(Boolean);
  const sourcesBlock = userBrief.source_text || urls.length
    ? `\n\nSOURCE MATERIAL PROVIDED BY THE LEARNER — design the course PRIMARILY from this. Preserve the source's angle, terminology, and structure where useful. Use general knowledge only to fill obvious gaps.\n` +
      (userBrief.source_text ? `\n--- Pasted text/notes ---\n${userBrief.source_text}\n` : '') +
      (urls.length ? `\n--- Source URLs (Stage 2 research will fetch these) ---\n${urls.join('\n')}\n` : '')
    : '';

  const userMsg = `Design a course based on this learner request:

Topic: ${userBrief.topic || '(derive from source material below)'}
Goal: ${userBrief.goal || '(unspecified)'}
Starting point: ${userBrief.starting_point || '(unspecified)'}
Depth preference: ${userBrief.depth || 'Solid foundation'}
Time budget: ${userBrief.time_budget || '(unspecified)'}
${sourcesBlock}
Decide the right scope (single_module / mini_course / full_course), break the subject into modules, and propose 4-6 topic titles per module. Submit via the tool.`;

  const resp = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    system: SYSTEM,
    tools: [briefTool],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: userMsg }]
  });

  const toolUse = resp.content.find(b => b.type === 'tool_use' && b.name === TOOL_NAME);
  if (!toolUse) throw new Error('Stage 1: model did not call the brief tool');

  // Normalise quiz_plans: model sometimes under-fills (<3 variants), repeats,
  // or omits entirely. Pad/dedupe/truncate to satisfy the 3-5 distinct rule
  // before schema validation rejects the whole brief.
  const raw = toolUse.input;
  if (raw?.modules) {
    for (const mod of raw.modules) {
      for (const topic of mod.topics || []) {
        topic.quiz_plan = normaliseQuizPlan(topic.quiz_plan);
      }
    }
  }

  const parsed = CourseBriefSchema.parse(raw);
  // Carry the learner-provided source material through for later stages
  // (Zod's strip behaviour drops unknown keys, so re-attach after parse).
  if (userBrief.source_text) parsed.source_text = userBrief.source_text;
  if (userBrief.source_urls && userBrief.source_urls.length) parsed.source_urls = userBrief.source_urls;
  return parsed;
}

// Default priority order for padding short or empty quiz_plans.
const DEFAULT_VARIANT_ORDER = ['multiple-choice', 'true-false', 'fill-in-blank', 'drag-match', 'short-answer'];

function normaliseQuizPlan(plan) {
  const seen = new Set();
  const out = [];
  for (const v of (Array.isArray(plan) ? plan : [])) {
    if (QUIZ_VARIANTS.includes(v) && !seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  // Pad up to 3 from the default order (skipping anything already in).
  for (const v of DEFAULT_VARIANT_ORDER) {
    if (out.length >= 3) break;
    if (!seen.has(v)) {
      seen.add(v);
      out.push(v);
    }
  }
  // Cap at 5.
  return out.slice(0, 5);
}
