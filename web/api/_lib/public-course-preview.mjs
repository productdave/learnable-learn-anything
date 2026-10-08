// Owner-only, read-only projection. This is not a publish action or an asset copier.
import { parseHTML } from 'linkedom';
import { SectionSchema, FlashcardSchema } from '../../js/generator/schema.mjs';
import { normalizePublicAuthor } from '../../js/public-author.js';
import { imageKey } from './publication-images.mjs';

const list = value => Array.isArray(value) ? value : [];
const identifier = value => typeof value === 'string' && /^[a-z0-9-]{1,160}$/.test(value);
const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const forbidden = /(?:sk-(?:ant-|proj-)?[A-Za-z0-9_-]{20,}|AIza[A-Za-z0-9_-]{20,}|eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+)/g;
const tags = new Set(['P','DIV','STRONG','EM','B','I','U','BR','UL','OL','LI','BLOCKQUOTE','CODE','PRE','H3','H4','A','TABLE','THEAD','TBODY','TR','TH','TD']);
const drop = new Set(['SCRIPT','STYLE','IFRAME','OBJECT','EMBED','SVG','MATH','FORM','INPUT','BUTTON','TEXTAREA','SELECT','TEMPLATE','LINK','META','IMG','AUDIO','VIDEO','SOURCE']);

export function publicPreviewLink(value) {
  if (typeof value !== 'string' || /[\\\u0000-\u0020\u007f]/.test(value)) return '';
  try {
    const url = new URL(value), host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash ||
        !host.includes('.') || host.includes(':') || /^[\d.]+$/.test(host) || /(^|\.)(localhost|local|internal|test|invalid)$/.test(host) ||
        /(?:\/storage\/|\/api\/|\/private(?:\/|$)|\/auth(?:\/|$)|\/signed(?:\/|$))/i.test(url.pathname)) return '';
    return url.href;
  } catch { return ''; }
}

