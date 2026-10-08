import {userFromRequest,serviceClient} from '../_lib/supabase-server.mjs';
import {boundedJson} from '../_lib/bounded-json.mjs';
import {publicationHash} from '../_lib/course-publication.mjs';
import {snapshotImage,readPublicationImage} from '../_lib/publication-images.mjs';
export const config={runtime:'nodejs'};
const uuid=value=>typeof value==='string'&&/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value);
const invalid=()=>Object.assign(new Error('Invalid moderation request.'),{statusCode:400});
export function moderationDecision(body) {
  if(!body||!uuid(body.reportId)||!uuid(body.operationId)||!['dismiss','remove','restore'].includes(body.action)||body.confirm!==true||!Number.isSafeInteger(body.revision)||body.revision<1||!Number.isSafeInteger(body.version)||body.version<1||typeof body.note!=='string'||body.note.trim().length<10||body.note.length>2000)throw invalid();
  return {reportId:body.reportId,operationId:body.operationId,action:body.action,revision:body.revision,version:body.version,note:body.note.trim(),confirm:true};
}
export async function requireModerator(db,userId) {
  const result=await db.from('course_moderators').select('user_id').eq('user_id',userId).eq('active',true).maybeSingle();
  if(result.error)throw result.error;
  if(!result.data)throw Object.assign(new Error('Moderator access is required.'),{statusCode:403});
}
export function createModerationHandler({authenticate=userFromRequest,admin=serviceClient,enabled=()=>process.env.LEARNABLE_MODERATION==='1',readImage=readPublicationImage}={}) {
  return async(req,res)=>{
    res.setHeader?.('Cache-Control','private, no-store');res.setHeader?.('X-Content-Type-Options','nosniff');
    if(!enabled())return res.status(503).json({code:'disabled',error:'Report review is not enabled here.'});
    if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Use GET or POST.'});
    try{
      const {user}=await authenticate(req),db=admin();await requireModerator(db,user.id);
      const params=new URL(req.url,'http://localhost').searchParams;
      if(req.method==='POST'){
        const body=moderationDecision(await boundedJson(req,12000));
        const result=await db.rpc('decide_course_report',{p_moderator:user.id,p_report:body.reportId,p_action:body.action,p_note:body.note,p_revision:body.revision,p_version:body.version,p_operation:body.operationId,p_hash:publicationHash(body)});
        if(result.error)throw result.error;
        if(result.data?.error){const code=result.data.error;return res.status(code==='forbidden'?403:code==='not_found'?404:code==='request'?400:409).json({code,error:code==='forbidden'?'Moderator access is required.':'The case or publication changed. Refresh it before deciding. Your note has not been discarded.'});}
        return res.status(200).json(result.data);
      }
      if(params.get('access')==='1')return res.status(200).json({allowed:true});
      const reportId=params.get('reportId');
      if(reportId){
        if(!uuid(reportId))throw invalid();
        const result=await db.from('course_publication_reports').select('id,publication_id,reason,detail,reported_version,evidence,status,revision,created_at,updated_at').eq('id',reportId).maybeSingle();
        if(result.error)throw result.error;if(!result.data)return res.status(404).json({code:'not_found',error:'This report is no longer available.'});
        const report=result.data,imageId=params.get('imageId');
        if(imageId){const metadata=snapshotImage(report.evidence,imageId);if(!metadata)return res.status(404).json({error:'Evidence image unavailable.'});const image=await readImage(db,metadata);await requireModerator(db,user.id);res.setHeader('Content-Type','image/png');res.setHeader('Content-Length',String(image.bytes.length));return res.status(200).end(image.bytes);}
        const [publication,audit]=await Promise.all([
          db.from('course_publications').select('id,status,version,moderation_removed,title:snapshot->>title,author:snapshot->publicAuthor').eq('id',report.publication_id).maybeSingle(),
          db.from('course_moderation_audit').select('action,note,created_at').eq('report_id',reportId).order('created_at',{ascending:false}).limit(50)
        ]);
        if(publication.error||audit.error)throw publication.error||audit.error;
        return res.status(200).json({report,publication:publication.data,audit:audit.data});
      }
      const state=params.get('status')||'open',cursor=params.get('cursor');if(!['open','closed'].includes(state))throw invalid();
      let after=null;
      if(cursor){if(cursor.length>400||!/^[A-Za-z0-9_-]+$/.test(cursor))throw invalid();try{after=JSON.parse(Buffer.from(cursor,'base64url'));}catch{throw invalid();}if(!after||!uuid(after.id)||after.status!==state||typeof after.at!=='string'||!/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(after.at)||!Number.isFinite(Date.parse(after.at)))throw invalid();}
      let query=db.from('course_publication_reports').select('id,reason,detail,status,reported_version,created_at,title:evidence->>title').eq('status',state).order('created_at',{ascending:true}).order('id',{ascending:true}).limit(21);
      if(after)query=query.or(`created_at.gt.${after.at},and(created_at.eq.${after.at},id.gt.${after.id})`);
      const result=await query;if(result.error)throw result.error;const reports=result.data.slice(0,20),last=reports.at(-1);
      return res.status(200).json({reports,nextCursor:result.data.length>20?Buffer.from(JSON.stringify({id:last.id,at:last.created_at,status:state})).toString('base64url'):null});
    }catch(error){const status=error.statusCode||503;return res.status(status).json({code:status===403?'forbidden':status===401?'auth':status===400?'request':'unavailable',error:status===401?'Sign in to review reports.':status===403?'Moderator access is required.':status===400?'Check the request and decision note.':'Report review could not be confirmed. Retry the same decision to check whether it completed.'});}
  };
}
export default createModerationHandler();
