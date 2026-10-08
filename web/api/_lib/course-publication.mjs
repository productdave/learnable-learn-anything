import { createHash } from 'node:crypto';
import { projectPublicCourse } from './public-course-preview.mjs';
import { normalizePublicAuthor } from '../../js/public-author.js';

const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value==='object' ? Object.fromEntries(Object.keys(value).sort().map(key=>[key,canonical(value[key])])) : value;
export const publicationHash = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export const reviewToken = row => publicationHash({payload:row.payload,updatedAt:row.updated_at});
export const publicationId = value => /^public-[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(value || '') ? value.slice(7) : null;
export const publicStatus = row => row ? {id:`public-${row.id}`,status:row.status,version:row.version,updatedAt:row.updated_at,moderationRemoved:!!row.moderation_removed,author:row.snapshot?.publicAuthor?.displayName || '',url:`/?experience=workspace&course=public-${row.id}`} : null;
export function publicationReadiness(course,options) {
  const preview=projectPublicCourse(course,options);
  const blockers=preview.issues.filter(i=>!['author','avatar','formatting'].includes(i.code));
  if([...preview.title].length>200||[...preview.subtitle].length>600)blockers.push({code:'listing',location:'Course',message:'Use a course title up to 200 characters and a description up to 600 before publishing.'});
  if(course.failedTopics?.length)blockers.push({code:'partial',location:'Course',message:'Finish recovery before publishing.'});
  // IDs enter attributes, selectors and learner storage. Do not publish ambiguous IDs.
  for(const mod of preview.modules)for(const lesson of mod.topics){
    const ids=new Set();
    for(const s of lesson.sections){
      if(s.id && (!/^[a-z0-9-]{1,120}$/.test(s.id)||ids.has(s.id)))blockers.push({code:'identifier',location:lesson.title,message:'An activity has an invalid or repeated identifier.'});
      if(s.id)ids.add(s.id);
      if(s.type==='quiz'&&s.variant==='multiple-choice'&&(!s.options.every(o=>/^[a-z0-9-]{1,30}$/.test(o.id))||new Set(s.options.map(o=>o.id)).size!==s.options.length||!s.options.some(o=>o.id===s.correct)))blockers.push({code:'answer',location:lesson.title,message:'A quiz needs valid, distinct answer identifiers.'});
    }
  }
  return {preview,blockers};
}
export function makePublication(course,name,options) {
  const {preview,blockers}=publicationReadiness(course,options);
  const author=normalizePublicAuthor({displayName:name});
  if(typeof name!=='string'||[...name.trim()].length>80||!author||/sk-|AIza|eyJ/.test(name))throw Object.assign(new Error('Choose a public name of 1–80 characters, not an email or private key.'),{code:'author',statusCode:400});
  if(blockers.length)throw Object.assign(new Error('Resolve the content checks before publishing. Your private course is unchanged.'),{code:'blocked',statusCode:409});
  return {...preview,publicAuthor:author,issues:[],counts:{...preview.counts,moduleCount:preview.modules.length}};
}
export function publicationCourse(row) {
  const p=row.snapshot,id=`public-${row.id}`,components=new Set(['lessons']),modules={};
  const curriculum={title:p.title,subtitle:p.subtitle,modules:p.modules.map((m,index)=>{
    const number=index+1;
    modules[number]=Object.fromEntries(m.topics.map(t=>{
      for(const s of t.sections)components.add(({quiz:'quizzes',practice:'practice',checklist:'checklists'})[s.type]||'lessons');
      if(t.flashcards.length)components.add('flashcards');
      const sections=t.sections.map(s=>s.type==='image'&&s.public_image ? {type:'image',shared_image:true,src:`/api/courses/public-image?courseId=${id}&imageId=${s.public_image.id}`,alt:s.alt,...(s.caption?{caption:s.caption}:{}),width:s.public_image.width,height:s.public_image.height} : s);
      return [t.id,{id:t.id,title:t.title,estimatedMinutes:t.estimatedMinutes,sections,flashcards:t.flashcards}];
    }));
    return {id:m.id,number,title:m.title,description:m.description,icon:'book-open',color:'#4338CA',topics:m.topics.map(t=>({id:t.id,title:t.title,contentRevision:publicationHash(t).slice(0,24)}))};
  })};
  return {config:{id,name:p.title,title:p.title,subtitle:p.subtitle,storageKeyPrefix:id,documentTitle:`${p.title} | Learnable`,components:[...components],publicAuthor:p.publicAuthor,communityPublication:true,communityVersion:row.version},curriculum,modules};
}