export function projectPublicCourse(course, { images } = {}) {
  if (!course?.config || !list(course?.curriculum?.modules).length) throw Object.assign(new Error('The saved learning path is not available yet.'), { code:'incomplete', statusCode:409 });
  // Bound work before parsing legacy/AI-authored markup.
  if (Buffer.byteLength(JSON.stringify(course)) > 12 * 1024 * 1024) throw Object.assign(new Error('This course is too large to preview here. Your saved copy is unchanged.'), { code:'size', statusCode:413 });
  const issues = [], counts = { lessons:0, missing:0, withheldImages:0, unsupported:0, cleaned:0 };
  const issue = (code, location, message) => { if (!issues.some(i => i.code === code && i.location === location)) issues.push({ code, location, message }); };
  const clean = (value, location = 'Course') => {
    if (typeof value !== 'string') return '';
    const result = value.replace(forbidden, '[Private value removed]');
    if (result !== value) issue('private-text', location, 'A credential-like value was removed. Review the saved text before sharing.');
    return result.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u202a-\u202e\u2066-\u2069]/g, '');
  };
  function html(value, location) {
    const source = clean(value, location), { document } = parseHTML(`<html><body>${source}</body></html>`);
    let changed = false;
    function node(n) {
      if (n.nodeType === 3) return escape(clean(n.textContent, location));
      if (n.nodeType !== 1) { changed = true; return ''; }
      if (drop.has(n.tagName)) { changed = true; return ''; }
      const content = [...n.childNodes].map(node).join('');
      if (!tags.has(n.tagName)) { changed = true; return content; }
      const tag = n.tagName.toLowerCase();
      let attrs = '';
      for (const a of n.attributes) if (!(n.tagName === 'A' && a.name === 'href')) changed = true;
      if (n.tagName === 'A') {
        const href = publicPreviewLink(n.getAttribute('href'));
        if (!href) { changed = true; return content; }
        attrs = ` href="${escape(href)}" target="_blank" rel="noopener noreferrer" referrerpolicy="no-referrer"`;
      }
      return tag === 'br' ? '<br>' : `<${tag}${attrs}>${content}</${tag}>`;
    }
    const result = [...document.body.childNodes].map(node).join('');
    if (changed) { counts.cleaned++; issue('formatting', location, 'Some formatting, embedded media or links were withheld. Compare with your saved lesson.'); }
    return result;
  }
  // Parsed schemas strip unknown nested keys. HTML is allowed only in two bodies;
  // every other string is rendered as text by the preview UI.
  function values(value, location) {
    if (typeof value === 'string') return clean(value, location);
    if (Array.isArray(value)) return value.map(v => values(v, location));
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([k,v]) => [k,values(v,location)]));
    return value;
  }
  const moduleIds = new Set(), moduleNumbers = new Set();
  const modules = list(course.curriculum.modules).map((mod, mi) => {
    const location = `Module ${mi + 1}`, topicIds = new Set();
    if (!identifier(mod?.id) || !Number.isInteger(Number(mod.number)) || Number(mod.number) < 1 || moduleIds.has(mod.id) || moduleNumbers.has(Number(mod.number))) throw Object.assign(new Error('The saved learning path has missing or repeated module identifiers. Review it before sharing.'), { code:'incomplete', statusCode:409 });
    moduleIds.add(mod.id); moduleNumbers.add(Number(mod.number));
    const topics = list(mod.topics).map((meta, ti) => {
      const place = `${location}, lesson ${ti + 1}`;
      if (!identifier(meta?.id) || topicIds.has(meta.id)) throw Object.assign(new Error('The saved learning path has missing or repeated lesson identifiers. Review it before sharing.'), { code:'incomplete', statusCode:409 });
      topicIds.add(meta.id);
      const saved = course.modules?.[mod.number]?.[meta.id];
      const title = clean(saved?.title || meta.title, place) || 'Untitled lesson';
      if (!saved || !list(saved.sections).length) { counts.missing++; issue('missing-lesson', place, 'This lesson has not been saved yet. Finish course recovery before sharing.'); return { id:meta.id, title, available:false, sections:[], flashcards:[] }; }
      counts.lessons++;
      const sections = list(saved.sections).map((s,si) => {
        if (s?.type === 'image') {
          const image=images?.get(imageKey(mi,ti,si));
          if (image && typeof s.alt==='string' && s.alt.trim() && [...s.alt].length<=300 && (!s.caption || (typeof s.caption==='string' && [...s.caption].length<=500))) {
            counts.publicImages=(counts.publicImages || 0)+1;
            return {type:'image',public_image:image,alt:clean(s.alt,place),...(s.caption?{caption:clean(s.caption,place)}:{})};
          }
          if (images) {
            counts.withheldImages++; issue('image',place,'This image needs an accepted, owned generated image with alternative text. External, missing or unreviewed images cannot be published.');
            return {type:'withheld',title:'Image needs review',message:'Return to the saved lesson to review or replace this image. It will not be silently left out of publication.'};
          }
          counts.withheldImages++; issue('image', place, 'Images are held back until public image sharing is supported. Your private originals stay unchanged.');
          return { type:'withheld', title:'Image not included in this preview', message:'Public image sharing is not enabled yet.' };
        }
        const parsed = SectionSchema.safeParse(s);
        if (!parsed.success) { counts.unsupported++; issue('unsupported', place, 'A saved content block needs a supported public format. Your saved version is unchanged.'); return { type:'withheld', title:'Content needs review', message:'This saved block cannot be shown in the public preview yet.' }; }
        const section = values(parsed.data, place);
        if (['concept','callout'].includes(section.type)) section.content = html(section.content, place);
        if (s.diagram) { counts.unsupported++; issue('diagram', place, 'An embedded diagram needs public-preview support. The text is shown without the diagram.'); }
        return section;
      });
      const flashcards = list(saved.flashcards).flatMap(card => {
        const parsed = FlashcardSchema.safeParse(card);
        if (parsed.success) return [values(parsed.data, place)];
        counts.unsupported++; issue('flashcard', place, 'A flashcard could not be previewed. Review the saved lesson.'); return [];
      });
      return { id:meta.id, title, available:true, estimatedMinutes:Number.isFinite(saved.estimatedMinutes) && saved.estimatedMinutes > 0 ? saved.estimatedMinutes : null, sections, flashcards };
    });
    if (!topics.length) issue('missing-lessons', location, 'This module has no lessons yet.');
    return { id:mod.id, title:clean(mod.title,location), description:clean(mod.description,location), topics };
  });
  const author = normalizePublicAuthor(course.publicAuthor || course.config.publicAuthor);
  // No profile/email fallback or remote avatar requests. Initials are the safe
  // preview until publicly shareable avatar assets have an explicit boundary.
  const publicAuthor = author ? { displayName:clean(author.displayName), avatarUrl:'' } : null;
  if (!publicAuthor) issue('author','Course','Choose the public author name you want learners to see.');
  if (author?.avatarUrl) issue('avatar','Course','The saved avatar is held back; initials are shown until public avatar sharing is supported.');
  return { version:1, title:clean(course.config.title || course.config.name || course.curriculum.title) || 'Untitled course', subtitle:clean(course.config.subtitle || course.curriculum.subtitle), publicAuthor, modules, counts, issues };
}
