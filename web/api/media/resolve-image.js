// POST /api/media/resolve-image
//
// Body: { src, sourceUrl, alt, caption }
// Returns a small embedded data:image URL when Learnable can safely fetch a
// direct image or find a better image candidate on the cited source page.

import { readJsonBody } from '../_lib/supabase-server.mjs';
import { resolveImageForEmbed } from '../_lib/media-resolve.mjs';

export const config = {
  runtime: 'nodejs',
  maxDuration: 20
};

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const body = await readJsonBody(req);
  if (!body?.src && !body?.sourceUrl && !body?.source_url) {
    return res.status(400).json({ error: 'Missing { src } or { sourceUrl }.' });
  }

  const result = await resolveImageForEmbed(body);
  if (!result.ok) {
    return res.status(404).json({
      ok: false,
      error: result.error || 'No embeddable image found.'
    });
  }

  return res.status(200).json(result);
}
