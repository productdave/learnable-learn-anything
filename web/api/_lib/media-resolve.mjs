import { parseHTML } from 'linkedom';
import { extractImages, isSafeUrl, readWithLimit } from './url-extract.mjs';
import { publicFetch } from './public-fetch.mjs';

const IMAGE_TIMEOUT_MS = 8_000;
const PAGE_TIMEOUT_MS = 8_000;
const MAX_IMAGE_BYTES = 1.5 * 1024 * 1024;
const MAX_PAGE_BYTES = 4 * 1024 * 1024;
const MAX_CANDIDATES = 12;
const USER_AGENT = 'Mozilla/5.0 (compatible; LearnableBot/1.0; +https://learnable-tau.vercel.app)';

const IMAGE_TYPES = new Map([
  ['image/jpeg', 'jpg'],
  ['image/jpg', 'jpg'],
  ['image/png', 'png'],
  ['image/webp', 'webp'],
  ['image/gif', 'gif'],
  ['image/svg+xml', 'svg']
]);

export async function resolveImageForEmbed(input = {}, { fetchImpl = publicFetch, signal } = {}) {
  if (signal?.aborted) return { ok: false, error: 'Image preparation paused.', failures: [] };
  const direct = normalizeUrl(input.src || input.url);
  const sourceUrl = normalizeUrl(input.sourceUrl || input.source_url);
  const alt = String(input.alt || '').trim();
  const caption = String(input.caption || '').trim();
  const candidates = [];

  if (direct) candidates.push({ url: direct, alt, source: 'direct', score: 100 });
  if (sourceUrl) {
    const pageCandidates = await imageCandidatesFromSourcePage(sourceUrl, { fetchImpl, alt, caption, signal });
    candidates.push(...pageCandidates);
  }

  const seen = new Set();
  const ordered = candidates
    .filter(c => c?.url && !seen.has(c.url) && seen.add(c.url))
    .sort((a, b) => (b.score || 0) - (a.score || 0))
    .slice(0, MAX_CANDIDATES);

  const failures = [];
  for (const candidate of ordered) {
    if (signal?.aborted) break;
    try {
      const embedded = await fetchImageAsDataUrl(candidate.url, { fetchImpl, signal });
      return {
        ok: true,
        src: embedded.src,
        contentType: embedded.contentType,
        bytes: embedded.bytes,
        originalUrl: candidate.url,
        source: candidate.source,
        alt: candidate.alt || alt
      };
    } catch (err) {
      failures.push({ url: candidate.url, error: err?.message || String(err) });
    }
  }

  return {
    ok: false,
    error: failures[0]?.error || 'No embeddable image found.',
    failures
  };
}

export async function embedWebImagesInTopicResults(topicResults = [], opts = {}) {
  const out = topicResults.map(result => !result?.content?.sections ? result
    : { ...result, content: { ...result.content, sections: [...result.content.sections] } });
  for (const result of out) {
    if (!result?.content?.sections) continue;
    for (let i = 0; i < result.content.sections.length; i++) {
      if (opts.signal?.aborted) return out;
      const embedded = await embedImageSection(result.content.sections[i], opts);
      if (opts.signal?.aborted) return out;
      result.content.sections[i] = embedded;
      opts.onProgress?.(out);
    }
  }
  return out;
}

async function embedImageSection(section, opts) {
  if (!section || section.type !== 'image') return section;
  if (section.ref_kind === 'pdf' || String(section.src || '').startsWith('data:image/')) return section;
  const url = section.src || section.url;
  if (!url) return section;
  const resolved = await resolveImageForEmbed({
    src: url,
    sourceUrl: section.source_url,
    alt: section.alt,
    caption: section.caption
  }, opts);
  if (!resolved.ok) return section;
  return {
    type: 'image',
    src: resolved.src,
    original_src: url,
    alt: section.alt || resolved.alt || '',
    caption: section.caption,
    source_title: section.source_title,
    source_url: section.source_url || resolved.originalUrl
  };
}

async function imageCandidatesFromSourcePage(sourceUrl, { fetchImpl, alt, caption, signal }) {
  let parsed;
  try { parsed = new URL(sourceUrl); } catch { return []; }
  if (!isSafeUrl(parsed)) return [];

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), PAGE_TIMEOUT_MS);
  try {
    const resp = await fetchImpl(parsed.href, {
      headers: {
        'user-agent': USER_AGENT,
        accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
      },
      signal: signal ? AbortSignal.any([ctl.signal, signal]) : ctl.signal,
      redirect: 'follow'
    });
    if (!resp.ok) return [];
    const contentType = resp.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(contentType)) return [];
    const bytes = await readWithLimit(resp.body, MAX_PAGE_BYTES);
    signal?.throwIfAborted();
    const html = new TextDecoder('utf-8', { fatal: false }).decode(bytes);
    return extractPageImages(html, resp.url || parsed.href, { alt, caption });
  } catch {
    return [];
  } finally {
    clearTimeout(timer);
  }
}

