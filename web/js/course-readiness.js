import { researchEvidence } from './research-evidence.js?v=6';
import { courseImageProgress } from './image-progress.js?v=2';

const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' && !!value.trim();
const unique = values => new Set(values).size === values.length;
const knownMaterials = ['lessons', 'practice', 'checklists', 'quizzes', 'flashcards'];
function usableQuiz(section) {
  if (!text(section.id) || !text(section.explanation)) return false;
  switch (section.variant) {
    case 'true-false': return text(section.statement) && typeof section.correct === 'boolean';
    case 'multiple-choice': return text(section.question) && list(section.options).length >= 2 && section.options.every(option => text(option?.id) && text(option?.text)) && section.options.some(option => option.id === section.correct);
    case 'fill-in-blank': return text(section.sentence) && section.sentence.includes('___') && list(section.acceptable_answers).some(text);
    case 'short-answer': return text(section.question) && text(section.sample_answer) && list(section.key_points).some(text);
    case 'drag-match': return text(section.question) && list(section.pairs).length >= 2 && section.pairs.every(pair => text(pair?.left) && text(pair?.right));
    default: return false;
  }
}

// Only saved course metadata can confirm this checkpoint. A live job mirror
// or a policy flag alone must never turn an unrefined copy into a ready draft.
function savedDesignProgress(course, lessons) {
  const selected = (course.config.visual_designer_policy || course._brief?.visual_designer_policy) === 'learner-experience-v1';
  const checkpoint = course._visualDesign;
  const valid = checkpoint?.version === 1 && checkpoint.policy === 'learner-experience-v1';
  const reviewed = valid && !!checkpoint.review && typeof checkpoint.review === 'object';
  const saved = valid ? lessons.filter(lesson => lesson.saved && checkpoint.items?.[`${lesson.moduleId}/${lesson.topicId}`]?.status === 'saved').length : 0;
  const total = lessons.length;
  const complete = !!(selected && valid && reviewed && checkpoint.status === 'complete' && !checkpoint.pending && total > 0 && saved === total);
  const flags = [], seen = new Set();
  const addFlags = (values, title) => {
    for (const flag of list(values)) {
      if (!text(flag?.message)) continue;
      const key = `${title}\n${flag.kind || ''}\n${flag.message}`;
      if (seen.has(key)) continue;
      seen.add(key); flags.push({ title, kind: text(flag.kind) ? flag.kind : '', message: flag.message });
    }
  };
  if (valid) {
    addFlags(checkpoint.review?.flags, 'Whole course');
    for (const lesson of lessons) {
      const review = list(checkpoint.review?.lessons).find(item => item?.moduleId === lesson.moduleId && item?.topicId === lesson.topicId);
      addFlags(review?.flags, lesson.title);
      addFlags(checkpoint.items?.[`${lesson.moduleId}/${lesson.topicId}`]?.flags, lesson.title);
    }
  }
  return { selected, reviewed: !!reviewed, saved, total, complete, status: valid ? checkpoint.status : 'pending', flags };
}

