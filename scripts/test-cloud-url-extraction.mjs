import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractUrlContent, isSafeUrl } from '../web/api/_lib/url-extract.mjs';
import { mergeSourceUrlResults, serverFetchUrls, sourceUrlHasResult } from '../web/api/_lib/gen-runner.mjs';

assert.equal(isSafeUrl(new URL('https://example.com/article')), true);
assert.equal(isSafeUrl(new URL('http://localhost/article')), false);
assert.equal(isSafeUrl(new URL('http://10.0.0.1/article')), false);
assert.equal(isSafeUrl(new URL('file:///tmp/article')), false);

const html = `<!doctype html>
<html>
  <head><title>Design Systems</title></head>
  <body>
    <article>
      <h1>Design Systems for Product Teams</h1>
      <p>This article explains how designers can use components, tokens, and interaction rules to ship better product work.</p>
      <p>It has enough plain text for Readability to extract useful course source context.</p>
      <img src="/hero.png" alt="A product interface" width="800" height="500">
    </article>
  </body>
</html>`;

const okResult = await extractUrlContent('https://example.com/design-systems', {
  fetchImpl: async () => new Response(html, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  })
});
assert.equal(okResult.ok, true);
assert.equal(okResult.url, 'https://example.com/design-systems');
assert.match(okResult.textContent, /designers can use components/i);
assert.equal(okResult.images[0].src, 'https://example.com/hero.png');

const blockedResult = await extractUrlContent('http://127.0.0.1/private');
assert.equal(blockedResult.ok, false);
assert.equal(blockedResult.statusCode, 400);
assert.match(blockedResult.error, /blocked/);

const unsupportedResult = await extractUrlContent('https://example.com/file.pdf', {
  fetchImpl: async () => new Response('pdf', {
    status: 200,
    headers: { 'content-type': 'application/pdf' }
  })
});
assert.equal(unsupportedResult.ok, false);
assert.match(unsupportedResult.error, /Unsupported content-type/);

const runnerResults = await serverFetchUrls([
  'https://example.com/design-systems',
  'https://example.com/file.pdf'
], {
  fetchImpl: async (url) => {
    if (String(url).endsWith('/file.pdf')) {
      return new Response('pdf', { status: 200, headers: { 'content-type': 'application/pdf' } });
    }
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
  }
});
assert.equal(runnerResults.length, 2);
assert.equal(runnerResults[0].ok, true);
assert.equal(runnerResults[1].ok, false);
assert.equal(runnerResults[0].requestedUrl, 'https://example.com/design-systems');
assert.equal(runnerResults[1].url, 'https://example.com/file.pdf');

const progressSnapshots = [];
const incrementalResults = await serverFetchUrls([
  'https://example.com/a',
  'https://example.com/b',
  'https://example.com/c'
], {
  fetchImpl: async (url) => new Response(html.replace('Design Systems', String(url)), {
    status: 200,
    headers: { 'content-type': 'text/html' }
  }),
  onProgress: async results => {
    progressSnapshots.push(results.map(result => result.requestedUrl));
  }
});
assert.equal(incrementalResults.length, 3);
assert.equal(progressSnapshots.length, 3);
assert.deepEqual(progressSnapshots.at(-1), [
  'https://example.com/a',
  'https://example.com/b',
  'https://example.com/c'
]);
assert.equal(sourceUrlHasResult('https://example.com/a', incrementalResults), true);
assert.equal(sourceUrlHasResult('https://example.com/missing', incrementalResults), false);
assert.deepEqual(
  mergeSourceUrlResults(
    [{ requestedUrl: 'https://example.com/a', ok: false, url: 'https://example.com/a' }],
    [{ requestedUrl: 'https://example.com/a', ok: true, url: 'https://example.com/a' }, { requestedUrl: 'https://example.com/d', ok: true, url: 'https://example.com/d' }]
  ).map(result => [result.requestedUrl, result.ok]),
  [['https://example.com/a', true], ['https://example.com/d', true]]
);

const unexpectedFailureResults = await serverFetchUrls(['https://example.com/throws'], null);
assert.equal(unexpectedFailureResults.length, 1);
assert.equal(unexpectedFailureResults[0].ok, false);
assert.equal(unexpectedFailureResults[0].url, 'https://example.com/throws');
assert.match(unexpectedFailureResults[0].error, /Cannot destructure|undefined|null|object/i);

let fetchedUrls = [];
const manyUrls = Array.from({ length: 12 }, (_, i) => `https://example.com/source-${i + 1}`);
const cappedResults = await serverFetchUrls(manyUrls, {
  fetchImpl: async (url) => {
    fetchedUrls.push(String(url));
    return new Response(html, { status: 200, headers: { 'content-type': 'text/html' } });
  }
});
assert.equal(cappedResults.length, 12);
assert.equal(fetchedUrls.length, 10);
assert.equal(cappedResults.filter(r => r.ok).length, 10);
assert.equal(cappedResults[10].ok, false);
assert.equal(cappedResults[10].url, 'https://example.com/source-11');
assert.match(cappedResults[10].error, /at most 10 source URLs/);

const runnerSource = readFileSync(new URL('../web/api/_lib/gen-runner.mjs', import.meta.url), 'utf8');
assert.ok(runnerSource.includes("import { extractUrlContent } from './url-extract.mjs';"));
assert.ok(runnerSource.includes('const SOURCE_URL_LIMIT = 10;'));
assert.ok(runnerSource.includes('const SOURCE_URL_CONCURRENCY = 4;'));
assert.ok(runnerSource.includes('const workers = Array.from({ length: Math.min(SOURCE_URL_CONCURRENCY, list.length) }'));
assert.ok(runnerSource.includes('const pendingSourceUrls = sourceUrls.filter(url => !sourceUrlHasResult(url, extractedUrls));'));
assert.ok(runnerSource.includes('onProgress: async partialResults =>'));
assert.ok(runnerSource.includes('extractedUrls = mergeSourceUrlResults(extractedUrls, partialResults);'));
assert.ok(runnerSource.includes('await patch({ extracted_urls: extractedUrls });'));
assert.ok(!runnerSource.includes('/api/fetch-url'));
assert.ok(!runnerSource.includes('VERCEL_URL'));

console.log('cloud URL extraction tests passed');
