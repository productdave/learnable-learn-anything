import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export const imageBudgetPaths = ['api/courses/images.js', 'api/_lib/supabase-server.mjs', 'api/_lib/image-request.mjs', 'api/_lib/image-execution.mjs'];
const sha = bytes => createHash('sha256').update(bytes).digest('hex');

// Deliberate, pinned four-file derivative, not a copy of the dirty checkout.
// The original release and its staging overlay must first pass their own hashes.
export function applyImageBudgetOverlay(base, source, scope) {
  assert.equal(scope.version, 1);
  assert.equal(scope.purpose, 'hobby-image-budget');
  assert.deepEqual(Object.keys(scope.files).sort(), [...imageBudgetPaths].sort(), 'Image budget overlay must contain exactly four reviewed paths.');
  const result = new Map(base);
  for (const path of imageBudgetPaths) {
    const entry = scope.files[path], prior = base.get(path), next = source.get(path);
    assert.equal(prior ? sha(prior) : null, entry.baseSha256, `Image overlay base drift: ${path}`);
    assert.ok(next, `Image overlay source missing: ${path}`);
    assert.equal(sha(next), entry.sha256, `Image overlay source drift: ${path}`);
    result.set(path, next);
  }
  return result;
}