export function extractPageImages(html, baseUrl, { alt = '', caption = '' } = {}) {
  const candidates = [];
  if (!html) return candidates;
  try {
    const { document } = parseHTML(html);
    for (const attr of ['og:image', 'twitter:image', 'twitter:image:src']) {
      const meta = document.querySelector(`meta[property="${attr}"], meta[name="${attr}"]`);
      const url = absolutize(meta?.getAttribute('content'), baseUrl);
      if (url) candidates.push({ url, alt: attr, source: 'source-page-meta', score: 8 });
    }

    for (const img of document.querySelectorAll('img')) {
      const raw = bestImageSrc(img);
      const url = absolutize(raw, baseUrl);
      if (!url) continue;
      const imgAlt = img.getAttribute('alt') || img.getAttribute('aria-label') || '';
      const score = 10 + textScore(`${imgAlt} ${url}`, `${alt} ${caption}`);
      if (looksDecorative(url, imgAlt)) continue;
      candidates.push({ url, alt: imgAlt, source: 'source-page-img', score });
    }

    for (const image of extractImages(html, baseUrl)) {
      const score = 12 + textScore(`${image.alt || ''} ${image.src}`, `${alt} ${caption}`);
      candidates.push({ url: image.src, alt: image.alt || '', source: 'readability-img', score });
    }
  } catch {}
  return candidates.sort((a, b) => (b.score || 0) - (a.score || 0));
}

async function fetchImageAsDataUrl(url, { fetchImpl, signal }) {
  const parsed = new URL(url);
  if (!isSafeUrl(parsed)) throw new Error('Image URL host is blocked.');

  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), IMAGE_TIMEOUT_MS);
  try {
    const resp = await fetchImpl(parsed.href, {
      headers: {
        'user-agent': USER_AGENT,
        accept: 'image/avif,image/webp,image/png,image/jpeg,image/svg+xml,image/*;q=0.8,*/*;q=0.2'
      },
      signal: signal ? AbortSignal.any([ctl.signal, signal]) : ctl.signal,
      redirect: 'follow'
    });
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const contentType = normalizeImageType(resp.headers.get('content-type') || '', parsed.pathname);
    if (!contentType) throw new Error(`Unsupported image content-type: ${resp.headers.get('content-type') || 'unknown'}`);
    const bytes = await readWithLimit(resp.body, MAX_IMAGE_BYTES);
    signal?.throwIfAborted();
    if (bytes.length < 64) throw new Error('Image response was empty.');
    const base64 = Buffer.from(bytes).toString('base64');
    return {
      src: `data:${contentType};base64,${base64}`,
      contentType,
      bytes: bytes.length
    };
  } catch (err) {
    if (err?.name === 'AbortError') throw new Error(`Timed out after ${IMAGE_TIMEOUT_MS}ms`);
    throw err;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeUrl(value) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('data:')) return '';
  try {
    const url = new URL(raw);
    return isSafeUrl(url) ? url.href : '';
  } catch {
    return '';
  }
}

function absolutize(value, baseUrl) {
  const raw = String(value || '').trim();
  if (!raw || raw.startsWith('data:')) return '';
  try {
    const url = new URL(raw, baseUrl);
    return isSafeUrl(url) ? url.href : '';
  } catch {
    return '';
  }
}

function bestImageSrc(img) {
  const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
  if (srcset) {
    const choices = srcset.split(',')
      .map(part => {
        const [url, size] = part.trim().split(/\s+/);
        const width = /(\d+)w/.exec(size || '')?.[1];
        return { url, width: Number(width || 0) };
      })
      .filter(x => x.url)
      .sort((a, b) => b.width - a.width);
    if (choices[0]?.url) return choices[0].url;
  }
  return img.getAttribute('src')
    || img.getAttribute('data-src')
    || img.getAttribute('data-original')
    || img.getAttribute('data-lazy-src')
    || '';
}

function normalizeImageType(header, pathname = '') {
  const raw = String(header || '').split(';')[0].trim().toLowerCase();
  if (IMAGE_TYPES.has(raw)) return raw === 'image/jpg' ? 'image/jpeg' : raw;
  const ext = String(pathname || '').split('.').pop()?.toLowerCase();
  if (ext === 'jpg' || ext === 'jpeg') return 'image/jpeg';
  if (ext === 'png') return 'image/png';
  if (ext === 'webp') return 'image/webp';
  if (ext === 'gif') return 'image/gif';
  if (ext === 'svg') return 'image/svg+xml';
  return '';
}

function textScore(haystack, needle) {
  const words = new Set(String(needle || '').toLowerCase().match(/[a-z0-9]{4,}/g) || []);
  if (!words.size) return 0;
  const h = String(haystack || '').toLowerCase();
  let score = 0;
  for (const word of words) {
    if (h.includes(word)) score += 6;
  }
  return score;
}

function looksDecorative(url, alt) {
  const text = `${url} ${alt}`.toLowerCase();
  return /logo|avatar|icon|sprite|favicon|tracking|pixel|blank|spacer/.test(text);
}
