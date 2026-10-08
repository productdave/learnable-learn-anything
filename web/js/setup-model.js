import { draftContent, NOTE_CHARACTER_LIMIT, noteCharacters } from './draft-store.js?v=5';

export const SETUP_STEPS = ['goal', 'experience', 'context', 'review'];
export const COURSE_DESCRIPTION_LIMIT = 5000;
export function courseDescriptionIssue(value) {
  return noteCharacters(value) > COURSE_DESCRIPTION_LIMIT
    ? 'Keep your course description to 5,000 characters. Move extra detail to Goal, Context or source notes. Your text has not been cut off.'
    : '';
}
export const FORMATS = {
  concept: ['Understand a topic', 'Build understanding with explanations and examples.'],
  guided_practice: ['Learn a skill', 'Build confidence with explanations and worked examples.'],
  project: ['Make something', 'Work towards a finished project or deliverable.'],
  exam_prep: ['Prepare for an exam', 'Focus on recall, application and readiness.']
};
export const COMPONENT_LABELS = { lessons: 'Step-by-step lessons', checklists: 'Checklists', quizzes: 'Quizzes', flashcards: 'Flashcards', images: 'Generate Course Images' };
export function setupURL(id, step = 'goal') {
  return `?${new URLSearchParams({ draft: id, step: SETUP_STEPS.includes(step) ? step : 'goal' })}`;
}
export function setupDraft(topic = '') {
  return draftContent({ step: 'goal', brief: { topic, experience: 'concept', depth: 'Solid foundation' } });
}
export function sourceUrlIssue(value) {
  if (!value.trim()) return '';
  try {
    const url = new URL(value.trim());
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password) return 'Use an http:// or https:// link without sign-in details.';
    const host = url.hostname.toLowerCase().replace(/\.$/, '');
    if (!host.includes('.') || host.includes(':') || /^[\d.]+$/.test(host) || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host)) return 'Use a public website address, not a local address or an IP address.';
    return '';
  } catch { return 'Enter a complete link, such as https://example.com/article.'; }
}
export function splitNote(note, makeId) {
  const characters = Array.from(note.text);
  const count = Math.ceil(characters.length / NOTE_CHARACTER_LIMIT);
  if (count < 2) return [note];
  return Array.from({ length: count }, (_, index) => ({
    id: index === 0 ? note.id : makeId(), title: `${note.title || 'Untitled note'} · Part ${index + 1}`,
    text: characters.slice(index * NOTE_CHARACTER_LIMIT, (index + 1) * NOTE_CHARACTER_LIMIT).join('')
  }));
}
export function setupIssues(draft) {
  const issues = [];
  if (!draft.brief.topic.trim()) issues.push({ step: 'goal', field: 'topic', text: 'Describe what you want to learn or teach.' });
  const descriptionIssue = courseDescriptionIssue(draft.brief.topic);
  if (descriptionIssue) issues.push({ step: 'goal', field: 'topic', text: descriptionIssue });
  if (!draft.brief.audience.trim()) issues.push({ step: 'goal', field: 'audience', text: 'Tell us who this course is for.' });
  for (const note of draft.sources.notes) if (noteCharacters(note.text) > NOTE_CHARACTER_LIMIT) issues.push({ step: 'context', source: note.id, type: 'notes', text: 'Split the long note into smaller notes. Nothing has been cut off.' });
  for (const link of draft.sources.links) {
    const problem = sourceUrlIssue(link.url);
    if (problem) issues.push({ step: 'context', source: link.id, type: 'links', text: problem });
  }
  for (const file of draft.sources.files) if (!(file.blob instanceof Blob)) issues.push({ step: 'context', source: file.id, type: 'files', text: `Reattach ${file.name}, or remove it from this setup.` });
  return issues;
}
export function sourceCounts(draft) {
  return { notes: draft.sources.notes.filter(n => n.text.trim()).length, links: draft.sources.links.filter(l => l.url.trim()).length, files: draft.sources.files.length };
}
export function fileProblem(file, existing = [], replacingId = '') {
  const extension = file.name.split('.').pop()?.toLowerCase();
  if (!['pdf', 'docx', 'txt'].includes(extension)) return 'Choose a PDF, DOCX or TXT file.';
  if (!file.size) return 'This file is empty. Choose a file with content.';
  if (file.size > 10 * 1024 * 1024) return 'This file is larger than 10 MB.';
  const others = existing.filter(item => item.id !== replacingId);
  if (others.length >= 5) return 'This setup already has five files.';
  if (others.some(item => item.name === file.name && item.size === file.size)) return 'A file with this name and size is already included. Remove it first if you want to replace it.';
  return '';
}
