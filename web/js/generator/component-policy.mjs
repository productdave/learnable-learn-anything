// Explicit setup choices are authoritative. Old jobs without this field retain
// their original all-tools behaviour; a model cannot opt a tool back in.
const LEGACY_COMPONENTS = ['lessons', 'quizzes', 'flashcards'];
export const GENERATION_COMPONENTS = ['lessons', 'practice', 'checklists', 'quizzes', 'flashcards', 'images'];
// Images are planned with lessons and produced by the same creation job. The
// server, not model output or a browser read, authorizes provider dispatch.
export const SUPPORTED_COMPONENTS = [...GENERATION_COMPONENTS];
// New creation rules are separate from the reader for existing saved courses
// and jobs. Never rewrite old lesson content or account payload hashes here.
export const CREATION_MATERIALS_POLICY = 'integrated-visuals-v2';
export const VISUAL_DESIGNER_POLICY = 'learner-experience-v1';
export const LEGACY_CREATION_MATERIALS_POLICY = 'standard-images-no-practice-v1';
export const usesIntegratedVisuals = brief => brief?.materials_policy === CREATION_MATERIALS_POLICY;
const standardMaterials = brief => [CREATION_MATERIALS_POLICY, LEGACY_CREATION_MATERIALS_POLICY].includes(brief?.materials_policy);
export const CREATION_COMPONENTS = ['lessons', 'checklists', 'quizzes', 'flashcards', 'images'];
export function creationComponents(selected = ['lessons', 'quizzes', 'flashcards']) {
  const values = Array.isArray(selected) ? selected : ['lessons', 'quizzes', 'flashcards'];
  return CREATION_COMPONENTS.filter(value => value === 'lessons' || value === 'images' || values.includes(value));
}
export function creationBrief(brief = {}) {
  if (brief.components != null && (!Array.isArray(brief.components) || brief.components.some(value => !GENERATION_COMPONENTS.includes(value)))) throw new Error('This course has unsupported component choices. Return to Experience to review them.');
  return { ...brief, materials_policy: CREATION_MATERIALS_POLICY, visual_designer_policy: VISUAL_DESIGNER_POLICY, components: creationComponents(brief.components) };
}
export function componentPolicy(brief = {}) {
  const explicit = Object.hasOwn(brief, 'components');
  const selected = standardMaterials(brief) ? creationComponents(brief.components) : explicit ? brief.components : LEGACY_COMPONENTS;
  if (!Array.isArray(selected) || !selected.includes('lessons') || selected.some(value => !GENERATION_COMPONENTS.includes(value))) throw new Error('This course has unsupported component choices. Return to Experience to review them.');
  const components = GENERATION_COMPONENTS.filter(value => selected.includes(value));
  return { explicit, components, integratedVisuals: usesIntegratedVisuals(brief), practice: components.includes('practice'), checklists: components.includes('checklists'), quizzes: components.includes('quizzes'), flashcards: components.includes('flashcards') };
}

export function retainComponentChoices(brief, request) {
  const policy = componentPolicy(request);
  if (!policy.explicit) return brief;
  return { ...brief, ...(standardMaterials(request) ? { materials_policy: request.materials_policy } : {}),
    ...(request.visual_designer_policy === VISUAL_DESIGNER_POLICY ? { visual_designer_policy: VISUAL_DESIGNER_POLICY } : {}),
    components: policy.components, modules: (brief.modules || []).map(mod => ({ ...mod, topics: (mod.topics || []).map(topic => ({ ...topic, ...(!policy.quizzes ? { quiz_plan: [] } : {}) })) })) };
}
