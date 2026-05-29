// Tiny client-side helper that fans a list of URLs out to /api/fetch-url and
// returns successfully-extracted articles. Used by both the service worker
// generator (sw.js) and the in-page fallback (generator/index.js).
//
// Progress is reported via onProgress({ done, total, url?, ok?, error? })
// — one event per completed URL — so the caller can update a job's message.

const ENDPOINT = '/api/fetch-url';

/**
 * Fetch + extract every URL in parallel. Failures soft-fail — they're omitted
 * from the result array and reported via onProgress with ok:false.
 *
 * @param {string[]} urls
 * @param {(p: {done:number,total:number,url?:string,ok?:boolean,error?:string}) => void} onProgress
 * @returns {Promise<Array<{url, title, byline, excerpt, textContent, length, images}>>}
 */
export async function fetchExtractedUrls(urls, onProgress = () => {}) {
  const list = (urls || []).map(u => String(u).trim()).filter(Boolean);
  if (!list.length) return [];
  const total = list.length;
  let done = 0;
  onProgress({ done, total });

  const out = await Promise.all(list.map(async (url) => {
    try {
      const resp = await fetch(ENDPOINT, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url })
      });
      const data = await resp.json().catch(() => ({ ok: false, error: 'Non-JSON response' }));
      done++;
      onProgress({ done, total, url, ok: !!data.ok, error: data.error });
      return data.ok ? data : null;
    } catch (err) {
      done++;
      onProgress({ done, total, url, ok: false, error: err.message || String(err) });
      return null;
    }
  }));
  return out.filter(Boolean);
}
