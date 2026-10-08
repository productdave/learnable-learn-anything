import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { imageCostEstimate, imageCostHTML } from '../web/js/image-cost.js';
import { imageFundingQuote } from '../web/api/_lib/image-request.mjs';
import { componentSummaryHTML } from '../web/js/setup-components.js';

let checks = 0;
const check = (value, message) => { assert.ok(value, message); checks++; };
const quote = imageFundingQuote({ LEARNABLE_GPT_IMAGES: '1' });
check(imageCostEstimate(1, quote).outputTokens === 439, 'estimate matches supported server model and settings');
check(Math.abs(imageCostEstimate(1, quote).outputUsd - .01317) < 1e-10, 'calculator tokens use verified model rate');
check(imageCostEstimate(12, quote).outputTokens === 5268, 'course token count scales with image count');
check(Math.abs(imageCostEstimate(12, quote).outputUsd - .15804) < 1e-10, 'multiply before display rounding');
for (const count of [0, -1, 1.5, NaN, Infinity, '12', '<script>', 10_001]) check(imageCostEstimate(count, quote) === null, 'invalid count has no numeric estimate');
for (const settings of [null, {}, { ...quote, model: 'other-model' }, { ...quote, size: '1536x1024' }, { ...quote, quality: 'high' }, { ...quote, n: 2 }, { ...quote, funding: 'learnable' }, { ...quote, provider: 'other' }]) {
  check(imageCostEstimate(1, settings) === null, 'unknown pricing configuration is not borrowed or free');
  const html = imageCostHTML({ count: 1, settings });
  check(html.includes('Cost estimate unavailable') && !html.includes('US$0.'), 'unknown settings display honest fallback');
}
const example = imageCostHTML(), plan = imageCostHTML({ count: 12 });
check(example.includes('US$0.013 per image') && example.includes('Example: 12 instructional images') && example.includes('not its lesson count'), 'setup estimate uses an illustrative image count, not one image per lesson');
check(plan.includes('US$0.158 for 12 images') && plan.includes('5,268 image-output tokens') && !plan.includes('Example:'), 'actual outline replaces illustrative count');
check(imageCostHTML({ count: 1 }).includes('for 1 image.'), 'singular image copy');
for (const copy of ['Uses extra tokens', 'Plus prompt tokens; not a fixed quote', 'separately from Claude', 'replacements add usage', 'Timed-out attempts', '17 September 2026', 'Prices and actual usage can change']) check(example.includes(copy), 'discloses ' + copy);
check(example.includes('rel="noopener noreferrer"') && example.includes('opens a new tab'), 'official sources have safe explicit link behavior');
check(!example.includes('data-image-cost-details open') && imageCostHTML({ detailsOpen: true }).includes('data-image-cost-details open'), 'details open state is controllable');
check(componentSummaryHTML(['lessons', 'images']).includes('data-image-cost-guidance'), 'review includes shared costs for selected images');
check(componentSummaryHTML(['lessons']).includes('data-image-cost-guidance'), 'new creation includes useful-image cost disclosure even when an old setup omitted its marker');
for (const file of ['setup-components', 'course-images']) check(readFileSync(new URL(`../web/js/${file}.js`, import.meta.url), 'utf8').includes('imageCostHTML('), 'shared cost explanation used by ' + file);
check(readFileSync(new URL('../web/js/course-setup.js',import.meta.url),'utf8').includes('courseImageInfoHTML()'),'setup reuses small shared information disclosure');
check(!readFileSync(new URL('../web/js/intake.js',import.meta.url),'utf8').includes('imageCostHTML('),'curriculum review does not repeat per-image billing actions');
console.log(`Image cost guidance: ${checks} checks passed (no provider calls).`);
