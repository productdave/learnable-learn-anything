import { userFromRequest,serviceClient } from '../_lib/supabase-server.mjs';
import { boundedJson } from '../_lib/bounded-json.mjs';
import { requireSafeCourseId } from './get.js';
import { publicationReadiness,makePublication,publicationHash,reviewToken,publicStatus } from '../_lib/course-publication.mjs';
import { collectPublicationImages,stagePublicationImages,publicImagesEnabled } from '../_lib/publication-images.mjs';
export const config={runtime:'nodejs'};
export function createPublishHandler({authenticate=userFromRequest,admin=serviceClient,enabled=()=>process.env.LEARNABLE_SELF_PUBLISH==='1',imagesEnabled=publicImagesEnabled,stageImages=stagePublicationImages}={}){
  return async(req,res)=>{
    res.setHeader?.('Cache-Control','private, no-store');
    if(!enabled())return res.status(503).json({code:'disabled',error:'Self-service publishing is not enabled here yet.'});
    if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Use GET or POST.'});
    try{
      const {user,client}=await authenticate(req),body=req.method==='POST'?await boundedJson(req,12000):null;
      const courseId=requireSafeCourseId(body?.courseId||new URL(req.url,'http://localhost').searchParams.get('courseId'));
      const source=await client.from('user_courses').select('payload,updated_at').eq('owner_id',user.id).eq('id',courseId).maybeSingle();
      if(source.error)throw source.error;
      if(!source.data||source.data.payload?.config?.id!==courseId)return res.status(404).json({code:'not_found',error:'This course is not available to your account.'});
      const db=admin(),prior=await db.from('course_publications').select('*').eq('owner_id',user.id).eq('source_course_id',courseId).maybeSingle();
      if(prior.error)throw prior.error;
      const row=source.data;
      if(!body){
        let blockers=[],imageCount=0;
        try{const bundle=imagesEnabled()?await collectPublicationImages({db,ownerId:user.id,courseId,course:row.payload,scope:reviewToken(row)}):undefined;blockers=publicationReadiness(row.payload,bundle).blockers;imageCount=bundle?.count||0;}catch(error){blockers=[{message:error.code==='publication_image'?error.message:'The saved course could not be checked. Refresh publishing status before continuing.'}];}
        if(prior.data?.moderation_removed)blockers.unshift({code:'moderation',message:'Public sharing is restricted after a moderation review. Your private course is unchanged.'});
        return res.status(200).json({reviewToken:reviewToken(row),publication:publicStatus(prior.data),blockers,imageCount,sourceChanged:!!prior.data&&prior.data.source_revision!==row.updated_at});
      }
      if(!['publish','unpublish'].includes(body.action)||!Number.isInteger(body.version)||body.version<0||!/^[a-f0-9-]{36}$/.test(body.operationId||''))return res.status(400).json({code:'request',error:'Review this course before confirming publication.'});
      const hash=publicationHash(body);
      if(prior.data?.last_operation===body.operationId){
        if(prior.data.last_hash!==hash)return res.status(409).json({code:'conflict',error:'This confirmation changed. Reload publishing status.'});
        return res.status(200).json({publication:publicStatus(prior.data),replayed:true});
      }
      if((prior.data?.version||0)!==body.version)return res.status(409).json({code:'conflict',error:'The publication changed. Refresh publishing status before continuing.'});
      let snapshot=null;
      if(body.action==='publish'){
        if(prior.data?.moderation_removed)return res.status(409).json({code:'moderation',error:'Public sharing is restricted after a moderation review. Your private course is unchanged.'});
        if(body.reviewToken!==reviewToken(row))return res.status(409).json({code:'review_changed',error:'Your saved course changed. Return to preview and review the latest version.'});
        if(body.confirmReviewed!==true||body.confirmRights!==true)return res.status(400).json({code:'confirmation',error:'Confirm your content/privacy review and permission to share.'});
        const bundle=imagesEnabled()?await collectPublicationImages({db,ownerId:user.id,courseId,course:row.payload,scope:`${user.id}/${courseId}/${body.operationId}/${hash}`}):undefined;
        snapshot=makePublication(row.payload,body.authorName,bundle);
        if(bundle?.count && body.confirmImages!==true)return res.status(400).json({code:'confirmation',error:'Review the images and alternative text, then confirm sharing these images publicly.'});
        if(bundle?.count)await stageImages(db,bundle.entries);
      }else if(body.confirmUnpublish!==true)return res.status(400).json({code:'confirmation',error:'Confirm that you want to end public access.'});
      const result=await db.rpc('commit_course_publication',{p_owner:user.id,p_course:courseId,p_action:body.action,p_version:body.version,p_source:row.payload,p_updated_at:row.updated_at,p_snapshot:snapshot,p_operation:body.operationId,p_hash:hash});
      if(result.error){if(result.error.code==='23514')return res.status(409).json({code:'moderation',error:'Public sharing is restricted after a moderation review. Refresh publishing status.'});throw result.error;}
      if(result.data?.error)return res.status(409).json({code:result.data.error,error:'The course or publication changed. Refresh and review again; any previous public version is unchanged.'});
      return res.status(200).json({publication:publicStatus(result.data.row),replayed:result.data.replayed});
    }catch(error){const status=error.statusCode||(/Request is too large|Invalid request/.test(error.message)?400:503);return res.status(status).json({code:error.code||'unavailable',error:status===401?'Sign in again to publish your course.':status<500?error.message:'The result could not be confirmed. Retry the same action to check whether it completed.'});}
  };
}
export default createPublishHandler();
