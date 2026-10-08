export function topicFailureKey(moduleId, topicId) {
  return `${moduleId}/${topicId}`;
}

export function researchFailureKey(moduleId) {
  return `${moduleId}/__research__`;
}

export function failureKey(failure = {}) {
  if (failure.stage === 'research' || failure.kind === 'research' || !failure.topicId) {
    return researchFailureKey(failure.moduleId);
  }
  return topicFailureKey(failure.moduleId, failure.topicId);
}

export function pruneResolvedFailures(failures = [], topicsByKey = {}, researchByModule = {}) {
  return (failures || []).filter(f => {
    if (f.stage === 'research' || f.kind === 'research' || !f.topicId) {
      return !researchByModule?.[f.moduleId];
    }
    return !topicsByKey[topicFailureKey(f.moduleId, f.topicId)];
  });
}

export function clearTopicFailure(failures = [], moduleId, topicId) {
  const key = topicFailureKey(moduleId, topicId);
  return (failures || []).filter(f => failureKey(f) !== key);
}

export function replaceTopicFailure(failures = [], failure) {
  return [
    ...clearTopicFailure(failures, failure.moduleId, failure.topicId),
    failure
  ];
}

export function clearResearchFailure(failures = [], moduleId) {
  const key = researchFailureKey(moduleId);
  return (failures || []).filter(f => failureKey(f) !== key);
}

export function replaceResearchFailure(failures = [], failure) {
  return [
    ...clearResearchFailure(failures, failure.moduleId),
    { ...failure, stage: 'research', kind: failure.kind || 'research' }
  ];
}
