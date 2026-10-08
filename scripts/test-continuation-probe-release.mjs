import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import test from 'node:test';
import { probeRelease, verifyProbeRelease } from './testing/continuation-probe-release.mjs';
import { tree } from './packaging/grounding-release.mjs';

const root = resolve(new URL('..', import.meta.url).pathname);
// Optional negative control runs the same acceptance case through the original
// source-coupled verifier. It must fail, without changing source or frozen files.
const legacy = process.env.LEARNABLE_PROBE_LEGACY_VERIFIER === '1';
const verify = legacy
  ? async () => {
    const { verifyContinuationRelease } = await import('./prepare-continuation-release.mjs');
    try { return verifyContinuationRelease(join(root, probeRelease.artifact)); }
    catch (error) {
      // Avoid dumping thousands of expected/actual inventory entries in TAP.
      throw Error('Legacy source-coupled verifier rejected the pinned package: ' + error.code);
    }
  }
  : verifyProbeRelease;

test('accepted frozen snapshot remains valid without reading editable workspace source', async () => {
  const result = await verify({ read(path) {
    assert.ok([probeRelease.artifact, probeRelease.parent].some(p => path.startsWith(join(root, p) + '/')),
      'Verifier read mutable source: ' + path);
    return readFileSync(path);
  } });
  assert.equal(result.paths, 4334);
  assert.equal(result.parentPaths, 4330);
  assert.equal(result.serverGroupsUnchanged, 8);
  assert.equal(result.routingUnchanged, true);
  assert.equal(result.changedPaths.length, 5);
  assert.equal(result.editableSourceUsed, false);
});

for (const release of ['parent', 'artifact']) {
  test(`${release}: altered report is rejected even when valid JSON`, () => {
    const target = join(root, probeRelease[release], 'packaging-report.json');
    assert.throws(() => verifyProbeRelease({ read: p => p === target
      ? Buffer.from(JSON.stringify({ ...JSON.parse(readFileSync(p)), status: 'tampered' })) : readFileSync(p) }),
    /Pinned release report changed/);
  });
  for (const delta of ['missing', 'extra']) {
    test(`${release}: ${delta} output file is rejected`, () => {
      const target = join(root, probeRelease[release], '.vercel/output');
      assert.throws(() => verifyProbeRelease({ list(p) {
        const paths = tree(p);
        return p !== target ? paths : delta === 'missing' ? paths.slice(1) : [...paths, 'unreviewed.js'].sort();
      } }), /Release file set changed/);
    });
  }
}
for (const [release, path] of [
  ['parent', 'functions/_functions/generation.func/api/_lib/gen-continuation.mjs'],
  ['artifact', 'functions/_functions/generation.func/api/_lib/gen-continuation.mjs'],
  ['artifact', 'config.json'],
  ['artifact', 'static/index.html'],
  ['artifact', 'static/js-workspace-recovery-20260930/tts-audio.js'],
]) {
  test(`${release}: modified bytes are rejected for ${path}`, () => {
    const target = join(root, probeRelease[release], '.vercel/output', path);
    assert.throws(() => verifyProbeRelease({ read: p => p === target
      ? Buffer.concat([readFileSync(p), Buffer.from('\n// tampered')]) : readFileSync(p) }), /Release bytes changed/);
  });
}
test('a different Vercel project binding is rejected', () => {
  const target = join(root, probeRelease.artifact, '.vercel/project.json');
  assert.throws(() => verifyProbeRelease({ read: p => p === target
    ? Buffer.from(JSON.stringify({ ...JSON.parse(readFileSync(p)), projectId: 'another-project' })) : readFileSync(p) }),
  /projectId/);
});
