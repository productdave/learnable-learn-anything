// Fix the 5 confirmed factual errors in the annotation course, in both the
// output/ source and the deployed web/ copy. Logs a warning if any target
// string isn't found (so we know a replacement silently no-op'd).

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { resolve } from 'path';

const ROOTS = [
  'output/ai-annotation-platform-pm/modules',
  'web/data/courses/ai-annotation-platform-pm/modules'
];

// file -> [ [find, replace], ... ]   (applied with replaceAll, in order)
const FIXES = {
  'module-1.json': [
    ['By 2023, it had grown to $1.4B revenue by becoming',
     'By 2024, it had grown to roughly $870M revenue by becoming'],
    ['went from $1.4B revenue providers of image labels to',
     'went from a high-volume image-labeling provider to'],
    ["By 2024, they're pulling $1.4B in revenue by recruiting",
     "By 2025, they're projected to pull roughly $2B in revenue by recruiting"],
    ['image classification, now pulling $1.4B revenue by recruiting',
     'image classification, now pulling roughly $870M revenue (2024) by recruiting'],
    ['now a $1.4B revenue provider of expert feedback',
     'now a roughly $870M revenue provider of expert feedback']
  ],
  'module-3.json': [
    // Mercor: only the "~$500M revenue by 2024" claim (NOT the Pentagon $500M)
    ['~$500M revenue by 2024', '~$500M annualized revenue by late 2025']
  ],
  'module-4.json': [
    ['Alexandros Wang', 'Alexandr Wang']
  ],
  'module-5.json': [
    // Soften the fabricated-precision Waymo stat. Longest/most-specific first.
    ['a 10% error rate in ground truth labels (e.g., LiDAR bounding boxes) can reduce final model accuracy by up to 15%',
     'even modest label-error rates in ground-truth data (e.g., LiDAR bounding boxes) can meaningfully degrade final model accuracy'],
    ['a 10% error rate in ground truth labels can reduce final model accuracy by up to 15%',
     'even modest label-error rates in ground-truth data can meaningfully degrade final model accuracy'],
    ['a 10% error rate in ground truth can reduce final model accuracy by up to 15%',
     'even modest label-error rates in ground-truth data can meaningfully degrade final model accuracy'],
    ['10% error rate in ground truth can reduce final model accuracy by up to 15%',
     'modest label-error rates in ground-truth data can meaningfully degrade final model accuracy'],
    // Now neutralize the Waymo attribution of that (now-vague) claim.
    ['Waymo discovered that even modest label-error rates',
     'Industry analyses suggest that even modest label-error rates'],
    ['Waymo found that even modest label-error rates',
     'Industry analyses suggest that even modest label-error rates']
  ],
  'module-7.json': [
    ['Meta signed a $15 billion annotation contract with Scale',
     'Meta invested ~$14.3B for a 49% stake in Scale'],
    ['Meta contract — $15 billion — demonstrated',
     'Meta deal — ~$14.3B for a 49% stake — demonstrated'],
    ["Meta's $15 billion contract in June 2025",
     "Meta's ~$14.3B investment for a 49% Scale stake in June 2025"]
  ]
};

let totalReplaced = 0;
for (const root of ROOTS) {
  for (const [file, pairs] of Object.entries(FIXES)) {
    const path = resolve(root, file);
    if (!existsSync(path)) { console.log(`  (skip, missing) ${path}`); continue; }
    let text = readFileSync(path, 'utf8');
    for (const [find, repl] of pairs) {
      const count = text.split(find).length - 1;
      if (count === 0) {
        console.log(`  ⚠ NOT FOUND in ${root}/${file}: "${find.slice(0, 50)}…"`);
        continue;
      }
      text = text.split(find).join(repl);
      totalReplaced += count;
      console.log(`  ✓ ${root}/${file}: ${count}× "${find.slice(0, 45)}…"`);
    }
    writeFileSync(path, text, 'utf8');
  }
}
console.log(`\nTotal replacements: ${totalReplaced}`);
