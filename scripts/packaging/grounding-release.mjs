// The approved five-file September 22 staging delta, not a general overlay API.
// Reuses frozen Linux dependencies; every output byte is checked against the
// frozen package plus the exact reviewed substitutions before deployment.
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
export const groundingNamespace = 'workspace-grounding-20260922';
export const groundingBase = 'workspace-source-recovery-20260919';
export const groundingManifestPath = 'output/diagnostics/m3-readiness-20260922/reviewed-delta.json';
export const groundingBaseKit = 'output/linux-staging/build-tegnGF';
export const groundingBaseArtifact = groundingBaseKit + '/output/grouped-staging/package-f7Spcw';
export const digest = value => createHash('sha256').update(value).digest('hex');
export const readJSON = path => JSON.parse(readFileSync(path));
export function tree(dir, prefix = '') {
  return readdirSync(join(dir, prefix), { withFileTypes: true }).flatMap(entry => {
    assert.ok(!entry.isSymbolicLink(), 'No external symlinks');
    const path = prefix + entry.name;
    return entry.isDirectory() ? tree(dir, path + '/') : [path];
  }).sort();
}
export function baseInventory(report) {
  const entries = [['config.json', report.configSha256], ...Object.entries(report.staticFiles).map(([p,h]) => ['static/' + p,h])];
  for (const group of report.groups) for (const [p,h] of Object.entries(group.files)) entries.push([`functions/_functions/${group.id}.func/${p}`,h]);
  return Object.fromEntries(entries);
}
export function expectedGrounding(kit) {
  const manifestBytes = readFileSync(join(kit, 'reviewed-delta.json'));
  assert.equal(digest(manifestBytes), 'd7b298f467d6adbc0425306df9c2203cab2f339aa44a17e898f0cb27d57005ea', 'Reviewed scope drift');
  const manifest = JSON.parse(manifestBytes);
  const reportBytes = readFileSync(join(kit, 'base/packaging-report.json'));
  assert.equal(digest(reportBytes), 'b40f7a8c1d61d2d754f9e7cb2c7efc567c6a31104c911c1f79052f104d4e404f', 'Frozen base report drift');
  assert.equal(digest(readFileSync(join(kit, 'base-release.json'))), '8691e6f72b1eb68edf229237332a31bf7e7e6589d8cb92f7ae0296be30494b7c');
  const baseReport = JSON.parse(reportBytes), inventory = baseInventory(baseReport), base = join(kit, 'base/.vercel/output');
  assert.deepEqual(tree(base), Object.keys(inventory).sort());
  for (const [p,h] of Object.entries(inventory)) assert.equal(digest(readFileSync(join(base,p))), h, 'Frozen bytes drift: '+p);
  const changes = new Map(), namespace = groundingNamespace, rebase = text => text.replaceAll(`js-${groundingBase}/`,`js-${namespace}/`).replaceAll(`styles-${groundingBase}/`,`styles-${namespace}/`);
  const sources = new Map();
  for (const file of manifest.files) {
    const bytes = readFileSync(join(kit, 'source', file.path));
    assert.equal(digest(bytes),file.sha256,'Approved source drift: '+file.path);
    sources.set(file.path.slice('web/js/'.length),bytes);
    for (const prior of [file.deployedFrontend,...file.serverCopies]) {
      const path = prior.path.slice((manifest.baseArtifact+'.vercel/output/').length);
      assert.equal(inventory[path],prior.sha256,'Reviewed destination drift');
      if (file.serverCopies.includes(prior)) changes.set(path,bytes);
    }
  }
  assert.equal(changes.size,9);
  for (const path of Object.keys(inventory)) {
    const js = path.startsWith(`static/js-${groundingBase}/`), css = path.startsWith(`static/styles-${groundingBase}/`);
    if (!js && !css) continue;
    const target = path.replace(groundingBase,namespace);
    assert.ok(!inventory[target], 'Fresh browser namespace required');
    const source = js && sources.get(path.slice(`static/js-${groundingBase}/`.length));
    changes.set(target,Buffer.from(rebase((source || readFileSync(join(base,path))).toString())));
  }
  const html = readFileSync(join(base,'static/index.html'),'utf8');
  assert.ok(html.includes(`js-${groundingBase}/app.js`));
  changes.set('static/index.html',Buffer.from(rebase(html)));
  for (const [path,bytes] of changes) inventory[path] = digest(bytes);
  const overlay = {purpose:'mvp-grounding-five-file',namespace,baseNamespace:groundingBase,manifestSha256:digest(manifestBytes),baseReportSha256:digest(reportBytes),serverCopies:9,sources:Object.fromEntries(manifest.files.map(f=>[f.path,f.sha256]))};
  return { inventory, changes, overlay, baseReport };
}
export function verifyGroundingArtifact(kit, artifact) {
  const expected = expectedGrounding(kit), output = join(artifact,'.vercel/output'), report = readJSON(join(artifact,'packaging-report.json'));
  assert.deepEqual(tree(output),Object.keys(expected.inventory).sort());
  for (const [p,h] of Object.entries(expected.inventory)) assert.equal(digest(readFileSync(join(output,p))),h,'Unexpected release bytes: '+p);
  assert.deepEqual(baseInventory(report),expected.inventory);
  assert.deepEqual(report.groundingOverlay,expected.overlay);
  // Routing, launcher options, dependencies, migrations and every metadata field
  // remain the frozen baseline, apart from hashes and explicit derivative paths.
  const normalized = structuredClone(report);
  delete normalized.groundingOverlay;
  for (const key of ['artifact','work','status','staticFiles']) normalized[key] = expected.baseReport[key];
  normalized.groups.forEach((g,i)=>{ g.files = expected.baseReport.groups[i].files; });
  assert.deepEqual(normalized,expected.baseReport);
  return expected;
}
