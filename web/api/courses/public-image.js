import { serviceClient } from '../_lib/supabase-server.mjs';
import { publicationId } from '../_lib/course-publication.mjs';
import { snapshotImage,readPublicationImage,publicImagesEnabled } from '../_lib/publication-images.mjs';
export const config={runtime:'nodejs'};
export function createPublicImageHandler({admin=serviceClient,readImage=readPublicationImage,enabled=()=>process.env.LEARNABLE_SELF_PUBLISH==='1'&&publicImagesEnabled()}={}) {
  return async(req,res)=>{
    res.setHeader?.('Cache-Control','no-store');res.setHeader?.('X-Content-Type-Options','nosniff');
    res.setHeader?.('Cross-Origin-Resource-Policy','same-origin');
    if(!enabled())return res.status(503).json({error:'Public images are not enabled here.'});
    if(req.method!=='GET')return res.status(405).json({error:'Use GET.'});
    const url=new URL(req.url,'http://localhost'),id=publicationId(url.searchParams.get('courseId')),imageId=url.searchParams.get('imageId');
    if(!id||!/^[a-f0-9]{64}$/.test(imageId||''))return res.status(404).json({error:'This shared image is not available.'});
    try {
      const db=admin(),lookup=()=>db.from('course_publications').select('snapshot,version').eq('id',id).eq('status','published').maybeSingle();
      const first=await lookup();if(first.error)throw first.error;
      const metadata=snapshotImage(first.data?.snapshot,imageId);
      if(!metadata)return res.status(404).json({error:'This shared image is not available.'});
      const asset=await readImage(db,metadata);
      // Close an update/unpublish window during the storage read. Already delivered
      // bytes cannot be recalled; no signed URL or cache extends future access.
      const last=await lookup();if(last.error)throw last.error;
      if(last.data?.version!==first.data.version||!snapshotImage(last.data?.snapshot,imageId))return res.status(404).json({error:'This shared image is no longer available.'});
      res.setHeader('Content-Type','image/png');res.setHeader('Content-Length',String(asset.bytes.length));return res.status(200).end(asset.bytes);
    } catch {return res.status(503).json({error:'The shared image could not be loaded. Retry loading; no image is regenerated.'});}
  };
}
export default createPublicImageHandler();
