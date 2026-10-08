import { sourceUrlIssue, COURSE_DESCRIPTION_LIMIT } from './setup-model.js?v=7';

export const SETUP_BUCKET = 'setup-sources';
export function accountIssue(code, message) { return Object.assign(new Error(message), { code }); }
export function setupIdentifier(value) {
  if (typeof value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9_-]{0,199}$/.test(value)) throw accountIssue('invalid', 'Invalid setup or source identifier.');
  return value;
}
export function sourcePath(owner, setup, file) {
  return `${setupIdentifier(owner)}/${setupIdentifier(setup)}/${setupIdentifier(file.id)}/${file.sha256}`;
}
const characters = (value, max, label) => {
  if (typeof value !== 'string' || Array.from(value).length > max) throw accountIssue('invalid', `${label} must be text of at most ${max.toLocaleString()} characters. Keep editing your local setup to shorten it.`);
  return value;
};
const collection = (value, max, label) => {
  if (!Array.isArray(value) || value.length > max) throw accountIssue('invalid', `Use at most ${max} ${label} per account setup.`);
  return value;
};
export function normalizeAccountPayload(input) {
  if (!input || input.schemaVersion !== 1) throw accountIssue('invalid', 'Unsupported setup format.');
  const brief = {};
  for (const [key, limit] of Object.entries({ topic: COURSE_DESCRIPTION_LIMIT, audience: 2000, goal: 6000, starting_point: 6000, context: 12000, depth: 100, experience: 100 })) brief[key] = characters(input.brief?.[key], limit, key === 'topic' ? 'Course description' : key.replace('_', ' '));
  if (!brief.topic.trim() || !brief.audience.trim()) throw accountIssue('invalid', 'Add a topic and audience before saving to your account.');
  const allowed = ['lessons', 'practice', 'checklists', 'quizzes', 'flashcards', 'images'];
  const components = ['lessons', ...new Set(collection(input.components, 6, 'component choices').filter(value => value !== 'lessons' && allowed.includes(value)))].sort();
  const notes = collection(input.sources?.notes, 50, 'notes').map(note => ({ id: setupIdentifier(note.id), title: characters(note.title, 500, 'Note title'), text: characters(note.text, 12000, 'Each note') }));
  const links = collection(input.sources?.links, 50, 'links').map(link => {
    const url = characters(link.url, 4000, 'URL'); const problem = sourceUrlIssue(url);
    if (problem) throw accountIssue('invalid', problem);
    return { id: setupIdentifier(link.id), title: characters(link.title, 500, 'Link title'), url };
  });
  const files = collection(input.sources?.files, 5, 'files').map(file => {
    const name = characters(file.name, 500, 'Filename');
    const type = { pdf: 'application/pdf', docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', txt: 'text/plain' }[name.split('.').pop().toLowerCase()];
    if (!type || !Number.isInteger(file.size) || file.size < 1 || file.size > 10485760 || !/^[a-f0-9]{64}$/.test(file.sha256)) throw accountIssue('invalid', 'Each source needs its original PDF, DOCX or TXT file, at most 10 MB.');
    return { id: setupIdentifier(file.id), name, type, size: file.size, sha256: file.sha256 };
  });
  for (const items of [notes, links, files]) if (new Set(items.map(item => item.id)).size !== items.length) throw accountIssue('invalid', 'Duplicate source identifiers.');
  const payload = { schemaVersion: 1, step: 'review', brief, components, sources: { notes, links, files } };
  if (new TextEncoder().encode(JSON.stringify(payload)).length > 1048576) throw accountIssue('invalid', 'Account setup text is limited to 1 MB. Split the material across separate setups; your local text has not been removed.');
  return payload;
}
export async function sha256(bytes) {
  return [...new Uint8Array(await crypto.subtle.digest('SHA-256', bytes))].map(n => n.toString(16).padStart(2, '0')).join('');
}
export async function prepareAccountPayload(draft) {
  const files = [];
  for (const file of draft.sources.files) {
    if (!(file.blob instanceof Blob)) throw accountIssue('missing-file', `Reattach ${file.name} before saving this setup to your account.`);
    files.push({ id: file.id, name: file.name, size: file.blob.size, sha256: await sha256(await file.blob.arrayBuffer()) });
  }
  const payload = normalizeAccountPayload({ schemaVersion: 1, brief: draft.brief, components: draft.components, sources: { notes: draft.sources.notes, links: draft.sources.links, files } });
  return { payload, hash: await sha256(new TextEncoder().encode(JSON.stringify(payload))) };
}
