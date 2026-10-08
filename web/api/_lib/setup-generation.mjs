import { createHash } from 'node:crypto';
import { normalizeAccountPayload, sourcePath } from '../../js/setup-account-model.js';
import { readDocument } from './document-reader.mjs';
import { SUPPORTED_COMPONENTS, creationBrief } from '../../js/generator/component-policy.mjs';

export const SETUP_SOURCE_TEXT_LIMIT = 48000;
export function setupGenerationIssues(payload, { imagesEnabled = process.env.LEARNABLE_CREATION_IMAGES === '1' && process.env.LEARNABLE_GPT_IMAGES === '1' && process.env.LEARNABLE_IMAGE_REQUESTS === '1' && (!process.env.LEARNABLE_IMAGE_FUNDING || process.env.LEARNABLE_IMAGE_FUNDING === 'creator') } = {}) {
  const issues = [];
  const selected = payload.components || [];
  if (!selected.includes('lessons') || selected.some(c => !SUPPORTED_COMPONENTS.includes(c))) issues.push({ step: 'experience', text: 'Review unsupported course materials in Experience before creating. Your choices have not been changed.' });
  if (!imagesEnabled) issues.push({step:'create',text:'Course images are included in every new course, but image generation is temporarily unavailable on this server. Your setup is safe. No AI charges have started; retry when staging creation is enabled.'});
  const characters = Array.from(payload.sources.notes.map(n => n.text).join('\n')).length;
  if (characters > SETUP_SOURCE_TEXT_LIMIT) issues.push({ step: 'context', text: 'Use up to 48,000 source-text characters in total for this first release. Splitting notes does not reduce the total. Your text has not been shortened.' });
  if (payload.sources.links.length > 10) issues.push({ step: 'context', text: 'Use up to 10 source links for this first release.' });
  return issues;
}
export function setupJobId(owner, id, hash) { return `job-setup-${createHash('sha256').update(JSON.stringify([owner, id, hash])).digest('hex').slice(0, 48)}`; }
export async function inspectSetupSources(row, owner, client) {
  const payload = normalizeAccountPayload(row.payload);
  const files = [], issues = [], deadline = Date.now() + 30000;
  const pieces = payload.sources.notes.filter(n => n.text.trim()).map(n => `Source note: ${n.title || 'Untitled'}\n${n.text}`);
  for (const file of payload.sources.files) {
    const entry = { id: file.id, name: file.name, kind: file.name.split('.').at(-1).toLowerCase() };
    let timer;
    try {
      if (Date.now() >= deadline) throw new Error('The source check took too long. Try again with fewer files.');
      const work = async () => {
        let downloaded;
        try { downloaded = await client.storage.from('setup-sources').download(sourcePath(owner, row.id, file)); }
        catch { throw new Error('Couldn’t read the saved original. Try again, or reattach the file in Context.'); }
        const { data, error } = downloaded;
        if (error || !data || data.size !== file.size) throw new Error('Couldn’t read the saved original. Try again, or reattach the file in Context.');
        const bytes = Buffer.from(await data.arrayBuffer());
        if (createHash('sha256').update(bytes).digest('hex') !== file.sha256) throw new Error('Couldn’t verify the saved file. Reattach the original before continuing.');
        if (Date.now() >= deadline) throw new Error('The source check took too long. Try again with fewer files.');
        return readDocument(bytes, entry.kind, { timeoutMs: Math.min(8000, deadline - Date.now()) });
      };
      const result = await Promise.race([work(), new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('The source check took too long. Try again with fewer files.')), deadline - Date.now()); })]);
      files.push({ ...entry, status: 'ready', ...result });
      pieces.push(`Source file: ${file.name}\n${result.text}`);
    } catch (error) {
      const message = error.message || 'Couldn’t read this file. Reattach it or paste its text into Notes.';
      files.push({ ...entry, status: 'error', code: error.code || 'read-failed', message });
      issues.push({ step: 'context', fileId: file.id, text: `${file.name}: ${message}` });
    } finally { clearTimeout(timer); }
  }
  const source_text = pieces.join('\n\n');
  const characters = Array.from(source_text).length;
  if (characters > SETUP_SOURCE_TEXT_LIMIT) issues.push({ step: 'context', text: 'Notes and files exceed the 48,000-character source budget, including labels. Shorten the selection in Context; nothing has been truncated.' });
  const digest = issues.length ? null : createHash('sha256').update(JSON.stringify(['source-reader-v1', row.content_hash, source_text, files.map(f => [f.id, f.kind, f.pages, f.warnings])])).digest('hex');
  return { source_text, issues, review: { files, characters, limit: SETUP_SOURCE_TEXT_LIMIT, complete: !issues.length, requiresReview: files.length > 0, digest } };
}
export async function setupToGenerationBrief(row, owner, client, inspection) {
  const payload = normalizeAccountPayload(row.payload);
  const sources = inspection || await inspectSetupSources(row, owner, client);
  const issues = [...setupGenerationIssues(payload), ...sources.issues];
  if (issues.length) throw Object.assign(new Error(issues[0].text), { issues });
  const source_text = sources.source_text;
  const b = payload.brief;
  return creationBrief({ topic: b.topic, goal: b.goal, audience: b.audience, context: b.context, starting_point: b.starting_point, depth: b.depth, learning_approach: b.experience, experience: 'standard', tone: 'conversational', source_text, source_urls: payload.sources.links.filter(l => l.url.trim()).map(l => l.url), source_manifest: payload.sources, source_storage_id: row.id, components: payload.components, setup_reference: { id: row.id, revision: row.revision, hash: row.content_hash, source_digest: sources.review.digest } });
}
