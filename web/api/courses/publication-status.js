import {userFromRequest,serviceClient} from '../_lib/supabase-server.mjs';
import {requireSafeCourseId} from './get.js';
import {publicStatus} from '../_lib/course-publication.mjs';

export const config={runtime:'nodejs'};
export function publicationCourseIds(value) {
  if(typeof value!=='string'||value.length>4024)throw Object.assign(new Error('Choose up to 25 saved courses.'),{statusCode:400});
  const ids=value.split(',');
  if(!ids.length||ids.length>25||new Set(ids).size!==ids.length)throw Object.assign(new Error('Choose up to 25 distinct saved courses.'),{statusCode:400});
  return ids.map(id=>{const safe=requireSafeCourseId(id);if(safe!==id)throw Object.assign(new Error('Invalid course id.'),{statusCode:400});return safe;});
}
export function createPublicationStatusHandler({authenticate=userFromRequest,admin=serviceClient,enabled=()=>process.env.LEARNABLE_SELF_PUBLISH==='1'}={}) {
  return async(req,res)=>{
    res.setHeader?.('Cache-Control','private, no-store');res.setHeader?.('X-Content-Type-Options','nosniff');
    if(!enabled())return res.status(503).json({code:'disabled',error:'Publication status is not enabled here.'});
    if(req.method!=='GET')return res.status(405).json({error:'Use GET.'});
    try {
      const {user,client}=await authenticate(req),ids=publicationCourseIds(new URL(req.url,'http://localhost').searchParams.get('courseIds'));
      const sources=await client.from('user_courses').select('id,updated_at').eq('owner_id',user.id).in('id',ids).limit(25);
      if(sources.error)throw sources.error;
      const owned=new Map(sources.data.map(row=>[row.id,row]));let publications=[];
      if(owned.size){
        const result=await admin().from('course_publications').select('id,source_course_id,status,version,source_revision,updated_at,moderation_removed,author:snapshot->publicAuthor').eq('owner_id',user.id).in('source_course_id',[...owned.keys()]).limit(25);
        if(result.error)throw result.error;publications=result.data;
      }
      const byCourse=new Map(publications.map(row=>[row.source_course_id,row]));
      return res.status(200).json({courses:ids.map(courseId=>{
        if(!owned.has(courseId))return {courseId,state:'unavailable',publication:null,sourceChanged:false};
        const row=byCourse.get(courseId);
        return {courseId,state:row?.moderation_removed?'restricted':row?.status||'private',publication:row?publicStatus({...row,snapshot:{publicAuthor:row.author}}):null,sourceChanged:!!row&&row.source_revision!==owned.get(courseId).updated_at};
      })});
    }catch(error){const status=error.statusCode||503;return res.status(status).json({error:status===401?'Sign in again to check publication status.':status===400?error.message:'Publication status could not be checked. Your saved courses are unchanged.'});}
  };
}
export default createPublicationStatusHandler();
