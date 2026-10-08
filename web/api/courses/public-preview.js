import { userFromRequest,serviceClient } from '../_lib/supabase-server.mjs';
import { requireSafeCourseId } from './get.js';
import { projectPublicCourse } from '../_lib/public-course-preview.mjs';
import { reviewToken } from '../_lib/course-publication.mjs';
import { collectPublicationImages,publicImagesEnabled,publicPNG } from '../_lib/publication-images.mjs';
import { imageAssetStore } from '../_lib/image-request-store.mjs';

export const config = { runtime:'nodejs' };
export function createPublicPreviewHandler({ authenticate = userFromRequest, admin=serviceClient, imagesEnabled=publicImagesEnabled, enabled = () => process.env.LEARNABLE_SETUP_GENERATION === '1' } = {}) {
  return async (req,res) => {
    res.setHeader?.('Cache-Control','private, no-store');
    res.setHeader?.('X-Content-Type-Options','nosniff');
    if (req.method !== 'GET') return res.status(405).json({ code:'method', error:'Use GET. This preview cannot publish or save changes.' });
    if (!enabled()) return res.status(503).json({ code:'disabled', error:'Publishing preview is not enabled here yet.' });
    try {
      const { user, client } = await authenticate(req);
      const url=new URL(req.url,'http://localhost'),courseId = requireSafeCourseId(url.searchParams.get('courseId'));
      const { data:row, error } = await client.from('user_courses').select('payload,updated_at').eq('owner_id',user.id).eq('id',courseId).maybeSingle();
      if (error) throw error;
      if (!row || row.payload?.config?.id !== courseId) return res.status(404).json({ code:'not_found', error:'This saved course is not available to your account.' });
      const token=reviewToken(row),db=imagesEnabled()?admin():null,bundle=db?await collectPublicationImages({db,ownerId:user.id,courseId,course:row.payload,scope:token}):undefined;
      if(url.searchParams.has('imageId')) {
        if(url.searchParams.get('reviewToken')!==token)return res.status(409).json({error:'Your course changed. Refresh the preview before reviewing this image.'});
        const entry=bundle?.entries.find(e=>e.metadata.id===url.searchParams.get('imageId'));
        if(!entry)return res.status(404).json({error:'This preview image is not available.'});
        const asset=await imageAssetStore(db).read(entry.row);
        if(!asset)throw new Error('Missing image');
        res.setHeader('Content-Type','image/png');return res.status(200).end(publicPNG(asset).bytes);
      }
      return res.status(200).json({ preview:projectPublicCourse(row.payload,bundle), updatedAt:row.updated_at,reviewToken:token });
    } catch (error) {
      const status = error.statusCode || 503;
      const messages = { incomplete:error.message, size:error.message,publication_image:error.message };
      return res.status(status).json({ code:error.code || (status===401?'account':'unavailable'), error:messages[error.code] || (status===401?'Sign in again to preview your course.':status===400?'Choose a saved course to preview.':'The latest saved course could not be loaded. Try again; nothing was published.') });
    }
  };
}
export default createPublicPreviewHandler();
