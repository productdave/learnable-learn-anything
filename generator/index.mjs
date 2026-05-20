// Learnable — Course Generator CLI
//
// Usage:
//   node generator/index.mjs <brief.json> [--out <dir>]
//
// Reads a learner brief (topic + variables) and produces a renderer-ready
// course directory: course.json, curriculum.json, modules/module-N.json.
//
// Requires ANTHROPIC_API_KEY in the environment (or a .env file in CWD).

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import Anthropic from '@anthropic-ai/sdk';

import { runIntake } from './stages/intake.mjs';
import { runResearchAll } from './stages/research.mjs';
import { runAllTopics } from './stages/topic.mjs';
import { assembleAndWrite } from './stages/assemble.mjs';
import { getTone } from './tones/conversational.mjs';

// --- tiny .env loader (no extra dep) --------------------------------
function loadDotEnv() {
  const path = resolve(process.cwd(), '.env');
  if (!existsSync(path)) return;
  const text = readFileSync(path, 'utf8');
  for (const line of text.split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    if (!process.env[m[1]]) process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, '');
  }
}

// --- CLI arg parsing -----------------------------------------------
function parseArgs(argv) {
  const args = { briefPath: null, outDir: resolve(process.cwd(), 'output') };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out' || a === '-o') {
      args.outDir = resolve(argv[++i]);
    } else if (!args.briefPath) {
      args.briefPath = resolve(a);
    }
  }
  return args;
}

function fmtTime(ms) {
  if (ms < 1000) return `${ms}ms`;
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));
  if (!args.briefPath) {
    console.error('Usage: node generator/index.mjs <brief.json> [--out <dir>]');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY. Set it in .env or your environment.');
    process.exit(1);
  }

  const userBrief = JSON.parse(readFileSync(args.briefPath, 'utf8'));
  const tone = getTone(userBrief.tone || 'conversational');

  console.log(`\nLearnable generator — ${userBrief.topic}\n`);

  const client = new Anthropic();

  // -- Stage 1 ----
  const t1 = Date.now();
  console.log('▸ Stage 1: Intake → Course Brief');
  const brief = await runIntake(client, userBrief);
  console.log(`  → ${brief.id} | scope=${brief.scope} | ${brief.modules.length} module(s), ${brief.modules.reduce((n, m) => n + m.topics.length, 0)} topic(s) [${fmtTime(Date.now() - t1)}]`);

  // -- Stage 2 ----
  const t2 = Date.now();
  console.log('\n▸ Stage 2: Research');
  const researchResults = await runResearchAll(client, brief);
  console.log(`  done [${fmtTime(Date.now() - t2)}]`);

  // -- Stage 3 ----
  const t3 = Date.now();
  console.log('\n▸ Stage 3: Topic generation');
  const topicResults = await runAllTopics(client, brief, researchResults, tone, { concurrency: 4 });
  console.log(`  done [${fmtTime(Date.now() - t3)}]`);

  // -- Stage 4 ----
  console.log('\n▸ Stage 4: Validate + write');
  const result = assembleAndWrite(brief, topicResults, args.outDir);
  console.log(`  wrote ${result.written.length} files to ${result.courseDir}`);
  console.log(`  topics: ${result.succeededTopics}/${result.totalTopics} succeeded`);
  if (result.failedTopics.length) {
    console.log('\n  Failed topics:');
    for (const f of result.failedTopics) console.log(`    - ${f}`);
  }

  console.log(`\nTotal time: ${fmtTime(Date.now() - t1)}\n`);
}

main().catch(err => {
  console.error('\nGenerator failed:', err.message);
  if (err.errors) console.error(JSON.stringify(err.errors, null, 2));
  process.exit(1);
});
