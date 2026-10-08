export async function boundedJson(req, max = 16384) {
  let text;
  if (req.body !== undefined) text = typeof req.body === 'string' ? req.body : JSON.stringify(req.body);
  else {
    const chunks = []; let size = 0;
    for await (const part of req) { const b = Buffer.from(part); size += b.length; if (size > max) throw new Error('Request is too large.'); chunks.push(b); }
    text = Buffer.concat(chunks).toString('utf8');
  }
  if (Buffer.byteLength(text || '') > max) throw new Error('Request is too large.');
  try { return JSON.parse(text); } catch { throw new Error('Invalid request.'); }
}
