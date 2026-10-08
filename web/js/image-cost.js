// Informational estimate only, never a funding quote or billing authorization.
// Verified 2026-09-17 against the GPT Image 2.5 calculator (medium, 1024 square):
// https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency
// Rates: https://developers.openai.com/api/docs/models/gpt-image-2.5-flare
const MODEL = 'gpt-image-2.5-flare-2026-09-08';
const OUTPUT_TOKENS = 439;
const OUTPUT_RATE = 30 / 1_000_000;
const DEFAULT_SETTINGS = Object.freeze({ provider: 'openai', funding: 'creator', model: MODEL, n: 1, size: '1024x1024', quality: 'medium' });
const dollars = value => `US$${value.toFixed(3)}`;
const number = value => value.toLocaleString('en-US');

export function imageCostEstimate(count = 1, settings = DEFAULT_SETTINGS) {
  // Never borrow another model's prices or treat an unknown configuration as free.
  if (!Number.isSafeInteger(count) || count < 1 || count > 10_000 ||
      !settings || Object.entries(DEFAULT_SETTINGS).some(([key, value]) => settings[key] !== value)) return null;
  return { count, outputTokens: count * OUTPUT_TOKENS, outputUsd: count * OUTPUT_TOKENS * OUTPUT_RATE };
}

export function imageCostHTML({ count = null, settings = DEFAULT_SETTINGS, detailsOpen = false } = {}) {
  const estimate = imageCostEstimate(count ?? 1, settings);
  const sample = imageCostEstimate(12, settings);
  return `<div class="image-cost-guidance" data-image-cost-guidance>
    <p><strong>Uses extra tokens.</strong> Generating images adds OpenAI usage and cost on top of the tokens used to write your course.</p>
    ${estimate ? `<p class="image-cost-estimate"><strong>Estimated image output: about ${dollars(estimate.outputUsd)} ${count === null ? 'per image' : `for ${number(count)} ${count === 1 ? 'image' : 'images'}`}.</strong> Plus prompt tokens; not a fixed quote.</p>` : '<p>Cost estimate unavailable for these settings. Check the model’s current OpenAI pricing before generating; this does not mean it is free.</p>'}
    <details data-image-cost-details ${detailsOpen ? 'open' : ''}><summary>How image costs work</summary>
      ${estimate ? `<p>${count === null ? `Example: 12 instructional images ≈ ${number(sample.outputTokens)} image-output tokens (${dollars(sample.outputUsd)}), plus prompt tokens. The number depends on what helps explain your course, not its lesson count.` : `This plan adds approximately ${number(estimate.outputTokens)} image-output tokens, plus prompt tokens, if you generate each image once.`}</p>
      <p>Based on GPT Image 2.5 Flare at 1024 × 1024, medium quality: approximately 439 output tokens per image. Output costs US$30 per million image tokens; uncached prompts cost US$5 per million text tokens.</p>` : ''}
      <p>Your connected OpenAI API account pays for images, separately from Claude’s course-writing usage. New generations and replacements add usage, even if you discard the result. Timed-out attempts may also be charged.</p>
      <p>${estimate ? 'Rates checked 17 September 2026. Estimates exclude prompt tokens, retries and taxes. Prices and actual usage can change. ' : ''}<a href="https://developers.openai.com/api/docs/${estimate ? 'models/gpt-image-2.5-flare' : 'pricing'}" target="_blank" rel="noopener noreferrer">OpenAI model pricing (opens a new tab)</a> · <a href="https://developers.openai.com/api/docs/guides/image-generation#cost-and-latency" target="_blank" rel="noopener noreferrer">Image cost calculator (opens a new tab)</a>.</p>
    </details>
  </div>`;
}
