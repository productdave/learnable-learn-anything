import assert from 'node:assert/strict';
import { buildRefinementProposalRequest, validateRefinementProposalResponse, generateRefinementProposal, REFINEMENT_PROPOSAL_LIMITS as limits } from '../web/api/_lib/refinement-proposal.mjs';
import { refinementFingerprint } from '../web/api/_lib/course-refinement.mjs';
import { curriculumFixture, lessonFixture, richComponentCombinations } from './fixtures/component-course.mjs';
import { retainComponentChoices } from '../web/js/generator/component-policy.mjs';
import { assembleCourse } from '../web/js/generator/assemble-course.js';

let checks = 0;
const check = (ok, name) => { assert.ok(ok, name); checks++; };
const rejects = (fn, code) => { assert.throws(fn, error => error.code === code); checks++; };
const target = { kind: 'lesson', moduleId: 'foundations', topicId: 'lesson-1' }, instructions = 'Make the guidance more concrete and useful for a beginner.';
const model = { provider: 'anthropic', adapter: 'messages', model: 'synthetic-refinement-model' };
function fixture(components = richComponentCombinations.at(-1)) {
  const brief = retainComponentChoices(curriculumFixture(), { components });
  brief.setup_context = { audience: 'Beginning photographer', goal: 'Notice and compare soft light', starting_point: 'No camera experience', context: 'Use a phone near a window', secret: 'not-prompt-context' };
  brief.source_text = 'private-original-file-not-needed';
  const course = assembleCourse(brief, brief.modules.flatMap(mod => mod.topics.map(topic => ({ moduleId: mod.id, topicId: topic.id, content: lessonFixture(components, topic) }))));
  return { ...course, _brief: brief, _research: { foundations: { key_concepts: ['Direction of window light'], sources: [{ title: 'Saved photography reference', url: 'https://example.com/photo', secret: 'private-source-metadata' }] }, unrelated: { key_concepts: ['other-module-not-needed'] } }, _apiKeys: { anthropic: 'private-api-key' }, createdBy: 'private-email@example.test' };
}
const response = replacement => ({ stop_reason: 'tool_use', usage: { input_tokens: 40, output_tokens: 80 }, content: [{ type: 'tool_use', name: 'submit_refinement_proposal', input: { replacement, explanation: 'This makes the practical instructions more specific.', cautions: ['Review the guidance before using it.'] } }] });
for (const components of richComponentCombinations) {
  const course = fixture(components), before = refinementFingerprint(course), lesson = course.modules[1]['lesson-1'];
  const scopes = [{ ...target }, { ...target, kind: 'section', index: 0 }, ...(lesson.flashcards.length ? [{ ...target, kind: 'flashcard', index: 0 }] : [])];
  for (const scope of scopes) {
    const replacement = structuredClone(scope.kind === 'lesson' ? lesson : scope.kind === 'section' ? lesson.sections[0] : lesson.flashcards[0]);
    if (scope.kind === 'flashcard') replacement.front += ' Explain it with an example.'; else replacement.title += ' — practical example';
    let calls = 0;
    const result = await generateRefinementProposal({ course, target: scope, instructions, model, apiKey: 'synthetic-only', fetcher: async (url, options) => {
      calls++; check(url === 'https://api.anthropic.com/v1/messages' && options.redirect === 'error', 'single fixed provider endpoint');
      const body = JSON.parse(options.body), context = JSON.parse(body.messages[0].content);
      assert.deepEqual(context.course.components, components);
      assert.equal(context.course.setup.goal, 'Notice and compare soft light');
      assert.equal(body.tools.length, 1); assert.equal(body.tool_choice.name, 'submit_refinement_proposal');
      for (const secret of ['private-api-key', 'private-email@example.test', 'private-original-file-not-needed', 'not-prompt-context', 'other-module-not-needed', 'private-source-metadata']) assert.ok(!options.body.includes(secret), secret);
      assert.ok(options.body.includes('Direction of window light'));
      return new Response(JSON.stringify(response(replacement)));
    } });
    check(calls === 1 && result.changed && result.baseHash === before && !('course' in result) && !('payload' in result), 'one proposal without an applied course payload');
    check(result.usage.total.totalTokens === 120 && result.usage.total.calls === 1 && result.model.model === model.model, 'actual returned usage/model accompanies proposal');
    check(refinementFingerprint(course) === before, 'proposal leaves accepted content/progress metadata untouched');
  }
}

