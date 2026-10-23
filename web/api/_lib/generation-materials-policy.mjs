// Shared lightweight capability check; admission must not load the image runner.
export const INTEGRATED_VISUALS_POLICY = 'integrated-visuals-v2';
export const usesIntegratedVisuals = brief => brief?.materials_policy === INTEGRATED_VISUALS_POLICY;
