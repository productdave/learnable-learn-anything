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

export async function runTopic(client, courseBrief, mod, topicMeta, bundle, tone) {
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

Now produce the topic via the submit_topic tool. Use moduleId "${mod.id}" and id "${topicMeta.id}".`;

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
 * Run topic generation for every topic in every module, with a concurrency cap
 * to stay polite to the API.
 */
export async function runAllTopics(client, courseBrief, researchResults, tone, { concurrency = 4 } = {}) {
  // Flatten { mod, topic, bundle } work items
  const work = [];
  for (const { mod, bundle } of researchResults) {
    for (const topic of mod.topics) {
      work.push({ mod, topic, bundle });
    }
  }

  const results = [];
  let cursor = 0;
  const workers = Array.from({ length: Math.min(concurrency, work.length) }, async () => {
    while (cursor < work.length) {
      const i = cursor++;
      const { mod, topic, bundle } = work[i];
      try {
        const content = await runTopic(client, courseBrief, mod, topic, bundle, tone);
        results.push({ moduleId: mod.id, topicId: topic.id, content });
        console.log(`    ✓ ${mod.id} / ${topic.id}`);
      } catch (err) {
        results.push({ moduleId: mod.id, topicId: topic.id, content: null, error: err.message });
        console.log(`    ✗ ${mod.id} / ${topic.id}: ${err.message}`);
      }
    }
  });
  await Promise.all(workers);

  return results;
}
