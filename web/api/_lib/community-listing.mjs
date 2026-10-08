import { createHash } from 'node:crypto';

export const COMMUNITY_PAGE_SIZE = 12;
const invalid = () => Object.assign(new Error('Invalid catalog request. Clear the search and try again.'), { statusCode: 400 });
const hash = q => createHash('sha256').update(q).digest('hex').slice(0,24);
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/;
const timestamp = value => typeof value === 'string' && /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,6})?(?:Z|\+00:00)$/.test(value) && Number.isFinite(Date.parse(value));

export function listingQuery(params, now = new Date().toISOString()) {
  const raw=params.get('q') || '';
  if(raw.length>120 || /[\u0000-\u001f\u007f]/.test(raw) || params.getAll('q').length>1 || params.getAll('cursor').length>1)throw invalid();
  const q=raw.trim(), token=params.get('cursor');
  if(!token)return {q,anchor:now,after:null};
  if(token.length>700 || !/^[A-Za-z0-9_-]+$/.test(token))throw invalid();
  let cursor;try{cursor=JSON.parse(Buffer.from(token,'base64url').toString('utf8'));}catch{throw invalid();}
  if(cursor?.v!==1 || cursor.q!==hash(q) || !timestamp(cursor.anchor) || !timestamp(cursor.at) || !uuid.test(cursor.id || '') || Date.parse(cursor.at)>Date.parse(cursor.anchor) || Date.parse(cursor.anchor)>Date.parse(now)+60000)throw invalid();
  return {q,anchor:cursor.anchor,after:{at:cursor.at,id:cursor.id}};
}

export async function listCommunity(db, params) {
  const request=listingQuery(params);
  let query=db.from('course_publications')
    .select('id,updated_at,title:snapshot->>title,subtitle:snapshot->>subtitle,author:snapshot->publicAuthor,moduleCount:snapshot->counts->>moduleCount,lessons:snapshot->counts->>lessons')
    .eq('status','published').lte('updated_at',request.anchor)
    .order('updated_at',{ascending:false}).order('id',{ascending:false}).limit(COMMUNITY_PAGE_SIZE+1);
  // Literal substring: wildcard characters are not user-controlled query syntax.
  if(request.q)query=query.ilike('listing_search','%'+request.q.replace(/[\\%_]/g,'\\$&')+'%');
  if(request.after)query=query.or(`updated_at.lt.${request.after.at},and(updated_at.eq.${request.after.at},id.lt.${request.after.id})`);
  const result=await query;if(result.error)throw result.error;
  const rows=result.data.slice(0,COMMUNITY_PAGE_SIZE),last=rows.at(-1);
  const nextCursor=result.data.length>COMMUNITY_PAGE_SIZE ? Buffer.from(JSON.stringify({v:1,q:hash(request.q),anchor:request.anchor,at:last.updated_at,id:last.id})).toString('base64url') : null;
  return {courses:rows.map(row=>({id:`public-${row.id}`,title:row.title,subtitle:row.subtitle,publicAuthor:row.author,modules:Number(row.moduleCount),topics:Number(row.lessons),emoji:'🎓'})),nextCursor};
}
