import { curriculumFixture, lessonFixture } from './component-course.mjs';
import { assembleCourse } from '../../web/js/generator/assemble-course.js';
import { retainComponentChoices } from '../../web/js/generator/component-policy.mjs';

export function publicPreviewFixture() {
  const components=['lessons','practice','checklists','quizzes','flashcards'], brief=retainComponentChoices(curriculumFixture(),{components});
  const course=assembleCourse(brief,brief.modules.flatMap(mod=>mod.topics.map(topic=>({moduleId:mod.id,topicId:topic.id,content:lessonFixture(components,topic)}))));
  course.config.id='public-preview-qa'; course.config.title='Publishing Preview Photography QA';
  Object.assign(course,{createdBy:'private-owner@example.com',createdByUserId:'private-owner-id',_brief:{sources:{notes:[{text:'PRIVATE-NOTE-SENTINEL'}]},learner_persona:'PRIVATE-PERSONA-SENTINEL'},_research:{private:'PRIVATE-RESEARCH-SENTINEL'},_tokenUsage:{private:'PRIVATE-BILLING-SENTINEL'},_refinementProposal:{instructions:'PRIVATE-PROMPT-SENTINEL'}});
  course.config.chatSystemPrompt='PRIVATE-CHAT-SENTINEL';
  course.modules[1]['lesson-1'].sections[0]._secret='PRIVATE-SECTION-SENTINEL';
  course.modules[1]['lesson-1'].sections.push({type:'image',asset_id:'12345678-1234-4234-8234-123456789abc',image_slot:'instruction',generated_by:'openai',alt:'PRIVATE-IMAGE-ALT-SENTINEL'});
  course.modules[1]['lesson-1'].flashcards[0]._progressId='PRIVATE-PROGRESS-SENTINEL';
  return course;
}
