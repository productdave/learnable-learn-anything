import { isUsableResearchBundle } from '../../js/generator/research-policy.mjs';
export { isUsableResearchBundle } from '../../js/generator/research-policy.mjs';

export function missingResearchModules(brief, research = {}) {
  return (brief?.modules || []).filter(mod => !isUsableResearchBundle(research?.[mod.id]));
}

export function hasCompleteResearchCheckpoint(brief, research = {}) {
  const modules = brief?.modules || [];
  return modules.length > 0 && missingResearchModules(brief, research).length === 0;
}