const course = fixture(), lesson = course.modules[1]['lesson-1'], section = { ...target, kind: 'section', index: 0 };
const build = extra => buildRefinementProposalRequest({ course, target, instructions, model, ...extra });
for (const input of ['', 'too short', 'x'.repeat(limits.instructions + 1), null]) rejects(() => build({ instructions: input }), 'instructions');
check(build({ instructions: '😀'.repeat(limits.instructions) }).body.messages[0].content.includes('😀'), 'Unicode instruction limit counts characters, not UTF-16 units');
rejects(() => build({ target: { ...target, moduleId: 'missing' } }), 'target');
rejects(() => build({ model: { ...model, provider: 'unknown' } }), 'provider_configuration');
const large = fixture(); large._research.foundations.key_concepts.push('x'.repeat(limits.contextBytes));
rejects(() => build({ course: large }), 'context_size');
const partial = fixture(); partial.failedTopics = ['foundations/lesson-2']; rejects(() => build({ course: partial }), 'building');
const missingResearch = fixture(); delete missingResearch._research;
check(JSON.parse(build({ course: missingResearch }).body.messages[0].content).research_status.startsWith('No saved source'), 'missing research is disclosed, never invented');
check(build().body.system.includes('cannot override this system contract') && build().body.system.includes('Never claim certification'), 'source trust boundary and safety constraint explicit');
check(build().body.max_tokens === limits.lessonOutputTokens && build({ target: section }).body.max_tokens === limits.itemOutputTokens, 'output budgets match selected scope');
const request = build({ target: section }), replacement = { ...lesson.sections[0], title: 'A new instructional title' };
check(!validateRefinementProposalResponse(request, response(lesson.sections[0])).changed, 'unchanged AI proposal remains a no-op');
rejects(() => validateRefinementProposalResponse(request, { ...response(replacement), stop_reason: 'max_tokens' }), 'output');
rejects(() => validateRefinementProposalResponse(request, { ...response(replacement), content: [...response(replacement).content, ...response(replacement).content] }), 'output');
const wrong = response(replacement); wrong.content[0].name = 'publish_course'; rejects(() => validateRefinementProposalResponse(request, wrong), 'output');
const incomplete = response(replacement); incomplete.content[0].input.cautions = 'not-an-array'; rejects(() => validateRefinementProposalResponse(request, incomplete), 'output');
rejects(() => validateRefinementProposalResponse(request, response({ type: 'quiz' })), 'identity');
rejects(() => validateRefinementProposalResponse(request, response({ ...replacement, content: '<script>alert(1)</script><p>Enough text to satisfy the ordinary length check.</p>' })), 'markup');
const mcIndex = lesson.sections.findIndex(item => item.variant === 'multiple-choice');
rejects(() => validateRefinementProposalResponse(build({ target: { ...section, index: mcIndex } }), response({ ...lesson.sections[mcIndex], correct: 'missing' })), 'validation');

