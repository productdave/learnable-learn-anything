// Learnable — Course Generator CLI (module-by-module, resumable)
//
// Usage:
//   node generator/index.mjs <brief.json> [--out <dir>]      # fresh generation
//   node generator/index.mjs --resume <courseId> [--out <dir>]  # finish missing modules
//
// Generates one module at a time and writes each module file independently.
// A failure in one module (credits, network, validation) never destroys other
// modules. Re-running with --resume skips completed topics and only generates
// what's missing — so you never re-pay for a topic that already succeeded.
//
// Requires ANTHROPIC_API_KEY in the environment (or a .env file in CWD).

import { readFileSync, existsSync } from 'fs';
import { resolve } from 'path';
import Anthropic from '@anthropic-ai/sdk';

import { runIntake } from './stages/intake.mjs';
import { runResearch } from './stages/research.mjs';
import { runAllTopics } from './stages/topic.mjs';
import { writeManifests, loadSavedBrief, readModuleMap, writeModuleMap } from './stages/assemble.mjs';
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

function parseArgs(argv) {
  const args = { briefPath: null, outDir: resolve(process.cwd(), 'output'), resumeCourseId: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--out' || a === '-o') args.outDir = resolve(argv[++i]);
    else if (a === '--resume' || a === '-r') args.resumeCourseId = argv[++i];
    else if (!args.briefPath) args.briefPath = resolve(a);
  }
  return args;
}

function fmtTime(ms) {
  const s = ms / 1000;
  if (s < 60) return `${s.toFixed(1)}s`;
  return `${Math.floor(s / 60)}m ${Math.round(s % 60)}s`;
}

async function main() {
  loadDotEnv();
  const args = parseArgs(process.argv.slice(2));

  if (!args.resumeCourseId && !args.briefPath) {
    console.error('Usage:\n  node generator/index.mjs <brief.json> [--out <dir>]\n  node generator/index.mjs --resume <courseId> [--out <dir>]');
    process.exit(1);
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('Missing ANTHROPIC_API_KEY. Set it in .env or your environment.');
    process.exit(1);
  }

  const client = new Anthropic();
  const t0 = Date.now();

  // --- Resolve the brief (fresh Stage 1, or load a persisted one) ----
  let brief, tone;
  if (args.resumeCourseId) {
    brief = loadSavedBrief(args.outDir, args.resumeCourseId);
    tone = getTone(brief.tone || 'conversational');
    console.log(`\nLearnable generator — RESUME ${brief.id}\n`);
    console.log(`Loaded saved brief: ${brief.modules.length} module(s), ${brief.modules.reduce((n, m) => n + m.topics.length, 0)} topic(s)`);
  } else {
    const userBrief = JSON.parse(readFileSync(args.briefPath, 'utf8'));
    tone = getTone(userBrief.tone || 'conversational');
    console.log(`\nLearnable generator — ${userBrief.topic}\n`);
    const t1 = Date.now();
    console.log('▸ Stage 1: Intake → Course Brief');
    brief = await runIntake(client, userBrief);
    console.log(`  → ${brief.id} | scope=${brief.scope} | ${brief.modules.length} module(s), ${brief.modules.reduce((n, m) => n + m.topics.length, 0)} topic(s) [${fmtTime(Date.now() - t1)}]`);
  }

  // Always (re)write the manifests + persist the brief so resume works.
  const courseDir = writeManifests(brief, args.outDir);

  // --- Per-module generation -----------------------------------------
  let modulesComplete = 0;
  for (const mod of brief.modules) {
    const existing = readModuleMap(brief, mod, args.outDir);
    const missing = mod.topics.filter(t => !existing[t.id]);

    if (missing.length === 0) {
      console.log(`\n▸ Module ${mod.number} "${mod.title}" — already complete (${mod.topics.length}/${mod.topics.length}), skipping`);
      modulesComplete++;
      continue;
    }

    console.log(`\n▸ Module ${mod.number}: ${mod.title}  (${missing.length} topic(s) to generate)`);

    // Research (per module). Non-fatal if it fails — topics fall back to general knowledge.
    let bundle = null;
    const tr = Date.now();
    try {
      bundle = await runResearch(client, brief, mod);
      console.log(`  ✓ research [${fmtTime(Date.now() - tr)}]`);
    } catch (e) {
      console.log(`  ✗ research failed (${e.message.slice(0, 80)}) — continuing without it`);
    }

    // Generate only the MISSING topics for this module.
    const partialMod = { ...mod, topics: missing };
    const topicResults = await runAllTopics(client, brief, [{ mod: partialMod, bundle }], tone, { concurrency: 4 });

    // Merge new topics into whatever already existed, then write the module file.
    const merged = { ...existing };
    for (const r of topicResults) {
      if (r.content) merged[r.topicId] = r.content;
    }
    const count = writeModuleMap(brief, mod, merged, args.outDir);
    const ok = mod.topics.filter(t => merged[t.id]).length;
    console.log(`  wrote module-${mod.number}.json — ${ok}/${mod.topics.length} topics`);
    if (ok === mod.topics.length) modulesComplete++;
  }

  // --- Report ---------------------------------------------------------
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Course: ${brief.id}`);
  console.log(`Modules complete: ${modulesComplete}/${brief.modules.length}`);
  console.log(`Output: ${courseDir}`);
  if (modulesComplete < brief.modules.length) {
    console.log(`\nSome modules incomplete. Resume with:`);
    console.log(`  node generator/index.mjs --resume ${brief.id} --out ${args.outDir}`);
  }
  console.log(`Total time: ${fmtTime(Date.now() - t0)}\n`);
}

main().catch(err => {
  console.error('\nGenerator failed:', err.message);
  if (err.errors) console.error(JSON.stringify(err.errors, null, 2));
  process.exit(1);
});
