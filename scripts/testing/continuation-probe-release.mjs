// Read-only identity check for the accepted staging snapshot. Unlike a release
// builder, this must not regenerate historical expectations from editable source.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { baseInventory, digest, tree } from '../packaging/grounding-release.mjs';

const root = resolve(new URL('../..', import.meta.url).pathname);
export const probeRelease = Object.freeze({
  artifact: 'output/staging/2026-09-30-audio-accessibility/release-chDg81',
  parent: 'output/staging/2026-09-30-continuation/release-WxC4mz',
  deploymentId: 'dpl_J3bJvZpCJ8LxnZ2G76KeZ6a7Ashg',
  reportSha256: '6cadff7a8f223852c9b8a28ebaee91c1d48a004eb1f6b811e1483457a184a307',
  parentReportSha256: 'faa33910d17b9368f5e887f21ef9bf125cb553b7bbb5fa38ea4ebbc9b9cb990d',
});

// The injected readers are only for negative tests; normal callers use the
// actual filesystem. Neither the accepted paths nor hashes are caller inputs.
export function verifyProbeRelease({ read = readFileSync, list = tree } = {}) {
  function snapshot(relative, sha, count) {
    const artifact = join(root, relative), bytes = read(join(artifact, 'packaging-report.json'));
    assert.equal(digest(bytes), sha, 'Pinned release report changed: ' + relative);
    const report = JSON.parse(bytes), inventory = baseInventory(report);
    assert.equal(report.stagingRef, 'dmnwkrybgggbpqpetuub');
    assert.equal(Object.keys(inventory).length, count);
    const output = join(artifact, '.vercel/output');
    assert.deepEqual(list(output), Object.keys(inventory).sort(), 'Release file set changed: ' + relative);
    for (const [path, expected] of Object.entries(inventory)) {
      assert.equal(digest(read(join(output, path))), expected, 'Release bytes changed: ' + path);
    }
    return { artifact, report, inventory };
  }
  const parent = snapshot(probeRelease.parent, probeRelease.parentReportSha256, 4330);
  const current = snapshot(probeRelease.artifact, probeRelease.reportSha256, 4334);
  assert.deepEqual(current.report.groups, parent.report.groups, 'Server groups changed');
  assert.equal(current.report.configSha256, parent.report.configSha256, 'Routing changed');
  assert.equal(current.report.groups.length, 8);
  const changed = Object.keys(current.inventory).filter(path => current.inventory[path] !== parent.inventory[path]).sort();
  assert.deepEqual(changed, [
    'static/index.html',
    'static/js-workspace-recovery-20260930/app-audio.js',
    'static/js-workspace-recovery-20260930/components/topic-view-audio.js',
    'static/js-workspace-recovery-20260930/tts-audio.js',
    'static/styles-workspace-grounding-20260922/components-audio.css',
  ]);
  assert.ok(Object.keys(parent.inventory).every(path => path in current.inventory), 'Parent path removed');
  assert.deepEqual(JSON.parse(read(join(current.artifact, '.vercel/project.json'))), {
    projectId: 'prj_nphig6i4hA9E8o9Wg3nhzxyP1krB', orgId: 'team_ONTVy4HempTg7uINmG0C8P3N', projectName: 'learnable-staging',
  });
  return { artifact: current.artifact, paths: 4334, parentPaths: 4330,
    reportSha256: probeRelease.reportSha256, parentReportSha256: probeRelease.parentReportSha256,
    changedPaths: changed, serverPaths: 0, serverGroupsUnchanged: 8, routingUnchanged: true,
    parentUnchanged: true, editableSourceUsed: false, paidCalls: 0 };
}
