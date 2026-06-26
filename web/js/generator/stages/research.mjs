// Stage 2 — Research
//
// For each module, run a web-grounded research call that produces a
// structured research bundle (key concepts, examples, expert names,
// misconceptions, sources). Stage 3 consumes these bundles to ground
// topic content in real-world material.
//
// One call per module, in parallel.

import { ResearchBundleSchema } from '../schema.mjs';
import { agentSystemLines } from '../agents.mjs';

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
      },
      images: {
        type: 'array',
        description: 'Aim for 4-8 images Stage 3 can embed. Two ref kinds: (a) web URLs of diagrams/charts/screenshots you found via web_search (kind:"web"); (b) PDF pages that ARE essentially diagrams/tables/screenshots (kind:"pdf"). Skip decorative stock images and skip text-only pages. Each ref needs a short `alt` (what the image shows) and a `caption` (one sentence on what it teaches).',
        items: {
          oneOf: [
            {
              type: 'object',
              required: ['kind', 'url', 'alt'],
              description: 'A web-hosted image found during research. Prefer canonical sources: Wikimedia, official docs, university pages, primary research. Avoid hotlink-protected hosts (Getty, Shutterstock).',
              properties: {
                kind: { const: 'web' },
                url: { type: 'string', description: 'Direct https:// URL of an image file (jpg/png/svg/webp).' },
                alt: { type: 'string', description: 'Short description of what the image shows (for accessibility + fallback).' },
                caption: { type: 'string', description: 'One-sentence caption — what does this image teach?' },
                source_title: { type: 'string', description: 'Title of the page or source the image came from.' },
                source_url: { type: 'string', description: 'URL of the page the image lives on (not the image itself).' }
              }
            },
            {
              type: 'object',
              required: ['kind', 'file_index', 'page', 'alt'],
              description: 'A page of one of the uploaded PDFs that is essentially a diagram, table, chart, or annotated screenshot worth showing inline. Do NOT pick text-only pages.',
              properties: {
                kind: { const: 'pdf' },
                file_index: { type: 'integer', minimum: 0, description: 'Which uploaded PDF, by 0-based file_index as listed in the prompt.' },
                page: { type: 'integer', minimum: 1, description: '1-indexed page number within that PDF.' },
                alt: { type: 'string', description: 'Short description of what is on the page.' },
                caption: { type: 'string', description: 'One-sentence caption — what does this page teach?' }
              }
            }
          ]
        }
      }
    }
  }
};

const SYSTEM = `${agentSystemLines('researcher')}

For the assigned module, ground the learning content in real-world material.

For the assigned module, use the web_search tool aggressively to find:
- The actual canonical concepts experts agree on
- Concrete examples and case studies that illustrate them
- Names of recognised thinkers or practitioners
- Common misconceptions or mistakes
- DIAGRAMS, CHARTS, SCREENSHOTS, or architecture images that would clarify a concept when embedded in the lesson. Prefer canonical sources (Wikimedia Commons, official docs, university pages, primary research). AVOID stock photos, decorative icons, and paywalled hotlinks.

If PDFs were uploaded by the learner, you have them as document blocks in this conversation. You can SEE their pages. For each PDF page that is essentially a diagram, table, chart, or annotated screenshot worth showing inline in the course, include an image ref of kind "pdf" with the file_index + page number. Skip text-only pages — those are read for substance, not embedded as images.

RECENCY: the user message includes today's date — treat it as "now". Your training data lags reality; the web does not. For fast-moving fields (AI, software, markets), prioritize sources from the last 12-18 months relative to today's date, and let search results OVERRIDE what you remember: if your training data says X is the newest model/tool/framework but search shows it's been superseded, the research bundle must reflect the current reality, not your training era.

Then submit a structured research bundle via the submit_research_bundle tool. Search 3-6 times before submitting. Don't make things up — if you couldn't find good material on something, leave that field shorter.`;

