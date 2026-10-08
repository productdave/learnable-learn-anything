// Synthetic 1024px PNG for binary/transport tests. Not a GPT-generated asset.
import { deflateSync } from 'node:zlib';
function chunk(type, data) {
  const kind = Buffer.from(type), crcInput = Buffer.concat([kind, data]);
  let crc = 0xffffffff;
  for (const byte of crcInput) {
    crc ^= byte;
    for (let i = 0; i < 8; i++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const result = Buffer.alloc(data.length + 12);
  result.writeUInt32BE(data.length, 0); kind.copy(result, 4); data.copy(result, 8);
  result.writeUInt32BE((crc ^ 0xffffffff) >>> 0, result.length - 4);
  return result;
}
export function syntheticPNG({ width = 1024, height = 1024, filter = 0, extraRaster = 0, trailing = false, animation = false, text = '' } = {}) {
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 2;
  const raster = Buffer.alloc((width * 3 + 1) * height + extraRaster, 180);
  for (let i = 0; i < height; i++) raster[i * (width * 3 + 1)] = filter;
  return Buffer.concat([Buffer.from([137,80,78,71,13,10,26,10]), chunk('IHDR', header),
    ...(text ? [chunk('tEXt',Buffer.from('Comment\0'+text))] : []),
    ...(animation ? [chunk('acTL', Buffer.alloc(8))] : []),
    chunk('IDAT', deflateSync(raster)), chunk('IEND', Buffer.alloc(0)), ...(trailing ? [Buffer.from('junk')] : [])]);
}
export function syntheticImageResponse(overrides = {}) {
  return { created: 1789516800, data: [{ b64_json: syntheticPNG().toString('base64') }],
    output_format: 'png', quality: 'medium', size: '1024x1024',
    usage: { input_tokens: 12, output_tokens: 30, total_tokens: 42,
      input_tokens_details: { text_tokens: 12, image_tokens: 0 }, output_tokens_details: { text_tokens: 0, image_tokens: 30 } },
    ...overrides };
}
