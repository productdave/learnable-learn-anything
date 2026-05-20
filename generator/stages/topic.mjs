// Stage 3 — Topic generation
//
// For each topic, one Sonnet call with the module's research bundle as
// context and the tone preset baked into the system prompt. Output is
// schema-constrained via tool use so it drops straight into the renderer.
//
// Parallel across topics, capped to avoid rate limits.

import { TopicContentSchema } from '../schema.mjs';

const TOOL_NAME = 'submit_topic';

const topicTool = {
  name: TOOL_NAME,
  description: 'Submit the finished topic content. Sections must follow the schema exactly.',
  input_schema: {
    type: 'object',
    required: ['id', 'moduleId', 'title', 'estimatedMinutes', 'sections', 'flashcards'],
    properties: {
      id: { type: 'string' },
      moduleId: { type: 'string' },
      title: { type: 'string' },
      estimatedMinutes: { type: 'integer', minimum: 5, maximum: 60 },
      sections: {
        type: 'array',
        minItems: 5,
        maxItems: 9,
        description: 'An ordered sequence of teaching sections. Must include: 2-3 concept sections, at least 1 callout, exactly 1 quiz, exactly 1 exercise, exactly 1 takeaway. Order: concept → concept → callout → concept → callout → quiz → exercise → takeaway is a good default.',
        items: {
          oneOf: [
            {
              type: 'object',
              required: ['type', 'title', 'content'],
              properties: {
                type: { const: 'concept' },
                title: { type: 'string', description: 'Specific, concrete section heading — not generic.' },
                content: { type: 'string', description: 'HTML body. Use <p>, <strong>, <em>. 2-3 paragraphs. Each paragraph 1-3 sentences.' }
              }
            },
            {
              type: 'object',
              required: ['type', 'variant', 'content'],
              properties: {
                type: { const: 'callout' },
                variant: { type: 'string', enum: ['example', 'key-insight', 'warning', 'tip'] },
                title: { type: 'string' },
                content: { type: 'string', description: 'Plain text body, 2-4 sentences. No HTML tags here.' }
              }
            },
            {
              type: 'object',
              required: ['type', 'variant', 'id', 'question', 'options', 'correct', 'explanation'],
              description: 'Multiple choice — best for testing applied judgement with plausible distractors. Use most often.',
              properties: {
                type: { const: 'quiz' },
                variant: { const: 'multiple-choice' },
                id: { type: 'string' },
                question: { type: 'string', description: 'A question that tests applied understanding, not recall.' },
                options: {
                  type: 'array',
                  minItems: 3,
                  maxItems: 5,
                  items: {
                    type: 'object',
                    required: ['id', 'text'],
                    properties: {
                      id: { type: 'string', description: 'a, b, c, or d' },
                      text: { type: 'string' }
                    }
                  }
                },
                correct: { type: 'string', description: 'Must match one of the option ids' },
                explanation: { type: 'string', description: 'Explain WHY the correct answer is right and what the distractors get wrong. 2-3 sentences.' }
              }
            },
            {
              type: 'object',
              required: ['type', 'variant', 'id', 'statement', 'correct', 'explanation'],
              description: 'True/false — best for testing a single sharp claim, surfacing a common misconception, or fast recall. Keep the statement unambiguous.',
              properties: {
                type: { const: 'quiz' },
                variant: { const: 'true-false' },
                id: { type: 'string' },
                statement: { type: 'string', description: 'A single declarative claim. Make it sharp — no weasel words.' },
                correct: { type: 'boolean', description: 'true if the statement is correct, false if false' },
                explanation: { type: 'string', description: 'Explain the nuance — especially for false statements, what the common mistake is and what is actually true.' }
              }
            },
            {
              type: 'object',
              required: ['type', 'variant', 'id', 'question', 'pairs', 'explanation'],
              description: 'Matching — best when you have 3-5 distinct items to pair (terms↔definitions, problems↔solutions, scenarios↔strategies). Higher engagement than MC for vocabulary or taxonomy.',
              properties: {
                type: { const: 'quiz' },
                variant: { const: 'drag-match' },
                id: { type: 'string' },
                question: { type: 'string', description: 'The instruction prompt above the pairs.' },
                pairs: {
                  type: 'array',
                  minItems: 3,
                  maxItems: 5,
                  items: {
                    type: 'object',
                    required: ['left', 'right'],
                    properties: {
                      left: { type: 'string', description: 'Term, concept, or scenario' },
                      right: { type: 'string', description: 'Definition, match, or response' }
                    }
                  }
                },
                explanation: { type: 'string', description: 'One paragraph summarising what the pattern of matches teaches.' }
              }
            },
            {
              type: 'object',
              required: ['type', 'variant', 'id', 'sentence', 'acceptable_answers', 'explanation'],
              description: 'Fill-in-the-blank — best when a single key term, number, or short phrase is the whole point (a ratio, a key name, a specific count). Use ___ in the sentence to mark the blank.',
              properties: {
                type: { const: 'quiz' },
                variant: { const: 'fill-in-blank' },
                id: { type: 'string' },
                sentence: { type: 'string', description: 'A sentence with exactly one blank, marked as three underscores: ___' },
                acceptable_answers: {
                  type: 'array',
                  minItems: 1,
                  maxItems: 6,
                  items: { type: 'string' },
                  description: 'All acceptable answer strings. Include common phrasings (e.g. "1:16", "1 to 16", "one to sixteen"). Match is case-insensitive and whitespace-tolerant.'
                },
                explanation: { type: 'string', description: 'Why this answer matters and what nearby wrong answers learners typically give.' }
              }
            },
            {
              type: 'object',
              required: ['type', 'variant', 'id', 'question', 'sample_answer', 'key_points', 'explanation'],
              description: 'Short-answer / open-ended — best when the concept requires synthesis or judgement that no fixed answer can capture. The learner writes free text, then reveals a sample answer + key points to self-assess.',
              properties: {
                type: { const: 'quiz' },
                variant: { const: 'short-answer' },
                id: { type: 'string' },
                question: { type: 'string', description: 'An open-ended question that requires the learner to synthesise multiple ideas.' },
                sample_answer: { type: 'string', description: '2-4 sentence model answer. Should be a strong but not exhaustive response — leaves room for the learner to have written something different and still be right.' },
                key_points: {
                  type: 'array',
                  minItems: 2,
                  maxItems: 5,
                  items: { type: 'string', description: 'A short bullet the learner should look for in their own answer.' }
                },
                explanation: { type: 'string', description: 'A note on what makes a strong answer here — what students typically miss.' }
              }
            },
            {
              type: 'object',
              required: ['type', 'id', 'title', 'prompt', 'hints'],
              properties: {
                type: { const: 'exercise' },
                id: { type: 'string' },
                title: { type: 'string' },
                prompt: { type: 'string', description: 'A concrete reflection or application prompt — get the learner to map the concept onto their own life. 2-4 sentences.' },
                hints: {
                  type: 'array',
                  minItems: 2,
                  maxItems: 4,
                  items: { type: 'string', description: 'A short hint or question that unsticks a learner who is staring at the prompt.' }
                }
              }
            },
            {
              type: 'object',
              required: ['type', 'points'],
              properties: {
                type: { const: 'takeaway' },
                points: {
                  type: 'array',
                  minItems: 3,
                  maxItems: 5,
                  items: { type: 'string', description: 'A single sentence the learner should walk away repeating.' }
                }
              }
            }
          ]
        }
      },
      flashcards: {
        type: 'array',
        minItems: 4,
        maxItems: 6,
        items: {
          type: 'object',
          required: ['front', 'back'],
          properties: {
            front: { type: 'string', description: 'A question that probes one specific idea from the topic.' },
            back: { type: 'string', description: 'A complete, self-contained answer.' }
          }
        }
      }
    }
  }
};

