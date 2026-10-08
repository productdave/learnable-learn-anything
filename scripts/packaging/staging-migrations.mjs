import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

export function verifyStagingMigrations(manifest, files, baseScope) {
  assert.equal(manifest.version, 1);
  assert.equal(manifest.stagingRef, 'dmnwkrybgggbpqpetuub');
  assert.equal(manifest.migrations.length, 21, 'Review the full migration inventory.');
  assert.deepEqual([...files.keys()].sort(), manifest.migrations.map(row => row.path).sort());
  manifest.migrations.forEach((row, i) => {
    assert.match(row.path, new RegExp(`^db/${String(i+1).padStart(2,'0')}-[a-z-]+\\.sql$`));
    assert.equal(createHash('sha256').update(files.get(row.path)).digest('hex'), row.sha256, `Migration drift: ${row.path}`);
    if (i < 19) assert.deepEqual({path:row.path,sha256:row.sha256}, {path:baseScope.migrations[i].path,sha256:baseScope.migrations[i].sha256}, 'Previously reviewed migration changed.');
  });
  assert.equal(manifest.migrations[19].path, 'db/20-hosted-course-conflict.sql');
  assert.equal(manifest.migrations[20].path, 'db/21-private-legacy-job-archive.sql');
  return manifest.migrations;
}