// A saved-content inventory, not schema certification, fact checking or a human
// review. Never infer content from job checkpoints or from selected checkboxes.
export function inspectSavedCourse(course) {
  const modules = list(course?.curriculum?.modules);
  const available = !!course?.config && modules.length > 0 && modules.every(mod => mod && text(mod.id) && Number.isInteger(Number(mod.number)) && Number(mod.number) > 0 && list(mod.topics).length > 0 && mod.topics.every(topic => topic && text(topic.id)));
  if (!available) return { available: false, lessons: [], total: 0, saved: 0, gaps: [], materials: [], warnings: [], evidence: null };
  const choices = Array.isArray(course.config.components) ? course.config.components : Array.isArray(course._brief?.components) ? course._brief.components : null;
  const structuralWarnings = [];
  if (!unique(modules.map(mod => mod.id)) || !unique(modules.map(mod => String(mod.number)))) structuralWarnings.push('Some module identifiers repeat. Review the learning path before using this course.');
  const lessons = modules.flatMap(mod => list(mod.topics).map(meta => {
    const content = course.modules?.[mod.number]?.[meta.id];
    const sections = list(content?.sections);
    const saved = text(meta.id) && !!content && sections.length > 0;
    const found = type => sections.filter(section => section?.type === type);
    const quizzes = found('quiz'), cards = list(content?.flashcards), explicit = !!choices;
    const presence = {
      lessons: saved && found('concept').filter(section => text(section.content)).length >= (explicit ? 2 : 1) && (!explicit || found('callout').some(section => text(section.content)) && found('takeaway').some(section => list(section.points).some(text))),
      practice: found('practice').length === 1 && found('practice').some(section => text(section.goal) && text(section.setup) && list(section.steps).length >= 2 && section.steps.every(step => text(step?.instruction)) && list(section.readinessChecks).length > 0),
      checklists: found('checklist').length === 1 && found('checklist').some(section => list(section.items).length >= (explicit ? 3 : 1) && section.items.every(item => text(item?.id) && text(item?.label)) && unique(section.items.map(item => item.id))),
      quizzes: quizzes.length >= (explicit ? 3 : 1) && quizzes.every(usableQuiz) && (!explicit || !list(meta.quiz_plan).length || JSON.stringify(quizzes.map(quiz => quiz.variant)) === JSON.stringify(meta.quiz_plan)),
      flashcards: cards.length >= (explicit ? 3 : 1) && cards.every(card => text(card?.front) && text(card?.back))
    };
    const gaps = !saved ? ['Lesson not saved'] : knownMaterials.filter(value => (choices ? choices.includes(value) : value === 'lessons') && !presence[value]);
    const warnings = [];
    const openable = saved && /^[a-z0-9-]+$/.test(mod.id) && /^[a-z0-9-]+$/.test(meta.id);
    if (saved && !openable) warnings.push('This lesson’s address is not supported. Its saved content is retained, but it cannot be opened from this review.');
    if (saved && (content.id !== meta.id || content.moduleId !== mod.id)) warnings.push('Saved lesson identifiers do not match the learning path.');
    if (!unique(list(mod.topics).map(topic => topic.id))) warnings.push('Lesson identifiers repeat in this module.');
    const ids = sections.filter(section => text(section?.id)).map(section => section.id);
    if (!unique(ids)) warnings.push('Some interactive items share an identifier. Check that answers and progress stay separate.');
    if (choices) {
      const extra = knownMaterials.filter(value => value !== 'lessons' && !choices.includes(value) && presence[value]);
      if (extra.length) warnings.push('This lesson contains materials that were not selected.');
    }
    for (const section of found('practice')) if (!list(section.safetyStops).some(text)) warnings.push('Practice has no pause or stop guidance.');
    const images = found('image');
    if (images.some(image => !text(image.src) && !/^[0-9a-f-]{36}$/i.test(image.asset_id || ''))) warnings.push('An image has no saved file or link.');
    if (images.some(image => !text(image.alt))) warnings.push('An image is missing alternative text.');
    return { moduleId: mod.id, moduleTitle: String(mod.title || mod.id), topicId: meta.id, title: String(meta.title || meta.id || 'Untitled lesson'), saved, openable, presence, gaps, warnings,
      counts: { quizzes: found('quiz').length, practice: found('practice').length, checklists: found('checklist').length, flashcards: list(content?.flashcards).length, images: images.length } };
  }));
  const evidence = researchEvidence({ review: { researchResults: modules.map(mod => ({ mod, bundle: course._research?.[mod.id] })) } });
  const materials = knownMaterials.map(id => ({ id, selected: choices ? choices.includes(id) : null, lessons: lessons.filter(lesson => lesson.presence[id]).length,
    count: id === 'lessons' ? lessons.filter(lesson => lesson.saved).length : lessons.reduce((sum, lesson) => sum + lesson.counts[id], 0) }));
  const warnings = [...structuralWarnings];
  if (!choices) warnings.push('This course has no saved material selection. Counts show content found, not whether the original request was fulfilled.');
  if (choices?.some(value => value !== 'images' && !knownMaterials.includes(value))) warnings.push('Some requested materials cannot be checked in this version.');
  if (choices && !choices.includes('lessons')) warnings.push('The saved selection does not include required lessons.');
  if (evidence.missing || evidence.unreferenced) warnings.push(`${evidence.missing + evidence.unreferenced} of ${modules.length} modules have no inspectable research references.`);
  if (list(course.failedTopics).length) warnings.push('The saved build still records failed lessons. Check its recovery status; the counts above describe the content available in this copy.');
  const imageProgress=courseImageProgress(course);
  const designProgress = savedDesignProgress(course, lessons);
  return { available: true, total: lessons.length, saved: lessons.filter(lesson => lesson.saved).length, lessons, materials, evidence, warnings, imageProgress, designProgress,
    gaps: lessons.filter(lesson => lesson.gaps.length), images: lessons.reduce((sum, lesson) => sum + lesson.counts.images, 0),
    explicit: !!choices, partial: !!list(course.failedTopics).length,
    needsAttention: structuralWarnings.length > 0 || lessons.some(lesson => lesson.gaps.length || lesson.warnings.length) || !!list(course.failedTopics).length || designProgress.selected && !designProgress.complete || imageProgress.selected && (imageProgress.missing > 0 || imageProgress.unplanned > 0) || !!choices && (!choices.includes('lessons') || choices.some(value => value !== 'images' && !knownMaterials.includes(value))) };
}
