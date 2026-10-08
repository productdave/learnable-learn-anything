import assert from 'node:assert/strict';
import { ReadableStream } from 'node:stream/web';
import { embedWebImagesInTopicResults, extractPageImages, resolveImageForEmbed } from '../web/api/_lib/media-resolve.mjs';

const pngBytes = new Uint8Array([
  137, 80, 78, 71, 13, 10, 26, 10,
  ...Array.from({ length: 96 }, (_, i) => i % 251)
]);

function response(body, { status = 200, contentType = 'text/html', url = 'https://example.com/page' } = {}) {
  const bytes = typeof body === 'string' ? new TextEncoder().encode(body) : body;
  return {
    ok: status >= 200 && status < 300,
    status,
    statusText: status === 200 ? 'OK' : 'Error',
    url,
    headers: new Map([['content-type', contentType]]),
    body: new ReadableStream({
      start(controller) {
        controller.enqueue(bytes);
        controller.close();
      }
    })
  };
}

{
  const candidates = extractPageImages(
    '<html><head><meta property="og:image" content="/og.png"></head><body><img src="/agent-loop.png" alt="agent loop diagram"></body></html>',
    'https://example.com/docs/agentic-ai',
    { alt: 'agent loop diagram' }
  );
  assert.equal(candidates[0].url, 'https://example.com/agent-loop.png');
}

{
  const fetchImpl = async (url) => {
    if (url === 'https://example.com/broken.png') return response('', { status: 404, contentType: 'text/plain', url });
    if (url === 'https://example.com/page') {
      return response('<img src="/agent-loop.png" alt="perceive reason act cycle diagram">', { url });
    }
    if (url === 'https://example.com/agent-loop.png') return response(pngBytes, { contentType: 'image/png', url });
    throw new Error(`unexpected fetch ${url}`);
  };
  const result = await resolveImageForEmbed({
    src: 'https://example.com/broken.png',
    sourceUrl: 'https://example.com/page',
    alt: 'perceive reason act cycle diagram'
  }, { fetchImpl });
  assert.equal(result.ok, true);
  assert.equal(result.originalUrl, 'https://example.com/agent-loop.png');
  assert.match(result.src, /^data:image\/png;base64,/);
}

{
  const fetchImpl = async (url) => response(pngBytes, { contentType: 'image/png', url });
  const topicResults = await embedWebImagesInTopicResults([
    {
      moduleId: 'm',
      topicId: 't',
      content: {
        sections: [
          { type: 'image', ref_kind: 'web', url: 'https://example.com/image.png', alt: 'Diagram' }
        ]
      }
    }
  ], { fetchImpl });
  const section = topicResults[0].content.sections[0];
  assert.match(section.src, /^data:image\/png;base64,/);
  assert.equal(section.original_src, 'https://example.com/image.png');
  assert.equal(section.ref_kind, undefined);
}

console.log('media resolve tests passed');
