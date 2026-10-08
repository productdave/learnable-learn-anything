import { decodeImagePNG } from './openai-image.mjs';

export const IMAGE_BUCKET = 'course-images';
export class ImageRequestError extends Error {
  constructor(code, statusCode = 409) {
    const messages = {
      request: 'Choose a saved lesson and valid image request.',
      consent: 'Confirm this image request and that your OpenAI account pays for it.',
      charge_ack: 'The previous request may have incurred a charge. A new request requires another confirmation.',
      conflict: 'The image request changed. Load the current attempt before continuing.',
      busy: 'Check or cancel the existing image request before starting another.',
      not_found: 'This image request or saved course is not available to your account.',
      stale: 'This lesson changed. Review its latest content before generating or accepting an image.',
      unavailable: 'The image request could not be confirmed. Reopen the same attempt; do not start another automatically.',
      asset: 'The saved image is unavailable. Check this attempt again; no image was regenerated.',
      referenced: 'This image is referenced by saved course content and cannot be removed as an unused candidate.',
      review: 'Review the image for accuracy and safety, and add alternative text before using it.',
      lesson: 'This lesson cannot accept another image yet. Review its content in Make changes first.',
    };
    super(messages[code] || messages.unavailable);
    this.name = 'ImageRequestError'; this.code = Object.hasOwn(messages, code) ? code : 'unavailable'; this.statusCode = statusCode;
  }
}
const unavailable = () => { throw new ImageRequestError('unavailable', 503); };

export function imageRequestStore(client) {
  return {
    async course(owner, id) {
      const { data, error } = await client.from('user_courses').select('id,payload,created_at,updated_at').eq('owner_id', owner).eq('id', id).maybeSingle();
      if (error) unavailable(); return data;
    },
    async get(owner, id) {
      const { data, error } = await client.from('course_image_requests').select('*').eq('owner_id', owner).eq('id', id).maybeSingle();
      if (error) unavailable(); return data;
    },
    async list(owner, courseId, after) {
      let query = client.from('course_image_requests').select('*').eq('owner_id',owner).eq('course_id',courseId).eq('is_current',true).order('id',{ascending:true}).limit(51);
      if (after) query = query.gt('id',after);
      const { data, error } = await query;
      if (error) unavailable(); return data;
    },
    async begin(row, expected, acknowledge) {
      const { data, error } = await client.rpc('begin_course_image_request', { p_owner: row.owner_id, p_id: row.id,
        p_course: row.course_id, p_slot: row.slot_key, p_expected: expected, p_payload: row.payload, p_ack: acknowledge === true });
      if (error) unavailable();
      if (data?.error) throw new ImageRequestError(data.error, data.error === 'not_found' ? 404 : 409);
      if (!data?.row) unavailable(); return data;
    },
    async update(row, patch) {
      const payload = { ...row.payload, ...patch };
      const { data, error } = await client.from('course_image_requests').update({ status: payload.status, payload, revision: row.revision + 1 })
        .eq('owner_id', row.owner_id).eq('id', row.id).eq('revision', row.revision).select('*').maybeSingle();
      if (error) unavailable(); return data;
    },
    async accept(row, course, payload, operationId, hash) {
      const { data, error } = await client.rpc('accept_course_image', { p_owner: row.owner_id, p_id: row.id,
        p_course: row.course_id, p_revision: row.revision, p_updated_at: course.updated_at,
        p_payload: payload, p_operation: operationId, p_hash: hash });
      if (error) unavailable();
      if (data?.error) throw new ImageRequestError(data.error, data.error === 'not_found' ? 404 : 409);
      if (!data?.saved) unavailable(); return data;
    },
  };
}

export function imageAssetPath(row) {
  const asset = row.payload.asset;
  if (!/^[0-9a-f-]{36}$/i.test(row.owner_id) || !/^[0-9a-f-]{36}$/i.test(row.id) || !/^[a-f0-9]{64}$/.test(asset?.sha256 || '')) throw new ImageRequestError('asset');
  return `${row.owner_id}/${row.id}/${asset.sha256}.png`;
}

export function imageAssetStore(client) {
  return {
    async put(row, bytes) {
      const { error } = await client.storage.from(IMAGE_BUCKET).upload(imageAssetPath(row), bytes, { contentType: 'image/png', upsert: false, cacheControl: 'private, no-store' });
      // A conflict or lost reply is resolved by downloading/verifying this exact
      // immutable object. Never overwrite it or ask the image provider again.
      return !error;
    },
    async read(row) {
      const { data, error } = await client.storage.from(IMAGE_BUCKET).download(imageAssetPath(row));
      if (error) {
        if (String(error.statusCode || error.status) === '404' || error.message === 'Object not found') return null;
        throw new ImageRequestError('asset', 503);
      }
      if (!data || data.size !== row.payload.asset.bytes || data.size > 8388608) throw new ImageRequestError('asset', 503);
      let result;
      try { result = decodeImagePNG(Buffer.from(await data.arrayBuffer()).toString('base64')); }
      catch { throw new ImageRequestError('asset', 503); }
      if (result.sha256 !== row.payload.asset.sha256) throw new ImageRequestError('asset', 503);
      return result;
    },
    async remove(row) {
      const { error } = await client.storage.from(IMAGE_BUCKET).remove([imageAssetPath(row)]);
      if (error) throw new ImageRequestError('asset', 503);
    },
  };
}
