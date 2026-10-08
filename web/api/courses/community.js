import { serviceClient,userFromRequest } from '../_lib/supabase-server.mjs';
import { boundedJson } from '../_lib/bounded-json.mjs';
import { publicationId,publicationCourse } from '../_lib/course-publication.mjs';
import { listCommunity } from '../_lib/community-listing.mjs';
export const config={runtime:'nodejs'};
export function createCommunityHandler({admin=serviceClient,authenticate=userFromRequest,enabled=()=>process.env.LEARNABLE_SELF_PUBLISH==='1'}={}){
  return async(req,res)=>{
    res.setHeader?.('Cache-Control','no-store');res.setHeader?.('X-Content-Type-Options','nosniff');
    if(!enabled())return res.status(503).json({code:'disabled',error:'Community publishing is not enabled here yet.'});
    if(!['GET','POST'].includes(req.method))return res.status(405).json({error:'Use GET or POST.'});
    try{
      const body=req.method==='POST'?await boundedJson(req,12000):null;
      const value=body?.courseId||new URL(req.url,'http://localhost').searchParams.get('courseId'),db=admin();
      if(!value&&req.method==='GET'){
        return res.status(200).json(await listCommunity(db,new URL(req.url,'http://localhost').searchParams));
      }
      const id=publicationId(value);if(!id)return res.status(404).json({error:'Course unavailable.'});
      const result=await db.from('course_publications').select('id,snapshot,version').eq('id',id).eq('status','published').maybeSingle();
      if(result.error)throw result.error;if(!result.data)return res.status(404).json({error:'This course is no longer public.'});
      if(req.method==='GET')return res.status(200).json({course:publicationCourse(result.data)});
      const {user}=await authenticate(req);
      if(!Number.isSafeInteger(body.version)||body.version<1||!['unsafe','privacy','rights','misleading','other'].includes(body.reason)||typeof body.detail!=='string'||body.detail.trim().length<10||body.detail.length>2000)return res.status(400).json({error:'Reopen the public course, choose a reason and describe the issue in 10–2,000 characters.'});
      const report=await db.rpc('submit_course_report',{p_reporter:user.id,p_publication:id,p_version:body.version,p_reason:body.reason,p_detail:body.detail.trim()});
      if(report.error)throw report.error;
      if(report.data?.error)return res.status(report.data.error==='not_found'?404:report.data.error==='conflict'?409:400).json({error:'This public course changed or the report could not be submitted. Reopen the course and try again.'});
      return res.status(200).json({received:true});
    }catch(error){return res.status(error.statusCode||503).json({error:error.statusCode===401?'Sign in to report a course.':error.statusCode===400?'Invalid request. Check the details and try again.':'Community courses could not be loaded. Try again.'});}
  };
}
export default createCommunityHandler();
