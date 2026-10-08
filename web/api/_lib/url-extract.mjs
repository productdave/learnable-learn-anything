import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';
import { publicFetch } from './public-fetch.mjs';

const FETCH_TIMEOUT_MS = 8_000;
const MAX_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_CHARS = 50_000;
const MAX_IMAGES = 10;
const USER_AGENT = 'Mozilla/5.0 (compatible; LearnableBot/1.0; +https://learnable-tau.vercel.app)';

export async function extractUrlContent(url, { fetchImpl = publicFetch } = {}) {
  const rawUrl = String(url || '').trim();
  if (!rawUrl) return { ok: false, url: rawUrl, error: 'Missing url', statusCode: 400 };

  let parsed;
  try { parsed = new URL(rawUrl); }
  catch { return { ok: false, url: rawUrl, error: 'Invalid URL', statusCode: 400 }; }

  if (!isSafeUrl(parsed)) {
    return { ok: false, url: rawUrl, error: 'URL host is blocked (private / loopback / link-local)', statusCode: 400 };
  }

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    let resp;
    try {
      resp = await fetchImpl(parsed.href, {
        headers: {
          'user-agent': USER_AGENT,
          accept: 'text/html,application/xhtml+xml;q=0.9,*/*;q=0.8'
        },
        signal: ctl.signal,
        redirect: 'follow'
      });
    } finally {
      clearTimeout(timer);
    }

    if (!resp.ok) {
      return { ok: false, url: rawUrl, error: `HTTP ${resp.status} ${resp.statusText}` };
    }

    const contentType = resp.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(contentType)) {
      return { ok: false, url: rawUrl, error: `Unsupported content-type: ${contentType}` };
    }

    const buf = await readWithLimit(resp.body, MAX_BYTES);
    const html = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    const finalUrl = resp.url || parsed.href;

    const { document } = parseHTML(html);
    if (!document.querySelector('base')) {
      const baseEl = document.createElement('base');
      baseEl.setAttribute('href', finalUrl);
      document.head?.prepend(baseEl);
    }

    const article = new Readability(document, { keepClasses: false }).parse();
    if (!article || !article.textContent) {
      return { ok: false, url: rawUrl, error: 'Could not extract readable article content' };
    }

    const textContent = String(article.textContent || '').slice(0, MAX_TEXT_CHARS);
    return {
      ok: true,
      url: finalUrl,
      title: article.title || '',
      byline: article.byline || '',
      excerpt: article.excerpt || '',
      textContent,
      length: article.length || textContent.length,
      images: extractImages(article.content, finalUrl)
    };
  } catch (err) {
    const msg = err?.name === 'AbortError'
      ? `Timed out after ${FETCH_TIMEOUT_MS}ms`
      : (err.message || String(err));
    return { ok: false, url: rawUrl, error: msg };
  }
}

/** Block obvious SSRF targets — internal infra, loopback, link-local. */
export function isSafeUrl(parsed) {
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  const host = (parsed.hostname || '').toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host === '0.0.0.0' || host === '::1') return false;
  if (/^127\./.test(host)) return false;
  if (/^10\./.test(host)) return false;
  if (/^192\.168\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
  if (/^169\.254\./.test(host)) return false;
  if (/^\[?(fc|fd)[0-9a-f]{2}:/i.test(host)) return false;
  return true;
}

export function extractImages(articleHtml, baseUrl) {
  const out = [];
  if (!articleHtml) return out;
  try {
    const { document } = parseHTML(`<!doctype html><html><head></head><body>${articleHtml}</body></html>`);
    const seen = new Set();
    for (const img of document.querySelectorAll('img')) {
      let raw = img.getAttribute('src') || img.getAttribute('data-src') || img.getAttribute('data-original') || '';
      if (!raw) {
        const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset') || '';
        if (srcset) raw = srcset.split(',')[0].trim().split(/\s+/)[0];
      }
      if (!raw || raw.startsWith('data:')) continue;
      let abs;
      try { abs = new URL(raw, baseUrl).href; } catch { continue; }
      if (seen.has(abs)) continue;
      seen.add(abs);
      const alt = img.getAttribute('alt') || '';
      const wRaw = img.getAttribute('width');
      const hRaw = img.getAttribute('height');
      const w = wRaw ? parseInt(wRaw, 10) : NaN;
      const h = hRaw ? parseInt(hRaw, 10) : NaN;
      if (Number.isFinite(w) && w < 120) continue;
      if (Number.isFinite(h) && h < 120) continue;
      out.push({ src: abs, alt });
      if (out.length >= MAX_IMAGES) break;
    }
  } catch {}
  return out;
}

export async function readWithLimit(stream, max) {
  if (!stream) return new Uint8Array(0);
  const reader = stream.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) throw new Error(`Response body exceeded ${max} bytes`);
    chunks.push(value);
  }
  const out = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { out.set(c, off); off += c.length; }
  return out;
}
