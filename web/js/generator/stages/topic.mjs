// Stage 3 — Topic generation
//
// For each topic, one Sonnet call with the module's research bundle as
// context and the tone preset baked into the system prompt. Output is
// schema-constrained via tool use so it drops straight into the renderer.
//
// Parallel across topics, capped to avoid rate limits.

import { TopicContentSchema } from '../schema.mjs';
import { agentSystemLines } from '../agents.mjs';

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
        maxItems: 15,
        description: 'An ordered sequence of teaching sections. Must include: 2-3 concept sections, 3-5 quiz sections (one per variant in the quiz_plan, in that order), at least 1 callout, exactly 1 takeaway. OPTIONAL: 0-2 image sections (diagram/chart/screenshot) when an image clarifies a concept — place each image immediately AFTER the concept it illustrates. INTERLEAVE the quizzes with concepts — each quiz comes immediately after the concept it tests, so the learner checks understanding while it is fresh. Do not cluster all quizzes at the end. Recommended pattern: concept → [optional image] → quiz → concept → callout → quiz → concept → quiz → [optional quiz #4] → [optional quiz #5] → takeaway. Exercise section is OPTIONAL; only include if a deeper application reflection genuinely adds value.',
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
            },
            {
              type: 'object',
              required: ['type', 'ref_kind', 'alt'],
              description: 'OPTIONAL inline image — a diagram, chart, or screenshot that clarifies a concept just taught. Use 0-2 per topic, ONLY when an image meaningfully helps. Source from the research bundle images array; do not invent URLs. Place an image section AFTER the concept section it illustrates, not before. Skip decorative imagery.',
              properties: {
                type: { const: 'image' },
                ref_kind: { type: 'string', enum: ['web', 'pdf'], description: '"web" for a URL from the research bundle; "pdf" for a page-index pointer into an uploaded PDF.' },
                url: { type: 'string', description: 'Required when ref_kind="web". Copy verbatim from one of the research bundle image refs.' },
                file_index: { type: 'integer', minimum: 0, description: 'Required when ref_kind="pdf". Which uploaded PDF.' },
                page: { type: 'integer', minimum: 1, description: 'Required when ref_kind="pdf". 1-indexed page number.' },
                alt: { type: 'string', description: 'Short description of what the image shows.' },
                caption: { type: 'string', description: 'One sentence explaining what this image teaches in context of the topic.' },
                source_title: { type: 'string', description: 'Source title (for web images).' },
                source_url: { type: 'string', description: 'Source page URL (for web images).' }
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
  return `${agentSystemLines('lessonWriter', 'practiceDesigner')}

Produce a single topic's worth of content that drops directly into the renderer.

Structure each topic as a deliberate learning arc with INTERLEAVED knowledge checks:
1. Open with a "what is this and why care" concept section.
2. Place a quiz immediately after — testing the very thing you just taught.
3. Introduce more substance in 1-2 more concept sections, each followed by a quiz that tests it.
4. Use callouts (example, key-insight, warning, tip) to break up text and reinforce.
5. End with a takeaway: 3-5 single-sentence summaries the learner walks away repeating.
6. Provide 4-6 flashcards for spaced repetition.

QUIZ STRUCTURE — critical:
- You will receive a quiz_plan (3-5 variants in order) from the topic context.
- Produce ONE quiz section per variant in the plan, in that exact order.
- Interleave the quizzes between concept sections — DO NOT cluster all quizzes at the end.
- Each quiz tests the concept just before it. Choose questions that match the substance.

Quiz variants and how to write them:
- multiple-choice: applied judgement with 3-4 plausible distractors. Most versatile.
- true-false: a sharp single claim. State it unambiguously. Most useful for misconceptions.
- drag-match: 3-5 paired items (terms↔definitions, problems↔fixes, scenarios↔strategies).
- fill-in-blank: ONE specific value/ratio/name/phrase. Sentence must contain ___ as the marker. Provide 2-4 acceptable phrasings.
- short-answer: synthesis questions where no fixed wording captures the right answer. Provide a model sample + 2-4 key points the learner should look for.

The exercise section (longer free-text reflection prompt) is OPTIONAL. Default to NOT including one — the 3-5 quizzes already give the learner active engagement. Only include an exercise if the topic genuinely benefits from a longer applied prompt that doesn't fit any quiz variant.

IMAGES (OPTIONAL — 0 to 2 per topic):
- You'll receive an IMAGE BUNDLE in the prompt — a list of image refs the researcher pre-vetted. Pick from those; do not invent URLs or PDF page numbers.
- Include an image ONLY when it genuinely clarifies a concept (an architecture diagram for an architecture concept, a chart for a comparison, a screenshot of a real interface, a labelled mechanism for a process). Skip decorative imagery.
- Place each image AFTER the concept section it illustrates, never before.
- Web image refs: copy the url, alt, caption, source_title, source_url verbatim.
- PDF image refs: copy the file_index, page, alt, caption verbatim — assemble will resolve them to embedded thumbnails.
- Many topics need zero images. That's fine. Only include them when they pull weight.

${tone.systemFragment}

VOICE EXEMPLARS (anonymous reference samples — match this style, do not quote):
${tone.exemplars.map((e, i) => `Sample ${i + 1}:\n${e}`).join('\n\n')}

RECENCY: today's date is ${new Date().toISOString().slice(0, 10)}. Your training data may be 1-2 years behind it. Where the research bundle names newer models, tools, versions, or events than you remember, TRUST THE BUNDLE — it came from live web search. Never frame the present as your training era ("new in 2024", "the latest GPT-4o") unless the research bundle confirms it's still current.

Important formatting:
- "concept" content is HTML. Wrap paragraphs in <p>. Use <strong> for 2-4 inline keywords per paragraph. Use <em> sparingly.
- "callout" content is plain text — no HTML tags.
- Keep paragraphs short. Real Conversational style breaks up density.
- Ground content in the research bundle. Drop in named experts where natural.
- Do not include any meta-commentary in the content itself.

Submit by calling the submit_topic tool. Do not write a preamble.`;
}

export async function runTopic(client, courseBrief, mod, topicMeta, bundle, tone) {
  const imageBundle = bundle?.images?.length
    ? `\nIMAGE BUNDLE — pre-vetted refs you MAY include as image sections in this topic (0-2 max, only when they genuinely clarify a concept). Copy fields VERBATIM; do not invent. Skip any you don't have a good use for.\n` +
      bundle.images.map((img, i) => {
        if (img.kind === 'web') {
          return `[${i}] kind:web url:${img.url} alt:"${img.alt}"${img.caption ? ` caption:"${img.caption}"` : ''}${img.source_title ? ` source_title:"${img.source_title}"` : ''}${img.source_url ? ` source_url:${img.source_url}` : ''}`;
        }
        return `[${i}] kind:pdf file_index:${img.file_index} page:${img.page} alt:"${img.alt}"${img.caption ? ` caption:"${img.caption}"` : ''}`;
      }).join('\n')
    : '';

  const researchContext = bundle
    ? `RESEARCH BUNDLE for this module (use as substance):
Key concepts: ${bundle.key_concepts.join('; ')}
Examples: ${bundle.examples.join(' | ')}
${bundle.experts.length ? 'Named thinkers:\n' + bundle.experts.map(e => `- ${e.name}: ${e.note}`).join('\n') : ''}
${bundle.misconceptions.length ? 'Common misconceptions:\n' + bundle.misconceptions.map(m => `- ${m}`).join('\n') : ''}${imageBundle}`
    : '(No external research available — use general knowledge carefully.)';

  const userMsg = `Write the content for this topic.

Course: "${courseBrief.title}" — ${courseBrief.subtitle}
Learner: ${courseBrief.learner_persona}
${courseBrief.human_feedback ? `\nHuman feedback from curriculum/research review:\n${courseBrief.human_feedback}\n` : ''}

Module ${mod.number}: ${mod.title}
Module description: ${mod.description}

Topic to write: "${topicMeta.title}"
Topic id: ${topicMeta.id}
Module id: ${mod.id}

${researchContext}

Now produce the topic via the submit_topic tool. Use moduleId "${mod.id}" and id "${topicMeta.id}".

${topicMeta.quiz_plan && topicMeta.quiz_plan.length ? `QUIZ PLAN for this topic — you MUST produce ${topicMeta.quiz_plan.length} quiz sections in this exact order of variants: ${topicMeta.quiz_plan.map((v, i) => `(${i + 1}) "${v}"`).join(', ')}. Interleave them with the concept sections — each quiz tests the concept just before it. Do not cluster them all at the end.` : ''}`;

  // Retry once — large tool outputs occasionally come back malformed
  // (stringified arrays, truncation). Coercion fixes most; the retry
  // catches the rest. We keep BOTH attempt errors so the surfaced message
  // makes the failure mode obvious.
  const attemptErrors = [];
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const resp = await client.messages.create({
        model: 'claude-sonnet-4-5-20250929',
        // 16k — a topic with 3 concepts + 5 quizzes + images + flashcards can
        // exceed 8k tokens of tool JSON; truncation produced malformed
        // sections ("Expected array, received string"). Billed on actual
        // usage, so the higher ceiling costs nothing when unused.
        max_tokens: 16384,
        system: buildSystem(tone),
        tools: [topicTool],
        tool_choice: { type: 'tool', name: TOOL_NAME },
        messages: [{ role: 'user', content: userMsg }]
      });

      // Surface model-side stop reasons that aren't a successful tool call.
      const toolUse = resp.content.find(b => b.type === 'tool_use' && b.name === TOOL_NAME);
      if (!toolUse) {
        const textChunk = (resp.content || []).find(b => b.type === 'text');
        const stop = resp.stop_reason || 'unknown';
        const sample = textChunk?.text ? ` Text reply: "${textChunk.text.slice(0, 200)}${textChunk.text.length > 200 ? '…' : ''}"` : '';
        throw new Error(`model did not call submit_topic (stop_reason=${stop}).${sample}`);
      }

      const input = coerceTopicInput(toolUse.input);
      return TopicContentSchema.parse(input);
    } catch (err) {
      attemptErrors.push(err);
      // Console log so the SW's DevTools view shows the full picture (status,
      // body, zod issues) without us having to broadcast huge payloads.
      try {
        // eslint-disable-next-line no-console
        console.error(`[stage3:${topicMeta.id}] attempt ${attempt + 1} failed:`, err);
        if (err?.issues) console.error(`[stage3:${topicMeta.id}] zod issues:`, err.issues);
        if (err?.body)   console.error(`[stage3:${topicMeta.id}] api body:`, err.body);
      } catch {}
    }
  }
  // Build a structured, human-readable summary covering both attempts.
  const summary = describeTopicErrors(attemptErrors);
  const wrapped = new Error(`Stage 3 [${topicMeta.id}]: ${summary.headline}`);
  wrapped.attempts = summary.attempts; // [{ status?, type?, issues?, message }]
  wrapped.kind = summary.kind;         // 'api' | 'schema' | 'tool' | 'unknown'
  throw wrapped;
}

