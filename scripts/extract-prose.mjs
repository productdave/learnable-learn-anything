// Extract reviewable prose from a course module: concept text, callouts,
// quiz questions + correct answers + explanations, takeaways. Strips HTML.
// Usage: node scripts/extract-prose.mjs <courseId> <moduleNumber>

import { readFileSync } from 'fs';
import { resolve } from 'path';

const [courseId, moduleNum] = process.argv.slice(2);
const dir = resolve('output', courseId);
const curriculum = JSON.parse(readFileSync(resolve(dir, 'curriculum.json'), 'utf8'));
const mod = curriculum.modules.find(m => String(m.number) === String(moduleNum));
const data = JSON.parse(readFileSync(resolve(dir, 'modules', `module-${moduleNum}.json`), 'utf8'));

const strip = (h) => (h || '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

console.log(`\n############ MODULE ${mod.number}: ${mod.title} ############`);
for (const t of mod.topics) {
  const topic = data[t.id];
  if (!topic) { console.log(`\n[MISSING TOPIC: ${t.id}]`); continue; }
  console.log(`\n===== TOPIC: ${topic.title} =====`);
  for (const s of topic.sections) {
    if (s.type === 'concept') {
      console.log(`\n[CONCEPT] ${s.title}`);
      console.log(strip(s.content));
    } else if (s.type === 'callout') {
      console.log(`\n[CALLOUT/${s.variant}] ${s.title || ''}`);
      console.log(strip(s.content));
    } else if (s.type === 'quiz') {
      console.log(`\n[QUIZ/${s.variant}] ${strip(s.question || s.statement || s.sentence || '')}`);
      if (s.variant === 'multiple-choice') {
        const correct = (s.options || []).find(o => o.id === s.correct);
        console.log(`  correct: ${correct ? correct.text : s.correct}`);
      } else if (s.variant === 'true-false') {
        console.log(`  correct: ${s.correct}`);
      } else if (s.variant === 'fill-in-blank') {
        console.log(`  accepts: ${(s.acceptable_answers || []).join(' | ')}`);
      } else if (s.variant === 'drag-match') {
        console.log('  pairs: ' + (s.pairs || []).map(p => `${p.left}→${p.right}`).join('; '));
      } else if (s.variant === 'short-answer') {
        console.log(`  sample: ${strip(s.sample_answer || '')}`);
      }
      if (s.explanation) console.log(`  why: ${strip(s.explanation)}`);
    } else if (s.type === 'takeaway') {
      console.log(`\n[TAKEAWAY]`);
      (s.points || []).forEach(p => console.log('  • ' + p));
    }
  }
}
