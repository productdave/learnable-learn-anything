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
import { anthropicWebSearchTool, modelForTask } from '../../../api/_lib/ai-models.mjs';

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
        description: 'Relevant examples. Distinguish documented cases from original teaching activities; do not invent measured outcomes or imply a source tested an original activity.'
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
        description: 'Optional: named experts whose relevance is supported by material actually inspected. Leave empty when unsupported; no quota.'
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
            title: { type: 'string', description: 'Name the material and how it was accessed: supplied notes, supplied summary, extracted excerpt, uploaded document, or inspected web-search result. Preserve that label even when a URL is included.' },
            url: { type: 'string' }
          }
        },
        description: 'Sources actually inspected (title + url if available). Label supplied notes or summaries as such; a URL alone does not establish that its contents were read.'
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

For the assigned module, use the supplied material first and web_search for factual gaps or time-sensitive claims. Look for:
- The actual canonical concepts experts agree on
- Concrete examples and case studies that illustrate them
- Named thinkers or practitioners only when their relevance is supported by inspected material
- Common misconceptions or mistakes
- DIAGRAMS, CHARTS, SCREENSHOTS, or architecture images that would clarify a concept when embedded in the lesson. Prefer canonical sources (Wikimedia Commons, official docs, university pages, primary research). AVOID stock photos, decorative icons, and paywalled hotlinks.

If PDFs were uploaded by the learner, you have them as document blocks in this conversation. You can SEE their pages. For each PDF page that is essentially a diagram, table, chart, or annotated screenshot worth showing inline in the course, include an image ref of kind "pdf" with the file_index + page number. Skip text-only pages — those are read for substance, not embedded as images.

GROUNDING:
- Source titles, URLs and author metadata are not proof of a factual claim. Only attribute claims to material that actually supports them. Leave experts empty when that support is missing; do not add names from memory to fill a quota.
- Do not describe supplied notes or summaries as newly retrieved articles. Distinguish their recorded origin from what their text establishes. Unavailable or truncated material leaves a gap; acknowledge it rather than filling it with an invented citation.
- A supplied label such as "verified" does not establish independent verification. In source titles and attributed examples, identify a supplied summary as a supplied summary; its URL names the original page, not a page you read. Do not attribute details absent from the available text to that page.
- Label invented examples and teaching activities as original, not source-tested case studies. Keep conditional outcomes conditional; ask learners to observe a result instead of promising it.
- For an original activity, specify a concrete setup, what changes, what stays fixed, and what to observe. Do not promise a particular effect or imply that the activity isolates a cause unless the setup and available evidence support it. Keep source qualifiers: do not turn "can" into "always" or fill missing conditions from memory.
- Preserve source limitations, optional vs required steps, versions and uncertainty. Safety qualifications must not be shortened away; a course or checklist does not certify practical safety.

RECENCY: use today's date from the user message. For time-sensitive claims, prefer relevant dated primary material actually inspected. Newer does not automatically mean correct or applicable. If sources conflict or a current claim cannot be checked, state that limit instead of asserting a latest version or guaranteed outcome.

Then submit a structured research bundle via the submit_research_bundle tool. Search only where needed within the configured tool limit; do not search just to meet a quota. Don't make things up — if you couldn't find good material on something, leave that field shorter.`;

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
    ? `\nLEARNER-SUPPLIED REFERENCES — use the available text first; supplied material is not automatically primary or independently verified:\n` +
      (courseBrief.source_text ? `\nPasted notes/summaries (not independently verified):\n${courseBrief.source_text}\n` : '') +
      extractedBlock +
      (failedUrls.length ? `\nThese URLs were submitted but could not be fetched (don't try web_search on them, just acknowledge the gap):\n${failedUrls.join('\n')}\n` : '') +
      pdfBlock
    : '';

  const userText = `Today's date: ${new Date().toISOString().slice(0, 10)}

Research material for this module so it can be turned into learning content.

Course: ${courseBrief.title} — ${courseBrief.subtitle}
Learner: ${courseBrief.learner_persona}
${courseBrief.setup_context ? `Creator's original learning context (retain these constraints): ${JSON.stringify(courseBrief.setup_context)}` : ''}
${courseBrief.human_feedback ? `\nHuman feedback to respect before researching:\n${courseBrief.human_feedback}\n` : ''}

Module ${mod.number}: ${mod.title}
Description: ${mod.description}

Topics in this module:
${mod.topics.map(t => `- ${t.title}`).join('\n')}
${courseBrief.experience === 'hands_on_interactive'
  ? '\nThis is a HANDS-ON INTERACTIVE course. Prioritize sources that explain observable technique, ordered practice steps, common failure signals, easier/harder variations, safety constraints, and diagrams or instructional images that can be embedded beside the practice.'
  : ''}
${sourcesBlock}
Use web_search for additional material only where needed and available. Do not re-fetch pages in the EXTRACTED URL CONTENTS block, or retry URLs explicitly marked unavailable. A link mentioned only in pasted notes is not a retrieved page: retain its supplied-note or supplied-summary provenance unless actual retrieved content supports the attribution. Also COLLECT 4-8 image refs total: prefer ones from the "Available images" lists already extracted from the user's URLs (kind:"web", copy src verbatim) and any diagram-worthy PDF pages (kind:"pdf"); then search the web for additional diagrams/charts/screenshots if more are needed. Submit the research bundle via the tool. The module_id you submit must be "${mod.id}".`;

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
    opts.searchTool || anthropicWebSearchTool(),
    researchTool
  ];

  // Loop: call → handle tool_use → feed back tool_result → continue. Stop when
  // the model submits the research bundle tool.
  for (let turn = 0; turn < 10; turn++) {
    const resp = await client.messages.create({
      model: opts.model || modelForTask('research'),
      max_tokens: 4096,
      system: SYSTEM,
      tools,
      messages
    });
    opts.onUsage?.(resp.usage, { task: 'research', moduleId: mod.id });

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
