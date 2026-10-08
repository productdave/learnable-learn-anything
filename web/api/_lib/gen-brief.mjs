export function topicCountForBrief(brief) {
  return (brief?.modules || []).reduce((total, mod) => total + (mod.topics || []).length, 0);
}

export function outlineForBrief(brief) {
  return {
    title: brief?.title || '',
    subtitle: brief?.subtitle || '',
    modules: (brief?.modules || []).map(mod => ({
      title: mod.title,
      topicCount: (mod.topics || []).length
    }))
  };
}