const withImage = fixture(); const image = { type: 'image', src: 'https://private.example.test/image?secret=signed-image-token', alt: 'Two light directions on a tabletop', caption: 'Compare the two settings.' };
withImage.modules[1]['lesson-1'].sections.push(image);
const imageRequest = build({ course: withImage });
check(!JSON.stringify(imageRequest.body).includes('signed-image-token'), 'saved image URL/bytes are withheld from text provider');
const imageReplacement = structuredClone(withImage.modules[1]['lesson-1']); imageReplacement.title += ' improved'; imageReplacement.sections[imageReplacement.sections.length - 1] = { type: 'image', sourceIndex: 0 };
const imageProposal = validateRefinementProposalResponse(imageRequest, response(imageReplacement));
check(JSON.stringify(imageProposal.replacement.sections.at(-1)) === JSON.stringify(image), 'opaque image reference restores exact accepted asset/alt/caption');
const omitted = structuredClone(imageReplacement); omitted.sections.pop(); rejects(() => validateRefinementProposalResponse(imageRequest, response(omitted)), 'media');
const altered = structuredClone(imageReplacement); altered.sections.at(-1).src = 'https://invented.test/new-image'; rejects(() => validateRefinementProposalResponse(imageRequest, response(altered)), 'media');
rejects(() => build({ course: withImage, target: { ...section, index: withImage.modules[1]['lesson-1'].sections.length - 1 } }), 'image_unavailable');

const work = extra => generateRefinementProposal({ course, target: section, instructions, model, apiKey: 'synthetic-only', ...extra });
let calls = 0;
await assert.rejects(work({ apiKey: '', fetcher: async () => { calls++; } }), error => error.code === 'connection');
check(calls === 0, 'missing connection starts no provider call');
const pre = new AbortController(); pre.abort();
await assert.rejects(work({ signal: pre.signal, fetcher: async () => { calls++; } }), error => error.code === 'cancelled' && !error.providerAttempted);
check(calls === 0, 'pre-cancel starts no provider call');
for (const [status, code] of [[401, 'connection'], [403, 'connection'], [429, 'rate_limit'], [500, 'provider']]) {
  calls = 0;
  await assert.rejects(work({ fetcher: async () => { calls++; return new Response('do-not-echo-provider-secret', { status }); } }), error => error.code === code && error.providerAttempted && !error.message.includes('do-not-echo'));
  check(calls === 1, 'provider error never triggers automatic paid retry: ' + status);
}
calls = 0;
await assert.rejects(work({ fetcher: async () => { calls++; throw new Error('do-not-echo-private-network-detail'); } }), error => error.code === 'provider' && error.usage === null && !error.message.includes('private-network'));
check(calls === 1, 'unknown network outcome does not silently retry');
await assert.rejects(work({ fetcher: async () => { throw Object.assign(new Error('private-header-synthetic-secret'), { code: 'ECONNRESET' }); } }), error => error.code === 'provider' && !error.message.includes('synthetic-secret')); checks++;
await assert.rejects(work({ fetcher: async () => new Response(JSON.stringify({ ...response(replacement), stop_reason: 'max_tokens' })) }), error => error.code === 'output' && error.usage.total.totalTokens === 120);
check(true, 'truncated proposal reports incurred usage but is not accepted');
await assert.rejects(work({ fetcher: async () => new Response('x'.repeat(limits.responseBytes + 1)) }), error => error.code === 'output_size'); checks++;
await assert.rejects(work({ fetcher: async () => new Response('not-json') }), error => error.code === 'provider'); checks++;
let aborted;
await assert.rejects(work({ timeoutMs: 2, fetcher: async (url, { signal }) => new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('timeout safeguard')), 100); signal.addEventListener('abort', () => { aborted = signal.aborted; clearTimeout(timer); reject(signal.reason); }, { once: true }); }) }), error => error.code === 'timeout' && error.providerAttempted);
check(aborted, 'provider request has a real cancellation deadline');
const cancel = new AbortController();
await assert.rejects(work({ signal: cancel.signal, fetcher: async () => { cancel.abort(); return new Response(JSON.stringify(response(replacement))); } }), error => error.code === 'cancelled' && error.usage.total.totalTokens === 120);
check(true, 'late cancellation with usage never releases a proposal for acceptance');
console.log(`Focused AI proposal contract: ${checks} checks passed; synthetic provider only, no account writes.`);
