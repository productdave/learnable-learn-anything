// Client-side PDF helpers — runs in the page (not the service worker).
//
// Two jobs:
//   1. `pdfToBase64(file)` — read a PDF file into a base64 string we can hand
//      to Anthropic's `document` content block (used by Stage 1 + Stage 2).
//   2. `extractPdfPageThumbs(file, { perFileBytes })` — render each page of a
//      PDF to a JPEG data URL using pdf.js, capped at a byte budget per file.
//      These are what Stage 3 image sections of `ref_kind:'pdf'` resolve to.
//
// pdf.js is loaded lazily from a CDN ESM build the first time it's needed, so
// users who never upload a PDF pay nothing for it.

let _pdfjsPromise = null;

async function loadPdfJs() {
  if (_pdfjsPromise) return _pdfjsPromise;
  _pdfjsPromise = (async () => {
    const mod = await import('https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/+esm');
    // Worker file must match the version we imported.
    mod.GlobalWorkerOptions.workerSrc =
      'https://cdn.jsdelivr.net/npm/pdfjs-dist@4.7.76/build/pdf.worker.min.mjs';
    return mod;
  })();
  return _pdfjsPromise;
}

/** Read a File into a base64-encoded string (no data: prefix). */
export function pdfToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = reader.result;
      // strip "data:application/pdf;base64,"
      const ix = String(dataUrl).indexOf('base64,');
      resolve(ix >= 0 ? String(dataUrl).slice(ix + 7) : '');
    };
    reader.onerror = () => reject(reader.error || new Error('PDF read failed'));
    reader.readAsDataURL(file);
  });
}

/**
 * Render each page of a PDF to a JPEG data URL.
 *
 * Adaptive quality: if the produced thumbs exceed `perFileBytes`, the function
 * iteratively shrinks dimensions and/or quality until they fit. If even the
 * lowest-quality pass blows the budget, we return what we have plus a warning
 * (the caller decides whether to surface it).
 *
 * @returns {Promise<{ pageThumbs: string[], totalBytes: number, warning: string|null }>}
 */
export async function extractPdfPageThumbs(file, { perFileBytes = 600_000 } = {}) {
  const pdfjs = await loadPdfJs();
  const buf = await file.arrayBuffer();
  const pdf = await pdfjs.getDocument({ data: buf }).promise;

  // Try a few quality presets. First one to fit the budget wins. Page-level
  // scale is the dominant lever; quality is the fine-tune.
  const presets = [
    { maxWidth: 1200, quality: 0.6 },
    { maxWidth: 900,  quality: 0.55 },
    { maxWidth: 700,  quality: 0.5 },
    { maxWidth: 500,  quality: 0.45 }
  ];

  let lastThumbs = [];
  let lastBytes = Infinity;
  let warning = null;

  for (const preset of presets) {
    const thumbs = [];
    let bytes = 0;
    for (let p = 1; p <= pdf.numPages; p++) {
      const page = await pdf.getPage(p);
      const viewport1x = page.getViewport({ scale: 1 });
      const scale = Math.min(preset.maxWidth / viewport1x.width, 2);
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement('canvas');
      canvas.width = Math.ceil(viewport.width);
      canvas.height = Math.ceil(viewport.height);
      const ctx = canvas.getContext('2d');
      await page.render({ canvasContext: ctx, viewport }).promise;
      const dataUrl = canvas.toDataURL('image/jpeg', preset.quality);
      thumbs.push(dataUrl);
      bytes += dataUrl.length;
      // Bail early on any preset that's already overshooting badly.
      if (bytes > perFileBytes * 1.5) break;
    }
    lastThumbs = thumbs;
    lastBytes = bytes;
    if (bytes <= perFileBytes && thumbs.length === pdf.numPages) {
      return { pageThumbs: thumbs, totalBytes: bytes, warning: null };
    }
  }

  // None of the presets fit. Return the smallest pass and warn.
  if (lastThumbs.length < pdf.numPages) {
    warning = `PDF too dense — only ${lastThumbs.length} of ${pdf.numPages} page${pdf.numPages === 1 ? '' : 's'} embedded.`;
  } else {
    warning = `PDF page thumbnails larger than budget (${(lastBytes / 1_000_000).toFixed(1)}MB) — kept at lowest quality.`;
  }
  return { pageThumbs: lastThumbs, totalBytes: lastBytes, warning };
}

/** Convenience: total bytes of an array of data URLs. */
export function dataUrlsBytes(urls) {
  let n = 0;
  for (const u of urls || []) n += (u || '').length;
  return n;
}
