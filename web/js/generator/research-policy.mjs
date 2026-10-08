// Shared by the server checkpoint gate and its browser presentation. References
// are review warnings, not mandatory for a course based on private notes.
export function isUsableResearchBundle(bundle) {
  return !!bundle && typeof bundle === 'object' && !Array.isArray(bundle) && Object.keys(bundle).length > 0;
}
