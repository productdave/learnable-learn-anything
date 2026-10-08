// Verify that reconciling old source assertions did not remove their protections.
// Mutations exist only in the verifier's read function, never in workspace files.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

const original = readFileSync('scripts/verify-cloud-architecture.mjs', 'utf8');
const mutations = [
  ['continuation schema readiness', 'web/api/health/cloud.js', "  'continuation',\n", '', 'cloud health checks durable workflow columns'],
  ['owner-bound save', 'web/api/_lib/course-commit.mjs', 'p_owner: ownerId, p_id: courseId', 'p_owner: null, p_id: courseId', 'course save helper writes completed courses'],
  ['original course revision', 'web/api/_lib/course-commit.mjs', 'p_expected_revision: row?.payload?._courseRevision || null', 'p_expected_revision: null', 'course save helper commits owned job rows'],
  ['original course timestamp', 'web/api/_lib/course-commit.mjs', 'p_updated_at: row?.updated_at || null', 'p_updated_at: null', 'course save helper commits owned job rows'],
  ['checkpoint-bound deletion', 'web/api/gen/delete.js', "rpc('delete_generation_job_at_checkpoint'", "rpc('delete_generation_job_for_owner'", 'delete endpoint uses atomic database cleanup'],
  ['research completeness', 'web/js/research-evidence.js', 'complete: modules.length > 0 && missing === 0', 'complete: true', 'intake disables research approval'],
  ['account epoch isolation', 'web/js/sync.js', ' && store.scope().epoch === context.epoch', '', 'sync isolates API keys'],
  ['uncertain save preservation', 'web/api/_lib/gen-runner.mjs', 'courseSaveAttempt && err?.code !== GENERATION_IO_UNCERTAIN', 'courseSaveAttempt', 'runner conditionally rolls back the exact saved revision'],
  ['deadline propagation', 'web/api/gen/start.js', 'createBudget({ request: req })', 'createBudget()', 'grouped generation preserves the invocation clock'],
  ['continuation-aware expiry', 'web/api/gen/watchdog.js', 'id,owner_id,run_id,error,message,continuation', 'id,owner_id,run_id,error,message', 'watchdog stale expiry is exact-run guarded'],
  ['shared module-load origin', 'scripts/packaging/grouped-router.mjs', 'learnable.generation.startedAt', 'unread.startedAt', 'grouped generation preserves the invocation clock'],
];

function run(mutation) {
  let source = original.replace("const root = new URL('..', import.meta.url).pathname;", `const root = ${JSON.stringify(process.cwd())};`);
  assert.notEqual(source, original, 'the in-memory verifier must use this workspace root');
  if (mutation) {
    const [, path, from, to] = mutation;
    const injection = `const content = readFileSync(join(root, path), 'utf8');
      if (path !== ${JSON.stringify(path)}) return content;
      if (!content.includes(${JSON.stringify(from)})) throw new Error('Invalid mutation fixture');
      return content.replace(${JSON.stringify(from)}, ${JSON.stringify(to)});`;
    const edited = source.replace("return readFileSync(join(root, path), 'utf8');", injection);
    assert.notEqual(edited, source); source = edited;
  }
  return spawnSync(process.execPath, ['--input-type=module', '-e', source], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024 });
}

const baseline = run();
assert.equal(baseline.status, 0, baseline.stderr);
for (const mutation of mutations) {
  const result = run(mutation);
  assert.equal(result.status, 1, `${mutation[0]} must fail the gate`);
  assert.ok(result.stderr.includes(`Error: ${mutation[4]}`), `${mutation[0]} failed for the wrong reason: ${result.stderr}`);
}
console.log(`Cloud architecture guard controls passed (${mutations.length + 1} checks: clean baseline and ${mutations.length} rejected in-memory regressions; no runtime edits or network).`);
