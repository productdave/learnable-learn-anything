// Stage 2 — Research
//
// For each module, run a web-grounded research call that produces a
// structured research bundle (key concepts, examples, expert names,
// misconceptions, sources). Stage 3 consumes these bundles to ground
// topic content in real-world material.
//
// One call per module, in parallel.

import { ResearchBundleSchema } from '../schema.mjs';

const TOOL_NAME = 'submit_research_bundle';

const researchTool = {
  name: TOOL_NAME,
  description: 'Submit the structured research bundle after you have finished searching.',
  input_schema: {
    type: 'object',
    required: ['module_id', 'key_concepts', 'examples'],
    properties: {
      module_id: { type: 'string' },
      key_concepts: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        description: 'The 4-8 most important concepts a learner should walk away understanding for this module.'
      },
      examples: {
        type: 'array',
        items: { type: 'string' },
        minItems: 2,
        description: 'Concrete real-world examples or case studies relevant to this module — at least 3.'
      },
      experts: {
        type: 'array',
        items: {
          type: 'object',
          required: ['name', 'note'],
          properties: {
            name: { type: 'string', description: 'Full name of a recognised expert / thinker / practitioner' },
            note: { type: 'string', description: 'One sentence about why they matter for this module' }
          }
        },
        description: 'Optional but helpful: 2-4 named thinkers or practitioners.'
      },
      misconceptions: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional: common myths or mistakes learners hold about this material.'
      },
      sources: {
        type: 'array',
        items: {
          type: 'object',
          required: ['title'],
          properties: {
            title: { type: 'string' },
            url: { type: 'string' }
          }
        },
        description: 'Notable sources you consulted (title + url if available).'
      }
    }
  }
};

const SYSTEM = `You are a research assistant grounding a learning module in real-world material.

For the assigned module, use the web_search tool aggressively to find:
- The actual canonical concepts experts agree on
- Concrete examples and case studies that illustrate them
- Names of recognised thinkers or practitioners
- Common misconceptions or mistakes

Then submit a structured research bundle via the submit_research_bundle tool. Search 3-6 times before submitting. Don't make things up — if you couldn't find good material on something, leave that field shorter.`;

export async function runResearch(client, courseBrief, mod) {
  const urls = (courseBrief.source_urls || []).filter(Boolean);
  const sourcesBlock = courseBrief.source_text || urls.length
    ? `\nPRIMARY SOURCES from the learner — ground your research in these first, before searching for general material:\n` +
      (urls.length ? `URLs to fetch via web_search:\n${urls.join('\n')}\n` : '') +
      (courseBrief.source_text ? `\nPasted text/notes:\n${courseBrief.source_text}\n` : '')
    : '';

  const userMsg = `Research material for this module so it can be turned into learning content.

Course: ${courseBrief.title} — ${courseBrief.subtitle}
Learner: ${courseBrief.learner_persona}

Module ${mod.number}: ${mod.title}
Description: ${mod.description}

Topics in this module:
${mod.topics.map(t => `- ${t.title}`).join('\n')}
${sourcesBlock}
Search the web for canonical material on these topics${urls.length ? ' (start by fetching the URLs above)' : ''}. Then submit your research bundle via the tool. The module_id you submit must be "${mod.id}".`;

  // Web search + final tool call in one streaming(-ish) interaction
  let messages = [{ role: 'user', content: userMsg }];
  const tools = [
    { type: 'web_search_20250305', name: 'web_search', max_uses: 6 },
    researchTool
  ];

  // Loop: call → handle tool_use → feed back tool_result → continue. Stop when
  // the model submits the research bundle tool.
  for (let turn = 0; turn < 10; turn++) {
    const resp = await client.messages.create({
      model: 'claude-sonnet-4-5-20250929',
      max_tokens: 4096,
      system: SYSTEM,
      tools,
      messages
    });

    messages.push({ role: 'assistant', content: resp.content });

    const submitBlock = resp.content.find(b => b.type === 'tool_use' && b.name === TOOL_NAME);
    if (submitBlock) {
      const parsed = ResearchBundleSchema.parse(submitBlock.input);
      return parsed;
    }

    // For any web_search calls the server-side tool already filled in results.
    if (resp.stop_reason === 'end_turn') {
      throw new Error(`Stage 2 [${mod.id}]: model ended turn without submitting research bundle`);
    }

    // If the model called a non-server tool other than submit, that's an error.
    const toolUses = resp.content.filter(b => b.type === 'tool_use');
    if (toolUses.length === 0) {
      throw new Error(`Stage 2 [${mod.id}]: model produced no tool call (stop_reason=${resp.stop_reason})`);
    }
    // Otherwise: web_search is server-side, Anthropic auto-injects results into
    // the next response. We just loop.
  }
  throw new Error(`Stage 2 [${mod.id}]: too many turns without research submission`);
}

export async function runResearchAll(client, courseBrief) {
  console.log(`  Researching ${courseBrief.modules.length} module(s) in parallel…`);
  const results = await Promise.all(
    courseBrief.modules.map(mod =>
      runResearch(client, courseBrief, mod)
        .then(bundle => {
          console.log(`    ✓ ${mod.id}`);
          return { mod, bundle };
        })
        .catch(err => {
          console.log(`    ✗ ${mod.id}: ${err.message}`);
          return { mod, bundle: null };
        })
    )
  );
  return results;
}