export async function runResearch(client, courseBrief, mod, opts = {}) {
  const urls = (courseBrief.source_urls || []).filter(Boolean);
  const pdfs = (opts.pdfs || []).filter(p => p && p.base64);
  // Stage 0 already fetched + Readability-extracted these. Use them as primary
  // substance; tell the model NOT to re-fetch.
  const extracted = (opts.extracted_urls || courseBrief.extracted_urls || []).filter(e => e && e.textContent);

  const extractedBlock = extracted.length
    ? `\n--- EXTRACTED URL CONTENTS (already fetched — do NOT re-fetch these) ---\n` +
      extracted.map((e, i) => {
        const imgList = (e.images || []).slice(0, 8);
        const imgs = imgList.length
          ? `\nAvailable images on this page (you may include any of these as image refs of kind:"web" — copy src verbatim):\n` +
            imgList.map(img => `  - src=${img.src}${img.alt ? `  alt="${img.alt.slice(0, 80)}"` : ''}`).join('\n')
          : '';
        const head = `[URL ${i + 1}] ${e.url}\nTitle: ${e.title || '(unknown)'}` + (e.byline ? `\nBy: ${e.byline}` : '');
        const body = `\n${e.textContent.slice(0, 10000)}` + (e.textContent.length > 10000 ? '\n…[truncated]' : '');
        return `${head}${imgs}${body}`;
      }).join('\n\n---\n\n') + '\n'
    : '';
  const failedUrls = urls.filter(u => !extracted.some(e => e.url === u || e.url.startsWith(u) || u.startsWith(e.url)));

  const pdfBlock = pdfs.length
    ? `\nUPLOADED PDFs you can see as documents in this message:\n` +
      pdfs.map(p => `- file_index ${p.file_index}: "${p.name}"${p.pageCount ? ` (${p.pageCount} pages)` : ''}`).join('\n') +
      `\nFor any page that is essentially a diagram, table, chart, or annotated screenshot worth showing inline, include an image ref of kind "pdf" with that file_index and 1-indexed page number.\n`
    : '';

  const sourcesBlock = courseBrief.source_text || urls.length || pdfs.length || extracted.length
    ? `\nPRIMARY SOURCES from the learner — ground your research in these first, before searching for general material:\n` +
      (courseBrief.source_text ? `\nPasted text/notes:\n${courseBrief.source_text}\n` : '') +
      extractedBlock +
      (failedUrls.length ? `\nThese URLs were submitted but could not be fetched (don't try web_search on them, just acknowledge the gap):\n${failedUrls.join('\n')}\n` : '') +
      pdfBlock
    : '';

  const userText = `Today's date: ${new Date().toISOString().slice(0, 10)}

Research material for this module so it can be turned into learning content.

Course: ${courseBrief.title} — ${courseBrief.subtitle}
Learner: ${courseBrief.learner_persona}
${courseBrief.human_feedback ? `\nHuman feedback to respect before researching:\n${courseBrief.human_feedback}\n` : ''}

Module ${mod.number}: ${mod.title}
Description: ${mod.description}

Topics in this module:
${mod.topics.map(t => `- ${t.title}`).join('\n')}
${sourcesBlock}
Use web_search for ADDITIONAL canonical material — broader context, comparisons, recent developments — NOT to re-fetch the URLs above (their text is already quoted). Also COLLECT 4-8 image refs total: prefer ones from the "Available images" lists already extracted from the user's URLs (kind:"web", copy src verbatim) and any diagram-worthy PDF pages (kind:"pdf"); then search the web for additional diagrams/charts/screenshots if more are needed. Submit the research bundle via the tool. The module_id you submit must be "${mod.id}".`;

  // Anthropic accepts a content array per message: [{type:'document',...}, {type:'text',...}]
  const initialContent = [
    ...pdfs.map(p => ({
      type: 'document',
      source: { type: 'base64', media_type: 'application/pdf', data: p.base64 }
    })),
    { type: 'text', text: userText }
  ];

  // Web search + final tool call in one streaming(-ish) interaction
  let messages = [{ role: 'user', content: initialContent }];
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

export async function runResearchAll(client, courseBrief, opts = {}) {
  console.log(`  Researching ${courseBrief.modules.length} module(s) in parallel…`);
  const results = await Promise.all(
    courseBrief.modules.map(mod =>
      runResearch(client, courseBrief, mod, opts)
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