function buildSystem(tone) {
  return `You are a teacher writing one topic of an interactive learning module. Your job is to produce a single topic's worth of content that drops directly into the renderer.

Structure each topic as a deliberate learning arc:
1. Open with a "what is this and why care" concept section.
2. Introduce the substance in 1-2 more concept sections.
3. Use callouts (example, key-insight, warning, tip) to break up text and reinforce.
4. Include one applied quiz that tests judgement, not recall.
5. Include one exercise that asks the learner to apply the concept to their own life.
6. End with a takeaway: 3-5 single-sentence summaries the learner walks away repeating.
7. Provide 4-6 flashcards for spaced repetition.

CHOOSING THE QUIZ FORMAT — pick the best fit for THIS topic, don't default:
- multiple-choice: best when the topic has rich plausible distractors (judgement calls). Use most often.
- true-false: best when there's a sharp claim or common misconception to nail down. Quick, punchy.
- drag-match: best when there are 3-5 paired items (terms↔definitions, problems↔fixes, scenarios↔strategies). Great for vocabulary or taxonomy topics.
- fill-in-blank: best when ONE specific value, ratio, number, name, or short phrase is the whole point of the lesson.
- short-answer: best when the concept requires synthesis no fixed answer captures — "how would you approach…", "describe the trade-off…".

Vary the format across topics in the same course. A 20-topic course with 20 multiple-choice quizzes is monotonous.

${tone.systemFragment}

VOICE EXEMPLARS (anonymous reference samples — match this style, do not quote):
${tone.exemplars.map((e, i) => `Sample ${i + 1}:\n${e}`).join('\n\n')}

Important formatting:
- "concept" content is HTML. Wrap paragraphs in <p>. Use <strong> for 2-4 inline keywords per paragraph. Use <em> sparingly.
- "callout" content is plain text — no HTML tags.
- Keep paragraphs short. Real Conversational style breaks up density.
- Ground content in the research bundle. Drop in named experts where natural.
- Do not include any meta-commentary in the content itself.

Submit by calling the submit_topic tool. Do not write a preamble.`;
}