/**
 * Convert raw caught errors into a structured summary the UI can render.
 * Zod errors get their issues flattened; API errors keep status + type.
 */
function describeTopicErrors(errs) {
  const attempts = errs.map((e) => {
    // Zod parse error (most common kind here)
    if (e?.issues && Array.isArray(e.issues)) {
      const top = e.issues.slice(0, 5).map(i => `${i.path?.join('.') || '<root>'}: ${i.message}`);
      return {
        kind: 'schema',
        message: 'Generated content failed schema validation',
        issues: top,
        more: Math.max(0, e.issues.length - 5)
      };
    }
    // Anthropic API error (we attached status + type in anthropic-fetch.js)
    if (typeof e?.status === 'number') {
      return {
        kind: 'api',
        status: e.status,
        type: e.type || null,
        message: e.message || 'API error'
      };
    }
    return { kind: 'unknown', message: e?.message || String(e) };
  });
  // Headline = the most informative of the two attempts.
  const worst = attempts.find(a => a.kind === 'api')
             || attempts.find(a => a.kind === 'schema')
             || attempts[attempts.length - 1] || { message: 'failed' };
  let headline;
  if (worst.kind === 'api') {
    headline = `API ${worst.status}${worst.type ? ` (${worst.type})` : ''}: ${worst.message.replace(/^Anthropic API \d+( \w+)?: /, '')}`;
  } else if (worst.kind === 'schema') {
    headline = `Schema mismatch — ${worst.issues?.[0] || 'see issues'}`;
  } else {
    headline = worst.message || 'unknown failure';
  }
  return { headline, attempts, kind: worst.kind };
}

