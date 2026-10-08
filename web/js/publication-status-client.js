import {getUser} from './auth.js?v=33';
import {publicationRequest} from './course-publishing.js?v=6';

// No persistent status cache. Batches avoid one network request per course card.
export function createPublicationStatusClient({getIdentity=getUser,request=publicationRequest}={}) {
  return {async load(owner,ids) {
    const guard=()=>{if(!owner||getIdentity()?.id!==owner)throw new Error('Your account changed. Reopen Your Courses.');};
    guard();const results=new Map(),unique=[...new Set(ids)];
    for(let start=0;start<unique.length;start+=25){
      guard();const batch=unique.slice(start,start+25);
      try{
        const response=await request('/api/courses/publication-status?'+new URLSearchParams({courseIds:batch.join(',')}));guard();
        if(!Array.isArray(response.courses))throw new Error('Invalid status response');
        for(const courseId of batch){const entry=response.courses.find(item=>item.courseId===courseId);results.set(courseId,entry&&['private','published','unpublished','restricted','unavailable'].includes(entry.state)?entry:{state:'error'});}
      }catch(error){guard();for(const id of batch)results.set(id,{state:'error'});}
    }
    return results;
  }};
}