export async function runTopic(client, courseBrief, mod, topicMeta, bundle, tone, assignedVariant) {
  const researchContext = bundle
    ? `RESEARCH BUNDLE for this module (use as substance):
Key concepts: ${bundle.key_concepts.join('; ')}
Examples: ${bundle.examples.join(' | ')}
${bundle.experts.length ? 'Named thinkers:\n' + bundle.experts.map(e => `- ${e.name}: ${e.note}`).join('\n') : ''}
${bundle.misconceptions.length ? 'Common misconceptions:\n' + bundle.misconceptions.map(m => `- ${m}`).join('\n') : ''}`
    : '(No external research available — use general knowledge carefully.)';

  const userMsg = `Write the content for this topic.

Course: "${courseBrief.title}" — ${courseBrief.subtitle}
Learner: ${courseBrief.learner_persona}

Module ${mod.number}: ${mod.title}
Module description: ${mod.description}

Topic to write: "${topicMeta.title}"
Topic id: ${topicMeta.id}
Module id: ${mod.id}

${researchContext}

Now produce the topic via the submit_topic tool. Use moduleId "${mod.id}" and id "${topicMeta.id}".

${assignedVariant ? `IMPORTANT — for the quiz section of this topic, you MUST use variant "${assignedVariant}". This is part of varying formats across the course. Do not use a different variant. Write the quiz so the ${assignedVariant} format genuinely fits the substance of this topic.` : ''}`;

  const resp = await client.messages.create({
    model: 'claude-sonnet-4-5-20250929',
    max_tokens: 4096,
    system: buildSystem(tone),
    tools: [topicTool],
    tool_choice: { type: 'tool', name: TOOL_NAME },
    messages: [{ role: 'user', content: userMsg }]
  });

  const toolUse = resp.content.find(b => b.type === 'tool_use' && b.name === TOOL_NAME);
  if (!toolUse) throw new Error(`Stage 3 [${topicMeta.id}]: model did not submit topic`);

  const parsed = TopicContentSchema.parse(toolUse.input);
  return parsed;
}

/**
 * Distribute quiz variants across topics so the same course has format variety.
 * Without this the LLM defaults to multiple-choice for almost everything.
 * Pattern: alternate MC with other variants, biased ~50% MC overall.
 */
function assignQuizVariants(courseBrief) {
  const variants = ['multiple-choice', 'true-false', 'drag-match', 'fill-in-blank', 'short-answer'];
  // Build a shuffled-but-balanced sequence. For 20 topics: ~10 MC, ~3 of each other.
  const assignments = new Map();
  let idx = 0;
  for (const mod of courseBrief.modules) {
    for (const topic of mod.topics) {
      // Even indices: multiple-choice. Odd indices: rotate through the others.
      const variant = (idx % 2 === 0) ? 'multiple-choice' : variants[1 + ((idx >> 1) % 4)];
      assignments.set(`${mod.id}/${topic.id}`, variant);
      idx++;
    }
  }
  return assignments;
}

/**
 * Run topic generation for every topic in every module, with a concurrency cap
 * to stay polite to the API.
 */
export async function runAllTopics(client, courseBrief, researchResults, tone, { concurrency = 4 } = {}) {
  const variantAssignments = assignQuizVariants(courseBrief);

  // Flatten { mod, topic, bundle, assignedVariant } work items
  const work = [];
  for (const { mod, bundle } of researchResults) {
    for (const topic of mod.topics) {
      const assignedVariant = variantAssignments.get(`${mod.id}/${topic.id}`);
      work.push({ mod, topic, bundle, assignedVariant });
    }
  }

  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, work.length) }, async () => {
    while (cursor < work.length) {
      const i = cursor++;
      const { mod, topic, bundle, assignedVariant } = work[i];
      try {
        const content = await runTopic(client, courseBrief, mod, topic, bundle, tone, assignedVariant);
        results.push({ moduleId: mod.id, topicId: topic.id, content });
        console.log(`    ✓ ${mod.id} / ${topic.id} [${assignedVariant}]`);
      } catch (err) {
        results.push({ moduleId: mod.id, topicId: topic.id, content: null, error: err.message });
        console.log(`    ✗ ${mod.id} / ${topic.id}: ${err.message}`);
      }
    }
  });
  await Promise.all(workers);

  return results;
}