/**
 * Repair common malformations in the model's tool output before validation:
 * - `sections` / `flashcards` returned as a JSON *string* instead of an array
 * - nested arrays (options, pairs, hints, points, etc.) stringified
 * - acceptable_answers exceeding the max (truncate to 6)
 */
function coerceTopicInput(input) {
  if (!input || typeof input !== 'object') return input;

  const tryParse = (v) => {
    if (typeof v !== 'string') return v;
    try { return JSON.parse(v); } catch { return v; }
  };

  input.sections = tryParse(input.sections);
  input.flashcards = tryParse(input.flashcards);

  if (Array.isArray(input.sections)) {
    for (const s of input.sections) {
      if (!s || typeof s !== 'object') continue;
      for (const key of ['options', 'pairs', 'hints', 'points', 'acceptable_answers', 'key_points']) {
        if (key in s) s[key] = tryParse(s[key]);
      }
      if (Array.isArray(s.acceptable_answers) && s.acceptable_answers.length > 6) {
        s.acceptable_answers = s.acceptable_answers.slice(0, 6);
      }
      // Quiz/exercise ids must be ≥3 chars (they're storage keys). The model
      // sometimes emits terse ids like "q1" — prefix with the topic id, which
      // also guards against cross-topic key collisions.
      if (typeof s.id === 'string' && s.id.length > 0 && s.id.length < 3 && typeof input.id === 'string') {
        s.id = `${input.id}-${s.id}`;
      }
    }
  }
  return input;
}

/**
 * Run topic generation for every topic in every module, with a concurrency cap
 * to stay polite to the API. Quiz variant choice now lives in Stage 1
 * (`topic.quiz_plan`); Stage 3 just honors the plan.
 */
export async function runAllTopics(client, courseBrief, researchResults, tone, { concurrency = 4 } = {}) {
  // Flatten { mod, topic, bundle } work items — topic already carries its quiz_plan
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
        console.log(`    ✓ ${mod.id} / ${topic.id} [${(topic.quiz_plan || []).join(', ')}]`);
      } catch (err) {
        results.push({ moduleId: mod.id, topicId: topic.id, content: null, error: err.message });
        console.log(`    ✗ ${mod.id} / ${topic.id}: ${err.message}`);
      }
    }
  });
  await Promise.all(workers);

  return results;
}
