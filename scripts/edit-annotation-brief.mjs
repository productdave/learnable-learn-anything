// One-shot: extend the ai-annotation-platform-pm brief with deeper competitor
// coverage + a new triple-sided-platform module, then save it back so
// `--resume` generates only the new topics.

import { readFileSync, writeFileSync } from 'fs';
import { resolve } from 'path';

const briefPath = resolve('output/ai-annotation-platform-pm/_brief.json');
const brief = JSON.parse(readFileSync(briefPath, 'utf8'));

// --- 1. Expand the competitive-landscape module ----------------------
const m3 = brief.modules.find(m => m.id === 'competitive-landscape');
const existing3 = new Set(m3.topics.map(t => t.id));

const newCompetitorTopics = [
  {
    id: 'traditional-workforce-providers',
    title: 'Traditional managed-workforce providers: Appen, iMerit, Sama, TELUS International, CloudFactory',
    quiz_plan: ['multiple-choice', 'drag-match', 'true-false']
  },
  {
    id: 'feature-comparison-matrix',
    title: 'Feature comparison: annotation tooling, RLHF, evals, expert marketplace, programmatic labeling, managed service, security across all players',
    quiz_plan: ['drag-match', 'multiple-choice', 'short-answer']
  }
];
for (const t of newCompetitorTopics) {
  if (!existing3.has(t.id)) m3.topics.push(t);
}

// --- 2. Add the triple-sided-platform module ------------------------
const newModuleId = 'triple-sided-platform';
if (!brief.modules.some(m => m.id === newModuleId)) {
  brief.modules.push({
    id: newModuleId,
    number: brief.modules.length + 1, // 7
    title: 'The Triple-Sided Platform: Ecosystem, Workflow & Opportunity',
    description: 'Map the three sides of an annotation platform — AI labs/requesters, the expert workforce, and ops/QA reviewers — across their before/during/after workflow, their distinct needs and pain points at each stage, and where the biggest product opportunity sits versus the competitive field.',
    icon: 'repeat',
    color: '#0D9488',
    topics: [
      {
        id: 'ecosystem-players',
        title: 'The three sides: AI labs/requesters, the expert workforce, and ops/QA — who they are and what they want',
        quiz_plan: ['multiple-choice', 'drag-match', 'true-false']
      },
      {
        id: 'workflow-before-during-after',
        title: 'The workflow journey: before (scoping, recruiting, task design), during (labeling, QA, adjudication), after (delivery, model impact, feedback)',
        quiz_plan: ['drag-match', 'multiple-choice', 'short-answer']
      },
      {
        id: 'needs-and-pain-points',
        title: 'Needs and key pain points across the journey, broken down by side',
        quiz_plan: ['multiple-choice', 'true-false', 'short-answer']
      },
      {
        id: 'opportunity-whitespace',
        title: 'Where the biggest opportunity sits versus competitors: the underserved side and the white space',
        quiz_plan: ['short-answer', 'multiple-choice', 'drag-match']
      }
    ]
  });
}

writeFileSync(briefPath, JSON.stringify(brief, null, 2), 'utf8');

const totalTopics = brief.modules.reduce((n, m) => n + m.topics.length, 0);
console.log(`Brief updated: ${brief.modules.length} modules, ${totalTopics} topics.`);
console.log('Module 3 now has', m3.topics.length, 'topics.');
console.log('New module 7:', newModuleId);
