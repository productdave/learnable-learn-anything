// /api/fetch-url — Vercel serverless function (Node runtime).
//
// Fetches a single URL server-side (browsers can't cross-origin-fetch most
// pages), runs Mozilla Readability over the HTML, and returns:
//   { ok: true, url, title, byline, excerpt, textContent, length, images }
//
// `textContent` is the article body as plain text (capped at ~50KB to keep
// Stage 1/2 prompts manageable). `images` is up to 10 candidate inline
// images from inside the article — `{ src, alt }` pairs the model can pick
// from when emitting `image` sections.
//
// Soft errors return `{ ok: false, url, error }` with status 200 so the
// caller can degrade gracefully (some URLs fetched, some failed).

import { parseHTML } from 'linkedom';
import { Readability } from '@mozilla/readability';

const FETCH_TIMEOUT_MS = 8_000;
const MAX_BYTES = 5 * 1024 * 1024; // 5MB cap on response body
const MAX_TEXT_CHARS = 50_000;
const MAX_IMAGES = 10;
const USER_AGENT = 'Mozilla/5.0 (compatible; LearnableBot/1.0; +https://learnable-tau.vercel.app)';

export const config = { runtime: 'nodejs' };

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'content-type');
    return res.status(204).end();
  }
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'POST only' });
  }

  // Vercel auto-parses JSON when content-type is application/json; otherwise
  // body is a Readable stream. Handle both shapes.
  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch { body = null; }
  } else if (body && typeof body.read === 'function') {
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { body = null; }
  }

  const url = body && typeof body.url === 'string' ? body.url.trim() : '';
  if (!url) return res.status(400).json({ error: 'Missing url' });

  let parsed;
  try { parsed = new URL(url); }
  catch { return res.status(400).json({ error: 'Invalid URL' }); }
  if (!isSafeUrl(parsed)) {
    return res.status(400).json({ error: 'URL host is blocked (private / loopback / link-local)' });
  }

  try {
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS);
    let resp;
    try {
      resp = await fetch(parsed.href, {
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
      return res.status(200).json({ ok: false, url, error: `HTTP ${resp.status} ${resp.statusText}` });
    }
    const contentType = resp.headers.get('content-type') || '';
    if (!/text\/html|application\/xhtml/i.test(contentType)) {
      return res.status(200).json({ ok: false, url, error: `Unsupported content-type: ${contentType}` });
    }

    const buf = await readWithLimit(resp.body, MAX_BYTES);
    const html = new TextDecoder('utf-8', { fatal: false }).decode(buf);
    const finalUrl = resp.url || parsed.href;

    const { document } = parseHTML(html);
    // Ensure relative links + images resolve correctly when Readability serializes back to HTML.
    if (!document.querySelector('base')) {
      const baseEl = document.createElement('base');
      baseEl.setAttribute('href', finalUrl);
      document.head?.prepend(baseEl);
    }

    const reader = new Readability(document, { keepClasses: false });
    const article = reader.parse();
    if (!article || !article.textContent) {
      return res.status(200).json({ ok: false, url, error: 'Could not extract readable article content' });
    }

    const images = extractImages(article.content, finalUrl);
    const textContent = String(article.textContent || '').slice(0, MAX_TEXT_CHARS);

    return res.status(200).json({
      ok: true,
      url: finalUrl,
      title: article.title || '',
      byline: article.byline || '',
      excerpt: article.excerpt || '',
      textContent,
      length: article.length || textContent.length,
      images
    });
  } catch (err) {
    const msg = err?.name === 'AbortError' ? `Timed out after ${FETCH_TIMEOUT_MS}ms` : (err.message || String(err));
    return res.status(200).json({ ok: false, url, error: msg });
  }
}

/** Block obvious SSRF targets — internal infra, loopback, link-local. */
function isSafeUrl(parsed) {
  if (!['http:', 'https:'].includes(parsed.protocol)) return false;
  const host = (parsed.hostname || '').toLowerCase();
  if (!host) return false;
  if (host === 'localhost' || host === '0.0.0.0' || host === '::1') return false;
  // IPv4 private + loopback + link-local + metadata
  if (/^127\./.test(host)) return false;
  if (/^10\./.test(host)) return false;
  if (/^192\.168\./.test(host)) return false;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(host)) return false;
  if (/^169\.254\./.test(host)) return false;
  // IPv6 unique-local fc00::/7
  if (/^\[?(fc|fd)[0-9a-f]{2}:/i.test(host)) return false;
  return true;
}

/** Pull candidate inline images out of the Readability-serialized article HTML. */
function extractImages(articleHtml, baseUrl) {
  const out = [];
  if (!articleHtml) return out;
  try {
    const { document } = parseHTML(`<!doctype html><html><head></head><body>${articleHtml}</body></html>`);
    const seen = new Set();
    for (const img of document.querySelectorAll('img')) {
      // Some sites lazy-load with data-src / data-original / srcset
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
      // Filter chrome / tracking pixels when dimensions are declared.
      if (Number.isFinite(w) && w < 120) continue;
      if (Number.isFinite(h) && h < 120) continue;
      out.push({ src: abs, alt });
      if (out.length >= MAX_IMAGES) break;
    }
  } catch { /* swallow — images are optional */ }
  return out;
}

async function readWithLimit(stream, max) {
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
