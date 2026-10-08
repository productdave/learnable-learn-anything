// Inventory only: no generation, billing, source reads or course mutations.
const list = value => Array.isArray(value) ? value : [];
const text = value => typeof value === 'string' && !!value.trim();
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
export const sameImageLesson = (a,b) => a?.moduleId === b?.moduleId && a?.topicId === b?.topicId;
export const savedGeneratedImage = lesson => list(lesson?.sections).find(s => s?.type === 'image' && s.image_slot === 'instruction' && s.generated_by === 'openai' && uuid(s.asset_id) && text(s.alt));
export function courseImageProgress(course, requests = []) {
  const selected = list(course?.config?.components || course?._brief?.components).includes('images');
  const integrated = (course?.config?.materials_policy || course?._brief?.materials_policy) === 'integrated-visuals-v2';
  const rows = list(course?.curriculum?.modules).flatMap(mod => list(mod?.topics).map(topic => {
    const target = { moduleId:mod?.id,topicId:topic?.id }, lesson = course?.modules?.[mod?.number]?.[topic?.id];
    const available = /^[a-z0-9-]+$/.test(target.moduleId || '') && /^[a-z0-9-]+$/.test(target.topicId || '') && list(lesson?.sections).length > 0;
    const image = savedGeneratedImage(lesson);
    const decision = integrated && text(lesson?.visual?.reason) && ['generate', 'omit'].includes(lesson?.visual?.decision) ? lesson.visual.decision : null;
    const request = list(requests).find(r => r?.current === true && r.courseId === course?.config?.id && r.slot === 'instruction' && sameImageLesson(r.target,target));
    const pending = request && !request.accepted && !['cancelled','discarded'].includes(request.status);
    const state = !available ? 'blocked' : integrated && !decision ? 'unplanned' : decision === 'omit' ? 'omitted' : pending && (request.stale || ['failed','unknown'].includes(request.status)) ? 'attention'
      : pending && request.status === 'ready' ? 'review' : pending && ['queued','running','persisting'].includes(request.status) ? 'generating'
      : image ? 'saved' : 'missing';
    return { target,title:String(topic?.title || topic?.id || 'Untitled lesson'),moduleTitle:String(mod?.title || mod?.id || ''),lesson,available,image,request,state,decision,reason:decision ? lesson.visual.reason : '' };
  }));
  const count = state => rows.filter(row => row.state === state).length;
  const planned = integrated ? rows.filter(row => row.decision === 'generate') : rows;
  const saved = planned.filter(row => row.available && row.image).length;
  return { selected,integrated,rows,total:planned.length,saved,missing:planned.length-saved,omitted:count('omitted'),unplanned:count('unplanned'),review:count('review'),generating:count('generating'),attention:count('attention'),blocked:count('blocked') };
}
export function nextImageIndex(rows, current = -1) {
  for (const state of ['review','attention','missing']) {
    for (let offset=1;offset<=rows.length;offset++) {
      const index=(current+offset+rows.length)%rows.length;
      if(index!==current && rows[index].state===state)return index;
    }
  }
  return -1;
}
export const IMAGE_PROGRESS_LABELS = { missing:'Not started',blocked:'Lesson not saved',review:'Awaiting review',generating:'In progress',attention:'Needs attention',saved:'In the lesson',omitted:'Text explains this lesson clearly',unplanned:'Visual decision not saved' };
