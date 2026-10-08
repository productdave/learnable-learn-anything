import assert from 'node:assert/strict';
import {
  appendFeedbackToBrief,
  appendFeedbackToUserBrief,
  hasCompleteResearch
} from '../web/api/gen/review.js';

const brief = {
  id: 'course-id',
  title: 'AI Agents',
  human_feedback: 'Existing direction note.',
  modules: [{ id: 'm1', title: 'Foundations' }]
};

const unchangedBrief = appendFeedbackToBrief(brief, '');
assert.equal(unchangedBrief, brief);

const revisedBrief = appendFeedbackToBrief(brief, 'Make it more applied.');
assert.notEqual(revisedBrief, brief);
assert.equal(revisedBrief.title, brief.title);
assert.equal(revisedBrief.modules, brief.modules);
assert.equal(revisedBrief.human_feedback, 'Existing direction note.\n\nMake it more applied.');
assert.equal(
  appendFeedbackToBrief(revisedBrief, 'Make it more applied.'),
  revisedBrief,
  'exact repeated curriculum feedback should not be appended twice.'
);

const freshFeedback = appendFeedbackToBrief({ title: 'No prior feedback' }, 'Add examples.');
assert.equal(freshFeedback.human_feedback, 'Add examples.');

const userBrief = {
  topic: 'AI agents',
  source_text: 'Original user notes',
  source_urls: ['https://example.com/source'],
  pdfRefs: [{ storage_path: 'user/job/source.pdf' }]
};

const unchangedUserBrief = appendFeedbackToUserBrief(userBrief, '', 'Human feedback');
assert.equal(unchangedUserBrief, userBrief);

const revisedUserBrief = appendFeedbackToUserBrief(
  userBrief,
  'Avoid enterprise fluff.',
  'Human feedback on the previous curriculum'
);
assert.notEqual(revisedUserBrief, userBrief);
assert.equal(revisedUserBrief.topic, userBrief.topic);
assert.equal(revisedUserBrief.source_urls, userBrief.source_urls);
assert.equal(revisedUserBrief.pdfRefs, userBrief.pdfRefs);
assert.equal(
  revisedUserBrief.source_text,
  'Original user notes\n\nHuman feedback on the previous curriculum:\nAvoid enterprise fluff.'
);
assert.equal(
  appendFeedbackToUserBrief(
    revisedUserBrief,
    'Avoid enterprise fluff.',
    'Human feedback on the previous curriculum'
  ),
  revisedUserBrief,
  'exact repeated user-brief feedback should not be appended twice.'
);

const fromEmptySource = appendFeedbackToUserBrief({}, 'Use concrete demos.', 'Research feedback');
assert.equal(fromEmptySource.source_text, 'Research feedback:\nUse concrete demos.');

const reviewableResearchJob = {
  brief: {
    modules: [
      { id: 'm1', title: 'Foundations' },
      { id: 'm2', title: 'Applied work' }
    ]
  },
  research: {
    m1: { key_concepts: ['one'] },
    m2: { key_concepts: ['two'] }
  }
};
assert.equal(hasCompleteResearch(reviewableResearchJob), true);
assert.equal(hasCompleteResearch({ ...reviewableResearchJob, research: { m1: { key_concepts: ['one'] } } }), false);
assert.equal(hasCompleteResearch({ ...reviewableResearchJob, research: { m1: {}, m2: { key_concepts: ['two'] } } }), false);
assert.equal(hasCompleteResearch({ brief: { modules: [] }, research: {} }), false);

console.log('gen review feedback tests passed');
