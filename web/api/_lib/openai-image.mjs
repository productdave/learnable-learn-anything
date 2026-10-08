import { createHash } from 'node:crypto';
import { inflateSync } from 'node:zlib';
import { readProtectedKey } from './provider-vault.mjs';
import { imagePolicy, requireImagePolicy, validOpenAIKey, imageFailureCode, ImageGenerationError } from './image-policy.mjs';

// Fixed origins and redirect refusal: no endpoint/key selection from course data.
export async function checkOpenAIKey(key, model, fetcher = fetch) {
  if (!validOpenAIKey(key)) throw new ImageGenerationError('credentials');
  let response;
  try {
    response = await fetcher(`https://api.openai.com/v1/models/${encodeURIComponent(model)}`, {
      method: 'GET', headers: { Authorization: `Bearer ${key}` },
      redirect: 'error', signal: AbortSignal.timeout(15000),
    });
    // No content/prompt is sent and no generation is performed by this check.
    await response.body?.cancel().catch(() => {});
  } catch { throw new ImageGenerationError('unavailable'); }
  if (!response.ok) throw new ImageGenerationError(imageFailureCode(response.status));
}

async function readResponse(response, limit, signal) {
  const reader = response.body?.getReader();
  if (!reader) throw new ImageGenerationError('response');
  const chunks = []; let size = 0;
  try {
    if (Number(response.headers.get('content-length')) > limit) throw new ImageGenerationError('response');
    while (true) {
      signal.throwIfAborted();
      const part = await reader.read();
      if (part.done) break;
      size += part.value.byteLength;
      if (size > limit) throw new ImageGenerationError('response');
      chunks.push(Buffer.from(part.value));
    }
    signal.throwIfAborted();
    return JSON.parse(Buffer.concat(chunks).toString('utf8'));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export function imageUsage(value) {
  const token = n => Number.isSafeInteger(n) && n >= 0;
  if (!value || !['input_tokens', 'output_tokens', 'total_tokens'].every(k => token(value[k])) ||
      value.total_tokens !== value.input_tokens + value.output_tokens) return null;
  const result = { input_tokens: value.input_tokens, output_tokens: value.output_tokens, total_tokens: value.total_tokens };
  for (const [key, total] of [['input_tokens_details', value.input_tokens], ['output_tokens_details', value.output_tokens]]) {
    const detail = value[key];
    if (detail && token(detail.text_tokens) && token(detail.image_tokens) && detail.text_tokens + detail.image_tokens === total) {
      result[key] = { text_tokens: detail.text_tokens, image_tokens: detail.image_tokens };
    }
  }
  return result; // Allowlist only; never retain arbitrary upstream fields.
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

// Structural validation of the bounded PNG pilot output, not a quality review.
// This also rejects HTML/SVG, truncated/base64 junk and decompression bombs.
export function decodeImagePNG(encoded, maxBytes = 8 * 1024 * 1024) {
  const fail = () => { throw new ImageGenerationError('response'); };
  if (typeof encoded !== 'string' || encoded.length > Math.ceil(maxBytes / 3) * 4 ||
      !encoded.length || encoded.length % 4 || !/^[A-Za-z0-9+/]*={0,2}$/.test(encoded)) fail();
  const bytes = Buffer.from(encoded, 'base64');
  if (bytes.length > maxBytes || bytes.toString('base64') !== encoded ||
      !bytes.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) fail();
  let offset = 8, header = null, ended = false, dataEnded = false, palette = false;
  const data = [];
  while (offset < bytes.length) {
    if (offset + 12 > bytes.length) fail();
    const size = bytes.readUInt32BE(offset), end = offset + 12 + size;
    if (end > bytes.length) fail();
    const type = bytes.toString('ascii', offset + 4, offset + 8), chunk = bytes.subarray(offset + 8, end - 4);
    if (!/^[A-Za-z]{4}$/.test(type) || crc32(bytes.subarray(offset + 4, end - 4)) !== bytes.readUInt32BE(end - 4)) fail();
    if (!header && type !== 'IHDR') fail();
    if (type === 'IHDR') {
      if (header || size !== 13) fail();
      header = chunk;
      if (header.readUInt32BE(0) !== 1024 || header.readUInt32BE(4) !== 1024 ||
          header[10] !== 0 || header[11] !== 0 || header[12] !== 0) fail();
    } else if (type === 'IDAT') {
      if (dataEnded) fail();
      data.push(chunk);
    } else {
      if (data.length) dataEnded = true;
      if (type === 'IEND') { if (size || !data.length || end !== bytes.length) fail(); ended = true; }
      else if (type === 'PLTE') { if (palette || data.length || !size || size % 3 || size > 768) fail(); palette = true; }
      else if (type[0] === type[0].toUpperCase()) fail(); // Unknown critical chunk.
      if (['acTL', 'fcTL', 'fdAT'].includes(type)) fail(); // No animated PNG.
    }
    offset = end;
  }
  if (!ended || !header) fail();
  const depth = header[8], color = header[9];
  const depths = { 0: [1,2,4,8,16], 2: [8,16], 3: [1,2,4,8], 4: [8,16], 6: [8,16] };
  if (!depths[color]?.includes(depth) || (color === 3 && !palette)) fail();
  const channels = { 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 }[color];
  const rowBytes = Math.ceil(1024 * channels * depth / 8) + 1, expected = rowBytes * 1024;
  let raster;
  try { raster = inflateSync(Buffer.concat(data), { maxOutputLength: expected + 1 }); } catch { fail(); }
  if (raster.length !== expected) fail();
  for (let i = 0; i < raster.length; i += rowBytes) if (raster[i] > 4) fail();
  return { bytes, contentType: 'image/png', width: 1024, height: 1024, sha256: createHash('sha256').update(bytes).digest('hex') };
}

// SERVER-ONLY primitive. The caller must first commit an owner/course-scoped
// request receipt and explicit confirmation. Not exposed as a paid HTTP route.
// This function dispatches at most once per invocation; it is NOT idempotent by
// itself. Durable replay/cancel reconciliation belongs to the next integration.
export async function generateCreatorImage({ client, ownerId, funding, prompt, alt, signal } = {}, {
  env = process.env, fetcher = fetch, readKey = readProtectedKey,
} = {}) {
  const policy = imagePolicy(env);
  requireImagePolicy(policy);
  if (funding !== policy.funding) throw new ImageGenerationError('funding');
  if (typeof ownerId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(ownerId) ||
      typeof prompt !== 'string' || !prompt.trim() || [...prompt].length > policy.maxPromptCharacters ||
      typeof alt !== 'string' || !alt.trim() || [...alt].length > policy.maxAltCharacters) throw new ImageGenerationError('input');
  if (signal?.aborted) throw new ImageGenerationError('cancelled');
  let key;
  try { key = await readKey(client, ownerId, 'openai'); } catch { throw new ImageGenerationError('vault'); }
  if (signal?.aborted) throw new ImageGenerationError('cancelled');
  if (!validOpenAIKey(key)) throw new ImageGenerationError('connection');
  const timeout = AbortSignal.timeout(policy.timeoutMs), combined = signal ? AbortSignal.any([signal, timeout]) : timeout;
  let dispatched = false, requestId = null, usage = null;
  try {
    combined.throwIfAborted();
    dispatched = true;
    const response = await fetcher('https://api.openai.com/v1/images/generations', {
      method: 'POST', headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
      redirect: 'error', signal: combined,
      body: JSON.stringify({ model: policy.model, prompt: prompt.trim(), n: policy.n, size: policy.size,
        quality: policy.quality, output_format: policy.output_format, moderation: policy.moderation, background: 'opaque' }),
    });
    const id = response.headers.get('x-request-id');
    requestId = /^req_[A-Za-z0-9_-]{1,100}$/.test(id || '') ? id : null;
    let result;
    try { result = await readResponse(response, response.ok ? policy.maxResponseBytes : 16384, combined); }
    catch (error) { if (response.ok || combined.aborted) throw error; }
    if (!response.ok) throw new ImageGenerationError(imageFailureCode(response.status, result?.error?.code));
    usage = imageUsage(result?.usage);
    if (!Array.isArray(result?.data) || result.data.length !== 1 || (result.output_format && result.output_format !== policy.output_format) ||
        (result.size && result.size !== policy.size) || (result.quality && result.quality !== policy.quality)) throw new ImageGenerationError('response');
    const asset = decodeImagePNG(result.data[0].b64_json, policy.maxImageBytes);
    combined.throwIfAborted();
    return { asset: { ...asset, alt: alt.trim() }, provenance: {
      funding: policy.funding, provider: policy.provider, model: policy.model,
      n: policy.n, size: policy.size, quality: policy.quality, outputFormat: policy.output_format,
      requestId, usage,
    } };
  } catch (error) {
    const code = signal?.aborted ? 'cancelled' : timeout.aborted || error?.name === 'TimeoutError' ? 'timeout' : error instanceof ImageGenerationError ? error.code : dispatched ? 'response' : 'unavailable';
    throw new ImageGenerationError(code, { dispatched, requestId, usage });
  } finally { key = null; }
}
